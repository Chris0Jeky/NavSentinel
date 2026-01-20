import { computeCDS } from "../shared/scoring";
import { getSettings, onSettingsChange } from "../shared/storage";
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
  capturePointerDown,
  captureClick,
  buildClickContextFromEvents,
  type DownCapture
} from "./dom_builder";
import { setDebugEnabled, updateDebugOverlay, type DebugInfo } from "./debug_overlay";

const CDS_SMART_BLOCK_THRESHOLD = 70;
const CDS_STRICT_BLOCK_THRESHOLD = 50;
const NS_SOURCE = "__navsentinel__";
const NAV_ALLOW_TTL_MS = 1500;
const RISKY_BLANK_REASONS = new Set([
  "intent_mismatch_under_interactive",
  "invisible_but_clickable",
  "overlay_large_interactive",
  "overlay_high_zindex",
  "retargeted_target_mismatch",
  "cursor_pointer_no_affordance"
]);

let lastDown: DownCapture | null = null;
let settings = { defaultMode: "smart", debug: false, dnrEnabled: false };
let allowlist: Allowlist = {};
let mainGuard: "unknown" | "yes" | "no" = "unknown";
let lastNav: { kind: string; url: string; status: "allowed" | "blocked" } | null = null;
let lastDebug: Omit<DebugInfo, "mainGuard" | "lastNav"> | null = null;
let rollbackShownAt = 0;

function refreshDebug(): void {
  if (!lastDebug) return;
  updateDebugOverlay({ ...lastDebug, mainGuard, lastNav: lastNav ?? undefined });
}

async function initSettings() {
  settings = await getSettings();
  allowlist = await getAllowlist();
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
  window.setTimeout(() => {
    if (mainGuard === "unknown") {
      mainGuard = "no";
      refreshDebug();
    }
  }, 750);
}

initSettings();

onSettingsChange((s) => {
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
  window.postMessage({ source: NS_SOURCE, type, ...(payload ?? {}) }, "*");
}

function notifyNavAllow(ttlMs = NAV_ALLOW_TTL_MS): void {
  try {
    chrome.runtime.sendMessage({ type: "ns-allow-nav", ttlMs });
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

function handleRollback(url: string): void {
  if (settings.defaultMode === "off") return;
  if (window.top !== window) return;
  if (!url) return;
  try {
    if (history.length > 1) {
      chrome.runtime.sendMessage({ type: "ns-store-forward", url });
      history.back();
      return;
    }
  } catch {
    // ignore
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

function nameLength(h: { textLength?: number; ariaLabelLength?: number; titleLength?: number }): number {
  return (h.textLength ?? 0) + (h.ariaLabelLength ?? 0) + (h.titleLength ?? 0);
}

function isInteractive(h: { tag: string; role?: string; hasOnClick?: boolean }): boolean {
  if (h.tag === "A" || h.tag === "BUTTON") return true;
  const role = (h.role ?? "").toLowerCase();
  if (role === "link" || role === "button") return true;
  return !!h.hasOnClick;
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
  if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
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
  if (!isInteractive(ctx.top) && !isInteractive(anchor)) return false;
  for (const reason of reasonCodes) {
    if (RISKY_BLANK_REASONS.has(reason)) return false;
  }
  return true;
}

function getBlockThreshold(mode: Mode): number {
  return mode === "strict" ? CDS_STRICT_BLOCK_THRESHOLD : CDS_SMART_BLOCK_THRESHOLD;
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
) {
  allowlist = await addAllowlistEntry(siteKey, host);
  allowActionOnce(params.actionId, params.url, params.target, params.features);
}

function showAllowPrompt(params: {
  title: string;
  url: string;
  host: string | null;
  target?: string;
  features?: string;
  actionId?: string | null;
}) {
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
          actionId: params.actionId,
          url: params.url,
          target: params.target,
          features: params.features
        });
      }
    });
  }

  showToast({
    message: `${params.title}: ${params.host ?? params.url}`,
    actions
  });
}

window.addEventListener(
  "message",
  (event) => {
    if (event.source !== window) return;
    const data = event.data as {
      source?: string;
      type?: string;
      id?: string;
      kind?: string;
      url?: string;
      target?: string;
      features?: string;
      mode?: "off" | "smart" | "strict";
    };
    if (!data || data.source !== NS_SOURCE) return;

    if (data.type === "ns-pong" || data.type === "ns-config-ack") {
      mainGuard = "yes";
      refreshDebug();
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
        features: data.features,
        actionId: data.id
      });
    }

    if (data.type === "ns-nav-allowed") {
      lastNav = { kind: data.kind ?? "unknown", url: data.url ?? "", status: "allowed" };
      refreshDebug();
      return;
    }
  },
  true
);

if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "ns-rollback") return;
    if (window.top !== window) return;
    if (settings.defaultMode === "off") return;
    const url = typeof message.url === "string" ? message.url : "";
    handleRollback(url);
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
  const run = () => {
    chrome.runtime.sendMessage({ type: "ns-check-rollback" }, (resp) => {
      if (!resp || !resp.shouldRollback) return;
      if (settings.defaultMode === "off") return;
      const url = typeof resp.entry?.url === "string" ? resp.entry.url : "";
      handleRollback(url);
    });
  };
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}

if (chrome?.runtime?.sendMessage && window.top === window) {
  const runForward = () => {
    chrome.runtime.sendMessage({ type: "ns-check-forward", currentUrl: location.href }, (resp) => {
      const url = typeof resp?.url === "string" ? resp.url : "";
      if (!url) return;
      if (settings.defaultMode === "off") return;
      showRollbackPrompt(url);
    });
  };
  window.addEventListener("pageshow", runForward);
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", runForward, { once: true });
  } else {
    runForward();
  }
}

window.addEventListener(
  "pointerdown",
  (e) => {
    if (!(e instanceof PointerEvent)) return;

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

    const click = captureClick(e);
    const ctx = buildClickContextFromEvents({ down: lastDown, click });
    const { cds, reasonCodes } = computeCDS(ctx);

    const mode: Mode = settings.defaultMode;

    const token = makeToken({
      siteKey: siteKeyFromLocation(),
      frameKey: frameKey(),
      mode,
      pointer: lastDown
        ? {
            x: lastDown.x,
            y: lastDown.y,
            button: lastDown.button,
            ctrl: lastDown.ctrl,
            shift: lastDown.shift,
            alt: lastDown.alt,
            meta: lastDown.meta
          }
        : {
            x: e.clientX,
            y: e.clientY,
            button: 0,
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            meta: e.metaKey
          },
      cds,
      reasonCodes
    });

    setActiveToken(token);

    const explicitNewTab = !!ctx.explicitNewTabIntent;

    const anchor = findAnchorFromEvent(e);
    const isBlankAnchor = !!(anchor && anchor.target === "_blank");
    const parsed = isBlankAnchor ? parseDestination(anchor?.getAttribute("href") ?? anchor?.href) : null;
    const isAllowed = parsed?.host
      ? isAllowlisted(allowlist, siteKeyFromLocation(), parsed.host)
      : false;

    let decision: "allow" | "prompt" | "block" = "allow";
    const blockThreshold = getBlockThreshold(mode);

    if (mode !== "off") {
      const smartAllowsBlank =
        mode === "smart" && !!anchor && isLegitBlankAnchor(anchor, ctx, cds, reasonCodes);
      if (isBlankAnchor && !isAllowed && !explicitNewTab && !smartAllowsBlank) {
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
      } else if (!isBlankAnchor && cds >= blockThreshold) {
        decision = "block";
        e.preventDefault();
        e.stopImmediatePropagation();
        showToast({
          message: `NavSentinel blocked deceptive click (CDS=${cds}).`
        });
      }
    }

    if (decision === "allow") {
      notifyNavAllow();
      postToMain("ns-allow", {
        allowOpen: mode === "off" || explicitNewTab,
        allowRedirect: true
      });
    }

    lastDebug = { mode, decision, cds, reasonCodes, ctx };
    refreshDebug();

    if (settings.debug) {
      // eslint-disable-next-line no-console
      console.debug("[NavSentinel] click", { decision, cds, reasonCodes, ctx });
    }
  },
  true
);
