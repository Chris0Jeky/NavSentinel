const NS_SOURCE = "__navsentinel__";
const BRIDGE_INIT_TYPE = "ns-port-init";
const OPEN_TTL_MS = 800;
const REDIRECT_TTL_MS = 1500;
const TARGET_NAV_TTL_MS = 10000;
const MAX_OPENS_PER_GESTURE = 1;
const MAX_REDIRECTS_PER_GESTURE = 2;
const ALLOW_ONCE_TTL_MS = 1200;
const BLOCKED_ACTION_TTL_MS = 5000;
const MAX_POPUP_INTENT_VIEWPORT_SHARE = 0.35;
const PROTOCOL_VERSION = 1;

let bridgePort: MessagePort | null = null;
let bridgeSession: string | null = null;

function postToIsolated(type: string, payload?: Record<string, unknown>): void {
  if (!bridgePort || !bridgeSession) return;
  bridgePort.postMessage({
    source: NS_SOURCE,
    type,
    v: PROTOCOL_VERSION,
    session: bridgeSession,
    ...(payload ?? {})
  });
}

let mode: "off" | "smart" | "strict" = "smart";
let debug = false;

let openCount = 0;
let redirectCount = 0;
let allowOnceRemaining = 0;
let allowOnceUntil = 0;
let allowOpenUntil = 0;
let allowRedirectUntil = 0;
let popupIntentArmed = false;
let popupIntentClearTimer = 0;

const blockedActions = new Map<
  string,
  {
    action: () => void;
    expiresAt: number;
    kind: string;
    url?: string;
    target?: string;
    features?: string;
  }
>();

type NavStatus = "allowed" | "blocked";

function nowMs(): number {
  return Date.now();
}

function recordNav(status: NavStatus, params: { kind: string; url?: string }): void {
  if (!debug) return;
  (window as any).__navsentinelLastNav = {
    status,
    kind: params.kind,
    url: params.url ?? "",
    ts: nowMs(),
    allowOpenUntil,
    allowRedirectUntil
  };
}

function markAllowance(params: { allowOpen: boolean; allowRedirect: boolean }): void {
  const now = nowMs();
  openCount = 0;
  redirectCount = 0;
  allowOpenUntil = params.allowOpen ? now + OPEN_TTL_MS : 0;
  allowRedirectUntil = params.allowRedirect ? now + REDIRECT_TTL_MS : 0;
}

function isOff(): boolean {
  return mode === "off";
}

function setAllowOnce(): void {
  allowOnceRemaining = 1;
  allowOnceUntil = nowMs() + ALLOW_ONCE_TTL_MS;
}

function textLength(el: Element): number {
  const text = (el.textContent ?? "").replace(/\s+/g, "");
  return Math.min(text.length, 80);
}

function attrLength(el: Element, name: string): number {
  const value = el.getAttribute(name);
  if (!value) return 0;
  return Math.min(value.length, 80);
}

function hasVisibleBox(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const cs = window.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") {
    return false;
  }
  const opacity = Number.parseFloat(cs.opacity);
  if (Number.isFinite(opacity) && opacity < 0.2) return false;
  return true;
}

function looksLikeLargeOverlay(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  const viewportArea = Math.max(window.innerWidth, 1) * Math.max(window.innerHeight, 1);
  const elementArea = rect.width * rect.height;
  return elementArea / viewportArea >= MAX_POPUP_INTENT_VIEWPORT_SHARE;
}

function findPopupIntentSource(target: EventTarget | null): Element | null {
  if (!target || typeof (target as Node).nodeType !== "number") return null;
  if ((target as Node).nodeType !== Node.ELEMENT_NODE) return null;
  const el = target as Element;
  if (el.closest("a")) return null;
  return el.closest("button, input[type='button'], input[type='submit']") as Element | null;
}

function hasMeaningfulName(el: Element): boolean {
  return (
    textLength(el) +
      attrLength(el, "aria-label") +
      attrLength(el, "title") +
      attrLength(el, "value") +
      attrLength(el, "alt") >
    0
  );
}

function looksLikePopupOpen(target?: string, features?: string): boolean {
  const normalizedTarget = (target ?? "").trim().toLowerCase();
  const normalizedFeatures = (features ?? "").toLowerCase();
  if (
    normalizedTarget === "" ||
    (normalizedTarget !== "_self" &&
      normalizedTarget !== "_top" &&
      normalizedTarget !== "_parent")
  ) {
    return true;
  }
  return (
    normalizedFeatures.includes("popup") ||
    normalizedFeatures.includes("width=") ||
    normalizedFeatures.includes("height=")
  );
}

function isSafePopupIntentSource(el: Element): boolean {
  if (!hasVisibleBox(el) || !hasMeaningfulName(el)) return false;
  if (looksLikeLargeOverlay(el)) return false;
  return true;
}

function consumeOpenAllowance(): "allow_once" | "allowed" | "none" {
  const now = nowMs();
  if (allowOnceRemaining > 0 && now <= allowOnceUntil) {
    allowOnceRemaining -= 1;
    return "allow_once";
  }
  if (allowOpenUntil > 0 && now <= allowOpenUntil && openCount < MAX_OPENS_PER_GESTURE) {
    openCount += 1;
    return "allowed";
  }
  return "none";
}

function consumePopupIntentAllowance(target?: string, features?: string): boolean {
  if (mode !== "smart") return false;
  if (!popupIntentArmed) return false;
  if (!looksLikePopupOpen(target, features)) return false;
  if (openCount >= MAX_OPENS_PER_GESTURE) return false;

  popupIntentArmed = false;
  if (popupIntentClearTimer) {
    window.clearTimeout(popupIntentClearTimer);
    popupIntentClearTimer = 0;
  }
  openCount += 1;
  return true;
}

function armPopupIntent(): void {
  popupIntentArmed = true;
  if (popupIntentClearTimer) {
    window.clearTimeout(popupIntentClearTimer);
  }
  popupIntentClearTimer = window.setTimeout(() => {
    popupIntentArmed = false;
    popupIntentClearTimer = 0;
  }, 0);
}

function maybeArmPopupIntent(
  event: MouseEvent | PointerEvent,
  options?: { keyboardOnly?: boolean }
): void {
  if (mode !== "smart" || !event.isTrusted) return;
  if (options?.keyboardOnly) {
    if (!(event instanceof MouseEvent) || event.detail !== 0) return;
  } else {
    if (event.button !== 0) return;
  }
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;

  const source = findPopupIntentSource(event.target);
  if (!source) return;
  if (!isSafePopupIntentSource(source)) return;

  armPopupIntent();
}

function consumeRedirectAllowance(): "allowed" | "none" {
  const now = nowMs();
  if (
    allowRedirectUntil > 0 &&
    now <= allowRedirectUntil &&
    redirectCount < MAX_REDIRECTS_PER_GESTURE
  ) {
    redirectCount += 1;
    return "allowed";
  }
  return "none";
}

function makeId(): string {
  return `${Math.floor(nowMs())}-${Math.random().toString(16).slice(2)}`;
}

function pruneBlockedActions(): void {
  const now = nowMs();
  for (const [id, entry] of blockedActions) {
    if (entry.expiresAt <= now) {
      blockedActions.delete(id);
    }
  }
}

function postBlocked(params: {
  id: string;
  kind: string;
  url?: string;
  target?: string;
  features?: string;
}): void {
  recordNav("blocked", {
    kind: params.kind,
    ...(params.url !== undefined ? { url: params.url } : {})
  });
  if (debug) {
    console.debug("[NavSentinel] blocked", { ...params, mode, ts: nowMs() });
  }
  postToIsolated("ns-nav-blocked", {
    id: params.id,
    kind: params.kind,
    ...(params.url !== undefined ? { url: params.url } : {}),
    ...(params.target !== undefined ? { target: params.target } : {}),
    ...(params.features !== undefined ? { features: params.features } : {}),
    ts: nowMs()
  });
}

function postAllowed(params: { kind: string; url?: string }): void {
  recordNav("allowed", params);
  if (!debug) return;
  postToIsolated("ns-nav-allowed", {
    kind: params.kind,
    url: params.url ?? "",
    ts: nowMs()
  });
}

function notifyAllowedTarget(url: string | URL | undefined): void {
  if (url === undefined) return;
  try {
    const href = new URL(String(url), location.href).toString();
    chrome.runtime.sendMessage({ type: "ns-allow-target-nav", url: href, ttlMs: TARGET_NAV_TTL_MS });
  } catch {
    // ignore
  }
}

function registerBlockedAction(params: {
  kind: string;
  url?: string;
  target?: string;
  features?: string;
  action: () => void;
}): void {
  pruneBlockedActions();
  const id = makeId();
  blockedActions.set(id, {
    action: params.action,
    expiresAt: nowMs() + BLOCKED_ACTION_TTL_MS,
    kind: params.kind,
    ...(params.url !== undefined ? { url: params.url } : {}),
    ...(params.target !== undefined ? { target: params.target } : {}),
    ...(params.features !== undefined ? { features: params.features } : {})
  });
  postBlocked({
    id,
    kind: params.kind,
    ...(params.url !== undefined ? { url: params.url } : {}),
    ...(params.target !== undefined ? { target: params.target } : {}),
    ...(params.features !== undefined ? { features: params.features } : {})
  });
}

const nativeProtoOpen = Window.prototype.open;
const nativeOpen = window.open;
const nativeAssign = Location.prototype.assign;
const nativeReplace = Location.prototype.replace;
const nativeFormSubmit = HTMLFormElement.prototype.submit;
const nativeFormRequestSubmit = HTMLFormElement.prototype.requestSubmit;

function callNativeOpen(
  thisArg: Window,
  url?: string | URL,
  target?: string,
  features?: string
): Window | null {
  if (nativeProtoOpen) {
    return nativeProtoOpen.call(thisArg, url as any, target, features);
  }
  return nativeOpen.call(thisArg, url as any, target, features);
}

function patchedOpen(
  this: Window,
  url?: string | URL,
  target?: string,
  features?: string
): Window | null {
  if (isOff()) {
    postAllowed({ kind: "window_open", ...(url !== undefined ? { url: String(url) } : {}) });
    return callNativeOpen(this, url, target, features);
  }

  const allowance = consumeOpenAllowance();
  if (allowance !== "none") {
    postAllowed({ kind: "window_open", ...(url !== undefined ? { url: String(url) } : {}) });
    return callNativeOpen(this, url, target, features);
  }

  if (consumePopupIntentAllowance(target, features)) {
    postAllowed({ kind: "window_open", ...(url !== undefined ? { url: String(url) } : {}) });
    return callNativeOpen(this, url, target, features);
  }

  registerBlockedAction({
    kind: "window_open",
    ...(url !== undefined ? { url: String(url) } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(features !== undefined ? { features } : {}),
    action: () => {
      callNativeOpen(this, url, target, features);
    }
  });

  return null;
}

function resolveFormAction(form: HTMLFormElement): string | undefined {
  const raw = form.getAttribute("action");
  if (!raw) return location.href;
  try {
    return new URL(raw, location.href).toString();
  } catch {
    return undefined;
  }
}

function patchLocation(): void {
  const patchedAssign = function (this: Location, url: string | URL): void {
    if (isOff()) {
      postAllowed({ kind: "location_assign", url: String(url) });
      notifyAllowedTarget(url);
      nativeAssign.call(this, url);
      return;
    }

    const allowance = consumeRedirectAllowance();
    if (allowance !== "none") {
      postAllowed({ kind: "location_assign", url: String(url) });
      notifyAllowedTarget(url);
      nativeAssign.call(this, url);
      return;
    }

    registerBlockedAction({
      kind: "location_assign",
      url: String(url),
      action: () => nativeAssign.call(this, url)
    });
  };

  const patchedReplace = function (this: Location, url: string | URL): void {
    if (isOff()) {
      postAllowed({ kind: "location_replace", url: String(url) });
      notifyAllowedTarget(url);
      nativeReplace.call(this, url);
      return;
    }

    const allowance = consumeRedirectAllowance();
    if (allowance !== "none") {
      postAllowed({ kind: "location_replace", url: String(url) });
      notifyAllowedTarget(url);
      nativeReplace.call(this, url);
      return;
    }

    registerBlockedAction({
      kind: "location_replace",
      url: String(url),
      action: () => nativeReplace.call(this, url)
    });
  };

  Location.prototype.assign = patchedAssign;
  Location.prototype.replace = patchedReplace;

  try {
    Object.defineProperty(window.location, "assign", {
      value: patchedAssign,
      writable: true,
      configurable: true
    });
  } catch {
    try {
      (window.location as any).assign = patchedAssign;
    } catch {
      // ignore
    }
  }

  try {
    Object.defineProperty(window.location, "replace", {
      value: patchedReplace,
      writable: true,
      configurable: true
    });
  } catch {
    try {
      (window.location as any).replace = patchedReplace;
    } catch {
      // ignore
    }
  }

  (window as any).__navsentinelLocationPatch = {
    protoAssign: Location.prototype.assign === patchedAssign,
    protoReplace: Location.prototype.replace === patchedReplace,
    locAssign: window.location.assign === patchedAssign,
    locReplace: window.location.replace === patchedReplace,
    locAssignDesc: (() => {
      const desc = Object.getOwnPropertyDescriptor(window.location, "assign");
      return desc
        ? { configurable: !!desc.configurable, writable: !!(desc as any).writable }
        : null;
    })(),
    locReplaceDesc: (() => {
      const desc = Object.getOwnPropertyDescriptor(window.location, "replace");
      return desc
        ? { configurable: !!desc.configurable, writable: !!(desc as any).writable }
        : null;
    })()
  };
}

function patchForms(): void {
  HTMLFormElement.prototype.submit = function (): void {
    const actionUrl = resolveFormAction(this);
    if (isOff()) {
      postAllowed({ kind: "form_submit", ...(actionUrl !== undefined ? { url: actionUrl } : {}) });
      notifyAllowedTarget(actionUrl);
      nativeFormSubmit.call(this);
      return;
    }

    const allowance = consumeRedirectAllowance();
    if (allowance !== "none") {
      postAllowed({ kind: "form_submit", ...(actionUrl !== undefined ? { url: actionUrl } : {}) });
      notifyAllowedTarget(actionUrl);
      nativeFormSubmit.call(this);
      return;
    }

    registerBlockedAction({
      kind: "form_submit",
      ...(actionUrl !== undefined ? { url: actionUrl } : {}),
      action: () => nativeFormSubmit.call(this)
    });
  };

  if (nativeFormRequestSubmit) {
    HTMLFormElement.prototype.requestSubmit = function (submitter?: HTMLElement | null): void {
      const actionUrl = resolveFormAction(this);
      if (isOff()) {
        postAllowed({
          kind: "form_request_submit",
          ...(actionUrl !== undefined ? { url: actionUrl } : {})
        });
        notifyAllowedTarget(actionUrl);
        nativeFormRequestSubmit.call(this, submitter as any);
        return;
      }

      const allowance = consumeRedirectAllowance();
      if (allowance !== "none") {
        postAllowed({
          kind: "form_request_submit",
          ...(actionUrl !== undefined ? { url: actionUrl } : {})
        });
        notifyAllowedTarget(actionUrl);
        nativeFormRequestSubmit.call(this, submitter as any);
        return;
      }

      registerBlockedAction({
        kind: "form_request_submit",
        ...(actionUrl !== undefined ? { url: actionUrl } : {}),
        action: () => nativeFormRequestSubmit.call(this, submitter as any)
      });
    };
  }
}

function patchOpen(): void {
  try {
    Object.defineProperty(window, "open", {
      value: patchedOpen,
      writable: true,
      configurable: true
    });
  } catch {
    window.open = patchedOpen as any;
  }

  if (Window.prototype.open !== patchedOpen) {
    Window.prototype.open = function (
      this: Window,
      url?: string | URL,
      target?: string,
      features?: string
    ): Window | null {
      return patchedOpen.call(this, url, target, features);
    } as any;
  }
}

function handleBridgeMessage(message: unknown): void {
  const data = message as {
    source?: string;
    type?: string;
    v?: number;
    session?: string;
    id?: string;
    mode?: "off" | "smart" | "strict";
    debug?: boolean;
    allowOpen?: boolean;
    allowRedirect?: boolean;
  };
  if (!data || data.source !== NS_SOURCE || data.v !== PROTOCOL_VERSION) return;
  if (!bridgeSession || data.session !== bridgeSession) return;

  if (data.type === "ns-gesture-allow") {
    markAllowance({ allowOpen: true, allowRedirect: true });
    return;
  }

  if (data.type === "ns-config") {
    if (data.mode) mode = data.mode;
    if (typeof data.debug === "boolean") debug = data.debug;
    postToIsolated("ns-config-ack", { mode, debug });
    return;
  }

  if (data.type === "ns-ping") {
    postToIsolated("ns-pong", { mode, debug });
    return;
  }

  if (data.type === "ns-allow-once") {
    setAllowOnce();
    return;
  }

  if (data.type === "ns-allow") {
    const allowOpen = data.allowOpen === true;
    const allowRedirect = data.allowRedirect === true;
    markAllowance({ allowOpen, allowRedirect });
    if (debug) {
      console.debug("[NavSentinel] allowance", {
        allowOpen,
        allowRedirect,
        openUntil: allowOpenUntil,
        redirectUntil: allowRedirectUntil
      });
    }
    return;
  }

  if (data.type === "ns-allow-action" && data.id) {
    const entry = blockedActions.get(data.id);
    if (!entry) return;
    if (entry.expiresAt <= nowMs()) {
      blockedActions.delete(data.id);
      return;
    }
    blockedActions.delete(data.id);
    entry.action();
  }
}

window.addEventListener(
  "pointerdown",
  (event) => {
    if (!(event instanceof PointerEvent)) return;
    maybeArmPopupIntent(event);
  },
  true
);

window.addEventListener(
  "mousedown",
  (event) => {
    if (!(event instanceof MouseEvent)) return;
    maybeArmPopupIntent(event);
  },
  true
);

window.addEventListener(
  "click",
  (event) => {
    if (!(event instanceof MouseEvent)) return;
    maybeArmPopupIntent(event);
    maybeArmPopupIntent(event, { keyboardOnly: true });
  },
  true
);

window.addEventListener(
  "message",
  (event) => {
    if (event.source !== window) return;
    const data = event.data as {
      source?: string;
      type?: string;
      v?: number;
      session?: string;
    };
    if (!data || data.source !== NS_SOURCE || data.v !== PROTOCOL_VERSION) return;
    if (data.type !== BRIDGE_INIT_TYPE || typeof data.session !== "string" || !data.session) return;
    if (bridgeSession && data.session !== bridgeSession) return;

    const nextPort = event.ports?.[0];
    if (!(nextPort instanceof MessagePort)) return;

    event.stopImmediatePropagation();
    event.stopPropagation();

    bridgePort?.close();
    bridgePort = nextPort;
    bridgeSession = data.session;
    bridgePort.onmessage = (bridgeEvent) => handleBridgeMessage(bridgeEvent.data);
    bridgePort.start?.();
    postToIsolated("ns-bridge-ready");
  },
  true
);

patchOpen();
patchLocation();
patchForms();
(window as any).__navsentinelMainGuard = true;
