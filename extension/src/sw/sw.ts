import { getRegistrableDomain, normalizeHost } from "../shared/domain";
import { initReputation, isKnownBadDomain, reputationReady } from "../shared/reputation";
import { getNavSettings, SUITE_SETTINGS_KEY } from "../shared/storage";
import { RedirectChainTracker } from "../shared/redirect_chain";
import {
  isOAuthUrl,
  extractRedirectUri,
  isUnexpectedCallback,
  type OAuthFlowState,
} from "../content/oauth_monitor";
import { swState } from "../shared/session_state";
import { updateTabIcon, clearTabIcon, setAllTabsGray, type IconState } from "./icon_manager";

const BASELINE_RULESET_ID = "baseline";

/** Cached defaultMode for synchronous access in navigation handlers. */
let cachedDefaultMode = "smart";

/** Maximum .bin file size we will read (2 MB + 16-byte header, matching MAX_FILTER_BITS). */
const MAX_REPUTATION_FILE_BYTES = 2 * 1024 * 1024 + 16;

/** Load the bloom filter into SW memory so child frames can query via message. */
async function loadReputationFilter(): Promise<void> {
  try {
    const url = chrome.runtime.getURL("reputation_data.bin");
    const response = await fetch(url);
    if (!response.ok) return;
    const cl = response.headers.get("content-length");
    if (cl && Number(cl) > MAX_REPUTATION_FILE_BYTES) return;
    const data = await response.arrayBuffer();
    if (data.byteLength > MAX_REPUTATION_FILE_BYTES) return;
    initReputation(data);
  } catch {
    // Graceful degradation: reputation checks via SW will return false
  }
}

void loadReputationFilter();
const NAV_ALLOW_TTL_MS = 1500;
const NAV_GESTURE_TTL_MS = 1500;
const NAV_TARGET_ALLOW_TTL_MS = 10000;
const ROLLBACK_SUPPRESS_MS = 6000;
const ROLLBACK_RETURN_TTL_MS = 5000;
const TYPED_ORIGIN_TTL_MS = 5_000;
const TYPED_ORIGIN_MAX_MS = 15_000;
const USER_NAV_CONTEXT_TTL_MS = 10_000;
const DBLCLICK_CHILD_MAX_AGE_MS = 5_000;
const DBLCLICK_CHILD_PRUNE_LIMIT = 50;
const OAUTH_FLOW_MAX_AGE_MS = 60_000;
const OAUTH_FLOW_PRUNE_LIMIT = 50;

// --- Session-backed state (write-through cache) ---
// In-memory Maps are the primary read path (synchronous).
// Writes are mirrored to chrome.storage.session for SW restart resilience.
// On startup, hydrate() populates these from session storage.
const allowUntilByTab = swState.allowUntilByTab;
const gestureUntilByTab = swState.gestureUntilByTab;
const allowStartedByTab = swState.allowStartedByTab;
const allowTargetByTab = swState.allowTargetByTab;
const userNavContextUntilByTab = swState.userNavContextUntilByTab;
const suppressUntilByTab = swState.suppressUntilByTab;
const typedOriginByTab = swState.typedOriginByTab;
const readyTabs = swState.readyTabs;
const pendingRollbackByTab = swState.pendingRollbackByTab;
const pendingForwardByTab = swState.pendingForwardByTab;
const rollbackReturnByTab = swState.rollbackReturnByTab;
const lastUrlByTab = swState.lastUrlByTab;
const lastCommittedByTab = swState.lastCommittedByTab;

// --- Redirect chain correlation ---
// Pass the session-backed Map so the tracker persists via swState.
const redirectChainTracker = new RedirectChainTracker(swState.redirectChainData);

// --- OAuth flow tracking per tab ---
const oauthFlowByTab = swState.oauthFlowByTab;

// --- Hydrate ephemeral state from session storage on SW startup ---
// Event listeners are registered synchronously (required by MV3), but handler
// bodies await this promise so the first event after a restart sees restored state.
const hydrateReady = swState.hydrate();

function pruneStaleOAuthFlows(): void {
  const now = Date.now();
  for (const [tabId, flow] of oauthFlowByTab) {
    if (now - flow.startedAt > OAUTH_FLOW_MAX_AGE_MS) {
      oauthFlowByTab.delete(tabId);
    }
  }
  if (oauthFlowByTab.size > OAUTH_FLOW_PRUNE_LIMIT) {
    const sorted = [...oauthFlowByTab.entries()].sort(
      (a, b) => a[1].startedAt - b[1].startedAt,
    );
    const excess = oauthFlowByTab.size - OAUTH_FLOW_PRUNE_LIMIT;
    for (let i = 0; i < excess; i++) {
      oauthFlowByTab.delete(sorted[i]![0]);
    }
  }
  swState.persistMap(oauthFlowByTab, "oauthFlow");
}

function processOAuthNavigation(tabId: number, url: string): void {
  if (!isOAuthUrl(url)) {
    const existingFlow = oauthFlowByTab.get(tabId);
    if (existingFlow && (existingFlow.phase === "redirect" || existingFlow.phase === "consent")) {
      existingFlow.phase = "callback";
      if (isUnexpectedCallback(existingFlow, url)) {
        chrome.tabs.sendMessage(
          tabId,
          { type: "ns-oauth-redirect-mismatch", callbackUrl: url },
          () => { if (chrome.runtime.lastError) { /* tab may not be ready */ } },
        );
      }
      existingFlow.phase = "complete";
      swState.persistMap(oauthFlowByTab, "oauthFlow");
      chrome.tabs.sendMessage(
        tabId,
        { type: "ns-oauth-flow-update", flow: existingFlow },
        () => { if (chrome.runtime.lastError) { /* ignore */ } },
      );
    }
    return;
  }

  const redirectUri = extractRedirectUri(url);
  let expectedCallbackDomain = "";
  if (redirectUri) {
    try {
      expectedCallbackDomain = normalizeHost(new URL(redirectUri).hostname);
    } catch {
      // malformed redirect_uri
    }
  }

  const existingFlow = oauthFlowByTab.get(tabId);
  if (existingFlow && existingFlow.phase === "redirect") {
    existingFlow.consentUrl = url;
    existingFlow.phase = "consent";
    if (expectedCallbackDomain) {
      existingFlow.expectedCallbackDomain = expectedCallbackDomain;
    }
  } else {
    pruneStaleOAuthFlows();
    const prevUrl = lastUrlByTab.get(tabId) ?? "";
    const flow: OAuthFlowState = {
      initiatorUrl: prevUrl,
      consentUrl: url,
      expectedCallbackDomain,
      startedAt: Date.now(),
      phase: "redirect",
    };
    oauthFlowByTab.set(tabId, flow);
  }
  swState.persistMap(oauthFlowByTab, "oauthFlow");

  const flow = oauthFlowByTab.get(tabId);
  if (flow) {
    chrome.tabs.sendMessage(
      tabId,
      { type: "ns-oauth-flow-update", flow },
      () => { if (chrome.runtime.lastError) { /* ignore */ } },
    );
  }
}

// --- DoubleClickjacking: track child windows opened by tabs ---
// Maps child tabId -> { openerTabId, createdAt, openerNavObserved }
// openerNavObserved is set when the child tab sends ns-dblclick-opener-nav,
// confirming it wrote to opener.location.
const childWindowByTab = swState.childWindowByTab;

function pruneStaleChildWindows(): void {
  const now = Date.now();
  // Always prune entries older than 2x the max age to prevent stale
  // correlations from tab ID reuse, regardless of map size.
  for (const [tabId, entry] of childWindowByTab) {
    if (now - entry.createdAt > DBLCLICK_CHILD_MAX_AGE_MS * 2) {
      childWindowByTab.delete(tabId);
    }
  }
  // Hard cap: if still over limit after age-based pruning, drop oldest entries.
  if (childWindowByTab.size > DBLCLICK_CHILD_PRUNE_LIMIT) {
    const sorted = [...childWindowByTab.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const excess = childWindowByTab.size - DBLCLICK_CHILD_PRUNE_LIMIT;
    for (let i = 0; i < excess; i++) {
      childWindowByTab.delete(sorted[i]![0]);
    }
  }
  swState.persistMap(childWindowByTab, "childWindow");
}

function clearPendingTabState(
  tabId: number,
  options: { preserveForwardOffer?: boolean } = {}
): void {
  readyTabs.delete(tabId);
  pendingRollbackByTab.delete(tabId);
  if (!options.preserveForwardOffer) {
    pendingForwardByTab.delete(tabId);
  }
  lastCommittedByTab.delete(tabId);
  // Persist is deferred to the caller's batch persist.
}

function trySendRollback(
  tabId: number,
  pending: { url: string; prevUrl?: string; qualifiers: string[] }
): void {
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "ns-rollback",
      url: pending.url,
      ...(pending.prevUrl !== undefined ? { prevUrl: pending.prevUrl } : {}),
      qualifiers: pending.qualifiers
    },
    () => {
      if (chrome.runtime.lastError) {
        pendingRollbackByTab.set(tabId, pending);
        readyTabs.delete(tabId);
      } else {
        pendingRollbackByTab.delete(tabId);
      }
      swState.persistMap(pendingRollbackByTab, "pendingRollback");
      swState.persistReadyTabs();
    }
  );
}

function trySendForwardOffer(
  tabId: number,
  forward: { url: string; ts: number; returnUrl?: string }
): void {
  chrome.tabs.sendMessage(tabId, { type: "ns-forward-offer", url: forward.url }, () => {
    if (chrome.runtime.lastError) {
      pendingForwardByTab.set(tabId, forward);
      readyTabs.delete(tabId);
    } else {
      pendingForwardByTab.delete(tabId);
    }
    swState.persistMap(pendingForwardByTab, "pendingForward");
    swState.persistReadyTabs();
  });
}

function getActiveRollbackReturn(tabId: number): { url: string; expiresAt: number } | null {
  const entry = rollbackReturnByTab.get(tabId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    rollbackReturnByTab.delete(tabId);
    swState.persistMap(rollbackReturnByTab, "rollbackReturn");
    return null;
  }
  return entry;
}

function hasRecentUserNavigationContext(tabId: number, now: number): boolean {
  const contextUntil = userNavContextUntilByTab.get(tabId);
  if (contextUntil !== undefined) {
    if (now <= contextUntil) return true;
    userNavContextUntilByTab.delete(tabId);
  }

  const gestureUntil = gestureUntilByTab.get(tabId);
  if (gestureUntil !== undefined && now <= gestureUntil + USER_NAV_CONTEXT_TTL_MS) {
    return true;
  }

  const priorCommit = lastCommittedByTab.get(tabId);
  return !!priorCommit?.allowedAtCommit && now - priorCommit.ts <= USER_NAV_CONTEXT_TTL_MS;
}

function rememberUserNavigationContext(tabId: number, now: number): void {
  userNavContextUntilByTab.set(tabId, now + USER_NAV_CONTEXT_TTL_MS);
}

function pruneExpiredGesture(tabId: number, now: number): void {
  const gestureUntil = gestureUntilByTab.get(tabId);
  if (gestureUntil !== undefined && now > gestureUntil) {
    gestureUntilByTab.delete(tabId);
  }
}

function isSameRegistrableNavigation(prevUrl: string | undefined, nextUrl: string): boolean {
  if (!prevUrl) return false;
  try {
    const prevUrlObj = new URL(prevUrl);
    const curUrlObj = new URL(nextUrl);
    const isHttp = (p: string) => p === "http:" || p === "https:";
    if (!isHttp(prevUrlObj.protocol) || !isHttp(curUrlObj.protocol)) return false;
    const prevReg = getRegistrableDomain(prevUrlObj.hostname.toLowerCase());
    const curReg = getRegistrableDomain(curUrlObj.hostname.toLowerCase());
    return !!prevReg && !!curReg && prevReg === curReg;
  } catch (err) {
    console.warn("[NavSentinel] same-domain check failed", err);
    return false;
  }
}

async function syncDnrRulesets(): Promise<void> {
  try {
    const settings = await getNavSettings();
    const enable = settings.dnrEnabled ? [BASELINE_RULESET_ID] : [];
    const disable = settings.dnrEnabled ? [] : [BASELINE_RULESET_ID];
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable,
      disableRulesetIds: disable
    });
  } catch (err) {
    console.warn("[NavSentinel] Failed to sync DNR rulesets", err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void syncDnrRulesets();
  chrome.action.setBadgeText({ text: "" }).catch(() => {});
  void getNavSettings().then((s) => { cachedDefaultMode = s.defaultMode; }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  void syncDnrRulesets();
  void getNavSettings().then((s) => { cachedDefaultMode = s.defaultMode; }).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes[SUITE_SETTINGS_KEY]) return;
  void syncDnrRulesets();

  const newVal = changes[SUITE_SETTINGS_KEY]!.newValue as
    | { nav?: { defaultMode?: string } }
    | undefined;
  if (newVal?.nav?.defaultMode) {
    cachedDefaultMode = newVal.nav.defaultMode;
  }
  if (newVal?.nav?.defaultMode === "off") {
    void setAllTabsGray();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "ns-reputation-check") {
    const domain = typeof message.domain === "string" ? message.domain : "";
    sendResponse?.({
      knownBad: domain ? isKnownBadDomain(domain) : false,
      filterReady: reputationReady(),
    });
    return;
  }

  if (message.type === "ns-allow-nav") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const ttl = typeof message.ttlMs === "number" ? message.ttlMs : NAV_ALLOW_TTL_MS;
      allowUntilByTab.set(tabId, Date.now() + ttl);
      swState.persistMap(allowUntilByTab, "allowUntil");
    }
    sendResponse?.({ ok: true });
  }

  if (message.type === "ns-nav-gesture") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const ttl = typeof message.ttlMs === "number" ? message.ttlMs : NAV_GESTURE_TTL_MS;
      const now = Date.now();
      gestureUntilByTab.set(tabId, now + ttl);
      if (typeof message.url === "string" && message.url) {
        lastUrlByTab.set(tabId, message.url);
      }
      rememberUserNavigationContext(tabId, now);
      typedOriginByTab.delete(tabId);
      swState.persistAll();
    }
    sendResponse?.({ ok: true });
  }

  if (message.type === "ns-allow-target-nav") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && typeof message.url === "string" && message.url) {
      const ttl = typeof message.ttlMs === "number" ? message.ttlMs : NAV_TARGET_ALLOW_TTL_MS;
      allowTargetByTab.set(tabId, {
        url: message.url,
        expiresAt: Date.now() + ttl
      });
      swState.persistMap(allowTargetByTab, "allowTarget");
    }
    sendResponse?.({ ok: true });
  }

  if (message.type === "ns-ready") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      readyTabs.add(tabId);
      swState.persistReadyTabs();
      const pending = pendingRollbackByTab.get(tabId);
      if (pending) {
        trySendRollback(tabId, pending);
      }
    }
  }

  if (message.type === "ns-check-rollback") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const entry = lastCommittedByTab.get(tabId);
      sendResponse?.({
        shouldRollback: !!entry && !entry.allowedAtCommit,
        entry,
        prevUrl: entry?.prevUrl
      });
    }
  }

  if (message.type === "ns-store-forward") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && typeof message.url === "string") {
      pendingForwardByTab.set(tabId, {
        url: message.url,
        ts: Date.now(),
        ...(typeof message.returnUrl === "string" && message.returnUrl
          ? { returnUrl: message.returnUrl }
          : {})
      });
      swState.persistMap(pendingForwardByTab, "pendingForward");
    }
  }

  if (message.type === "ns-begin-rollback") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && typeof message.returnUrl === "string" && message.returnUrl) {
      rollbackReturnByTab.set(tabId, {
        url: message.returnUrl,
        expiresAt: Date.now() + ROLLBACK_RETURN_TTL_MS
      });
      swState.persistMap(rollbackReturnByTab, "rollbackReturn");
    }
    sendResponse?.({ ok: true });
  }

  if (message.type === "ns-check-forward") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const forward = pendingForwardByTab.get(tabId);
      const currentUrl = typeof message.currentUrl === "string" ? message.currentUrl : "";
      if (forward && currentUrl && forward.url === currentUrl) {
        sendResponse?.({ status: "already_on_forward", url: "" });
        return;
      }
      if (forward && currentUrl && forward.returnUrl === currentUrl) {
        pendingForwardByTab.delete(tabId);
        swState.persistMap(pendingForwardByTab, "pendingForward");
        sendResponse?.({ status: "offer", url: forward.url });
        return;
      }
      if (forward && !forward.returnUrl) {
        pendingForwardByTab.delete(tabId);
        swState.persistMap(pendingForwardByTab, "pendingForward");
        sendResponse?.({ status: "offer", url: forward.url });
        return;
      }
      if (forward && Date.now() - forward.ts > ROLLBACK_SUPPRESS_MS) {
        pendingForwardByTab.delete(tabId);
        swState.persistMap(pendingForwardByTab, "pendingForward");
      }
      sendResponse?.({ status: "none", url: "" });
    }
  }

  if (message.type === "ns-get-chain-info") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const info = redirectChainTracker.getChainInfo(tabId);
      sendResponse?.(info ?? { depth: 0, viaKnownRedirector: false, knownRedirectorHops: 0 });
    } else {
      // No tab context (popup, devtools, etc.) -- return default to avoid
      // hanging the caller's message port.
      sendResponse?.({ depth: 0, viaKnownRedirector: false, knownRedirectorHops: 0 });
    }
    return;
  }

  if (message.type === "ns-tab-risk-update") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    const state = message.state;
    if (state !== "green" && state !== "yellow" && state !== "red" && state !== "gray") return;
    const blockCount = typeof message.blockCount === "number" &&
      Number.isFinite(message.blockCount) && message.blockCount >= 0
        ? Math.floor(message.blockCount)
        : 0;
    void updateTabIcon(tabId, state, blockCount);
  }

  // DoubleClickjacking: forward opener.location write from child to opener tab.
  // Only forward if the sender tab is a known child window to prevent
  // malicious pages from injecting false opener-nav signals.
  if (message.type === "ns-dblclick-opener-nav") {
    const childTabId = sender.tab?.id;
    if (typeof childTabId !== "number") return;
    const childEntry = childWindowByTab.get(childTabId);
    if (!childEntry) return;
    // Mark that this child performed an opener.location write so the
    // child-close signal is only sent for confirmed attack scenarios.
    childEntry.openerNavObserved = true;
    swState.persistMap(childWindowByTab, "childWindow");

    // --- OAuth: detect opener manipulation during an active OAuth flow ---
    const openerOAuthFlow = oauthFlowByTab.get(childEntry.openerTabId);
    if (openerOAuthFlow && openerOAuthFlow.phase !== "complete") {
      chrome.tabs.sendMessage(
        childEntry.openerTabId,
        { type: "ns-oauth-opener-manipulation", flow: openerOAuthFlow },
        () => { if (chrome.runtime.lastError) { /* ignore */ } },
      );
    }

    chrome.tabs.sendMessage(
      childEntry.openerTabId,
      {
        type: "ns-dblclick-opener-nav-from-child",
        url: typeof message.url === "string" ? message.url : "",
        ts: typeof message.ts === "number" ? message.ts : Date.now(),
      },
      () => {
        if (chrome.runtime.lastError) { /* opener may have navigated away */ }
      }
    );
    sendResponse?.({ ok: true });
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!swState.hydrated) { void hydrateReady.then(() => onBeforeNavigateHandler(details)); return; }
  onBeforeNavigateHandler(details);
});
function onBeforeNavigateHandler(details: chrome.webNavigation.WebNavigationParentedCallbackDetails): void {
  const forward = pendingForwardByTab.get(details.tabId);
  const rollbackReturn = getActiveRollbackReturn(details.tabId);
  const preserveForwardOffer =
    !!forward && !!rollbackReturn && rollbackReturn.url === details.url;
  clearPendingTabState(details.tabId, { preserveForwardOffer });
  if (!preserveForwardOffer) {
    rollbackReturnByTab.delete(details.tabId);
  }
  allowStartedByTab.delete(details.tabId);
  const now = Date.now();
  const allowUntil = allowUntilByTab.get(details.tabId) ?? 0;
  const gestureUntil = gestureUntilByTab.get(details.tabId) ?? 0;
  if (now > allowUntil && now > gestureUntil) {
    swState.persistAll();
    return;
  }
  allowStartedByTab.set(details.tabId, details.url);
  if (now <= gestureUntil) {
    gestureUntilByTab.delete(details.tabId);
  }
  swState.persistAll();
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!swState.hydrated) { void hydrateReady.then(() => onCommittedHandler(details)); return; }
  onCommittedHandler(details);
});
function onCommittedHandler(details: chrome.webNavigation.WebNavigationTransitionCallbackDetails): void {
  rollbackReturnByTab.delete(details.tabId);
  const now = Date.now();
  const targetAllowance = allowTargetByTab.get(details.tabId);
  const targetAllowed =
    !!targetAllowance &&
    now <= targetAllowance.expiresAt &&
    targetAllowance.url === details.url;
  if (targetAllowance) {
    allowTargetByTab.delete(details.tabId);
  }
  const prevUrl = lastUrlByTab.get(details.tabId);
  lastUrlByTab.set(details.tabId, details.url);

  // Reset tab icon for fresh top-frame navigation.
  // Content script will escalate to yellow/red as threats are detected.
  // Uses synchronous cached mode to avoid racing with content-script threat escalation.
  void updateTabIcon(details.tabId, cachedDefaultMode === "off" ? "gray" : "green");

  // --- OAuth flow tracking ---
  processOAuthNavigation(details.tabId, details.url);

  const qualifiers = details.transitionQualifiers ?? [];
  const isRedirect =
    qualifiers.includes("client_redirect") || qualifiers.includes("server_redirect");
  const isUserTyped =
    details.transitionType === "typed" ||
    details.transitionType === "auto_bookmark" ||
    qualifiers.includes("from_address_bar");
  const isLinkish = details.transitionType === "link";

  // Only record hops that are redirect-driven OR that extend an existing
  // chain (a non-redirect commit arriving within the chain window).
  // Plain user-typed and same-domain navigations should NOT inflate chain
  // depth -- they are benign and would cause false positives.
  if (isRedirect || redirectChainTracker.hasActiveChain(details.tabId, now)) {
    redirectChainTracker.recordHop(
      details.tabId,
      details.url,
      now,
      details.transitionType
    );
  }

  const typedOriginEntry = typedOriginByTab.get(details.tabId);

  if (isUserTyped && !isRedirect) {
    typedOriginByTab.set(details.tabId, { ts: now, deadline: now + TYPED_ORIGIN_MAX_MS });
  } else if (!isRedirect) {
    typedOriginByTab.delete(details.tabId);
  }

  if (isUserTyped) { swState.persistAll(); return; }
  if (!isRedirect && !isLinkish) { swState.persistAll(); return; }

  const inTypedOriginWindow = typedOriginEntry != null
    && now - typedOriginEntry.ts < TYPED_ORIGIN_TTL_MS
    && now < typedOriginEntry.deadline;
  if (inTypedOriginWindow) {
    if (isRedirect) {
      typedOriginByTab.set(details.tabId, { ts: now, deadline: typedOriginEntry.deadline });
    }
    swState.persistAll();
    return;
  }

  const allowUntil = allowUntilByTab.get(details.tabId) ?? 0;
  const startedUrl = allowStartedByTab.get(details.tabId);
  const startedAllowed = startedUrl === details.url;
  const allowedAtCommit = now <= allowUntil || startedAllowed || targetAllowed;
  allowStartedByTab.delete(details.tabId);
  const recentUserNavigationContext = hasRecentUserNavigationContext(details.tabId, now);
  pruneExpiredGesture(details.tabId, now);

  const entry = {
    url: details.url,
    ...(prevUrl !== undefined ? { prevUrl } : {}),
    transitionType: details.transitionType,
    qualifiers,
    ts: now,
    allowedAtCommit
  };

  if (allowedAtCommit) {
    lastCommittedByTab.set(details.tabId, entry);
    rememberUserNavigationContext(details.tabId, now);
    swState.persistAll();
    return;
  }

  if (!prevUrl) {
    lastCommittedByTab.delete(details.tabId);
    swState.persistAll();
    return;
  }

  if (!recentUserNavigationContext && isSameRegistrableNavigation(prevUrl, details.url)) {
    lastCommittedByTab.delete(details.tabId);
    swState.persistAll();
    return;
  }

  lastCommittedByTab.set(details.tabId, entry);

  const suppressUntil = suppressUntilByTab.get(details.tabId) ?? 0;
  if (now <= suppressUntil) { swState.persistAll(); return; }

  pendingForwardByTab.set(details.tabId, { url: details.url, ts: now });
  suppressUntilByTab.set(details.tabId, now + ROLLBACK_SUPPRESS_MS);

  if (readyTabs.has(details.tabId)) {
    trySendRollback(details.tabId, {
      url: details.url,
      ...(prevUrl !== undefined ? { prevUrl } : {}),
      qualifiers
    });
  } else {
    pendingRollbackByTab.set(details.tabId, {
      url: details.url,
      ...(prevUrl !== undefined ? { prevUrl } : {}),
      qualifiers
    });
  }
  swState.persistAll();
}

chrome.webNavigation.onErrorOccurred?.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!swState.hydrated) { void hydrateReady.then(() => onErrorOccurredHandler(details)); return; }
  onErrorOccurredHandler(details);
});
function onErrorOccurredHandler(details: { tabId: number; frameId: number; url?: string }): void {
  const forward = pendingForwardByTab.get(details.tabId);
  const rollbackReturn = getActiveRollbackReturn(details.tabId);
  const preserveForwardOffer =
    !!forward && !!rollbackReturn && !!details.url && forward.url === details.url;
  clearPendingTabState(details.tabId, { preserveForwardOffer });
  rollbackReturnByTab.delete(details.tabId);
  allowStartedByTab.delete(details.tabId);
  typedOriginByTab.delete(details.tabId);
  swState.persistAll();
}

// --- DoubleClickjacking: track tab creation with opener ---
chrome.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  if (typeof tab.openerTabId !== "number") return;
  if (!swState.hydrated) { void hydrateReady.then(() => { /* tab already tracked by next event */ }); }
  pruneStaleChildWindows();
  childWindowByTab.set(tab.id, {
    openerTabId: tab.openerTabId,
    createdAt: Date.now(),
    openerNavObserved: false
  });
  swState.persistMap(childWindowByTab, "childWindow");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!swState.hydrated) { void hydrateReady.then(() => onRemovedHandler(tabId)); return; }
  onRemovedHandler(tabId);
});
function onRemovedHandler(tabId: number): void {
  clearTabIcon(tabId);
  const childEntry = childWindowByTab.get(tabId);
  if (childEntry) {
    childWindowByTab.delete(tabId);
    const age = Date.now() - childEntry.createdAt;
    // Only notify the opener if the child actually wrote to opener.location.
    // Without this gate, benign popups (OAuth, help windows) that open and
    // self-close quickly would cause false positives.
    if (age <= DBLCLICK_CHILD_MAX_AGE_MS && childEntry.openerNavObserved) {
      // Child window closed quickly after opener.location write -- notify the opener tab.
      chrome.tabs.sendMessage(
        childEntry.openerTabId,
        { type: "ns-dblclick-child-closed", childTabId: tabId, ageMs: age },
        () => {
          // Ignore errors if the opener tab's content script isn't ready.
          if (chrome.runtime.lastError) { /* expected if tab navigated away */ }
        }
      );
    }
  }

  allowUntilByTab.delete(tabId);
  gestureUntilByTab.delete(tabId);
  allowStartedByTab.delete(tabId);
  allowTargetByTab.delete(tabId);
  userNavContextUntilByTab.delete(tabId);
  suppressUntilByTab.delete(tabId);
  rollbackReturnByTab.delete(tabId);
  typedOriginByTab.delete(tabId);
  redirectChainTracker.deleteTab(tabId);
  oauthFlowByTab.delete(tabId);
  clearPendingTabState(tabId);
  lastUrlByTab.delete(tabId);
  // Batch persist all cleanup in one storage write
  swState.persistAll();
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const pendingRollback = pendingRollbackByTab.get(tabId);
  if (pendingRollback && (changeInfo.status === "complete" || changeInfo.url)) {
    trySendRollback(tabId, pendingRollback);
  }

  const forward = pendingForwardByTab.get(tabId);
  if (!forward) return;
  if (changeInfo.status !== "complete" && !changeInfo.url) return;
  const currentUrl = tab.url ?? changeInfo.url ?? "";
  if (!currentUrl) return;
  if (currentUrl === forward.url) return;
  if (!readyTabs.has(tabId)) return;
  trySendForwardOffer(tabId, forward);
});
