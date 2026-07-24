import { getRegistrableDomain, normalizeHost } from "../shared/domain";
import { initReputation, isKnownBadDomain, reputationReady } from "../shared/reputation";
import {
  getNavSettings,
  appendEvent,
  handleEventLogAppendMessage,
  handlePromptOutcomeStorageMessage,
  isEventLogAppendMessage,
  isEventLogMigrationMessage,
  isPromptOutcomeStorageMessage,
  migrateStoredEventLogUrls,
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
import { updateTabIcon, updateTabIconWhen, clearTabIcon, setAllTabsGray } from "./icon_manager";

const BASELINE_RULESET_ID = "baseline";

/** Cached defaultMode for synchronous access in navigation handlers. */
let cachedDefaultMode = "smart";
// Set once storage.onChanged delivers a mode, so the slower async startup read
// (loadCachedDefaultMode, especially after its retry) cannot resolve LATE and clobber a
// newer onChanged value with the stale value it read at startup. (#362)
let modeUpdatedByOnChanged = false;

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
// RI-06: scrub legacy full/opaque event URLs in the same serialized service-
// worker write lane used by appends, so an installed user's on-disk corpus is
// minimized without racing a concurrent event.
void migrateStoredEventLogUrls().catch((err) => {
  console.warn("[NavSentinel] event-log URL migration failed; will retry on worker restart:", err);
});
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
  // Belt-and-suspenders: SessionState._restoreMap now validates captureTimestampsByTab
  // entries and skips non-arrays, but guard here too so this path and the prune loop
  // below stay independently safe if a future write path or call site bypasses that. (#339)
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
async function loadCachedDefaultMode(): Promise<void> {
  try {
    const mode = (await getNavSettings()).defaultMode;
    // Don't clobber a newer value an onChanged delivered while this read was in flight.
    if (!modeUpdatedByOnChanged) cachedDefaultMode = mode;
  } catch (err) {
    // Rare (storage quota / context invalidated mid-read). Retry once — a transient
    // failure usually succeeds immediately, which avoids a stale-"smart" green badge for
    // an "off" user. cachedDefaultMode is the BADGE-paint value only (not enforcement); on
    // a double failure it stays at its current value and self-heals on the next
    // storage.onChanged / worker restart, so we surface the failure rather than flip to a
    // different (also-possibly-wrong) mode. (#362)
    console.warn("[NavSentinel] cachedDefaultMode read failed, retrying:", err);
    try {
      const mode = (await getNavSettings()).defaultMode;
      if (!modeUpdatedByOnChanged) cachedDefaultMode = mode;
    } catch (retryErr) {
      console.warn(
        "[NavSentinel] cachedDefaultMode retry failed; keeping",
        cachedDefaultMode,
        retryErr,
      );
    }
  }
}
const cachedModeReady = loadCachedDefaultMode();

// onCommittedHandler paints the toolbar badge from the synchronously-read
// cachedDefaultMode. That read (cachedModeReady, local storage) is a separate concern
// from session hydration, so ONLY the icon paint inside onCommittedHandler awaits
// cachedModeReady; the handler itself gates on swState.hydrated like every other nav
// handler (#327). A later storage.onChanged can still briefly race the startup read (its
// read may resolve after the change and write back the pre-change value), exactly as the
// historical onStartup refresh could; that window is transient and self-heals on the next
// change. (#303)

// Prune stale / over-cap OAuth flows. `activeTabId`, when given, is NEVER pruned:
// the flow currently being created or updated must survive even if it is itself
// past max-age (the user lingered on a consent page) or the oldest under the size
// cap — pruning it would drop initiatorUrl (#207) and expectedCallbackDomain (#324),
// weakening redirect-mismatch detection. Does NOT persist; the caller owns the
// single persistMap so an authorize commit writes session storage once. (#366)
function pruneStaleOAuthFlows(activeTabId?: number): void {
  const now = Date.now();
  for (const [tabId, flow] of oauthFlowByTab) {
    if (tabId !== activeTabId && now - flow.startedAt > OAUTH_FLOW_MAX_AGE_MS) {
      oauthFlowByTab.delete(tabId);
    }
  }
  if (oauthFlowByTab.size > OAUTH_FLOW_PRUNE_LIMIT) {
    const sorted = [...oauthFlowByTab.entries()]
      .filter(([tabId]) => tabId !== activeTabId)
      .sort((a, b) => a[1].startedAt - b[1].startedAt);
    const excess = oauthFlowByTab.size - OAUTH_FLOW_PRUNE_LIMIT;
    for (let i = 0; i < excess && i < sorted.length; i++) {
      oauthFlowByTab.delete(sorted[i]![0]);
    }
  }
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
    // The flow is finished: drop it so completed (semantically-dead) entries don't
    // linger in the map and session storage until the tab closes or the age-pruner
    // happens to run on the next new flow. `existingFlow` is a local reference, so the
    // terminal update below still carries the 'complete' phase to the content script. (#366)
    oauthFlowByTab.delete(tabId);
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

  // Size/age-cap OTHER tabs' stale flows here — on an OAuth-authorize commit, not
  // on every navigation — so BOTH the in-place-update and new-flow paths below
  // benefit. A provider chaining multiple /authorize hops updates a flow in place
  // and would otherwise never trigger cleanup. `tabId` is passed so THIS tab's flow
  // is never pruned, even if it is itself past max-age (lingering consent) — so the
  // in-place update below keeps its initiatorUrl/expectedCallbackDomain. (#366)
  pruneStaleOAuthFlows(tabId);

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

// Tab+URL keys (`tabId\nurl`) whose rollback/forward message send is currently in
// flight. onUpdated can fire twice (loading->complete, or url+status) before the async
// sendMessage callback resolves; without this guard the second fire re-reads the same
// pending entry and re-sends (double modal). Unlike a pre-delete, the pending entry
// stays in the (persisted) map until the callback resolves it, so a worker death
// mid-send cannot drop it. Cleared in the send callback. Module-level. (#323 / disc#3)
//
// Keyed on tabId+URL rather than the bare tabId (#360). The bare-tabId Set had a
// triple-send bug: when an older entry A was in flight and a newer commit overwrote the
// slot with B that also dispatched, A's callback delete(tabId) cleared the marker while
// B was still in flight, so a later onUpdated re-dispatched B a *third* time. A+B carry
// *different* URLs, so tab+URL keys scope each marker to its own destination — A's
// callback clears only A's key and never frees B. The composite key (vs a per-entry
// object reference) is deliberate so a same-URL rewrite stays guarded: ns-store-forward
// replaces pendingForwardByTab with a *fresh* object for the same tab+URL (to add a
// returnUrl) while a send is in flight; an object-identity key would treat the rewrite
// as not-in-flight and fire a duplicate forward offer — the tab+URL key still matches it.
const rollbackSendInFlight = new Set<string>();
const forwardSendInFlight = new Set<string>();

/** In-flight key for a tab's rollback/forward send. `\n` cannot occur in a URL, so it
 *  unambiguously separates the numeric tabId from the destination URL. (#360) */
function sendInFlightKey(tabId: number, url: string): string {
  return `${tabId}\n${url}`;
}

function trySendRollback(
  tabId: number,
  pending: { url: string; prevUrl?: string; qualifiers: string[] }
): void {
  const inFlightKey = sendInFlightKey(tabId, pending.url);
  rollbackSendInFlight.add(inFlightKey); // callers skip a re-send of this tab+URL while set (#323/disc#3, #360)
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "ns-rollback",
      url: pending.url,
      ...(pending.prevUrl !== undefined ? { prevUrl: pending.prevUrl } : {}),
      qualifiers: pending.qualifiers
    },
    () => {
      rollbackSendInFlight.delete(inFlightKey);
      if (chrome.runtime.lastError) {
        // Send failed (tab busy / port gone). Leave pendingRollbackByTab exactly as it
        // is: every caller stores the entry in the map *before* dispatching (onCommitted
        // stores-then-sends; ns-ready/onUpdated send the map's own entry), so it is
        // already queued for the next onUpdated retry. We must NOT re-insert the captured
        // (stale closure) `pending`: if a newer navigation overwrote the entry, or
        // onBeforeNavigate / onRemoved cleared it during the async gap, that newer state
        // is authoritative — resurrecting our stale value would clobber a fresher rollback
        // or leave a zombie that fires a false rollback on the next page. (#323/disc#5/#7)
        readyTabs.delete(tabId);
      } else if (pendingRollbackByTab.get(tabId) === pending) {
        // Delivered. Remove ONLY the exact entry we sent (reference identity) — a newer
        // entry written during the async send gap must survive. (#323/disc#5)
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
  const inFlightKey = sendInFlightKey(tabId, forward.url);
  forwardSendInFlight.add(inFlightKey); // callers skip a re-send of this tab+URL while set (#323/disc#3, #360)
  chrome.tabs.sendMessage(tabId, { type: "ns-forward-offer", url: forward.url }, () => {
    forwardSendInFlight.delete(inFlightKey);
    if (chrome.runtime.lastError) {
      // Same rule as trySendRollback: the entry is already in pendingForwardByTab (its
      // only caller sends the map's own entry), so leave it queued for retry and never
      // re-insert the stale closure value over a newer ns-store-forward write or a slot
      // that onBeforeNavigate / onRemoved cleared during the gap. (#323/disc#6/#7)
      readyTabs.delete(tabId);
    } else if (pendingForwardByTab.get(tabId) === forward) {
      // Delivered. Remove ONLY the exact offer we sent — a newer ns-store-forward offer
      // written during the async gap must survive. (#323/disc#6)
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
  // Accept any string mode (not just truthy) so a future empty-string mode is not
  // silently dropped, leaving cachedDefaultMode stale. No valid mode is "" today. (#362)
  if (typeof newVal?.nav?.defaultMode === "string") {
    cachedDefaultMode = newVal.nav.defaultMode;
    // This is authoritative and fresher than the startup read; block a late startup
    // read from overwriting it with the value it captured before this change. (#362)
    modeUpdatedByOnChanged = true;
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

  if (isEventLogMigrationMessage(message)) {
    void migrateStoredEventLogUrls()
      .then(() => sendResponse?.({ ok: true }))
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
        // Skip if a send for this tab+URL is already in flight (e.g. an onUpdated-
        // triggered send, or a rapid duplicate ns-ready) so we don't double-send the
        // same rollback. A newer entry for a *different* URL is a different key and would
        // not be blocked here. (#323/disc#3, #360)
        if (pending && !rollbackSendInFlight.has(sendInFlightKey(tabId, pending.url))) {
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
      // A completed flow is deleted from the map on completion (#366), so a LIVE
      // openerOAuthFlow is never 'complete'. The `!== "complete"` guard only matters for a
      // corrupt/tampered restored 'complete' entry, which OAUTH_PHASES still admits as
      // defence-in-depth (see session_state.ts) — treat that as a finished flow, not an
      // active manipulation target. Do not remove the guard without also tightening OAUTH_PHASES.
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
  // Gate on swState.hydrated, uniform with every other nav/lifecycle handler
  // (onBeforeNavigate / onErrorOccurred / onCreated / onRemoved / onUpdated). The nav
  // state machine needs only the session-backed maps; the cachedDefaultMode read is a
  // separate concern handled by gating ONLY the icon paint inside onCommittedHandler on
  // cachedModeReady. Gating the whole handler on startupSettled (hydration AND the mode
  // read) made onCommitted defer on a different signal than the hydration-only handlers,
  // so in the startup window the same tab's nav events could process out of order and
  // drop per-tab nav state -> a false rollback. (#327, was #303)
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
    allowTargetMatchesCommit(targetAllowance, details.url);
  if (targetAllowance) {
    allowTargetByTab.delete(details.tabId);
  }
  if (targetAllowed && targetAllowance?.silentEvent) {
    void appendEvent(targetAllowance.silentEvent);
  }
  const prevUrl = lastUrlByTab.get(details.tabId);
  lastUrlByTab.set(details.tabId, details.url);

  // Reset tab icon for fresh top-frame navigation; the content script will escalate to
  // yellow/red as threats are detected. The green/gray color needs cachedDefaultMode (the
  // async local-storage read) so it is NOT painted synchronously — that would flash green
  // for an "off"-mode user on a mid-session restart (#303). But the reset must still be
  // ordered BEFORE the page's own escalation, or a slow mode read could land the green/gray
  // paint after a red/yellow threat badge and hide it. updateTabIconWhen reserves this tab's
  // icon-chain slot synchronously (so a later escalation is ordered after it) while
  // deferring only the color until cachedModeReady settles. (#327, was #303)
  void updateTabIconWhen(
    details.tabId,
    cachedModeReady,
    () => (cachedDefaultMode === "off" ? "gray" : "green")
  );

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

  // Always queue the rollback so the map is the single source of truth: it then survives a
  // worker restart and a failed/raced send, and trySendRollback removes this exact entry
  // only on delivery (identity match) and leaves it for the next onUpdated retry on failure.
  // persistAll() runs BEFORE the dispatch so the queued entry is written ahead of the send
  // that may clear it — the success callback's later persistMap is then unambiguously the
  // last write, with no persist-ordering race. A worker death between here and that callback
  // re-attempts delivery on restart rather than dropping the rollback: a deliberate
  // durability win over the old direct-send, whose only cost is a rare possible redelivery
  // (never a missed rollback). Send now if the tab is already ready. (#323)
  const rollbackEntry = {
    url: details.url,
    ...(prevUrl !== undefined ? { prevUrl } : {}),
    qualifiers
  };
  pendingRollbackByTab.set(details.tabId, rollbackEntry);
  swState.persistAll();
  // Mirror the ns-ready / onUpdated in-flight guard so this site cannot double-send the
  // same tab+URL. Because the key is tab+URL (not the bare tabId), guarding here never
  // strands a NEW destination while an OLDER one is in flight — the worry that blocked a
  // naive per-tabId guard: a fresh commit to a different URL has a different key. (#360)
  if (
    readyTabs.has(details.tabId) &&
    !rollbackSendInFlight.has(sendInFlightKey(details.tabId, rollbackEntry.url))
  ) {
    trySendRollback(details.tabId, rollbackEntry);
  }
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
  if (!preserveForwardOffer) {
    // Mirror onBeforeNavigateHandler: keep the rollback-return + suppress window alive when
    // we are preserving the forward offer. The offer is meaningless without its rollbackReturn
    // companion — preserveForwardOffer on the NEXT navigation/error event requires rollbackReturn
    // to still exist, so an unconditional delete here drops the very offer clearPendingTabState
    // just preserved. The suppress window must likewise survive so the eventual forward-retry
    // commit is not mis-rolled-back. (#339)
    rollbackReturnByTab.delete(details.tabId);
    suppressUntilByTab.delete(details.tabId);
  }
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
  // clearPendingTabState (below) deletes this tab's pending rollback/forward entries; an
  // in-flight send's callback then finds the slot gone and (error: leaves it; success:
  // identity-mismatch) never re-inserts a zombie for the dead tab. (#323/disc#7)
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
    !rollbackSendInFlight.has(sendInFlightKey(tabId, pendingRollback.url))
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
  // tab+URL key (#360): a same-URL rewrite via ns-store-forward (which swaps in a fresh
  // offer object to add a returnUrl while a send is in flight) stays guarded here, so the
  // rewrite cannot fire a duplicate forward offer.
  if (forwardSendInFlight.has(sendInFlightKey(tabId, forward.url))) return;
  trySendForwardOffer(tabId, forward);
}
