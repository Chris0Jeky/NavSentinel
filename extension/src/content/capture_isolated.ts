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
import { setDebugEnabled, updateDebugOverlay } from "./debug_overlay";

const CDS_BLOCK_THRESHOLD = 70;
const NS_SOURCE = "__navsentinel__";

let lastDown: DownCapture | null = null;
let settings = { defaultMode: "smart", debug: false };
let allowlist: Allowlist = {};

async function initSettings() {
  settings = await getSettings();
  allowlist = await getAllowlist();
  setDebugEnabled(settings.debug);
}

initSettings();

onSettingsChange((s) => {
  settings = s;
  setDebugEnabled(s.debug);
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

function parseDestination(rawUrl: string | null | undefined): { href: string | null; host: string | null } {
  if (!rawUrl) return { href: null, host: null };
  try {
    const u = new URL(rawUrl, location.href);
    return { href: u.toString(), host: u.hostname.toLowerCase() };
  } catch {
    return { href: null, host: null };
  }
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
    };
    if (!data || data.source !== NS_SOURCE) return;

    if (data.type === "ns-nav-blocked") {
      if (settings.defaultMode === "off") return;
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

    if (data.type === "ns-window-open-blocked") {
      if (settings.defaultMode === "off") return;
      const parsed = parseDestination(data.url);
      const url = parsed.href ?? data.url ?? "";

      if (!url) return;

      if (parsed.host && isAllowlisted(allowlist, siteKeyFromLocation(), parsed.host)) {
        allowOnce(url, data.target || "_blank", data.features);
        return;
      }

      showAllowPrompt({
        title: "Blocked popup",
        url,
        host: parsed.host,
        target: data.target || "_blank",
        features: data.features
      });
    }
  },
  true
);

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
    if (mode === "off" || explicitNewTab) {
      postToMain("ns-gesture-allow");
    }

    const anchor = findAnchorFromEvent(e);
    const isBlankAnchor = !!(anchor && anchor.target === "_blank");
    const parsed = isBlankAnchor ? parseDestination(anchor?.getAttribute("href") ?? anchor?.href) : null;
    const isAllowed = parsed?.host
      ? isAllowlisted(allowlist, siteKeyFromLocation(), parsed.host)
      : false;

    let decision: "allow" | "block" = "allow";

    if (mode !== "off") {
      if (isBlankAnchor && !isAllowed && !explicitNewTab) {
        decision = "block";
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
      } else if (!isBlankAnchor && cds >= CDS_BLOCK_THRESHOLD) {
        decision = "block";
        e.preventDefault();
        e.stopImmediatePropagation();
        showToast({
          message: `NavSentinel blocked deceptive click (CDS=${cds}).`
        });
      }
    }

    updateDebugOverlay({ mode, decision, cds, reasonCodes, ctx });

    if (settings.debug) {
      // eslint-disable-next-line no-console
      console.debug("[NavSentinel] click", { decision, cds, reasonCodes, ctx });
    }
  },
  true
);
