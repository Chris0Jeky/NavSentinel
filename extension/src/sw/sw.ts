import { getRegistrableDomain, normalizeHost } from "../shared/domain";
import { initReputation, isKnownBadDomain, reputationReady } from "../shared/reputation";
import {
  getNavSettings,
  appendEvent,
  handleEventLogAppendMessage,
  handlePromptOutcomeStorageMessage,
  isEventLogAppendMessage,
  isPromptOutcomeStorageMessage,
  SUITE_SETTINGS_KEY,
} from "../shared/storage";
import { RedirectChainTracker } from "../shared/redirect_chain";
import {
  isOAuthUrl,
  extractRedirectUri,
  hasOAuthResponseParams,
  isUnexpectedCallback,
  type OAuthFlowState,
} from "../content/oauth_monitor";
import { swState } from "../shared/session_state";
import { updateTabIcon, clearTabIcon, setAllTabsGray } from "./icon_manager";

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
const MAX_TTL_MS = 30_000;
const MAX_GESTURE_TTL_MS = 3_000;

function clampTtl(raw: unknown, fallback: number, ceiling = MAX_TTL_MS): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(raw, ceiling);
}
const ROLLBACK_SUPPRESS_MS = 6000;
const ROLLBACK_RETURN_TTL_MS = 5000;
const TYPED_ORIGIN_TTL_MS = 5_000;
const TYPED_ORIGIN_MAX_MS = 15_000;
const USER_NAV_CONTEXT_TTL_MS = 10_000;
const DBLCLICK_CHILD_MAX_AGE_MS = 5_000;
const DBLCLICK_CHILD_PRUNE_LIMIT = 50;
const OAUTH_FLOW_MAX_AGE_MS = 60_000;
const OAUTH_FLOW_PRUNE_LIMIT = 50;

// Defensive per-tab rate limit for viewport captures (visual-sim). Capturing
// the viewport is comparatively expensive and should be bounded even if a page
// somehow drives repeated requests. Session-backed via SessionStateManager so
// the limit survives a SW restart — otherwise a page could force the ephemeral
// worker to recycle between bursts to reset the counter and bypass the cap.
// The capture handler gates on swState.hydrated so a restarted worker reads the
// persisted counts before deciding. Residual: persistMap is fire-and-forget, so
// if the worker dies between the in-memory push and the session.set flush, one
// attempt can be lost (at most a small slack within a window) — best-effort, not
// a hard guarantee; the handler awaits captureVisibleTab which keeps the worker
// alive long enough to flush in practice.
const CAPTURE_RATE_WINDOW_MS = 60_000;
const CAPTURE_RATE_MAX_PER_WINDOW = 3;
const CAPTURE_RATE_PRUNE_LIMIT = 200;
const captureTimestampsByTab = swState.captureTimestampsByTab;

/**
 * Returns true if a viewport capture is allowed for this tab right now, and
 * records the attempt. Drops requests beyond CAPTURE_RATE_MAX_PER_WINDOW within
 * CAPTURE_RATE_WINDOW_MS.
 */
function allowViewportCapture(tabId: number, now = Date.now()): boolean {
  const cutoff = now - CAPTURE_RATE_WINDOW_MS;
  // Defensive: a corrupt session value could restore as a non-array (SessionState
  // _restoreMap does not validate per-entry shape), which would throw on .filter.
  const stored = captureTimestampsByTab.get(tabId);
  const recent = (Array.isArray(stored) ? stored : []).filter((ts) => ts >= cutoff);
  if (recent.length >= CAPTURE_RATE_MAX_PER_WINDOW) {
    captureTimestampsByTab.set(tabId, recent);
    swState.persistMap(captureTimestampsByTab, "captureTimestamps");
    return false;
  }
  recent.push(now);
  captureTimestampsByTab.set(tabId, recent);
  // Bound the map size against tab churn (entries are cleared on tab removal,
  // but prune defensively in case a removal event is missed).
  if (captureTimestampsByTab.size > CAPTURE_RATE_PRUNE_LIMIT) {
    for (const [id, list] of captureTimestampsByTab) {
      // Same defensive guard as above: a corrupt non-array entry for any tab
      // must not throw here and hang the (synchronous-path) message port.
      const live = (Array.isArray(list) ? list : []).filter((ts) => ts >= cutoff);
      if (live.length === 0) captureTimestampsByTab.delete(id);
      else captureTimestampsByTab.set(id, live);
    }
  }
  swState.persistMap(captureTimestampsByTab, "captureTimestamps");
  return true;
}

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

// Refresh the synchronously-read cachedDefaultMode on every worker start. MV3
// restarts the SW on any waking event (navigation/message), not just install or
// browser start, so onInstalled/onStartup do not fire on a mid-session restart.
// Without this, cachedDefaultMode would stay at the "smart" default until the
// next storage change and onCommittedHandler would paint the toolbar badge green
// even when the user's persisted mode is "off". Running it here subsumes the
// install/startup paths too (the listeners only fire if this module evaluated).
// (#303)
const cachedModeReady = getNavSettings()
  .then((s) => { cachedDefaultMode = s.defaultMode; })
  .catch(() => {});

// onCommitted reads cachedDefaultMode synchronously. swState.hydrated flips true
// when session storage resolves, but cachedModeReady waits on local storage (a
// separate concurrent read) -- so gating onCommitted on swState.hydrated alone
// would let a navigation in the "session-resolved, mode-not-yet-read" window run
// with the stale default. startupSettled flips true only after BOTH have landed,
// so onCommitted (below) gates on it instead. A later storage.onChanged can still
// briefly race the startup read (its read may resolve after the change and write
// back the pre-change value), exactly as the historical onStartup refresh could;
// that window is transient and self-heals on the next change. (#303)
const startupReady = Promise.all([hydrateReady, cachedModeReady]);
let startupSettled = false;
void startupReady.then(() => { startupSettled = true; });

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

function processOAuthNavigation(
  tabId: number,
  url: string,
  initiatorUrl: string,
  isUserTyped: boolean,
): void {
  const existingFlow = oauthFlowByTab.get(tabId);

  // --- Callback detection (runs REGARDLESS of isOAuthUrl) ---
  // A commit that carries an OAuth RESPONSE (code/error in query, or access_token/
  // id_token in query or fragment) during an active flow IS the callback. This is
  // checked BEFORE the isOAuthUrl gate on purpose: an attacker callback can be
  // crafted to ALSO satisfy isOAuthUrl — an oauth-keyword path segment (e.g.
  // "/oauth/cb") plus an OAuth request param such as `scope` — and when the callback
  // logic lived inside the `!isOAuthUrl` branch, such a callback skipped mismatch
  // detection entirely and fell through to fresh-flow creation, so no +30
  // ns-oauth-redirect-mismatch fired. (#222)
  //
  // Gates that keep this from firing on legitimate traffic (preserved from #207):
  //   (a) Only an active flow in redirect/consent can have a callback.
  //   (b) Excludes user-typed/bookmarked navigations — a real callback arrives via a
  //       redirect, link click, or form submit — so a benign typed page carrying a
  //       generic ?code= (e.g. a coupon) does not trip.
  //   (c) Requires an OAuth RESPONSE payload (code/error/token), NOT merely `state`,
  //       so genuine intermediate provider authorization hops (e.g.
  //       login.live.com/oauth20_authorize.srf?...&state=...) are not mis-classified.
  //   (d) Only fires the +30 mismatch when the registrable domain differs from the
  //       redirect_uri host recorded at flow start (isUnexpectedCallback).
  //
  // Residual: a benign redirect/link page on another domain that happens to carry a
  // generic ?code=/?error= during an active flow can still mismatch (tracked as a
  // follow-up). An abandoned flow lingers in redirect/consent until the 60s
  // age-prune rather than being force-completed (bounded by OAUTH_FLOW_MAX_AGE_MS).
  if (
    existingFlow &&
    (existingFlow.phase === "redirect" || existingFlow.phase === "consent") &&
    !isUserTyped &&
    hasOAuthResponseParams(url)
  ) {
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
    return;
  }

  // Not a callback. A non-OAuth commit has nothing further to do here; an
  // authorization REQUEST (isOAuthUrl) continues to flow-creation below.
  if (!isOAuthUrl(url)) return;

  const redirectUri = extractRedirectUri(url);
  let expectedCallbackDomain = "";
  if (redirectUri) {
    try {
      expectedCallbackDomain = normalizeHost(new URL(redirectUri).hostname);
    } catch {
      // malformed redirect_uri
    }
  }

  if (existingFlow && (existingFlow.phase === "redirect" || existingFlow.phase === "consent")) {
    // A second authorization URL within an active (pre-callback) flow updates it
    // IN PLACE rather than overwriting it with a fresh flow. Critically, the
    // expectedCallbackDomain is only overwritten when the new URL actually carries
    // one (the `if` below), so a second /authorize WITHOUT a redirect_uri cannot
    // WIPE the domain the first URL established. Without this, an injected second
    // OAuth URL would reset expectedCallbackDomain to "" and isUnexpectedCallback
    // would then pass any callback unconditionally. (#324 / disc#4)
    existingFlow.consentUrl = url;
    existingFlow.phase = "consent";
    if (expectedCallbackDomain) {
      existingFlow.expectedCallbackDomain = expectedCallbackDomain;
    }
    // initiatorUrl and startedAt are intentionally kept from the original flow: a
    // second authorization URL is treated as a continuation of the same flow, and
    // initiatorUrl is display-only (not consulted by isUnexpectedCallback).
  } else {
    pruneStaleOAuthFlows();
    const flow: OAuthFlowState = {
      // The page that initiated the flow — the URL committed BEFORE this consent
      // navigation. Passed in from onCommittedHandler, which captures it before
      // overwriting lastUrlByTab; re-reading the map here would yield the consent
      // URL itself. (#207)
      initiatorUrl,
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

// Tabs removed within REMOVED_TAB_TTL_MS. A rollback/forward send callback can
// fire AFTER the tab was closed (the lastError is usually *because* it closed);
// re-queuing the pending entry then leaves a zombie for a dead tab. Suppress the
// re-queue in that window. Module-level (not session-backed): a restart clears it,
// and a dead tab never fires onUpdated, so this only matters in-session. The TTL is
// kept short (real dead-port sendMessage callbacks fire in ~100-500ms) so a tab id
// that Chrome reuses soon after close is not wrongly suppressed. (#323 / disc#7)
const REMOVED_TAB_TTL_MS = 5_000;
const REMOVED_TAB_PRUNE_LIMIT = 256;
const recentlyRemovedTabs = new Map<number, number>(); // tabId -> removedAt

// Tabs with a rollback/forward message send currently in flight. onUpdated can
// fire twice (loading->complete, or url+status) before the async sendMessage
// callback resolves; without this guard the second fire re-reads the SAME pending
// entry and re-sends (double modal). Unlike a pre-delete, the pending entry stays
// in the (persisted) map until the callback resolves it, so a worker death mid-send
// cannot drop it. Cleared in the send callback. Module-level. (#323 / disc#3)
const rollbackSendInFlight = new Set<number>();
const forwardSendInFlight = new Set<number>();

function noteTabRemoved(tabId: number, now: number): void {
  recentlyRemovedTabs.set(tabId, now);
  if (recentlyRemovedTabs.size > REMOVED_TAB_PRUNE_LIMIT) {
    for (const [id, ts] of recentlyRemovedTabs) {
      if (now - ts >= REMOVED_TAB_TTL_MS) recentlyRemovedTabs.delete(id);
    }
    // Hard cap backstop: drop oldest-inserted if still over the limit.
    while (recentlyRemovedTabs.size > REMOVED_TAB_PRUNE_LIMIT) {
      const oldest = recentlyRemovedTabs.keys().next().value;
      if (oldest === undefined) break;
      recentlyRemovedTabs.delete(oldest);
    }
  }
}

function wasTabRecentlyRemoved(tabId: number, now: number): boolean {
  const ts = recentlyRemovedTabs.get(tabId);
  return ts !== undefined && now - ts < REMOVED_TAB_TTL_MS;
}

function trySendRollback(
  tabId: number,
  pending: { url: string; prevUrl?: string; qualifiers: string[] }
): void {
  rollbackSendInFlight.add(tabId); // onUpdated skips a re-send while this is set (#323/disc#3)
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "ns-rollback",
      url: pending.url,
      ...(pending.prevUrl !== undefined ? { prevUrl: pending.prevUrl } : {}),
      qualifiers: pending.qualifiers
    },
    () => {
      rollbackSendInFlight.delete(tabId);
      if (chrome.runtime.lastError) {
        readyTabs.delete(tabId);
        // Re-queue for retry, but not for a tab that closed during the send (#323/disc#7):
        // onRemoved fires synchronously and clearPendingTabState already deleted the
        // entry, so skipping the re-queue here leaves no zombie. NOTE: this re-queue can
        // still clobber a newer pending entry written during the async gap (#323/disc#5/#6)
        // — that needs the per-tab send-generation guard tracked separately; unchanged here.
        if (!wasTabRecentlyRemoved(tabId, Date.now())) {
          pendingRollbackByTab.set(tabId, pending);
        }
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
  forwardSendInFlight.add(tabId); // onUpdated skips a re-send while this is set (#323/disc#3)
  chrome.tabs.sendMessage(tabId, { type: "ns-forward-offer", url: forward.url }, () => {
    forwardSendInFlight.delete(tabId);
    if (chrome.runtime.lastError) {
      readyTabs.delete(tabId);
      if (!wasTabRecentlyRemoved(tabId, Date.now())) {
        pendingForwardByTab.set(tabId, forward);
      }
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

chrome.runtime.onInstalled.addListener((details) => {
  void syncDnrRulesets();
  chrome.action.setBadgeText({ text: "" }).catch(() => {});
  // cachedDefaultMode is refreshed by the worker-start cachedModeReady above,
  // which also runs on install/update, so no separate read is needed here. (#303)

  if (details.reason === "install") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("src/onboarding/onboarding.html"),
    }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  void syncDnrRulesets();
  // cachedDefaultMode is refreshed by the worker-start cachedModeReady above
  // (which runs on browser start too), so no separate read is needed here. (#303)
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

// Gate a session-backed message handler on hydration (#228.1). On a cold SW the
// runtime onMessage event can fire before _doHydrate's async storage.session.get
// resolves. A handler that mutates a session-backed map before that would have
// its persist dropped (persistMap is a pre-hydrate no-op) and then be clobbered
// when _restoreMap merges the stale stored value back; read handlers would see
// empty maps. Both cause false rollbacks/blocks on legitimate navigations. Defer
// the body until hydration (hydrateReady is already resolved by the time it runs)
// and return true so the message port stays open for any deferred sendResponse.
function runWhenHydrated(run: () => void, keepPortOpen = true): boolean {
  if (swState.hydrated) {
    run();
  } else {
    void hydrateReady.then(run).catch((err) => {
      // A deferred body that throws loses its (optional) sendResponse. The gated
      // read handlers (Map.get / getChainInfo) cannot throw on restored data, and
      // every content-side caller checks chrome.runtime.lastError and recovers, so
      // error-path response recovery is intentionally delegated to the caller
      // rather than emitting a per-handler neutral default here (R2 NIT).
      console.warn("[NavSentinel] deferred session-backed message handler failed:", err);
    });
  }
  // Returning true holds the message port open for a (possibly deferred)
  // sendResponse. Handlers that never respond pass keepPortOpen=false so they do
  // not leave a dangling port (R1 finding 3).
  return keepPortOpen;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (isPromptOutcomeStorageMessage(message)) {
    void handlePromptOutcomeStorageMessage(message, sender)
      .then((response) => sendResponse?.(response))
      .catch((err) => {
        sendResponse?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  if (isEventLogAppendMessage(message)) {
    void handleEventLogAppendMessage(message)
      .then((response) => sendResponse?.(response))
      .catch((err) => {
        sendResponse?.({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
    return true;
  }

  if (message.type === "ns-reputation-check") {
    const domain = typeof message.domain === "string" ? message.domain : "";
    sendResponse?.({
      knownBad: domain ? isKnownBadDomain(domain) : false,
      filterReady: reputationReady(),
    });
    return;
  }

  if (message.type === "ns-allow-nav") {
    return runWhenHydrated(() => {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        const ttl = clampTtl(message.ttlMs, NAV_ALLOW_TTL_MS);
        allowUntilByTab.set(tabId, Date.now() + ttl);
        swState.persistMap(allowUntilByTab, "allowUntil");
      }
      sendResponse?.({ ok: true });
    });
  }

  if (message.type === "ns-nav-gesture") {
    return runWhenHydrated(() => {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        const ttl = clampTtl(message.ttlMs, NAV_GESTURE_TTL_MS, MAX_GESTURE_TTL_MS);
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
    });
  }

  if (message.type === "ns-allow-target-nav") {
    return runWhenHydrated(() => {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number" && typeof message.url === "string" && message.url) {
        const lower = message.url.toLowerCase();
        const isHttp = lower.startsWith("http:") || lower.startsWith("https:");
        if (isHttp) {
          const ttl = clampTtl(message.ttlMs, NAV_TARGET_ALLOW_TTL_MS);
          allowTargetByTab.set(tabId, {
            url: message.url,
            expiresAt: Date.now() + ttl,
            ...(message.matchQueryPrefix === true ? { matchQueryPrefix: true } : {}),
            ...(isEventLogAppendMessage({ type: "ns-event-log-append", entry: message.silentEvent })
              ? { silentEvent: message.silentEvent }
              : {})
          });
          swState.persistMap(allowTargetByTab, "allowTarget");
        }
      }
      sendResponse?.({ ok: true });
    });
  }

  if (message.type === "ns-ready") {
    return runWhenHydrated(() => {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        readyTabs.add(tabId);
        swState.persistReadyTabs();
        const pending = pendingRollbackByTab.get(tabId);
        // Skip if a send is already in flight (e.g. an onUpdated-triggered send, or
        // a rapid duplicate ns-ready) so we don't double-send the same rollback. (#323/disc#3)
        if (pending && !rollbackSendInFlight.has(tabId)) {
          trySendRollback(tabId, pending);
        }
      }
    }, false);
  }

  if (message.type === "ns-check-rollback") {
    return runWhenHydrated(() => {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        const entry = lastCommittedByTab.get(tabId);
        sendResponse?.({
          shouldRollback: !!entry && !entry.allowedAtCommit,
          entry,
          prevUrl: entry?.prevUrl
        });
      } else {
        sendResponse?.({ shouldRollback: false, entry: undefined, prevUrl: undefined });
      }
    });
  }

  if (message.type === "ns-store-forward") {
    return runWhenHydrated(() => {
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
    }, false);
  }

  if (message.type === "ns-begin-rollback") {
    return runWhenHydrated(() => {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number" && typeof message.returnUrl === "string" && message.returnUrl) {
        rollbackReturnByTab.set(tabId, {
          url: message.returnUrl,
          expiresAt: Date.now() + ROLLBACK_RETURN_TTL_MS
        });
        swState.persistMap(rollbackReturnByTab, "rollbackReturn");
      }
      sendResponse?.({ ok: true });
    });
  }

  if (message.type === "ns-check-forward") {
    return runWhenHydrated(() => {
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
      } else {
        sendResponse?.({ status: "none", url: "" });
      }
    });
  }

  if (message.type === "ns-get-chain-info") {
    // Session-backed: redirectChainTracker reads swState.redirectChainData, so on a
    // cold SW it must wait for hydration or it returns the empty depth:0 default
    // and weakens redirect-chain scoring during the post-recycle window (#228.1).
    return runWhenHydrated(() => {
      const tabId = sender.tab?.id;
      if (typeof tabId === "number") {
        const info = redirectChainTracker.getChainInfo(tabId);
        sendResponse?.(info ?? { depth: 0, viaKnownRedirector: false, knownRedirectorHops: 0 });
      } else {
        // No tab context (popup, devtools, etc.) -- return default to avoid
        // hanging the caller's message port.
        sendResponse?.({ depth: 0, viaKnownRedirector: false, knownRedirectorHops: 0 });
      }
    });
  }

  if (message.type === "ns-capture-viewport") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    if (typeof tabId !== "number" || typeof windowId !== "number") {
      sendResponse?.({ dataUrl: null });
      return;
    }
    const runCapture = (): void => {
      // Defensive per-tab throttle: drop excess captures and return null safely.
      if (!allowViewportCapture(tabId)) {
        sendResponse?.({ dataUrl: null });
        return;
      }
      chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse?.({ dataUrl: null });
          return;
        }
        sendResponse?.({ dataUrl });
      });
    };
    // Gate on hydration: a freshly-restarted worker must see the persisted
    // per-tab counts before deciding, otherwise a capture in the pre-hydrate
    // window reads an empty map (allowed) and its write is discarded when
    // _restoreMap merges the persisted entry back (overwriting the tab's key) —
    // reopening the recycle-between-bursts bypass this slice closes. Defer until
    // hydrated (keeps the port open). The .catch closes the port on any
    // unexpected throw so the response promise can never hang.
    if (!swState.hydrated) {
      void hydrateReady.then(runCapture).catch(() => sendResponse?.({ dataUrl: null }));
    } else {
      runCapture();
    }
    return true;
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
    return runWhenHydrated(() => {
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
    });
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
    // Clear any active rollback-suppress window on a genuine new navigation. The
    // suppress window exists ONLY to stop the rollback-return commit (the
    // preserveForwardOffer case) from re-triggering a rollback; if it survived a
    // forward navigation, a second suspicious URL committed within the 6s window
    // would be silently skipped by onCommittedHandler's suppress check. (disc#1)
    suppressUntilByTab.delete(details.tabId);
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
  // Defer until startupSettled (hydration AND the cachedDefaultMode read both
  // landed) so any navigation during wake-up paints the badge with the restored
  // mode, not the "smart" default -- not just the first one. (#303)
  if (!startupSettled) { void startupReady.then(() => onCommittedHandler(details)); return; }
  onCommittedHandler(details);
});
function onCommittedHandler(details: chrome.webNavigation.WebNavigationTransitionCallbackDetails): void {
  rollbackReturnByTab.delete(details.tabId);
  const now = Date.now();
  const targetAllowance = allowTargetByTab.get(details.tabId);
  const targetAllowed =
    !!targetAllowance &&
    now <= targetAllowance.expiresAt &&
    allowTargetMatchesCommit(targetAllowance, details.url);
  if (targetAllowance) {
    allowTargetByTab.delete(details.tabId);
  }
  if (targetAllowed && targetAllowance?.silentEvent) {
    void appendEvent(targetAllowance.silentEvent);
  }
  const prevUrl = lastUrlByTab.get(details.tabId);
  lastUrlByTab.set(details.tabId, details.url);

  // Reset tab icon for fresh top-frame navigation.
  // Content script will escalate to yellow/red as threats are detected.
  // Uses synchronous cached mode to avoid racing with content-script threat escalation.
  void updateTabIcon(details.tabId, cachedDefaultMode === "off" ? "gray" : "green");

  const qualifiers = details.transitionQualifiers ?? [];
  const isRedirect =
    qualifiers.includes("client_redirect") || qualifiers.includes("server_redirect");
  const isUserTyped =
    details.transitionType === "typed" ||
    details.transitionType === "auto_bookmark" ||
    qualifiers.includes("from_address_bar");
  const isLinkish = details.transitionType === "link";

  // --- OAuth flow tracking ---
  // Pass prevUrl (captured above, before the lastUrlByTab overwrite) so a new flow's
  // initiatorUrl is the initiating page, not the consent URL; and whether this commit
  // was user-initiated address entry (typed / bookmark / address-bar). A real OAuth
  // callback arrives via a redirect, a link click, or a form submit — never a typed
  // URL — so excluding ONLY the user-typed transitions stops a benign typed/bookmarked
  // ?code= page from tripping a false redirect-mismatch, while still accepting
  // link-click and gesture-driven JS callbacks (which carry no redirect qualifier). (#207)
  processOAuthNavigation(details.tabId, details.url, prevUrl ?? "", isUserTyped);

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

  const inTypedOriginWindow = typedOriginEntry !== null && typedOriginEntry !== undefined
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

function allowTargetMatchesCommit(
  targetAllowance: { url: string; matchQueryPrefix?: boolean },
  committedUrl: string
): boolean {
  if (targetAllowance.url === committedUrl) return true;
  if (!targetAllowance.matchQueryPrefix) return false;
  try {
    const allowed = new URL(targetAllowance.url);
    const committed = new URL(committedUrl);
    if (allowed.protocol !== committed.protocol || allowed.host !== committed.host) return false;
    if (allowed.pathname !== committed.pathname) return false;
    if (allowed.hash && allowed.hash !== committed.hash) return false;
    if (!allowed.search) return true;
    return committed.search === allowed.search || committed.search.startsWith(`${allowed.search}&`);
  } catch {
    return false;
  }
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
  const tabId = tab.id;
  const openerTabId = tab.openerTabId;
  // Before hydration, persistMap() early-returns (SessionStateManager skips
  // writes while !hydrated), so a synchronous set here would NOT be persisted —
  // the entry would live only in memory and be lost on the next SW restart,
  // silently dropping the opener relationship for DoubleClickjacking. Defer the
  // real tracking to after restore (matching onRemoved/onBeforeNavigate) so the
  // handler runs once hydrated and its persistMap actually writes.
  if (!swState.hydrated) {
    void hydrateReady.then(() => onCreatedHandler(tabId, openerTabId));
    return;
  }
  onCreatedHandler(tabId, openerTabId);
});
function onCreatedHandler(tabId: number, openerTabId: number): void {
  pruneStaleChildWindows();
  childWindowByTab.set(tabId, {
    openerTabId,
    createdAt: Date.now(),
    openerNavObserved: false
  });
  swState.persistMap(childWindowByTab, "childWindow");
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!swState.hydrated) { void hydrateReady.then(() => onRemovedHandler(tabId)); return; }
  onRemovedHandler(tabId);
});
function onRemovedHandler(tabId: number): void {
  // Mark the tab removed so an in-flight rollback/forward send callback does not
  // re-queue a zombie pending entry for it. (#323/disc#7)
  noteTabRemoved(tabId, Date.now());
  void clearTabIcon(tabId); // fire-and-forget: blank is chain-ordered (#272)
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
  captureTimestampsByTab.delete(tabId);
  clearPendingTabState(tabId);
  lastUrlByTab.delete(tabId);
  // Batch persist all cleanup in one storage write
  swState.persistAll();
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Gate the session-backed reads (pendingRollback/pendingForward/readyTabs) on
  // hydration like the nav/lifecycle handlers (#266). A cold worker can fire
  // onUpdated before _doHydrate resolves; reading the still-empty maps would
  // drop a legitimate pending rollback/forward offer (same FN class as #228.1).
  if (!swState.hydrated) { void hydrateReady.then(() => onUpdatedHandler(tabId, changeInfo, tab)); return; }
  onUpdatedHandler(tabId, changeInfo, tab);
});
function onUpdatedHandler(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab
): void {
  const pendingRollback = pendingRollbackByTab.get(tabId);
  // Skip if a send is already in flight: onUpdated can fire twice (loading->complete,
  // or url+status) before the async callback resolves, and re-sending the same entry
  // double-fires the rollback (double modal). The entry stays in the persisted map
  // until the in-flight send resolves it, so this never drops it. (#323/disc#3)
  if (
    pendingRollback &&
    (changeInfo.status === "complete" || changeInfo.url) &&
    !rollbackSendInFlight.has(tabId)
  ) {
    trySendRollback(tabId, pendingRollback);
  }

  const forward = pendingForwardByTab.get(tabId);
  if (!forward) return;
  if (changeInfo.status !== "complete" && !changeInfo.url) return;
  const currentUrl = tab.url ?? changeInfo.url ?? "";
  if (!currentUrl) return;
  if (currentUrl === forward.url) return;
  if (!readyTabs.has(tabId)) return;
  if (forwardSendInFlight.has(tabId)) return; // mirror of the rollback in-flight guard (#323/disc#3)
  trySendForwardOffer(tabId, forward);
}
