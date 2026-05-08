import { computeCDS } from "../shared/scoring";
import { appendEvent, appendPromptOutcome, getPromptOutcomes, getNavSettings, onNavSettingsChange, type NavSettings } from "../shared/storage";
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
import { computeNRS, NRS_BLOCK_THRESHOLD, NRS_STRICT_BLOCK_THRESHOLD } from "../shared/nrs";
import type { NavigationContext } from "../shared/nrs";
import type { RedirectChainInfo } from "../shared/redirect_chain";
import { initReputation, isKnownBadDomain, checkReputationViaMessage } from "../shared/reputation";
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
import {
  handlePushStateBridgeMessage,
  isPushStateAbuseActive,
} from "./pushstate_guard";

const CDS_SMART_BLOCK_THRESHOLD = 70;
const CDS_STRICT_BLOCK_THRESHOLD = 50;
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
    !r.startsWith("keyboard_") && !r.startsWith("legit_") && !r.includes("allowlisted") && !r.includes("previously_allowed") && !r.includes("explicit_new_tab")
  );
  const topReason = positive[0];
  const explanation = topReason ? explainReasonCode(topReason) : "";
  return explanation ? `${prefix} — ${explanation}` : prefix;
}

function makeBridgeSession(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let lastDown: DownCapture | null = null;
let settings: NavSettings = { defaultMode: "smart", debug: false, dnrEnabled: false };
let allowlist: Allowlist = {};
let bridgePort: MessagePort | null = null;
let bridgeReady = false;
const bridgeSession = makeBridgeSession();
const pendingBridgeMessages: Array<{ type: string; payload?: Record<string, unknown> }> = [];
let mainGuard: "unknown" | "yes" | "no" = "unknown";
let lastNav: { kind: string; url: string; status: "allowed" | "blocked" } | null = null;
let lastDebug: Omit<DebugInfo, "mainGuard" | "lastNav"> | null = null;
let rollbackShownAt = 0;
let bridgeRetryTimer = 0;
let bridgeRetryDelayMs = BRIDGE_RETRY_MS;
let bridgeInitStartedAt = 0;
let forwardCheckInFlight = false;
let forwardCheckTimer = 0;
let gestureNavAttempts = 0;
let gestureDownId: number | null = null;
const CHAIN_INFO_TTL_MS = 30_000;
let cachedChainInfo: RedirectChainInfo | null = null;
let cachedChainInfoAt = 0;

function markMainGuardReady(): void {
  if (bridgeRetryTimer) {
    window.clearTimeout(bridgeRetryTimer);
    bridgeRetryTimer = 0;
  }
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
    ...(lastNav ? { lastNav } : {})
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
  document.documentElement.setAttribute("data-navsentinel-capture-ready", "1");
  setDebugEnabled(settings.debug);
  postToMain("ns-config", { mode: settings.defaultMode, debug: settings.debug });
  postToMain("ns-ping");
  // Load reputation bloom filter in the background (non-blocking)
  void loadReputationFilter();
  if (isTopFrame()) {
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
    pendingBridgeMessages.push(
      payload !== undefined
        ? { type, payload }
        : { type }
    );
    if (pendingBridgeMessages.length > MAX_PENDING_BRIDGE_MESSAGES) {
      pendingBridgeMessages.splice(0, pendingBridgeMessages.length - MAX_PENDING_BRIDGE_MESSAGES);
    }
    ensureBridge();
    return;
  }
  sendBridgeMessageToMain({ source: NS_SOURCE, type, v: PROTOCOL_VERSION, ...(payload ?? {}) });
}

function flushBridgeMessages(): void {
  if (!bridgeReady || !bridgePort) return;
  while (pendingBridgeMessages.length > 0) {
    const next = pendingBridgeMessages.shift();
    if (!next) break;
    bridgePort.postMessage({
      source: NS_SOURCE,
      type: next.type,
      v: PROTOCOL_VERSION,
      session: bridgeSession,
      ...(next.payload ?? {})
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
  };
  if (!data || data.source !== NS_SOURCE || data.v !== PROTOCOL_VERSION) return;
  if (data.session !== bridgeSession) return;

  if (data.type === "ns-bridge-ready") {
    markMainGuardReady();
    return;
  }

  if (data.type === "ns-pong" || data.type === "ns-config-ack") {
    markMainGuardReady();
    return;
  }

  if (data.type === "ns-nav-blocked") {
    lastNav = { kind: data.kind ?? "unknown", url: data.url ?? "", status: "blocked" };
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
    lastNav = { kind: data.kind ?? "unknown", url: data.url ?? "", status: "allowed" };
    refreshDebug();
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
      pendingBridgeMessages.length = 0;
      refreshDebug();
      return;
    }
    bridgePort?.close();

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
      bridgeRetryTimer = window.setTimeout(attempt, bridgeRetryDelayMs);
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

function appendOutcomeSafely(
  partial: Parameters<typeof appendPromptOutcome>[0]
): void {
  void appendPromptOutcome(partial).catch(() => {
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
    chrome.runtime.sendMessage({ type: "ns-nav-gesture", ttlMs });
  } catch {
    // ignore
  }
}

function notifyAllowedTarget(url: string, ttlMs = NAV_TARGET_ALLOW_TTL_MS): void {
  if (!url) return;
  try {
    chrome.runtime.sendMessage({ type: "ns-allow-target-nav", url, ttlMs });
  } catch {
    // ignore
  }
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
    showToast({
      message: buildPlainMessage("NavSentinel detected a suspicious overlay injected after page load", [alert.type]),
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
  // Only run the mutation monitor in the top frame. Sub-frames run with
  // all_frames:true but the monitor is most valuable in the top frame, and
  // cross-origin iframes already cannot be observed from the parent. Wrapped
  // in try/catch because accessing window.top throws in sandboxed iframes.
  try {
    if (window !== window.top) return;
  } catch {
    // Sandboxed iframe -- skip monitoring
    return;
  }

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
  (window as any).__navsentinelRollbackPrompt = { url, ts: now };
  appendEventSafely({ kind: "nav_rollback", site: siteKeyFromLocation(), url, destHost: host });
  showToast({
    message: `NavSentinel rolled back a suspicious redirect to ${host}`,
    actions: [
      {
        label: "Proceed",
        onClick: () => {
          try {
            notifyNavAllow();
            location.assign(url);
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
  const target = prevUrl && prevUrl !== url ? prevUrl : "";
  if (target) {
    try {
      chrome.runtime.sendMessage({ type: "ns-begin-rollback", returnUrl: target });
      chrome.runtime.sendMessage({ type: "ns-store-forward", url, returnUrl: target });
      notifyNavAllow();
      notifyAllowedTarget(target);
      window.setTimeout(() => {
        try {
          if (history.length > 1) {
            history.back();
            return;
          }
        } catch {
          // ignore
        }
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
  return mode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD;
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
}): void {
  const promptScore = params.promptScore ?? lastDebug?.cds ?? 0;
  const sourceDomain = siteKeyFromLocation();
  const destDomain = params.host ?? undefined;
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
          outcome: "allow_once"
        }).then(() => {
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
          outcome: "always_allow"
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
    onDismiss: () => {
      appendOutcomeSafely({
        domain: sourceDomain,
        ...(destDomain !== undefined ? { destDomain } : {}),
        type: "nav",
        score: promptScore,
        outcome: "dismiss"
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
    if (!url) return;
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
    if (window.top !== window) return;
    handleOAuthRuntimeMessage(message);
  });
}

if (chrome?.runtime?.sendMessage && isTopFrame()) {
  // -- Rollback polling --
  const run = (retries = 4) => {
    chrome.runtime.sendMessage({ type: "ns-check-rollback" }, (resp) => {
      if (resp?.shouldRollback) {
        if (settings.defaultMode === "off") return;
        const url = typeof resp.entry?.url === "string" ? resp.entry.url : "";
        const prevUrl = typeof resp.prevUrl === "string" ? resp.prevUrl : "";
        handleRollback(url, prevUrl);
        return;
      }
      if (retries > 0) {
        window.setTimeout(() => run(retries - 1), 200);
      }
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => run(), { once: true });
  } else {
    run();
  }

  // -- Forward polling --
  const runForward = (retries = 1) => {
    if (forwardCheckInFlight) return;
    if (forwardCheckTimer) {
      window.clearTimeout(forwardCheckTimer);
      forwardCheckTimer = 0;
    }
    forwardCheckInFlight = true;
    chrome.runtime.sendMessage({ type: "ns-check-forward", currentUrl: location.href }, (resp) => {
      forwardCheckInFlight = false;
      const status = typeof resp?.status === "string" ? resp.status : "";
      const url = typeof resp?.url === "string" ? resp.url : "";
      if (status === "offer" && url) {
        if (settings.defaultMode === "off") return;
        showRollbackPrompt(url);
        return;
      }
      if (!resp && retries > 0) {
        forwardCheckTimer = window.setTimeout(() => runForward(retries - 1), 200);
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
    notifyNavGesture();
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
    const downForClick =
      !isKeyboardActivation && lastDown && performance.now() - lastDown.ts < 1500 ? lastDown : null;

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

    const explicitNewTab = !!ctx.explicitNewTabIntent;
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

    const userActivationActive = !!(navigator as any).userActivation?.isActive;

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

    const oauthRedirectMismatch = isOAuthRedirectMismatch();
    const oauthOpenerManip = isOAuthOpenerManipulation();
    const cfScore = getClickfixScoreForNRS();
    const pushStateAbuse = isPushStateAbuseActive();

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
    const blockThreshold = getNrsBlockThreshold(mode);
    const smartAllowsBlank =
      mode === "smart" && !!anchor && isLegitBlankAnchor(anchor, ctx, cds, cdsReasons);

    if (mode !== "off") {
      const hasClickfix = cfScore > 0;
      if (isBlankAnchor && !isAllowed && !explicitNewTab && !smartAllowsBlank) {
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
            promptScore: nrs
          });
          // Suppress standalone ClickFix toast — unified prompt covers it
          if (hasClickfix) clickFixAlertedAt = Date.now();
        } else {
          const prefix = hasClickfix
            ? "NavSentinel blocked a new tab with fake dialog detected"
            : "NavSentinel blocked a suspicious new tab";
          showToast({ message: buildPlainMessage(prefix, reasonCodes) });
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
          type: "nav",
          score: nrs,
          outcome: "block"
        });
        const blockPrefix = hasClickfix
          ? "NavSentinel blocked a deceptive click with fake dialog"
          : "NavSentinel blocked a deceptive click";
        showToast({ message: buildPlainMessage(blockPrefix, reasonCodes) });
        if (hasClickfix) clickFixAlertedAt = Date.now();
      }
    }

    if (decision === "allow") {
      if (isSameTabAnchor && parsed?.href) {
        notifyAllowedTarget(parsed.href);
      }
      notifyNavGesture();
      notifyNavAllow();
      postToMain("ns-allow", {
        allowOpen: mode === "off" || explicitNewTab,
        allowRedirect: true
      });
    }

    lastDebug = { mode, decision, cds, nrs, reasonCodes, nrsFactors, ctx };
    refreshDebug();

    if (settings.debug) {
      console.debug("[NavSentinel] click", { decision, nrs, cds, reasonCodes, nrsFactors, ctx });
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
