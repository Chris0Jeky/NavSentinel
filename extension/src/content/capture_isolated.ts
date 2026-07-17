import { computeCDS } from "../shared/scoring";
import { appendEvent, appendPromptOutcome, getPromptOutcomes, getNavSettings, onNavSettingsChange, buildNavOutcomeFeatures, type EventLogEntry, type NavSettings, type NavOutcomeFeatures } from "../shared/storage";
import { ADAPTIVE_SCORES_KEY, getEffectiveThresholdAdjustment, updateAdaptiveScores } from "../shared/adaptive_scoring";
import {
  analyzeOutcomesForPair,
  isPairOnCooldown,
  setCooldown,
  clearCooldown,
} from "../shared/smart_defaults";
import { makeToken, setActiveToken } from "../shared/stateMachine";
import type { Mode } from "../shared/types";
import {
  addAllowlistEntry,
  getAllowlist,
  isAllowlisted,
  onAllowlistChange,
  type Allowlist
} from "../shared/allowlist";
import { getRegistrableDomain } from "../shared/domain";
import { areSameOrganization } from "../shared/domain_groups";
import { computeNRS, getTierAdjustedBlockThreshold, NRS_BLOCK_THRESHOLD, NRS_STRICT_BLOCK_THRESHOLD } from "../shared/nrs";
import type { NavigationContext } from "../shared/nrs";
import { resolveFrameNavigationTrustTier } from "../shared/top_sites";
import {
  createEmptyState,
  isStateExpired,
  computeJsBehaviorScore,
  type JsBehaviorState,
} from "../shared/js_behavior_state";
import type { RedirectChainInfo } from "../shared/redirect_chain";
import { initReputation, isKnownBadDomain, checkReputationViaMessage } from "../shared/reputation";
import { loadBrandTemplates } from "../shared/visual_sim_loader";
import { triggerVisualSimCheck, waitForStability, resetVisualSimState } from "./visual_sim_capture";
import { isCurrentPageCrossOriginFromBrand } from "../shared/visual_sim_brand_domains";
import { showToast } from "./ui_toast";
import { explainReasonCode } from "../shared/explanations";
import {
  buildClickContextFromEvents,
  buildKeyboardClickContext,
  captureClick,
  capturePointerDown,
  type DownCapture
} from "./dom_builder";
import { setDebugEnabled, updateDebugOverlay, type DebugInfo } from "./debug_overlay";
import { recordClipboardWrite, scanForClickFix } from "./clickfix_detector";
import { OutboundQueue } from "./bridge_outbound";
import {
  handleDblclickBridgeMessage,
  handleDblclickRuntimeMessage,
  isDoubleClickHijackActive,
  getDblclickOpenerNavUrl,
} from "./dblclick_guard";
import {
  startMutationMonitor,
  getMutationAlertCount,
  type MutationAlert,
} from "./mutation_monitor";
import {
  handleOAuthRuntimeMessage,
  isOAuthRedirectMismatch,
  isOAuthOpenerManipulation,
} from "./oauth_monitor";
import { shouldSuppressSmartBlankPrompt } from "./smart_prompt_gate";
import {
  handlePushStateBridgeMessage,
  isPushStateAbuseActive,
} from "./pushstate_guard";
import { analyzeCSP, type CSPAnalysis } from "./csp_analyzer";
import { getDomainRisk, recordNavigation } from "../shared/domain_profile";
import { recordNavigationAnomaly, getAnomalyScoreSync, primeAnomalySession } from "../shared/nav_anomaly";
import {
  isDocumentNavigationHref,
  shouldLogImmediateSilentNav,
  shouldQueueSameTabSilentCommit,
  silentNavThrottleAllows,
  type SilentNavThrottleState,
} from "./silent_decision";

const CDS_SMART_BLOCK_THRESHOLD = 70;
const NS_SOURCE = "__navsentinel__";
const BRIDGE_INIT_TYPE = "ns-port-init";
const PROTOCOL_VERSION = 1;
const NAV_ALLOW_TTL_MS = 1500;
const NAV_GESTURE_TTL_MS = 1500;
const NAV_TARGET_ALLOW_TTL_MS = 10000;
const MAX_PENDING_BRIDGE_MESSAGES = 32;
const BRIDGE_RETRY_MS = 100;
const MAX_BRIDGE_RETRY_MS = 1000;
const MAX_BRIDGE_INIT_MS = 10000;
const RISKY_BLANK_REASONS = new Set([
  "intent_mismatch_under_interactive",
  "invisible_but_clickable",
  "overlay_large_interactive",
  "overlay_medium_interactive",
  "overlay_high_zindex",
  "overlay_elevated_zindex",
  "retargeted_target_mismatch",
  "cursor_pointer_no_affordance",
  "near_invisible_opacity",
  "low_opacity",
  "no_accessible_name",
  "composite_escalation",
  "clipboard_write_with_overlay",
  "clickfix_instruction_pattern"
]);

function buildPlainMessage(prefix: string, reasonCodes: string[]): string {
  const positive = reasonCodes.filter(r =>
    !r.startsWith("keyboard_") && !r.startsWith("legit_") &&
    !r.includes("allowlisted") && !r.includes("previously_allowed") &&
    !r.includes("explicit_new_tab") && r !== "nrs_user_activation_active"
  );
  const topReason = positive[positive.length - 1];
  const explanation = topReason ? explainReasonCode(topReason) : "";
  return (explanation && explanation !== topReason) ? `${prefix} — ${explanation}` : prefix;
}

function makeBridgeSession(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let lastDown: DownCapture | null = null;
let settings: NavSettings = { defaultMode: "smart", debug: false, dnrEnabled: false };
let allowlist: Allowlist = {};
let adaptiveAdjustment = 0;

// P5-B1 (#236): consecutive-destination throttle for nav_silent_allow events,
// suppressing rapid repeats of the same destination within one document
// lifetime (e.g. _blank re-clicks). It is module state, so a same-tab
// navigation tears down the content script and resets it — bounding volume
// there relies on appendEvent's loud-event-protecting trim, not this throttle.
const silentNavThrottle: SilentNavThrottleState = { key: "", at: 0 };
const SILENT_NAV_THROTTLE_MS = 10000;

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[ADAPTIVE_SCORES_KEY]) {
    const newScores = changes[ADAPTIVE_SCORES_KEY].newValue;
    const domain = siteKeyFromLocation();
    adaptiveAdjustment = (newScores && typeof newScores === "object" && newScores[domain]?.adjustment) ?? 0;
  }
});

let bridgePort: MessagePort | null = null;
let bridgeReady = false;
const bridgeSession = makeBridgeSession();
// Pre-ready buffer for isolated → main messages. On overflow it keeps control
// relays (mode config + allow decisions) that change guard behavior over routine
// pings — see bridge_outbound.ts.
const pendingBridgeMessages = new OutboundQueue(MAX_PENDING_BRIDGE_MESSAGES);
// Isolated → main control messages that must survive buffer pressure.
const PRIORITY_BRIDGE_TYPES = new Set<string>([
  "ns-config",
  "ns-allow",
  "ns-allow-once",
  "ns-allow-action",
  "ns-allow-target-nav",
]);
let mainGuard: "unknown" | "yes" | "no" = "unknown";
let lastNav: { kind: string; url: string; status: "allowed" | "blocked"; target?: string } | null = null;
let lastDebug: Omit<DebugInfo, "mainGuard" | "lastNav"> | null = null;
let rollbackShownAt = 0;
let bridgeRetryTimer = 0;
let bridgeRetryDelayMs = BRIDGE_RETRY_MS;
let bridgeInitStartedAt = 0;
let bridgeAttemptGen = 0;
let forwardCheckInFlight = false;
let forwardCheckTimer = 0;
let previousMode = "";
let gestureNavAttempts = 0;
let gestureDownId: number | null = null;
const CHAIN_INFO_TTL_MS = 30_000;
const FORWARD_CHECK_INFLIGHT_TIMEOUT_MS = 2_000;
let cachedChainInfo: RedirectChainInfo | null = null;
let cachedChainInfoAt = 0;
/** Cached CSP analysis for the current page (computed once after DOM ready). */
let cachedCSPAnalysis: CSPAnalysis | null = null;
let cachedDomainRepeatOffender = false;

type TabRiskState = "green" | "yellow" | "red" | "gray";
const SEVERITY: Record<TabRiskState, number> = { gray: 0, green: 1, yellow: 2, red: 3 };
let currentTabRiskState: TabRiskState = "green";
let tabBlockCount = 0;

function sendIconUpdate(state: TabRiskState, blockCount?: number): void {
  if (!isTopFrame()) return;
  if (SEVERITY[state] < SEVERITY[currentTabRiskState]) return;
  const count = blockCount ?? tabBlockCount;
  if (state === currentTabRiskState && count === tabBlockCount) return;
  currentTabRiskState = state;
  tabBlockCount = count;
  chrome.runtime.sendMessage({
    type: "ns-tab-risk-update",
    state,
    blockCount: count,
  }).catch(() => {});
}

function markMainGuardReady(): void {
  if (bridgeRetryTimer) {
    window.clearTimeout(bridgeRetryTimer);
    bridgeRetryTimer = 0;
  }
  bridgeAttemptGen++;
  bridgeRetryDelayMs = BRIDGE_RETRY_MS;
  bridgeInitStartedAt = 0;
  bridgeReady = true;
  document.documentElement.setAttribute("data-navsentinel-bridge-ready", "1");
  mainGuard = "yes";
  flushBridgeMessages();
  refreshDebug();
}

function refreshDebug(): void {
  if (!lastDebug) return;
  updateDebugOverlay({
    ...lastDebug,
    mainGuard,
    mutationAlerts: getMutationAlertCount(),
    ...(lastNav ? { lastNav } : {}),
    ...(cachedCSPAnalysis ? { cspInfo: cachedCSPAnalysis } : {}),
  });
}

/** Maximum .bin file size we will read (2 MB + 16-byte header, matching MAX_FILTER_BITS). */
const MAX_REPUTATION_FILE_BYTES = 2 * 1024 * 1024 + 16;

/** Safe top-frame check that won't throw in sandboxed iframes without allow-same-origin. */
function isTopFrame(): boolean {
  try { return window === window.top; } catch { return false; }
}

async function loadReputationFilter(): Promise<void> {
  // Only the top frame loads the bloom filter locally.
  // Child frames delegate reputation checks to the service worker via
  // checkReputationViaMessage(), avoiding duplicate ~117KB fetches.
  if (!isTopFrame()) return;

  try {
    const url = chrome.runtime.getURL("reputation_data.bin");
    const response = await fetch(url);
    if (!response.ok) {
      console.warn("[NavSentinel] Reputation filter not found (HTTP", response.status, ")");
      return;
    }
    // Pre-read size guard: reject obviously oversized responses before buffering.
    const cl = response.headers.get("content-length");
    if (cl && Number(cl) > MAX_REPUTATION_FILE_BYTES) {
      console.warn("[NavSentinel] Reputation file too large (Content-Length:", cl, ")");
      return;
    }
    const data = await response.arrayBuffer();
    // Post-read size guard: Content-Length can be absent or spoofed.
    if (data.byteLength > MAX_REPUTATION_FILE_BYTES) {
      console.warn("[NavSentinel] Reputation file too large:", data.byteLength, "bytes");
      return;
    }
    if (initReputation(data)) {
      if (settings.debug) {
        console.debug("[NavSentinel] Reputation bloom filter loaded:", data.byteLength, "bytes");
      }
    }
  } catch (err) {
    // Graceful degradation: reputation checks will return false
    console.warn("[NavSentinel] Failed to load reputation filter:", err);
  }
}

async function initSettings() {
  ensureBridge();
  try {
    settings = await getNavSettings();
    allowlist = await getAllowlist();
  } catch (err) {
    console.warn("[NavSentinel] Failed to load settings, using defaults", err);
  }
  try {
    adaptiveAdjustment = await getEffectiveThresholdAdjustment(siteKeyFromLocation());
  } catch (err) {
    console.warn("[NavSentinel] Failed to load adaptive threshold, using default", err);
  }
  document.documentElement.setAttribute("data-navsentinel-capture-ready", "1");
  setDebugEnabled(settings.debug);
  postToMain("ns-config", { mode: settings.defaultMode, debug: settings.debug });
  postToMain("ns-ping");
  // Load reputation bloom filter in the background (non-blocking)
  void loadReputationFilter();
  // Load visual-similarity brand templates in the background (non-blocking)
  // and schedule the brand-match capture once the page settles.
  if (isTopFrame() && settings.defaultMode !== "off") {
    void loadBrandTemplates().catch((err) => {
      console.warn("[NavSentinel] Failed to load brand templates:", err);
    });
    scheduleVisualSimCheck();
  }
  // Pre-fetch domain risk for the current site (non-blocking)
  void getDomainRisk(siteKeyFromLocation()).then((risk) => {
    cachedDomainRepeatOffender = risk.isRepeatOffender;
  }).catch((err) => { console.warn("[NavSentinel] domain profile pre-fetch failed:", err); });
  // Seed the nav-anomaly session count from the stored profile so the sync
  // anomaly score works for a returning user on this fresh content-script load.
  void primeAnomalySession().catch((err) => {
    console.warn("[NavSentinel] nav anomaly prime failed:", err);
  });
  previousMode = settings.defaultMode;
  if (isTopFrame()) {
    sendIconUpdate(settings.defaultMode === "off" ? "gray" : "green");
    try {
      chrome.runtime.sendMessage({ type: "ns-ready" });
    } catch {
      // ignore
    }
    // Fetch redirect chain info for this tab's navigation
    try {
      chrome.runtime.sendMessage({ type: "ns-get-chain-info" }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && typeof resp.depth === "number") {
          cachedChainInfo = resp;
          cachedChainInfoAt = Date.now();
        }
      });
    } catch {
      // ignore
    }
  }
}

void initSettings();

onNavSettingsChange((s) => {
  settings = s;
  setDebugEnabled(s.debug);
  postToMain("ns-config", { mode: s.defaultMode, debug: s.debug });
  if (s.defaultMode !== previousMode) {
    previousMode = s.defaultMode;
    const newState: TabRiskState = s.defaultMode === "off" ? "gray" : "green";
    currentTabRiskState = newState;
    tabBlockCount = 0;
    if (isTopFrame()) {
      chrome.runtime.sendMessage({
        type: "ns-tab-risk-update",
        state: newState,
        blockCount: 0,
      }).catch(() => {});
    }
  }
  refreshDebug();
});

onAllowlistChange((list) => {
  allowlist = list;
});

function siteKeyFromLocation(): string {
  return location.hostname.toLowerCase();
}

function frameKey(): string {
  return isTopFrame() ? "top" : "frame";
}

function postToMain(type: string, payload?: Record<string, unknown>): void {
  if (mainGuard === "no") return;
  if (!bridgeReady) {
    pendingBridgeMessages.enqueue(
      payload !== undefined ? { type, payload } : { type },
      PRIORITY_BRIDGE_TYPES.has(type)
    );
    ensureBridge();
    return;
  }
  sendBridgeMessageToMain({ source: NS_SOURCE, type, v: PROTOCOL_VERSION, ...(payload ?? {}) });
}

function flushBridgeMessages(): void {
  if (!bridgeReady || !bridgePort) return;
  const { items, dropped } = pendingBridgeMessages.drain();
  for (const next of items) {
    bridgePort.postMessage({
      source: NS_SOURCE,
      type: next.type,
      v: PROTOCOL_VERSION,
      session: bridgeSession,
      ...(next.payload ?? {})
    });
  }
  if (dropped > 0) {
    appendEventSafely({
      kind: "bridge_buffer_overflow",
      site: siteKeyFromLocation(),
      extra: { direction: "isolated_to_main", dropped },
    });
  }
}

function sendBridgeMessageToMain(payload: Record<string, unknown>): void {
  if (!bridgePort) return;
  bridgePort.postMessage({
    ...payload,
    session: bridgeSession
  });
}

function handleBridgeMessage(message: unknown): void {
  const data = message as {
    source?: string;
    type?: string;
    session?: string;
    challenge?: string;
    id?: string;
    kind?: string;
    url?: string;
    target?: string;
    features?: string;
    mode?: "off" | "smart" | "strict";
    debug?: boolean;
    v?: number;
    // Clipboard write metadata (ns-clipboard-write)
    ts?: number;
    contentLength?: number;
    looksLikeCommand?: boolean;
    // PushState abuse metadata (ns-pushstate-suspicious)
    reason?: string;
    method?: string;
    // Allow-target-nav relay (ns-allow-target-nav)
    ttlMs?: number;
    matchQueryPrefix?: boolean;
    // Pre-verification buffer overflow count (ns-bridge-overflow)
    dropped?: number;
  };
  if (!data || data.source !== NS_SOURCE || data.v !== PROTOCOL_VERSION) return;

  if (data.type === "ns-challenge" && data.session === bridgeSession && data.challenge) {
    bridgePort?.postMessage({
      source: NS_SOURCE,
      type: "ns-challenge-response",
      v: PROTOCOL_VERSION,
      session: bridgeSession,
      challenge: data.challenge
    });
    return;
  }

  if (data.session !== bridgeSession) return;

  if (data.type === "ns-bridge-ready") {
    markMainGuardReady();
    return;
  }

  if (data.type === "ns-pong" || data.type === "ns-config-ack") {
    markMainGuardReady();
    return;
  }

  if (data.type === "ns-bridge-overflow") {
    // MAIN-world guard dropped buffered messages before the bridge verified;
    // record it in the trusted event log rather than discarding it silently.
    const dropped = typeof data.dropped === "number" ? data.dropped : 0;
    if (dropped > 0) {
      appendEventSafely({
        kind: "bridge_buffer_overflow",
        site: siteKeyFromLocation(),
        extra: { direction: "main_to_isolated", dropped },
      });
    }
    return;
  }

  if (data.type === "ns-nav-blocked") {
    lastNav = {
      kind: data.kind ?? "unknown",
      url: data.url ?? "",
      status: "blocked",
      ...(typeof data.target === "string" ? { target: data.target } : {})
    };
    refreshDebug();

    if (settings.defaultMode === "off") {
      allowActionOnce(data.id, data.url, data.target, data.features);
      return;
    }

    const parsed = parseDestination(data.url);
    const url = parsed.href ?? data.url ?? "";
    if (!url) return;

    if (parsed.host && isAllowlisted(allowlist, siteKeyFromLocation(), parsed.host)) {
      allowActionOnce(data.id, url, data.target || "_blank", data.features);
      return;
    }

    const title =
      data.kind === "location_assign" || data.kind === "location_replace"
        ? "Blocked redirect"
        : data.kind === "form_submit" || data.kind === "form_request_submit"
          ? "Blocked form submit"
          : data.kind === "shadow_anchor"
            ? "Blocked new tab"
            : "Blocked popup";

    showAllowPrompt({
      title,
      url,
      host: parsed.host,
      target: data.target || "_blank",
      ...(data.features ? { features: data.features } : {}),
      ...(data.id !== undefined ? { actionId: data.id } : {})
    });
    return;
  }

  if (data.type === "ns-nav-allowed") {
    lastNav = {
      kind: data.kind ?? "unknown",
      url: data.url ?? "",
      status: "allowed",
      ...(typeof data.target === "string" ? { target: data.target } : {})
    };
    refreshDebug();
    if (data.kind === "window_open" && isImmediateWindowOpenTarget(data.target) && lastDebug?.decision === "allow") {
      const parsed = parseDestination(data.url);
      appendImmediateSilentNav(buildSilentNavEvent({
        destHref: parsed.href,
        destHost: parsed.host,
        nrs: lastDebug.nrs ?? 0,
        reasonCodes: lastDebug.reasonCodes,
        nrsFactors: lastDebug.nrsFactors ?? [],
        blockThreshold: lastDebug.blockThreshold ?? getNrsBlockThreshold(settings.defaultMode),
      }));
    }
    return;
  }

  // Forwarded from MAIN world — not gated on mode because allowed navigations
  // must be pre-approved in the SW even when the guard is "off".
  if (data.type === "ns-allow-target-nav") {
    const url = typeof data.url === "string" ? data.url : "";
    const ttlMs = typeof data.ttlMs === "number" ? data.ttlMs : NAV_TARGET_ALLOW_TTL_MS;
      if (url) {
        const parsed = parseDestination(url);
        const shouldAttachSilentEvent = !(
          lastNav?.kind === "window_open" && isImmediateWindowOpenTarget(lastNav.target)
        );
      const silentEvent = shouldAttachSilentEvent && lastDebug?.decision === "allow"
        ? buildSilentNavEvent({
          destHref: parsed.href,
          destHost: parsed.host,
          nrs: lastDebug.nrs ?? 0,
          reasonCodes: lastDebug.reasonCodes,
          nrsFactors: lastDebug.nrsFactors ?? [],
          blockThreshold: lastDebug.blockThreshold ?? getNrsBlockThreshold(settings.defaultMode),
          })
        : null;
      notifyAllowedTarget(
        url,
        ttlMs,
        silentEvent ?? undefined,
        { matchQueryPrefix: data.matchQueryPrefix === true }
      );
    }
    return;
  }

  if (data.type === "ns-clipboard-write") {
    const ts = typeof data.ts === "number" ? data.ts : Date.now();
    const contentLength = typeof data.contentLength === "number" ? data.contentLength : -1;
    const cmdLike = typeof data.looksLikeCommand === "boolean" ? data.looksLikeCommand : false;
    recordClipboardWrite({ ts, contentLength, looksLikeCommand: cmdLike });
    if (settings.defaultMode !== "off") {
      handleClickFixScan();
    }
    return;
  }

  // --- DoubleClickjacking bridge messages from main_guard ---
  {
    const dblResult = handleDblclickBridgeMessage(data.type ?? "", data);
    if (dblResult.handled) {
      // Forward to the SW so it can notify the opener tab.
      // This capture_isolated is running in the CHILD window; the opener tab
      // needs this signal to correlate with its click timing.
      if (dblResult.forwardToSW) {
        try {
          chrome.runtime.sendMessage(dblResult.forwardToSW);
        } catch {
          // ignore -- SW may not be reachable
        }
      }
      return;
    }
  }

  // --- PushState abuse bridge messages from main_guard ---
  if (handlePushStateBridgeMessage(data.type ?? "", data)) {
    if (settings.defaultMode !== "off") {
      appendEventSafely({
        kind: "pushstate_abuse",
        site: siteKeyFromLocation(),
        url: typeof data.url === "string" ? data.url : location.href,
        reasons: [typeof data.reason === "string" ? data.reason : "unknown"],
      });
      // A pushState/replaceState is an in-page (SPA) navigation: the cached
      // visual-sim score is route-specific and must be re-evaluated for the
      // new route rather than carried over.
      onVisualSimSpaNavigation();
    }
    return;
  }

  // --- JS Behavior Analysis signals from main_guard ---
  if (
    data.type === "ns-js-form-submit-suspicious" ||
    data.type === "ns-js-exfil-network" ||
    data.type === "ns-js-exfil-beacon" ||
    data.type === "ns-js-credential-read"
  ) {
    if (settings.defaultMode !== "off") {
        handleJsBehaviorSignal(data.type, data as Record<string, unknown>);
    }
    return;
  }
}

function ensureBridge(): void {
  if (bridgeReady || mainGuard === "no" || bridgeRetryTimer) return;

  if (!bridgeInitStartedAt) {
    bridgeInitStartedAt = Date.now();
  }

  const attempt = () => {
    bridgeRetryTimer = 0;
    if (bridgeReady || mainGuard === "no") return;
    if (Date.now() - bridgeInitStartedAt >= MAX_BRIDGE_INIT_MS) {
      console.warn("[NavSentinel] Bridge init timed out — MAIN world guard disabled");
      bridgePort?.close();
      bridgePort = null;
      bridgeReady = false;
      mainGuard = "no";
      bridgeRetryDelayMs = BRIDGE_RETRY_MS;
      bridgeInitStartedAt = 0;
      pendingBridgeMessages.drain(); // discard buffered messages; guard is disabled
      refreshDebug();
      return;
    }

    const prevPort = bridgePort;
    bridgeAttemptGen++;
    const thisGen = bridgeAttemptGen;

    prevPort?.close();

    const channel = new MessageChannel();
    bridgePort = channel.port1;
    bridgePort.onmessage = (event) => handleBridgeMessage(event.data);
    bridgePort.start?.();
    channel.port2.start?.();

    window.postMessage(
      {
        source: NS_SOURCE,
        type: BRIDGE_INIT_TYPE,
        v: PROTOCOL_VERSION,
        session: bridgeSession
      },
      "*",
      [channel.port2]
    );

    if (!bridgeReady && mainGuard === "unknown") {
      bridgeRetryTimer = window.setTimeout(() => {
        bridgeRetryTimer = 0;
        if (bridgeAttemptGen !== thisGen) return;
        attempt();
      }, bridgeRetryDelayMs);
      bridgeRetryDelayMs = Math.min(bridgeRetryDelayMs * 2, MAX_BRIDGE_RETRY_MS);
    }
  };

  attempt();
}

function appendEventSafely(
  partial: Parameters<typeof appendEvent>[0]
): void {
  void appendEvent(partial).catch(() => {
    // ignore
  });
}

async function refreshAdaptiveScores(baseThreshold?: number): Promise<void> {
  try {
    const threshold = baseThreshold ?? (settings.defaultMode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD);
    const outcomes = await getPromptOutcomes();
    await updateAdaptiveScores(outcomes, threshold);
    adaptiveAdjustment = await getEffectiveThresholdAdjustment(siteKeyFromLocation());
  } catch (err) {
    console.warn("[NavSentinel] Failed to refresh adaptive scores, using stale values", err);
  }
}

function appendOutcomeSafely(
  partial: Parameters<typeof appendPromptOutcome>[0]
): void {
  void appendPromptOutcome(partial).then(() => {
    refreshAdaptiveScores();
  }).catch(() => {
    // ignore
  });
}

function notifyNavAllow(ttlMs = NAV_ALLOW_TTL_MS): void {
  try {
    chrome.runtime.sendMessage({ type: "ns-allow-nav", ttlMs });
  } catch {
    // ignore
  }
}

function notifyNavGesture(ttlMs = NAV_GESTURE_TTL_MS): void {
  try {
    chrome.runtime.sendMessage({ type: "ns-nav-gesture", ttlMs, url: location.href });
  } catch {
    // ignore
  }
}

function notifyNavContext(): void {
  try {
    chrome.runtime.sendMessage({ type: "ns-nav-context" });
  } catch {
    // ignore
  }
}

function notifyAllowedTarget(
  url: string,
  ttlMs = NAV_TARGET_ALLOW_TTL_MS,
  silentEvent?: EventLogEntry,
  options?: { matchQueryPrefix?: boolean }
): void {
  if (!url) return;
  try {
    chrome.runtime.sendMessage({
      type: "ns-allow-target-nav",
      url,
      ttlMs,
      ...(options?.matchQueryPrefix ? { matchQueryPrefix: true } : {}),
      ...(silentEvent ? { silentEvent } : {})
    });
  } catch {
    // ignore
  }
}

function buildSilentNavEvent(params: {
  destHref: string | null | undefined;
  destHost: string | null | undefined;
  nrs: number;
  reasonCodes: string[];
  nrsFactors: string[];
  blockThreshold: number;
}): EventLogEntry | null {
  if (settings.defaultMode === "off") return null;
  if (!isTopFrame()) return null;
  if (!isDocumentNavigationHref(params.destHref, params.destHost, location.href)) return null;
  return {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    ts: Date.now(),
    kind: "nav_silent_allow",
    site: siteKeyFromLocation(),
    ...(params.destHost ? { destHost: params.destHost } : {}),
    score: params.nrs,
    reasons: params.reasonCodes,
    extra: {
      nrsFactors: params.nrsFactors,
      adaptiveAdj: adaptiveAdjustment,
      threshold: params.blockThreshold
    }
  };
}

function isImmediateWindowOpenTarget(target: unknown): boolean {
  if (typeof target !== "string" || target === "") return true;
  const normalized = target.toLowerCase();
  if (normalized === "_blank") return true;
  if (normalized === "_self" || normalized === "_top" || normalized === "_parent") return false;
  try {
    return target !== window.name;
  } catch {
    return true;
  }
}

function appendImmediateSilentNav(event: EventLogEntry | null): void {
  if (!event) return;
  const throttleKey = getRegistrableDomain(event.destHost ?? "") ?? event.destHost ?? "";
  if (!silentNavThrottleAllows(silentNavThrottle, throttleKey, performance.now(), SILENT_NAV_THROTTLE_MS)) {
    return;
  }
  appendEventSafely(event);
}

let clickFixAlertedAt = 0;

/** Tracked ClickFix state for NRS integration. Expires after 30 s. */
const CLICKFIX_STATE_TTL_MS = 30_000;
let clickfixState: { score: number; lastScanTs: number } = {
  score: 0,
  lastScanTs: 0,
};

/** Return current ClickFix score if it has not expired, otherwise 0. */
function getClickfixScoreForNRS(): number {
  if (clickfixState.score <= 0) return 0;
  if (Date.now() - clickfixState.lastScanTs > CLICKFIX_STATE_TTL_MS) {
    clickfixState = { score: 0, lastScanTs: 0 };
    return 0;
  }
  return clickfixState.score;
}

// --- JS Behavior state (accumulated from main-world signals) ---
let _jsBehaviorState: JsBehaviorState = createEmptyState();

function getJsBehaviorScoreForNRS(): number {
  if (isStateExpired(_jsBehaviorState)) {
    _jsBehaviorState = createEmptyState();
    return 0;
  }
  return computeJsBehaviorScore(_jsBehaviorState);
}

function handleJsBehaviorSignal(type: string, payload: Record<string, unknown>): void {
  const now = Date.now();
  if (isStateExpired(_jsBehaviorState)) {
    _jsBehaviorState = createEmptyState();
  }
  _jsBehaviorState.lastSignalTs = now;

  const recordSignal = (key: keyof JsBehaviorState["signalCounts"]) => {
    _jsBehaviorState.signalCounts[key]++;
    _jsBehaviorState.signalLastTs[key] = now;
  };

  switch (type) {
    case "ns-js-form-submit-suspicious": {
      const hasCredentialFields = payload.hasCredentialFields === true;
      const isCrossOrigin = payload.isCrossOrigin === true;
      const actionDynamicallyChanged = payload.actionDynamicallyChanged === true;
      if (hasCredentialFields && isCrossOrigin) {
        recordSignal("formSubmitSuspicious");
      }
      if (actionDynamicallyChanged) {
        recordSignal("dynamicFormAction");
      }
      if (!hasCredentialFields && !isCrossOrigin && !actionDynamicallyChanged) {
        recordSignal("formSubmitSuspicious");
      }
      break;
    }
    case "ns-js-exfil-network":
      recordSignal("exfilNetwork");
      break;
    case "ns-js-exfil-beacon":
      recordSignal("exfilBeacon");
      break;
    case "ns-js-credential-read":
      recordSignal("credentialRead");
      break;
  }

  _jsBehaviorState.score = computeJsBehaviorScore(_jsBehaviorState);
}

// --- Visual similarity brand-match state (top frame only) ---
let _cachedVisualSimScore = 0;
let _visualSimScheduled = false;
// URL the cached visual-sim score was computed for. Used to detect SPA
// (in-page) navigations so a stale per-route score is not applied elsewhere.
let _visualSimUrl = "";
let _visualSimNavListenersBound = false;
// Pending observer/timer waiting for a delayed (SPA / multi-step) password
// field. Tracked so a navigation can cancel a stale wait.
let _visualSimPwObserver: MutationObserver | null = null;
let _visualSimPwTimer: ReturnType<typeof setTimeout> | null = null;

/** How long to watch for a delayed password field before giving up. */
const VISUAL_SIM_PW_WAIT_MS = 30_000;

function getVisualSimScoreForNRS(): number {
  return _cachedVisualSimScore;
}

function cancelVisualSimPasswordWait(): void {
  if (_visualSimPwObserver) {
    _visualSimPwObserver.disconnect();
    _visualSimPwObserver = null;
  }
  if (_visualSimPwTimer) {
    clearTimeout(_visualSimPwTimer);
    _visualSimPwTimer = null;
  }
}

/**
 * When no password field is present yet, multi-step / SPA login flows (Google,
 * Microsoft, etc.) often inject one after the user advances. Observe the DOM
 * for a password field and run the check once it appears, bounded by a timeout
 * so the observer never leaks. Returns true if a wait was armed.
 */
function waitForPasswordFieldThenRun(): boolean {
  if (typeof MutationObserver === "undefined" || !document.documentElement) {
    return false;
  }
  cancelVisualSimPasswordWait();
  const armedUrl = location.href;
  _visualSimPwObserver = new MutationObserver(() => {
    // Abandon if the page navigated away while we were waiting.
    if (location.href !== armedUrl) {
      cancelVisualSimPasswordWait();
      return;
    }
    if (document.querySelector('input[type="password"]')) {
      cancelVisualSimPasswordWait();
      void runVisualSimCheck();
    }
  });
  _visualSimPwObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  _visualSimPwTimer = setTimeout(() => cancelVisualSimPasswordWait(), VISUAL_SIM_PW_WAIT_MS);
  return true;
}

/**
 * Run the brand-match check for the current route. Waits for the page to
 * stabilize, then captures the viewport (via the service worker) and compares
 * it against the brand template database. On a match it refines the score
 * using the brand-canonical-domain map so brand surfaces on their own domains
 * are not penalized (cross-origin impersonation is the only thing that scores).
 *
 * Fully best-effort: any failure degrades to a score of 0 and never blocks the
 * click-time decision path (the result is read synchronously from the cache).
 */
async function runVisualSimCheck(): Promise<void> {
  try {
    _visualSimUrl = location.href;
    // Only meaningful on pages that ask for credentials. If none is present
    // yet, watch for one to be injected (multi-step / SPA login flows) rather
    // than giving up permanently.
    if (!document.querySelector('input[type="password"]')) {
      _cachedVisualSimScore = 0;
      waitForPasswordFieldThenRun();
      return;
    }

    await waitForStability();

    // First pass: do not assume cross-origin so we learn the matched brand
    // without over-scoring. The match object is populated even when this pass
    // scores 0, so we can still look up the canonical domain for the brand.
    const result = await triggerVisualSimCheck(false);
    if (!result || !result.match) {
      _cachedVisualSimScore = 0;
      return;
    }

    const crossOrigin = isCurrentPageCrossOriginFromBrand(result.match.brandId);
    // On-domain matches score 0; only re-score (cross-origin) when off-domain.
    const refined = crossOrigin ? await triggerVisualSimCheck(true) : result;
    _cachedVisualSimScore = refined && refined.score > 0 ? refined.score : 0;

    if (settings.debug) {
      console.debug(
        "[NavSentinel] Visual brand match:",
        result.match.brandId,
        "crossOrigin=", crossOrigin,
        "score=", _cachedVisualSimScore
      );
    }
  } catch (err) {
    _cachedVisualSimScore = 0;
    console.warn("[NavSentinel] Visual similarity check failed:", err);
  }
}

/**
 * Reset and re-evaluate visual-similarity state after an in-page (SPA)
 * navigation. The cached score is route-specific, so a score from one route
 * must not leak into a later route. Clears the cached score, the capture cache
 * (so the new route is re-captured), and re-runs the check for the new URL.
 */
function onVisualSimSpaNavigation(): void {
  if (!isTopFrame()) return;
  if (settings.defaultMode === "off") return;
  // No-op if the URL has not actually changed (e.g. duplicate events).
  if (location.href === _visualSimUrl) return;
  _cachedVisualSimScore = 0;
  _visualSimScheduled = false;
  cancelVisualSimPasswordWait();
  resetVisualSimState();
  scheduleVisualSimCheck();
}

function bindVisualSimNavListeners(): void {
  if (_visualSimNavListenersBound) return;
  if (!isTopFrame()) return;
  _visualSimNavListenersBound = true;
  // popstate (back/forward) and hashchange (hash routing) fire in the isolated
  // world. Suspicious pushState/replaceState arrive via the main-world bridge
  // (ns-pushstate-suspicious) and are also routed here.
  window.addEventListener("popstate", () => onVisualSimSpaNavigation());
  window.addEventListener("hashchange", () => onVisualSimSpaNavigation());
}

/**
 * Top-frame-only brand-match scheduler. Schedules the check once per route and
 * defers it off the critical path. Re-invoked on SPA navigations so each route
 * is re-evaluated.
 */
function scheduleVisualSimCheck(): void {
  if (!isTopFrame()) return;
  if (settings.defaultMode === "off") return;
  bindVisualSimNavListeners();
  if (_visualSimScheduled) return;
  _visualSimScheduled = true;

  // Defer off the critical path. Start from page load to avoid contending
  // with initial render and SPA hydration.
  if (document.readyState === "complete") {
    void runVisualSimCheck();
  } else {
    window.addEventListener("load", () => { void runVisualSimCheck(); }, { once: true });
  }
}

function handleClickFixScan(): void {
  if (settings.defaultMode === "off") return;
  const now = Date.now();

  const result = scanForClickFix();

  // Update tracked ClickFix state for NRS integration.
  // Only overwrite a positive state with another positive detection;
  // a negative scan must not wipe a prior positive — let TTL handle expiry.
  // This prevents an adversarial second clipboard write (innocuous value after
  // removing the overlay) from clearing the positive state prematurely.
  const newScore = result.detected ? result.score : 0;
  if (newScore > 0 || clickfixState.score <= 0) {
    clickfixState = {
      score: newScore,
      lastScanTs: now,
    };
  }

  if (!result.detected) return;

  // Rate-limit standalone toast: at most one alert per 10 seconds
  if (now - clickFixAlertedAt < 10_000) return;

  clickFixAlertedAt = now;
  sendIconUpdate("red");
  appendEventSafely({
    kind: "clickfix_detected",
    site: siteKeyFromLocation(),
    url: location.href,
    score: result.score,
    reasons: result.reasons,
  });

  showToast({
    message: buildPlainMessage("NavSentinel detected a fake verification dialog with clipboard hijack. Do NOT paste into Run or Terminal", result.reasons),
    actions: [
      {
        label: "Dismiss",
        onClick: () => {
          appendOutcomeSafely({
            domain: siteKeyFromLocation(),
            type: "nav",
            score: result.score,
            outcome: "dismiss",
            ...(result.reasons?.length ? { reasons: result.reasons } : {}),
          });
        },
      },
    ],
    timeoutMs: 0,
  });
}

// --- Mutation monitor ---

const MUTATION_START_DELAY_MS = 2000;

function handleMutationAlert(alert: MutationAlert): void {
  if (settings.defaultMode === "off") return;

  appendEventSafely({
    kind: "mutation_alert",
    site: siteKeyFromLocation(),
    url: location.href,
    reasons: [alert.type],
    extra: { details: alert.details, severity: alert.severity },
  });

  // Only show a warning toast for high-severity overlay injections.
  // Low-severity alerts (cookie banners, chat widgets, ARIA dialogs) are
  // still logged for telemetry but do not disturb the user.
  if (alert.type === "overlay_injected" && alert.severity === "high") {
    sendIconUpdate("yellow");
    showToast({
      message: "NavSentinel detected a suspicious overlay injected after page load. The page may be attempting a phishing attack.",
      actions: [{ label: "Dismiss", onClick: () => {} }],
      timeoutMs: 0,
    });
  }

  refreshDebug();
}

function initMutationMonitor(): void {
  if (settings.defaultMode === "off") return;
  startMutationMonitor(document, handleMutationAlert);
}

function scheduleMutationMonitor(): void {
  if (!isTopFrame()) return;

  // Use the `load` event (readyState "complete") as the baseline instead of
  // `DOMContentLoaded`. This avoids false positives from SPA hydration that
  // often continues 3-5 seconds after DCL. If `load` already fired, delay
  // from the current time with a longer window (3 s) since we cannot know
  // how long ago the page finished loading.
  if (document.readyState === "complete") {
    setTimeout(initMutationMonitor, 3000);
  } else {
    window.addEventListener("load", () => {
      setTimeout(initMutationMonitor, MUTATION_START_DELAY_MS);
    }, { once: true });
  }
}

scheduleMutationMonitor();

// --- CSP analysis (run once after DOM is ready) ---

function runCSPAnalysis(): void {
  if (cachedCSPAnalysis) return;
  cachedCSPAnalysis = analyzeCSP(document);
  if (settings.debug) {
    console.debug("[NavSentinel] CSP analysis:", cachedCSPAnalysis);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runCSPAnalysis, { once: true });
} else {
  runCSPAnalysis();
}

// --- Rollback prompts ---

function showRollbackPrompt(url: string): void {
  const now = Date.now();
  if (now - rollbackShownAt < 750) return;
  rollbackShownAt = now;
  lastNav = { kind: "rollback", url, status: "blocked" };
  refreshDebug();
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url || "destination";
    }
  })();
  sendIconUpdate("yellow");
  appendEventSafely({ kind: "nav_rollback", site: siteKeyFromLocation(), url, destHost: host });
  showToast({
    message: `NavSentinel rolled back a suspicious redirect to ${host}`,
    actions: [
      {
        label: "Proceed",
        onClick: () => {
          try {
            if (/^https?:\/\//i.test(url)) {
              notifyNavAllow();
              location.assign(url);
            }
          } catch {
            // ignore
          }
        }
      },
      {
        label: "Dismiss",
        onClick: () => {
          // no-op
        }
      }
    ],
    timeoutMs: 0
  });
}

function handleRollback(url: string, prevUrl?: string): void {
  if (settings.defaultMode === "off") return;
  if (!isTopFrame()) return;
  if (!url) return;
  const referrerTarget = (() => {
    if (!document.referrer || document.referrer === location.href) return "";
    try {
      return new URL(document.referrer).toString();
    } catch {
      return "";
    }
  })();
  const target = prevUrl && prevUrl !== url ? prevUrl : referrerTarget;
  if (target && /^https?:\/\//i.test(target)) {
    try {
      chrome.runtime.sendMessage({ type: "ns-begin-rollback", returnUrl: target });
      chrome.runtime.sendMessage({ type: "ns-store-forward", url, returnUrl: target });
      notifyNavAllow();
      notifyAllowedTarget(target);
      window.setTimeout(() => {
        try {
          postToMain("ns-allow", { allowOpen: false, allowRedirect: true });
          location.replace(target);
        } catch {
          // ignore
        }
      }, 0);
      return;
    } catch {
      // ignore
    }
  }
  showRollbackPrompt(url);
}

function parseDestination(rawUrl: string | null | undefined): { href: string | null; host: string | null } {
  if (!rawUrl) return { href: null, host: null };
  try {
    const u = new URL(rawUrl, location.href);
    return { href: u.toString(), host: u.hostname.toLowerCase() };
  } catch {
    return { href: null, host: null };
  }
}

function isInteractive(h: { tag: string; role?: string; hasOnClick?: boolean }): boolean {
  if (h.tag === "A" || h.tag === "BUTTON") return true;
  const role = (h.role ?? "").toLowerCase();
  if (role === "link" || role === "button") return true;
  return !!h.hasOnClick;
}

function isInteractiveElement(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "A" || tag === "BUTTON") return true;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (role === "link" || role === "button") return true;
  return !!el.getAttribute("onclick");
}

function elementNameLength(el: Element): number {
  const text = (el.textContent ?? "").replace(/\s+/g, "");
  const aria = (el.getAttribute("aria-label") ?? "").trim();
  const title = (el.getAttribute("title") ?? "").trim();
  return Math.min(120, text.length + aria.length + title.length);
}

function isVisibleElement(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const cs = window.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") {
    return false;
  }
  const opacity = Number.parseFloat(cs.opacity);
  if (Number.isFinite(opacity) && opacity < 0.08) return false;
  return true;
}

function isLegitBlankAnchor(
  anchor: HTMLAnchorElement,
  ctx: { top: { tag: string; role?: string; hasOnClick?: boolean }; retargeted?: boolean },
  cds: number,
  reasonCodes: string[]
): boolean {
  if (cds >= CDS_SMART_BLOCK_THRESHOLD) return false;
  if (ctx.retargeted) return false;
  if (!isVisibleElement(anchor)) return false;
  if (elementNameLength(anchor) === 0) return false;
  if (!isInteractive(ctx.top) && !isInteractiveElement(anchor)) return false;
  for (const reason of reasonCodes) {
    if (RISKY_BLANK_REASONS.has(reason)) return false;
  }
  return true;
}

function getNrsBlockThreshold(mode: Mode): number {
  const base = mode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD;
  return Math.max(30, Math.min(100, base + adaptiveAdjustment));
}

function tryOpenShadowRoot(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    // chrome.dom API is available to MV3 content scripts without permissions
    // and reliably accesses shadow roots from the isolated world.
    return (globalThis as Record<string, unknown> as { chrome?: { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } } })
      .chrome?.dom?.openOrClosedShadowRoot?.(el) ?? null;
  } catch { return null; }
}

function findAnchorInShadowRoots(x: number, y: number): HTMLAnchorElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const sr = tryOpenShadowRoot(el);
    if (!sr) continue;
    const inner = sr.elementFromPoint(x, y);
    if (inner?.tagName === "A") return inner as HTMLAnchorElement;
    const anc = inner?.closest?.("a");
    if (anc) return anc as HTMLAnchorElement;
    const first = sr.querySelector("a");
    if (first) return first as HTMLAnchorElement;
  }
  return null;
}

function findAnchorFromEvent(e: MouseEvent): HTMLAnchorElement | null {
  const path = e.composedPath?.() ?? [];
  for (const el of path) {
    if (el instanceof HTMLAnchorElement) return el;
    if (el instanceof Element && el.tagName === "A") return el as HTMLAnchorElement;
    // Cross-world fallback: shadow-internal elements in composedPath may not
    // pass instanceof checks from the extension's isolated world.
    if ((el as { nodeType?: number; tagName?: string })?.nodeType === 1 &&
        (el as { tagName?: string })?.tagName === "A")
      return el as unknown as HTMLAnchorElement;
  }
  const target = e.target as Element | null;
  const fromClosest = (target?.closest("a") as HTMLAnchorElement | null) ?? null;
  if (fromClosest) return fromClosest;
  // Shadow DOM fallback: composedPath() may not pierce shadow roots in all
  // Chromium builds when called from the extension's isolated world.
  // Scan all elements at click coordinates for shadow roots containing anchors.
  return findAnchorInShadowRoots(e.clientX, e.clientY);
}

function allowOnce(url: string, target?: string, features?: string): void {
  notifyNavAllow();
  postToMain("ns-allow-once");
  window.setTimeout(() => {
    try {
      window.open(url, target ?? "_blank", features);
    } catch {
      showToast({ message: "NavSentinel could not open the allowed navigation." });
    }
  }, 0);
}

function allowActionOnce(actionId?: string | null, url?: string, target?: string, features?: string): void {
  if (actionId) {
    notifyNavAllow();
    postToMain("ns-allow-action", { id: actionId });
    return;
  }
  if (url) {
    allowOnce(url, target, features);
  }
}

async function allowAlways(
  siteKey: string,
  host: string,
  params: { actionId?: string | null; url?: string; target?: string; features?: string }
): Promise<void> {
  allowlist = await addAllowlistEntry(siteKey, host);
  appendEventSafely({ kind: "nav_allowlist_add", site: siteKey, destHost: host, url: location.href });
  allowActionOnce(params.actionId ?? null, params.url, params.target, params.features);
}

/**
 * After an "Allow once" click, check whether the user has now hit the smart
 * default threshold for this domain pair. If so, show a suggestion toast.
 */
function checkSmartDefaultSuggestion(sourceDomain: string, destDomain: string): void {
  void (async () => {
    try {
      const onCooldown = await isPairOnCooldown(sourceDomain, destDomain);
      if (onCooldown) return;

      // Don't suggest adding a pair already on the allowlist. After #307 a historical
      // always_allow outcome keeps counting toward the streak, so a pair the user
      // already made permanent (or re-allowed in options) could otherwise re-surface
      // the toast. Read the live allowlist (not the cached module copy) so an
      // options-page removal correctly re-enables the suggestion. (#315)
      const currentAllowlist = await getAllowlist();
      if (isAllowlisted(currentAllowlist, sourceDomain, destDomain)) return;

      const outcomes = await getPromptOutcomes();
      const suggestion = analyzeOutcomesForPair(outcomes, sourceDomain, destDomain);
      if (!suggestion) return;

      const displayDomain = getRegistrableDomain(destDomain) || destDomain;
      showToast({
        message: `You’ve allowed navigations to ${displayDomain} ${suggestion.allowCount} times. Always allow?`,
        actions: [
          {
            label: "Always Allow",
            onClick: () => {
              void (async () => {
                try {
                  await clearCooldown(sourceDomain, destDomain);
                  allowlist = await addAllowlistEntry(sourceDomain, destDomain);
                  appendEventSafely({
                    kind: "nav_allowlist_add",
                    site: sourceDomain,
                    destHost: destDomain,
                    url: location.href,
                  });
                } catch {
                  // ignore
                }
              })();
            },
          },
        ],
        onDismiss: () => {
          void setCooldown(sourceDomain, destDomain).catch(() => {});
        },
        timeoutMs: 0,
      });
    } catch {
      // Graceful degradation: don't break the main flow
    }
  })();
}

function showAllowPrompt(params: {
  title: string;
  url: string;
  host: string | null;
  target?: string;
  features?: string;
  actionId?: string | null;
  promptScore?: number;
  /** Replay-grade enrichment captured at decision time (P5-C1). Absent for the
   *  main-world bridge prompt path, which has no CDS/NRS decision context. */
  outcomeFeatures?: NavOutcomeFeatures;
}): void {
  const promptScore = params.promptScore ?? lastDebug?.cds ?? 0;
  const sourceDomain = siteKeyFromLocation();
  const destDomain = params.host ?? undefined;
  const outcomeFeatures = params.outcomeFeatures ?? {};
  const actions = [
    {
      label: "Allow once",
      onClick: () => {
        allowActionOnce(params.actionId, params.url, params.target, params.features);
        void appendPromptOutcome({
          domain: sourceDomain,
          ...(destDomain !== undefined ? { destDomain } : {}),
          type: "nav",
          score: promptScore,
          outcome: "allow_once",
          ...outcomeFeatures
        }).then(() => {
          refreshAdaptiveScores();
          if (destDomain) {
            checkSmartDefaultSuggestion(sourceDomain, destDomain);
          }
        }).catch(() => {});
      }
    }
  ];

  if (params.host) {
    actions.push({
      label: "Always allow",
      onClick: () => {
        appendOutcomeSafely({
          domain: sourceDomain,
          ...(destDomain !== undefined ? { destDomain } : {}),
          type: "nav",
          score: promptScore,
          outcome: "always_allow",
          ...outcomeFeatures
        });
        void allowAlways(sourceDomain, params.host as string, {
          ...(params.actionId !== undefined ? { actionId: params.actionId } : {}),
          ...(params.url !== undefined ? { url: params.url } : {}),
          ...(params.target !== undefined ? { target: params.target } : {}),
          ...(params.features !== undefined ? { features: params.features } : {})
        });
      }
    });
  }

  appendEventSafely({
    kind: "nav_blank_prompt",
    site: sourceDomain,
    url: params.url,
    ...(params.host ? { destHost: params.host } : {})
  });

  showToast({
    message: `${params.title}: ${params.host ?? params.url}`,
    actions,
    // Coalesce a burst of blocked-nav prompts (ad-heavy / malicious-popup pages)
    // into the count pill so the user is not forced to act on each. The blocked
    // navigation stays blocked; the pill expands to the latest prompt's actions
    // if a popup was actually wanted.
    coalesce: true,
    onDismiss: () => {
      appendOutcomeSafely({
        domain: sourceDomain,
        ...(destDomain !== undefined ? { destDomain } : {}),
        type: "nav",
        score: promptScore,
        outcome: "dismiss",
        ...outcomeFeatures
      });
    }
  });
}

if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "ns-rollback") return;
    if (!isTopFrame()) return;
    if (settings.defaultMode === "off") return;
    const url = typeof message.url === "string" ? message.url : "";
    const prevUrl = typeof message.prevUrl === "string" ? message.prevUrl : "";
    handleRollback(url, prevUrl);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "ns-forward-offer") return;
    if (!isTopFrame()) return;
    if (settings.defaultMode === "off") return;
    const url = typeof message.url === "string" ? message.url : "";
    if (!url || !/^https?:\/\//i.test(url)) return;
    showRollbackPrompt(url);
  });

  // DoubleClickjacking: delegate to dblclick_guard module for
  // ns-dblclick-child-closed and ns-dblclick-opener-nav-from-child.
  chrome.runtime.onMessage.addListener((message) => {
    if (!isTopFrame()) return;
    handleDblclickRuntimeMessage(message);
  });

  // OAuth monitoring: delegate to oauth_monitor module for
  // ns-oauth-flow-update, ns-oauth-redirect-mismatch, ns-oauth-opener-manipulation.
  chrome.runtime.onMessage.addListener((message) => {
    if (!isTopFrame()) return;
    handleOAuthRuntimeMessage(message);
  });
}

if (chrome?.runtime?.sendMessage && isTopFrame()) {
  // -- Rollback polling --
  const run = (polls = 4, errorBudget = 3) => {
    chrome.runtime.sendMessage({ type: "ns-check-rollback" }, (resp) => {
      if (chrome.runtime.lastError) {
        if (errorBudget > 0) window.setTimeout(() => run(polls, errorBudget - 1), 200);
        return;
      }
      if (resp?.shouldRollback) {
        if (settings.defaultMode === "off") return;
        const url = typeof resp.entry?.url === "string" ? resp.entry.url : "";
        const prevUrl = typeof resp.prevUrl === "string" ? resp.prevUrl : "";
        handleRollback(url, prevUrl);
        return;
      }
      if (polls > 0) {
        window.setTimeout(() => run(polls - 1, errorBudget), 200);
      }
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => run(), { once: true });
  } else {
    run();
  }

  // -- Forward polling --
  const runForward = (retries = 1, errorBudget = 3) => {
    if (forwardCheckInFlight) return;
    if (forwardCheckTimer) {
      window.clearTimeout(forwardCheckTimer);
      forwardCheckTimer = 0;
    }
    forwardCheckInFlight = true;
    const inflightGuard = window.setTimeout(() => { forwardCheckInFlight = false; }, FORWARD_CHECK_INFLIGHT_TIMEOUT_MS);
    chrome.runtime.sendMessage({ type: "ns-check-forward", currentUrl: location.href }, (resp) => {
      window.clearTimeout(inflightGuard);
      forwardCheckInFlight = false;
      if (chrome.runtime.lastError) {
        if (errorBudget > 0) forwardCheckTimer = window.setTimeout(() => runForward(retries, errorBudget - 1), 200);
        return;
      }
      const status = typeof resp?.status === "string" ? resp.status : "";
      const url = typeof resp?.url === "string" ? resp.url : "";
      if (status === "offer" && url) {
        if (settings.defaultMode === "off") return;
        if (!/^https?:\/\//i.test(url)) return;
        showRollbackPrompt(url);
        return;
      }
      if (!resp && retries > 0) {
        forwardCheckTimer = window.setTimeout(() => runForward(retries - 1, errorBudget), 200);
      }
    });
  };

  window.addEventListener("pageshow", () => runForward());
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      runForward();
    }
  });

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => runForward(), { once: true });
  } else {
    runForward();
  }
}

window.addEventListener(
  "pointerdown",
  (e) => {
    if (!(e instanceof PointerEvent)) return;
    // Pointerdown is risk-correlation evidence only. Even a trusted down can be
    // cancelled or followed by page-script navigation, so it must not mint the
    // tab-wide SW rollback allowance before a trusted click is approved.
    if (!e.isTrusted) return;
    // A cold worker can miss the page's initial onCommitted event. Seed only
    // the rollback baseline here; ns-nav-context grants no navigation authority.
    if (isTopFrame()) notifyNavContext();
    lastDown = capturePointerDown(e);
    const token = makeToken({
      siteKey: siteKeyFromLocation(),
      frameKey: frameKey(),
      mode: settings.defaultMode,
      pointer: {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey
      },
      cds: 0,
      reasonCodes: []
    });
    setActiveToken(token);
  },
  true
);

window.addEventListener(
  "click",
  (e) => {
    if (!(e instanceof MouseEvent)) return;

    const isKeyboardActivation = e.isTrusted && e.detail === 0;
    // A recent trusted down remains risk-correlation evidence even when page
    // code synchronously dispatches the click: target/timing mismatches should
    // raise suspicion. It never grants authority; the current click's
    // `e.isTrusted` separately gates prompt suppression and every allowance.
    const downForClick =
      !isKeyboardActivation && lastDown && performance.now() - lastDown.ts < 1500
        ? lastDown
        : null;

    const ctx = (() => {
      if (isKeyboardActivation) {
        const path = e.composedPath?.() ?? [];
        const firstEl = path.find((p) => p instanceof Element) as Element | undefined;
        return buildKeyboardClickContext(firstEl ?? (e.target instanceof Element ? e.target : null));
      }
      const click = captureClick(e);
      return buildClickContextFromEvents({ down: downForClick, click });
    })();

    const cdsResult = computeCDS(ctx);
    const { cds, reasonCodes: cdsReasons } = cdsResult;
    const mode: Mode = settings.defaultMode;
    const pointer = isKeyboardActivation
      ? undefined
      : downForClick
        ? {
            x: downForClick.x,
            y: downForClick.y,
            button: downForClick.button,
            ctrl: downForClick.ctrl,
            shift: downForClick.shift,
            alt: downForClick.alt,
            meta: downForClick.meta
          }
        : {
            x: e.clientX,
            y: e.clientY,
            button: 0,
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey
          };

    const explicitNewTab = e.isTrusted && !!ctx.explicitNewTabIntent;
    const anchor = findAnchorFromEvent(e);
    const anchorTarget = (anchor?.target ?? "").toLowerCase();
    const isBlankAnchor = !!(anchor && anchorTarget === "_blank");
    const isSameTabAnchor = !!(anchor && (!anchorTarget || anchorTarget === "_self"));
    const parsed = anchor ? parseDestination(anchor.getAttribute("href") ?? anchor.href) : null;
    const isAllowed = parsed?.host
      ? isAllowlisted(allowlist, siteKeyFromLocation(), parsed.host)
      : false;

    const currentDownId = downForClick ? downForClick.ts : performance.now();
    if (currentDownId !== gestureDownId) {
      gestureDownId = currentDownId;
      gestureNavAttempts = 0;
    }
    gestureNavAttempts++;

    const siteRegDomain = getRegistrableDomain(siteKeyFromLocation());
    const destRegDomain = parsed?.host ? getRegistrableDomain(parsed.host) : null;
    const isCrossSite = !!(
      siteRegDomain &&
      destRegDomain &&
      siteRegDomain !== destRegDomain &&
      !areSameOrganization(siteRegDomain, destRegDomain)
    );

    const timeSincePointerdownMs = downForClick
      ? performance.now() - downForClick.ts
      : undefined;

    const userActivationActive = !!navigator.userActivation?.isActive;

    const dblClickHijack = isDoubleClickHijackActive();

    // Check both the registrable domain and the full hostname against the
    // bloom filter. Feeds may contain either form, and attackers may use
    // deep subdomains to evade registrable-domain-only checks.
    // In the top frame the filter is loaded locally for synchronous lookups.
    // Child frames skip loading and delegate to the SW asynchronously below.
    //
    // NOTE: In child frames, isKnownBadDomain() always returns false because
    // the bloom filter is not loaded locally. The +50 knownBadDomain NRS
    // factor is therefore absent. The async SW check below provides a
    // best-effort late warning but cannot retroactively block.
    const destHost = parsed?.host ?? null;
    const destDomainBad = destRegDomain
      ? isKnownBadDomain(destRegDomain) ||
        (destHost !== null && destHost !== destRegDomain && isKnownBadDomain(destHost))
      : false;
    const topFrame = isTopFrame();
    const trustTier = resolveFrameNavigationTrustTier({
      isTopFrame: topFrame,
      destHost,
      destinationAllowlisted: isAllowed,
      knownBadDomain: destDomainBad,
    });

    const oauthRedirectMismatch = isOAuthRedirectMismatch();
    const oauthOpenerManip = isOAuthOpenerManipulation();
    const cfScore = getClickfixScoreForNRS();
    const jsBehaviorScore = getJsBehaviorScoreForNRS();
    const visualSimScore = getVisualSimScoreForNRS();
    const pushStateAbuse = isPushStateAbuseActive();

    // Sync best-effort anomaly score (uses in-memory sliding window only).
    // The authoritative async path runs after the decision is made.
    const navAnomalyScore = destHost ? getAnomalyScoreSync(destHost) : 0;

    const navCtx: NavigationContext = {
      isNewTabOrWindow: isBlankAnchor,
      isCrossSite,
      timeSincePointerdownMs,
      userActivationActive,
      multipleAttemptsInGesture: gestureNavAttempts > 1,
      destinationAllowlisted: isAllowed,
      explicitNewTabIntent: explicitNewTab,
      doubleClickHijackActive: dblClickHijack,
      knownBadDomain: destDomainBad,
      ...(() => {
        const chain = cachedChainInfo;
        if (chain && chain.depth >= 2 && Date.now() - cachedChainInfoAt <= CHAIN_INFO_TTL_MS) {
          return {
            redirectChainDepth: chain.depth,
            redirectViaKnownRedirector: chain.viaKnownRedirector,
            knownRedirectorHops: chain.knownRedirectorHops,
          };
        }
        return {};
      })(),
      oauthRedirectMismatch,
      oauthOpenerManipulation: oauthOpenerManip,
      clickfixScore: cfScore > 0 ? cfScore : undefined,
      pushStateAbuse,
      cspWeaknessScore: cachedCSPAnalysis?.score,
      domainRepeatOffender: cachedDomainRepeatOffender,
      navAnomalyScore: navAnomalyScore > 0 ? navAnomalyScore : undefined,
      jsBehaviorScore: jsBehaviorScore > 0 ? jsBehaviorScore : undefined,
      visualSimilarityScore: visualSimScore > 0 ? visualSimScore : undefined,
      trustTier,
    };

    if (dblClickHijack) {
      const openerNavUrl = getDblclickOpenerNavUrl();
      appendEventSafely({
        kind: "dblclickjack_detected",
        site: siteKeyFromLocation(),
        url: openerNavUrl || location.href,
        destHost: (() => { try { return new URL(openerNavUrl || location.href, location.href).hostname; } catch { return location.hostname; } })(),
      });
    }

    const nrsResult = computeNRS(cdsResult, navCtx);
    const { nrs, reasonCodes, nrsFactors } = nrsResult;

    const token = makeToken({
      siteKey: siteKeyFromLocation(),
      frameKey: frameKey(),
      mode,
      pointer,
      cds,
      reasonCodes
    });
    setActiveToken(token);

    let decision: "allow" | "prompt" | "block" = "allow";
    const blockThreshold = getTierAdjustedBlockThreshold(getNrsBlockThreshold(mode), trustTier, nrsFactors);
    // Replay-grade feature snapshot (P5-C1 / #238). Built from LOCAL decision
    // scope here — `lastDebug` is only assigned below (after the branches), so
    // it would carry the previous click's data at the outcome call sites.
    const navFeatures: NavOutcomeFeatures = buildNavOutcomeFeatures({
      reasonCodes,
      nrsFactors,
      cds,
      navAnomalyScore,
      adaptiveAdj: adaptiveAdjustment,
      thresholdUsed: blockThreshold,
      ...(ctx ? { ctx } : {})
    });
    const smartAllowsBlank =
      mode === "smart" && e.isTrusted && !!anchor && isLegitBlankAnchor(anchor, ctx, cds, cdsReasons);
    const smartSuppressesBlankPrompt = shouldSuppressSmartBlankPrompt({
      mode,
      isBlankAnchor,
      isAllowed,
      explicitNewTab,
      cds,
      cdsReasons,
      nrs,
      nrsFactors,
      blockThreshold,
      pointerDownTrusted: downForClick?.trusted === true,
      clickTrusted: e.isTrusted,
      keyboardActivation: isKeyboardActivation,
      timeSincePointerdownMs,
      destHost,
      destHref: parsed?.href ?? null,
      sameOrganization: destHost === location.hostname ||
        !!(siteRegDomain && destRegDomain && areSameOrganization(siteRegDomain, destRegDomain)),
      oauthRedirectMismatch,
      oauthOpenerManipulation: oauthOpenerManip,
      trustTier,
    });

    if (mode !== "off") {
      const hasClickfix = cfScore > 0;
      if (isBlankAnchor && !isAllowed && !explicitNewTab && !smartAllowsBlank && !smartSuppressesBlankPrompt) {
        if (nrs >= blockThreshold) {
          decision = "block";
        } else {
          decision = "prompt";
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (parsed?.href) {
          const title = hasClickfix
            ? (decision === "block"
              ? "Blocked: navigation + fake dialog"
              : "Suspicious navigation + fake dialog detected")
            : decision === "block" ? "Blocked new tab" : "Suspicious new tab";
          showAllowPrompt({
            title,
            url: parsed.href,
            host: parsed.host,
            target: "_blank",
            promptScore: nrs,
            outcomeFeatures: navFeatures
          });
          // Suppress standalone ClickFix toast — unified prompt covers it
          if (hasClickfix) clickFixAlertedAt = Date.now();
        } else {
          const prefix = hasClickfix
            ? "NavSentinel blocked a new tab with fake dialog detected"
            : "NavSentinel blocked a suspicious new tab";
          showToast({ message: buildPlainMessage(prefix, reasonCodes), coalesce: !hasClickfix });
          if (hasClickfix) clickFixAlertedAt = Date.now();
        }
      } else if (!isBlankAnchor && nrs >= blockThreshold) {
        decision = "block";
        e.preventDefault();
        e.stopImmediatePropagation();
        appendEventSafely({
          kind: "nav_click_block",
          site: siteKeyFromLocation(),
          url: location.href,
          score: nrs,
          reasons: reasonCodes
        });
        appendOutcomeSafely({
          domain: siteKeyFromLocation(),
          ...(destHost ? { destDomain: destHost } : {}),
          type: "nav",
          score: nrs,
          outcome: "block",
          ...navFeatures
        });
        const blockPrefix = hasClickfix
          ? "NavSentinel blocked a deceptive click with fake dialog"
          : "NavSentinel blocked a deceptive click";
        showToast({ message: buildPlainMessage(blockPrefix, reasonCodes), coalesce: !hasClickfix });
        if (hasClickfix) clickFixAlertedAt = Date.now();
      }
    }

    if (decision === "block") {
      sendIconUpdate("red", tabBlockCount + 1);
    } else if (decision === "prompt") {
      sendIconUpdate("yellow");
    }

    if (decision === "allow") {
      const silentNavEvent = e.isTrusted
        ? buildSilentNavEvent({
            destHref: parsed?.href,
            destHost,
            nrs,
            reasonCodes,
            nrsFactors,
            blockThreshold,
          })
        : null;
      if (e.isTrusted && parsed?.href && shouldQueueSameTabSilentCommit({
        isTopFrame: topFrame,
        isDocumentNavigation: silentNavEvent !== null,
        isSameTabAnchor,
        explicitNewTab
      })) {
        notifyAllowedTarget(parsed.href, NAV_TARGET_ALLOW_TTL_MS, silentNavEvent ?? undefined);
      }
      // A synthetic click may still be scored, but it cannot create either an
      // exact target allowance or the broad tab/main-world windows that suppress
      // rollback. Otherwise a hostile page can dispatch pointerdown/click and
      // self-authorize its own navigation.
      if (e.isTrusted) {
        notifyNavGesture();
        notifyNavAllow();
        postToMain("ns-allow", {
          allowOpen: mode === "off" || explicitNewTab,
          allowRedirect: true
        });
      }

      // Same-tab candidates are persisted from the SW after the navigation
      // actually commits. A _blank anchor needs immediate logging because the
      // commit belongs to the newly opened child tab, not this opener tab.
      if (
        shouldLogImmediateSilentNav({
          mode,
          isTopFrame: topFrame,
          hasAnchor: !!anchor,
          isDocumentNavigation: silentNavEvent !== null,
          isBlankAnchor,
          isSameTabAnchor,
          explicitNewTab
        })
      ) {
        // Privacy: record the destination HOST only — never the full URL
        // (path/query can carry tokens/PII) — so the local log does not become a
        // browsing history. All of it stays local (D16); none is ever transmitted.
        appendImmediateSilentNav(silentNavEvent);
      }
    }

    lastDebug = {
      mode,
      decision,
      cds,
      nrs,
      blockThreshold,
      reasonCodes,
      nrsFactors,
      ctx,
      adaptiveAdj: adaptiveAdjustment,
      navAnomalyScore
    };
    refreshDebug();

    if (settings.debug) {
      console.debug("[NavSentinel] click", { decision, nrs, cds, reasonCodes, nrsFactors, ctx });
    }

    // --- Record domain profile (async, non-blocking) ---
    // Filter out the repeat-offender factor to prevent feedback loop:
    // recording it would bake +10 into totalNRS, inflating avgNRS and
    // making the domain a permanent repeat offender.
    if (mode !== "off") {
      const site = siteKeyFromLocation();
      const baseReasons = reasonCodes.filter(r => r !== "nrs_domain_repeat_offender");
      const baseNrs = Math.max(0, cachedDomainRepeatOffender ? nrs - 10 : nrs);
      void recordNavigation(site, baseNrs, baseReasons, blockThreshold)
        .then((risk) => { cachedDomainRepeatOffender = risk.isRepeatOffender; })
        .catch((err) => { console.warn("[NavSentinel] domain profile write failed:", err); });
    }

    // --- Record navigation anomaly profile (async, non-blocking) ---
    // Records the destination in the nav pattern profile and updates
    // the in-memory sliding window for burst detection.
    if (mode !== "off" && destHost) {
      void recordNavigationAnomaly(destHost)
        .catch((err) => { console.warn("[NavSentinel] nav anomaly write failed:", err); });
    }

    // --- Child-frame async reputation check ---
    // Child frames don't load the bloom filter locally to save memory.
    // If the synchronous path allowed the navigation and we have a
    // cross-site destination, ask the SW for a deferred reputation check.
    if (!isTopFrame() && decision === "allow" && destRegDomain && isCrossSite && mode !== "off") {
      void (async () => {
        try {
          const checks = [checkReputationViaMessage(destRegDomain)];
          if (destHost !== null && destHost !== destRegDomain) {
            checks.push(checkReputationViaMessage(destHost));
          }
          const results = await Promise.all(checks);
          const anyBad = results.some((r) => r.knownBad);
          const anyReady = results.some((r) => r.filterReady);
          if (!anyBad) {
            if (!anyReady && settings.debug) {
              console.debug("[NavSentinel] Child-frame reputation check: filter not ready in SW");
            }
            return;
          }
          // Destination is known-bad -- late async check from child frame.
          // The synchronous NRS path could not include the +50 knownBadDomain
          // factor because the bloom filter is not loaded in child frames.
          const host = destHost ?? destRegDomain;
          appendEventSafely({
            kind: "nav_reputation_late_warn",
            site: siteKeyFromLocation(),
            url: parsed?.href ?? location.href,
            destHost: host,
            reasons: ["late_async_child_frame"],
          });
          showToast({
            message: `NavSentinel warning: ${host} is a known malicious domain`,
            timeoutMs: 8000,
          });
        } catch {
          // Graceful degradation: SW unreachable
        }
      })();
    }
  },
  true
);
