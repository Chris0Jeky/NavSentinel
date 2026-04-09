import { computeCDS } from "../shared/scoring";
import { computeNRS, nrsDecision, type NavContext } from "../shared/nrs";
import { appendEvent, getNavSettings, onNavSettingsChange, type NavSettings } from "../shared/storage";
import { makeToken, setActiveToken } from "../shared/stateMachine";
import type { Mode } from "../shared/types";
import {
  addAllowlistEntry,
  getAllowlist,
  isAllowlisted,
  onAllowlistChange,
  type Allowlist
} from "../shared/allowlist";
import { showToast } from "./ui_toast";
import {
  buildClickContextFromEvents,
  buildKeyboardClickContext,
  captureClick,
  capturePointerDown,
  type DownCapture
} from "./dom_builder";
import { setDebugEnabled, updateDebugOverlay, type DebugInfo } from "./debug_overlay";

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
  "overlay_high_zindex",
  "retargeted_target_mismatch",
  "cursor_pointer_no_affordance"
]);

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
let gestureAttemptCount = 0;
let lastPointerdownTs = 0;

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
    ...(lastNav ? { lastNav } : {})
  });
}

async function initSettings() {
  ensureBridge();
  settings = await getNavSettings();
  allowlist = await getAllowlist();
  document.documentElement.setAttribute("data-navsentinel-capture-ready", "1");
  setDebugEnabled(settings.debug);
  postToMain("ns-config", { mode: settings.defaultMode, debug: settings.debug });
  postToMain("ns-ping");
  if (window.top === window) {
    try {
      chrome.runtime.sendMessage({ type: "ns-ready" });
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
  return window.top === window ? "top" : "frame";
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
    message: `NavSentinel rolled back a redirect to ${host}.`,
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
  if (window.top !== window) return;
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
  const aria = el.getAttribute("aria-label") ?? "";
  const title = el.getAttribute("title") ?? "";
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

function findAnchorFromEvent(e: MouseEvent): HTMLAnchorElement | null {
  const path = e.composedPath?.() ?? [];
  for (const el of path) {
    if (el instanceof HTMLAnchorElement) return el;
    if (el instanceof Element && el.tagName === "A") return el as HTMLAnchorElement;
  }
  const target = e.target as Element | null;
  return (target?.closest("a") as HTMLAnchorElement | null) ?? null;
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

function showAllowPrompt(params: {
  title: string;
  url: string;
  host: string | null;
  target?: string;
  features?: string;
  actionId?: string | null;
}): void {
  const actions = [
    {
      label: "Allow once",
      onClick: () => allowActionOnce(params.actionId, params.url, params.target, params.features)
    }
  ];

  if (params.host) {
    actions.push({
      label: "Always allow",
      onClick: () => {
        void allowAlways(siteKeyFromLocation(), params.host as string, {
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
    site: siteKeyFromLocation(),
    url: params.url,
    ...(params.host ? { destHost: params.host } : {})
  });

  showToast({
    message: `${params.title}: ${params.host ?? params.url}`,
    actions
  });
}

if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "ns-rollback") return;
    if (window.top !== window) return;
    if (settings.defaultMode === "off") return;
    const url = typeof message.url === "string" ? message.url : "";
    const prevUrl = typeof message.prevUrl === "string" ? message.prevUrl : "";
    handleRollback(url, prevUrl);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "ns-forward-offer") return;
    if (window.top !== window) return;
    if (settings.defaultMode === "off") return;
    const url = typeof message.url === "string" ? message.url : "";
    if (!url) return;
    showRollbackPrompt(url);
  });
}

if (chrome?.runtime?.sendMessage && window.top === window) {
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
}

if (chrome?.runtime?.sendMessage && window.top === window) {
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
    lastPointerdownTs = performance.now();
    gestureAttemptCount = 0;
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
    const { cds, reasonCodes: cdsReasonCodes } = cdsResult;
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

    // Only count navigation-relevant clicks (blank anchors, cross-site anchors)
    // toward the NRS multi-attempt factor — not plain same-site clicks
    const isNavRelevant = isBlankAnchor || (parsed?.host && !isAllowed);
    if (isNavRelevant) {
      gestureAttemptCount += 1;
    }

    // Compute pointerdown delta for NRS fast-timing factor.
    // Only pass to NRS for navigation-relevant clicks; for same-site
    // clicks the delta is not meaningful since click always follows
    // pointerdown quickly.
    const pointerdownDeltaMs = isNavRelevant && lastPointerdownTs > 0
      ? performance.now() - lastPointerdownTs
      : undefined;

    // Build allowlisted hosts array for NRS
    const siteKey = siteKeyFromLocation();
    const allowlistedHosts = allowlist[siteKey] ?? [];

    // Compute NRS from CDS + navigation context
    const navCtx: NavContext = {
      cds: cdsResult,
      isNewTab: isBlankAnchor,
      destinationUrl: parsed?.href ?? undefined,
      pageHost: location.hostname,
      pointerdownDeltaMs,
      userActivationActive: typeof navigator?.userActivation?.isActive === "boolean"
        ? navigator.userActivation.isActive
        : undefined,
      attemptsInGesture: gestureAttemptCount,
      explicitNewTabIntent: explicitNewTab,
      allowlistedHosts,
    };
    const nrsResult = computeNRS(navCtx);
    const { nrs, reasonCodes } = nrsResult;

    const token = makeToken({
      siteKey,
      frameKey: frameKey(),
      mode,
      pointer,
      cds,
      reasonCodes
    });
    setActiveToken(token);

    // Use NRS for navigation decisions
    const nrsAction = nrsDecision(nrs, mode);
    const smartAllowsBlank =
      mode === "smart" && !!anchor && isLegitBlankAnchor(anchor, ctx, cds, cdsReasonCodes);

    let decision: "allow" | "prompt" | "block" = "allow";

    if (mode !== "off") {
      if (isBlankAnchor && !isAllowed && !explicitNewTab && !smartAllowsBlank) {
        // For blank anchors, use NRS-based decision
        if (nrsAction === "block") {
          decision = "block";
          e.preventDefault();
          e.stopImmediatePropagation();
          appendEventSafely({
            kind: "nav_click_block",
            site: siteKey,
            url: location.href,
            score: nrs,
            reasons: reasonCodes
          });
          showToast({ message: `NavSentinel blocked deceptive navigation (NRS=${nrs}).` });
        } else {
          // NRS prompt or even allow still prompts for unsanctioned blank anchors
          decision = "prompt";
          e.preventDefault();
          e.stopImmediatePropagation();
          if (parsed?.href) {
            showAllowPrompt({
              title: "Blocked new tab",
              url: parsed.href,
              host: parsed.host,
              target: "_blank"
            });
          } else {
            showToast({ message: "NavSentinel blocked a new tab navigation." });
          }
        }
      } else if (!isBlankAnchor && nrsAction === "block") {
        decision = "block";
        e.preventDefault();
        e.stopImmediatePropagation();
        appendEventSafely({
          kind: "nav_click_block",
          site: siteKey,
          url: location.href,
          score: nrs,
          reasons: reasonCodes
        });
        showToast({ message: `NavSentinel blocked deceptive click (NRS=${nrs}).` });
      } else if (!isBlankAnchor && nrsAction === "prompt") {
        decision = "prompt";
        e.preventDefault();
        e.stopImmediatePropagation();
        if (parsed?.href) {
          showAllowPrompt({
            title: "Suspicious navigation",
            url: parsed.href,
            host: parsed.host,
          });
        } else {
          showToast({ message: `NavSentinel flagged a suspicious click (NRS=${nrs}).` });
        }
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

    lastDebug = { mode, decision, cds, nrs, reasonCodes, ctx };
    refreshDebug();

    if (settings.debug) {
      console.debug("[NavSentinel] click", { decision, nrs, cds, reasonCodes, ctx });
    }
  },
  true
);
