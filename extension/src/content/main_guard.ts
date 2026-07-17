import { initJsBehaviorMonitor } from "./js_behavior_monitor";
import { OutboundQueue, isMainGuardAlertType, isFloodableAlertType } from "./bridge_outbound";
import { enforceMapSizeCap, pruneTimestampWindow, shouldEmitRapidPushState } from "./main_guard_helpers";
import {
  PUSHSTATE_GESTURE_WINDOW_MS,
  PUSHSTATE_RAPID_THRESHOLD,
  PUSHSTATE_RAPID_WINDOW_MS,
  MAX_PENDING_OUTBOUND,
  RESERVED_SCARCE_OUTBOUND_SLOTS,
} from "./main_guard_constants";

const NS_SOURCE = "__navsentinel__";
const BRIDGE_INIT_TYPE = "ns-port-init";
const OPEN_TTL_MS = 800;
const REDIRECT_TTL_MS = 1500;
const TARGET_NAV_TTL_MS = 10000;
const MAX_OPENS_PER_GESTURE = 1;
const MAX_REDIRECTS_PER_GESTURE = 2;
const ALLOW_ONCE_TTL_MS = 1200;
const BLOCKED_ACTION_TTL_MS = 5000;
// Hard cap on live blockedActions entries. The TTL-only prune evicts nothing within a 5s
// burst, so a tight loop of blocked window.open/location/form.submit calls would otherwise
// grow the Map unbounded (one closure per call). 256 is far above any legitimate count of
// pending blocked actions awaiting a user decision; over it, the oldest entry is evicted. (#301)
const MAX_BLOCKED_ACTIONS = 256;
const MAX_POPUP_INTENT_VIEWPORT_SHARE = 0.35;
const PROTOCOL_VERSION = 1;
// Max time to wait for the isolated world to echo the bridge challenge before
// the half-open handshake is torn down. Must be shorter than the isolated
// side's total bridge-init budget (MAX_BRIDGE_INIT_MS = 10s) so a legitimate
// retry can still re-establish after a dead or hostile first init is released.
const BRIDGE_HANDSHAKE_TIMEOUT_MS = 3000;
// 800ms covers accessibility settings with wider double-click windows (up to 900ms+).
// Combined with window.open + opener.location correlation, FP risk from the wider
// window is minimal.
const DBLCLICK_WINDOW_MS = 800;
const OPENER_NAV_STALE_MS = 3000;

// PushState gating + pre-bridge buffer constants live in main_guard_constants.ts (a
// side-effect-free module) so the #377/F1 invariant test asserts against the SAME values
// the runtime uses. The gesture-branch emission bound derived from the three PUSHSTATE_*
// constants must stay within the priority OutboundQueue's scarce-signal reservation — that
// invariant is enforced in tests/main-guard-helpers.test.ts.
// Hard cap on the pushState timestamp buffer. In a synchronous flood every timestamp equals
// `now` so the window filter prunes nothing; we only need to know the count reached the rapid
// threshold, so cap the buffer just above it to bound memory + the per-call O(n) filter. (#302)
const PUSHSTATE_RAPID_CAP = PUSHSTATE_RAPID_THRESHOLD * 2;

let bridgePort: MessagePort | null = null;
let bridgeSession: string | null = null;
let bridgeVerified = false;
let bridgeChallenge: string | null = null;
let bridgeHandshakeTimer = 0;
// Buffers messages produced before the bridge is verified. On overflow it keeps
// security-relevant alerts (never evicted by routine traffic) and the earliest
// of equal-priority messages — see bridge_outbound.ts for the rationale.
const pendingOutbound = new OutboundQueue(MAX_PENDING_OUTBOUND, RESERVED_SCARCE_OUTBOUND_SLOTS);

function postToIsolated(type: string, payload?: Record<string, unknown>): void {
  if (!bridgePort || !bridgeSession || !bridgeVerified) {
    pendingOutbound.enqueue(
      { type, ...(payload !== undefined ? { payload } : {}) },
      isMainGuardAlertType(type),
      isFloodableAlertType(type)
    );
    return;
  }
  bridgePort.postMessage({
    source: NS_SOURCE,
    type,
    v: PROTOCOL_VERSION,
    session: bridgeSession,
    ...(payload ?? {})
  });
}

function flushPendingOutbound(): void {
  const { items, dropped } = pendingOutbound.drain();
  for (const msg of items) {
    postToIsolated(msg.type, msg.payload);
  }
  // Surface any drop through the (now-verified) bridge so the isolated side can
  // record it in the trusted event log — not silently discarded in production.
  if (dropped > 0) {
    if (debug) {
      console.debug(`[NavSentinel] dropped ${dropped} pre-verification bridge message(s) on overflow`);
    }
    postToIsolated("ns-bridge-overflow", { dropped });
  }
}

function clearBridgeHandshakeTimer(): void {
  if (bridgeHandshakeTimer) {
    clearTimeout(bridgeHandshakeTimer);
    bridgeHandshakeTimer = 0;
  }
}

/**
 * Tear down a bridge handshake that never completed. Without this, a port whose
 * peer never echoes the challenge (a dead isolated context, or a hostile page
 * that posts a bridge init first and then stalls) would pin `bridgeSession`
 * forever — the `bridgeSession && data.session !== bridgeSession` guard would
 * then reject the real isolated world's init, permanently disabling the bridge
 * while messages buffer and drop. Releasing the half-open state lets a fresh
 * init (any session) re-establish. Buffered messages are preserved for it.
 */
function failBridgeHandshake(): void {
  bridgeHandshakeTimer = 0;
  if (bridgeVerified) return;
  try {
    bridgePort?.close();
  } catch {
    /* port may already be closed */
  }
  bridgePort = null;
  bridgeSession = null;
  bridgeChallenge = null;
  bridgeVerified = false;
}

let mode: "off" | "smart" | "strict" = "off";
let debug = false;

function syncJsBehaviorMonitor(): void {
  initJsBehaviorMonitor({
    mode,
    debug,
    postSignal: postToIsolated,
  });
}

let openCount = 0;
let redirectCount = 0;
let allowOnceRemaining = 0;
let allowOnceUntil = 0;
let allowOpenUntil = 0;
let allowRedirectUntil = 0;
let popupIntentArmed = false;
let popupIntentClearTimer = 0;

// --- DoubleClickjacking detection state ---
// Tracks the timestamp of the last window.open call from this page.
let lastWindowOpenTs = 0;
// Tracks opener.location writes observed from child windows.
let lastOpenerNavTs = 0;
let lastOpenerNavUrl = "";

// --- PushState gating state ---
/** Timestamp of the most recent trusted user gesture (pointerdown/click). */
let lastGestureTs = 0;
/** Timestamps of recent pushState/replaceState calls for rapid-fire detection. */
let pushStateTimestamps: number[] = [];
// Cooldown anchor so a sustained rapid-pushState burst emits at most one alert per window,
// not one per call (which would flood the priority bridge queue and drop ns-nav-blocked) (#302).
let lastRapidPushStateEmitAt = 0;

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
  postToIsolated("ns-debug-nav-record", {
    status,
    kind: params.kind,
    url: params.url ?? "",
    ts: nowMs(),
  });
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

function postAllowed(params: { kind: string; url?: string; target?: string }): void {
  recordNav("allowed", params);
  postToIsolated("ns-nav-allowed", {
    kind: params.kind,
    url: params.url ?? "",
    ...(params.target !== undefined ? { target: params.target } : {}),
    ts: nowMs()
  });
}

function notifyAllowedTarget(url: string | URL | undefined, options?: { matchQueryPrefix?: boolean }): void {
  if (url === undefined || String(url) === "") return;
  try {
    const href = new URL(String(url), location.href).toString();
    if (!href.startsWith("http:") && !href.startsWith("https:")) return;
    postToIsolated("ns-allow-target-nav", {
      url: href,
      ttlMs: TARGET_NAV_TTL_MS,
      ...(options?.matchQueryPrefix ? { matchQueryPrefix: true } : {})
    });
  } catch {
    // ignore
  }
}

function isGetForm(form: HTMLFormElement): boolean {
  const raw = form.getAttribute("method") || form.method || "get";
  return raw.toLowerCase() === "get";
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
  // Bound the Map against a synchronous flood the TTL prune can't catch (#301).
  enforceMapSizeCap(blockedActions, MAX_BLOCKED_ACTIONS);
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
// Chromium exposes assign/replace as LegacyUnforgeable own methods on each
// Location instance; the prototype slots are absent. Capture the real instance
// methods so our compatibility prototype wrappers remain callable.
const nativeAssign = window.location.assign;
const nativeReplace = window.location.replace;
const nativeFormSubmit = HTMLFormElement.prototype.submit;
const nativeFormRequestSubmit = HTMLFormElement.prototype.requestSubmit;

/**
 * Install a patched method on an object/prototype as a WRITABLE + CONFIGURABLE
 * data property (native methods are non-enumerable, so we keep enumerable:false),
 * with a plain-assignment fallback.
 *
 * NavSentinel used to FREEZE these slots (non-writable/non-configurable), but a
 * frozen inherited data property throws "Cannot assign to read only property"
 * when a page reassigns it in strict mode — aborting legitimate code: SPA routers
 * doing `history.pushState = wrapper` (grey screen on claude.ai / TanStack, #347),
 * and form/analytics libraries doing `HTMLFormElement.prototype.submit = wrapper`
 * or `window.open = wrapper` (#349). Freezing also bought no real defense: a
 * MAIN-world adversary shares this realm and bypasses the hook regardless
 * (cross-realm native, wholesale overwrite, or simply not calling the API).
 *
 * History, form, and open wrappers keep working when a page wraps them because
 * each wrapper delegates to the module-captured native (not to `proto[prop]`),
 * so a capture-then-wrap chains safely without re-entrancy. Location is a
 * compatibility-only exception here: Chromium exposes assign/replace as
 * non-configurable own properties on window.location, so making the prototype
 * reassignable avoids a strict-mode initialization throw but does not prove that
 * ordinary location calls traverse our wrapper. #458 tracks that pre-navigation
 * interception boundary. The real gate for supported enforcement hooks is the
 * click/gesture allowance inside each wrapper, not the descriptor.
 */
function softPatchProto(
  proto: object,
  prop: string,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  value: Function,
  label: string
): void {
  try {
    Object.defineProperty(proto, prop, {
      value,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    try {
      (proto as Record<string, unknown>)[prop] = value;
      if (debug) {
        console.debug(`[NavSentinel] softPatchProto fallback for ${label}, used assignment`);
      }
    } catch {
      if (debug) {
        console.debug(`[NavSentinel] softPatchProto failed for ${label}`);
      }
    }
  }
}

// Clipboard API natives (may not exist in all contexts)
const nativeClipboardWriteText =
  typeof navigator !== "undefined" && navigator.clipboard
    ? navigator.clipboard.writeText?.bind(navigator.clipboard)
    : undefined;
const nativeClipboardWrite =
  typeof navigator !== "undefined" && navigator.clipboard
    ? navigator.clipboard.write?.bind(navigator.clipboard)
    : undefined;

function callNativeOpen(
  thisArg: Window,
  url?: string | URL,
  target?: string,
  features?: string
): Window | null {
  if (nativeProtoOpen) {
    return nativeProtoOpen.call(thisArg, url, target, features);
  }
  return nativeOpen.call(thisArg, url, target, features);
}

const RESERVED_TARGETS = new Set(["_top", "_parent", "_blank"]);

// Subframes skip guards only for self-navigations; top-level nav is caught by the SW's onCommitted.
function isSubframe(): boolean {
  try {
    return window.top !== window;
  } catch {
    return true;
  }
}

function isSubframeSelfTarget(target: string | undefined): boolean {
  if (!target) return false; // undefined/empty = _blank per spec, not self
  const t = target.toLowerCase();
  if (t === "_self") return true;
  if (RESERVED_TARGETS.has(t)) return false;
  return target === window.name;
}

function isFormSelfTarget(formTarget: string): boolean {
  if (!formTarget) return true; // empty/missing form target = submit to self
  const t = formTarget.toLowerCase();
  if (t === "_self") return true;
  if (RESERVED_TARGETS.has(t)) return false;
  return formTarget === window.name;
}

function recordWindowOpen(): void {
  lastWindowOpenTs = nowMs();
  postToIsolated("ns-dblclick-window-open", { ts: lastWindowOpenTs });
}

function patchedOpen(
  this: Window | null | undefined,
  url?: string | URL,
  target?: string,
  features?: string
): Window | null {
  // Pages commonly capture `window.open` and call the saved function from an
  // arrow/strict wrapper, which supplies no receiver. Default only that nullish
  // case to this page's window. Preserve same-origin cross-realm Window receivers
  // (which fail this realm's instanceof Window), and let the native throw its
  // normal Illegal invocation TypeError for genuinely invalid receivers.
  const receiver = this === null || this === undefined ? window : this;

  if (isOff() || (isSubframe() && isSubframeSelfTarget(target))) {
    postAllowed({
      kind: "window_open",
      ...(url !== undefined ? { url: String(url) } : {}),
      ...(target !== undefined ? { target } : {})
    });
    notifyAllowedTarget(url);
    recordWindowOpen();
    return callNativeOpen(receiver, url, target, features);
  }

  const allowance = consumeOpenAllowance();
  if (allowance !== "none") {
    postAllowed({
      kind: "window_open",
      ...(url !== undefined ? { url: String(url) } : {}),
      ...(target !== undefined ? { target } : {})
    });
    notifyAllowedTarget(url);
    recordWindowOpen();
    return callNativeOpen(receiver, url, target, features);
  }

  if (consumePopupIntentAllowance(target, features)) {
    postAllowed({
      kind: "window_open",
      ...(url !== undefined ? { url: String(url) } : {}),
      ...(target !== undefined ? { target } : {})
    });
    notifyAllowedTarget(url);
    recordWindowOpen();
    return callNativeOpen(receiver, url, target, features);
  }

  registerBlockedAction({
    kind: "window_open",
    ...(url !== undefined ? { url: String(url) } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(features !== undefined ? { features } : {}),
    action: () => {
      recordWindowOpen();
      callNativeOpen(receiver, url, target, features);
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
    if (isOff() || (isSubframe() && this === window.location)) {
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
    if (isOff() || (isSubframe() && this === window.location)) {
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

  // Keep the prototype slots writable+configurable so strict-mode libraries can
  // reassign them without aborting. Chromium's LegacyUnforgeable instance methods
  // still bypass these prototype wrappers for ordinary window.location calls;
  // #458 owns the real interception design. Do not attempt an instance patch:
  // those own methods are non-writable/non-configurable, and the failed fallback
  // previously produced misleading debug output.
  softPatchProto(Location.prototype, "assign", patchedAssign, "Location.prototype.assign");
  softPatchProto(Location.prototype, "replace", patchedReplace, "Location.prototype.replace");

  if (debug) {
    postToIsolated("ns-location-patch-info", {
      protoAssign: Location.prototype.assign === patchedAssign,
      protoReplace: Location.prototype.replace === patchedReplace,
      locAssign: window.location.assign === patchedAssign,
      locReplace: window.location.replace === patchedReplace,
    });
  }
}

function patchForms(): void {
  const patchedFormSubmit = function (this: HTMLFormElement): void {
    const actionUrl = resolveFormAction(this);
    if (isOff() || (isSubframe() && isFormSelfTarget(this.target))) {
      postAllowed({ kind: "form_submit", ...(actionUrl !== undefined ? { url: actionUrl } : {}) });
      notifyAllowedTarget(actionUrl, { matchQueryPrefix: isGetForm(this) });
      nativeFormSubmit.call(this);
      return;
    }

    const allowance = consumeRedirectAllowance();
    if (allowance !== "none") {
      postAllowed({ kind: "form_submit", ...(actionUrl !== undefined ? { url: actionUrl } : {}) });
      notifyAllowedTarget(actionUrl, { matchQueryPrefix: isGetForm(this) });
      nativeFormSubmit.call(this);
      return;
    }

    registerBlockedAction({
      kind: "form_submit",
      ...(actionUrl !== undefined ? { url: actionUrl } : {}),
      action: () => nativeFormSubmit.call(this)
    });
  };
  // Writable+configurable (#349): a frozen submit threw when js_behavior_monitor
  // (and legit form libraries) reassign HTMLFormElement.prototype.submit. Now the
  // page/js_behavior wrapper chains cleanly on top of ours (wrapper -> our wrapper
  // -> native); the redirect-allowance gate is unchanged.
  softPatchProto(HTMLFormElement.prototype, "submit", patchedFormSubmit, "HTMLFormElement.prototype.submit");

  if (nativeFormRequestSubmit) {
    const patchedFormRequestSubmit = function (this: HTMLFormElement, submitter?: HTMLElement | null): void {
      const actionUrl = resolveFormAction(this);
      if (isOff() || (isSubframe() && isFormSelfTarget(this.target))) {
        postAllowed({
          kind: "form_request_submit",
          ...(actionUrl !== undefined ? { url: actionUrl } : {})
        });
        notifyAllowedTarget(actionUrl, { matchQueryPrefix: isGetForm(this) });
        nativeFormRequestSubmit.call(this, submitter);
        return;
      }

      const allowance = consumeRedirectAllowance();
      if (allowance !== "none") {
        postAllowed({
          kind: "form_request_submit",
          ...(actionUrl !== undefined ? { url: actionUrl } : {})
        });
        notifyAllowedTarget(actionUrl, { matchQueryPrefix: isGetForm(this) });
        nativeFormRequestSubmit.call(this, submitter);
        return;
      }

      registerBlockedAction({
        kind: "form_request_submit",
        ...(actionUrl !== undefined ? { url: actionUrl } : {}),
        action: () => nativeFormRequestSubmit.call(this, submitter)
      });
    };
    softPatchProto(HTMLFormElement.prototype, "requestSubmit", patchedFormRequestSubmit, "HTMLFormElement.prototype.requestSubmit");
  }
}

function patchOpen(): void {
  // Writable+configurable (#349): a frozen window.open threw when a page wrapped it
  // (analytics commonly do `window.open = wrapper`). The popup gate is the
  // gesture/allowance check inside patchedOpen, not the descriptor.
  softPatchProto(window, "open", patchedOpen, "window.open");

  if (Window.prototype.open !== patchedOpen) {
    const protoWrapper = function (
      this: Window,
      url?: string | URL,
      target?: string,
      features?: string
    ): Window | null {
      return patchedOpen.call(this, url, target, features);
    };
    softPatchProto(Window.prototype, "open", protoWrapper, "Window.prototype.open");
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
    syncJsBehaviorMonitor();
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
    if (event.isTrusted) lastGestureTs = nowMs();
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

function findSuspiciousShadowAnchor(e: MouseEvent): HTMLAnchorElement | null {
  const path = e.composedPath();
  for (const node of path) {
    if (!(node instanceof HTMLAnchorElement)) continue;
    if (node.target.toLowerCase() !== "_blank") continue;
    if (!(node.getRootNode() instanceof ShadowRoot)) continue;
    const nameLen = textLength(node) + attrLength(node, "aria-label") + attrLength(node, "title");
    if (nameLen > 0 && hasVisibleBox(node)) continue;
    return node;
  }
  return null;
}

window.addEventListener(
  "click",
  (event) => {
    if (!(event instanceof MouseEvent)) return;
    if (event.isTrusted) lastGestureTs = nowMs();
    maybeArmPopupIntent(event);
    maybeArmPopupIntent(event, { keyboardOnly: true });

    if (mode !== "off" && event.isTrusted) {
      const shadowAnchor = findSuspiciousShadowAnchor(event);
      if (shadowAnchor) {
        event.preventDefault();
        const href = shadowAnchor.href;
        registerBlockedAction({
          kind: "shadow_anchor",
          url: href,
          target: "_blank",
          action: () => callNativeOpen(window, href, "_blank")
        });
      }
    }
  },
  true
);

function generateChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
    // Only a VERIFIED bridge pins its session — that prevents post-verification
    // hijack by a *different* session. An unverified session has not proven
    // legitimacy, so a fresh init (e.g. the real isolated world arriving after a
    // hostile page raced an init first) is allowed to take over the handshake
    // instead of being locked out.
    //
    // Residual init-auth limits (best-effort; the session travels in a
    // page-visible postMessage and the challenge is echoable, so this is not a
    // hard boundary — all tracked in #186): a main-world attacker can (a) replay
    // the known session to re-pin even a verified bridge, and (b) thrash repeated
    // inits to keep the bridge unverified until the isolated side disables the
    // guard (~10s). Both are strictly less severe than the permanent lockout this
    // change replaced; the real fix is SW-vouched init authentication (#186).
    if (bridgeVerified && bridgeSession && data.session !== bridgeSession) return;

    const nextPort = event.ports?.[0];
    if (!(nextPort instanceof MessagePort)) return;

    event.stopImmediatePropagation();
    event.stopPropagation();

    // A new init supersedes any handshake already in progress; drop its timer.
    clearBridgeHandshakeTimer();
    bridgePort?.close();
    bridgePort = nextPort;
    bridgeSession = data.session;
    bridgeVerified = false;
    bridgeChallenge = generateChallenge();

    bridgePort.onmessage = (bridgeEvent) => {
      const msg = bridgeEvent.data as { source?: string; type?: string; challenge?: string };
      if (!bridgeVerified) {
        if (msg && msg.source === NS_SOURCE && msg.type === "ns-challenge-response" && msg.challenge === bridgeChallenge) {
          clearBridgeHandshakeTimer();
          bridgeVerified = true;
          bridgeChallenge = null;
          bridgePort!.onmessage = (e) => handleBridgeMessage(e.data);
          postToIsolated("ns-bridge-ready");
          flushPendingOutbound();
        }
        return;
      }
      handleBridgeMessage(bridgeEvent.data);
    };
    bridgePort.start?.();

    bridgePort.postMessage({
      source: NS_SOURCE,
      type: "ns-challenge",
      v: PROTOCOL_VERSION,
      session: bridgeSession,
      challenge: bridgeChallenge
    });

    // If the peer never echoes the challenge, release the half-open handshake
    // so a fresh init can re-establish the bridge instead of deadlocking.
    bridgeHandshakeTimer = window.setTimeout(failBridgeHandshake, BRIDGE_HANDSHAKE_TIMEOUT_MS);
  },
  true
);

// --- Clipboard API command keyword detection ---

// NOTE: Keep this list in sync with COMMAND_KEYWORDS in clickfix_detector.ts
const COMMAND_KEYWORDS = [
  // Windows shells and scripting
  "powershell", "cmd /", "cmd.exe", "mshta", "msiexec", "certutil", "bitsadmin",
  "rundll32", "regsvr32", "wscript", "cscript",
  // Windows LOLBins
  "forfiles", "pcalua", "schtasks", "installutil",
  // Unix/macOS shells
  "curl ", "wget ", "bash", "sh ", "/bin/", "osascript",
  // PowerShell cmdlets and patterns
  "invoke-", "iex ", "iex(", "iwr ", "start-process",
  "downloadstring", "downloadfile", "new-object", "system.net",
  "frombase64", "base64", "-encodedcommand", "-enc ",
];

function textLooksLikeCommand(text: string): boolean {
  if (!text || text.length < 5) return false;
  const lower = text.toLowerCase();
  for (const kw of COMMAND_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// --- Clipboard API patching ---

function patchClipboard(): void {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;

  if (nativeClipboardWriteText) {
    try {
      navigator.clipboard.writeText = function (data: string): Promise<void> {
        // Capture metadata before calling native (data may be GC'd), but
        // only send the bridge message after the write succeeds so that
        // failed writes (permission denied, no user gesture) do not cause
        // false ClickFix detections.
        const cmdLike = textLooksLikeCommand(data);
        const len = data.length;
        return nativeClipboardWriteText!(data).then((result) => {
          postToIsolated("ns-clipboard-write", {
            ts: nowMs(),
            contentLength: len,
            looksLikeCommand: cmdLike,
          });
          if (debug) {
            console.debug("[NavSentinel] clipboard.writeText intercepted", {
              length: len,
              looksLikeCommand: cmdLike,
            });
          }
          return result;
        });
      };
    } catch {
      // clipboard.writeText may not be configurable in all contexts
    }
  }

  if (nativeClipboardWrite) {
    try {
      navigator.clipboard.write = function (data: ClipboardItem[]): Promise<void> {
        // Only send the bridge message after the native write succeeds.
        return nativeClipboardWrite!(data).then((result) => {
          // Try to read text/plain content from ClipboardItems for command detection.
          // Non-text MIME types are skipped (blobs may be expensive to read).
          let inspected = false;
          try {
            for (const item of data) {
              if (item.types.includes("text/plain")) {
                item.getType("text/plain").then((blob) => {
                  blob.text().then((text) => {
                    postToIsolated("ns-clipboard-write", {
                      ts: nowMs(),
                      contentLength: text.length,
                      looksLikeCommand: textLooksLikeCommand(text),
                    });
                  }).catch(() => {});
                }).catch(() => {});
                inspected = true;
                break;
              }
            }
          } catch {
            // ClipboardItem API may not be fully available
          }
          if (!inspected) {
            postToIsolated("ns-clipboard-write", {
              ts: nowMs(),
              contentLength: -1,
              looksLikeCommand: false,
            });
          }
          if (debug) {
            console.debug("[NavSentinel] clipboard.write intercepted");
          }
          return result;
        });
      };
    } catch {
      // clipboard.write may not be configurable in all contexts
    }
  }
}

// --- PushState detection helpers ---

/**
 * Heuristic: does the new path look like a cross-origin navigation attempt?
 *
 * Attackers use pushState to set the URL path to something like
 * `/accounts.google.com/signin` or `/www.chase.com/secure/login` to
 * make the address bar appear as if the user navigated to a trusted site.
 *
 * We check for domain-like segments (containing dots) in the new path
 * that do not match the current hostname.
 *
 * Legitimate SPAs typically push paths like `/dashboard`, `/user/123`,
 * `/products/widget` -- none of which contain dots that look like domains.
 */
function pathLooksCrossOrigin(newUrl: string): boolean {
  try {
    const parsed = new URL(newUrl, location.href);
    // Only inspect same-origin pushState (cross-origin would throw)
    if (parsed.origin !== location.origin) return false;

    const segments = parsed.pathname.split("/").filter(Boolean);
    const currentHost = location.hostname.toLowerCase();
    for (const rawSeg of segments) {
      let seg: string;
      try { seg = decodeURIComponent(rawSeg); } catch { seg = rawSeg; }
      const dots = seg.split(".").length - 1;
      // Require 2+ dots to distinguish real domains (accounts.google.com)
      // from file names (style.css), version strings (v1.2.3), etc.
      if (dots >= 2 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(seg)) {
        if (seg.toLowerCase() !== currentHost) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a pushState/replaceState call is suspicious.
 *
 * Returns a reason string if suspicious, or null if benign.
 */
function checkPushStateSuspicious(url: string | URL | null | undefined, _method: string): string | null {
  if (isOff()) return null;

  const now = nowMs();
  const urlStr = url !== null && url !== undefined ? String(url) : "";

  // --- Rapid-fire detection ---
  // Track timestamps and prune old entries
  pushStateTimestamps.push(now);
  // Prune to the window AND cap the buffer so a synchronous flood (all timestamps === now,
  // nothing pruned) can't grow it unbounded. (#302)
  pushStateTimestamps = pruneTimestampWindow(
    pushStateTimestamps,
    now,
    PUSHSTATE_RAPID_WINDOW_MS,
    PUSHSTATE_RAPID_CAP,
  );

  if (pushStateTimestamps.length >= PUSHSTATE_RAPID_THRESHOLD) {
    // In a rapid burst, emit at most one rapid_pushstate per window (cooldown) AND suppress
    // every other alert (including the gesture-correlated one below) for the rest of the burst.
    // Emitting per-call — via EITHER alert type — would saturate the priority bridge queue
    // before the handshake and drop a later ns-nav-blocked, losing that detection. (#302)
    const rapid = shouldEmitRapidPushState(now, lastRapidPushStateEmitAt, PUSHSTATE_RAPID_WINDOW_MS);
    lastRapidPushStateEmitAt = rapid.lastEmitAt;
    return rapid.emit ? "rapid_pushstate" : null;
  }

  // --- Gesture-correlated domain-like path (only below the rapid threshold, so it is
  // inherently rate-limited and cannot flood) ---
  if (lastGestureTs > 0 && (now - lastGestureTs) <= PUSHSTATE_GESTURE_WINDOW_MS) {
    if (urlStr && pathLooksCrossOrigin(urlStr)) {
      return "domain_like_path_after_gesture";
    }
  }

  return null;
}

const nativePushState = History.prototype.pushState;
const nativeReplaceState = History.prototype.replaceState;

function patchHistory(): void {
  const patchedPushState = function (
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    const result = nativePushState.call(this, data, unused, url);
    const reason = checkPushStateSuspicious(url, "pushState");
    if (reason) {
      postToIsolated("ns-pushstate-suspicious", {
        ts: nowMs(),
        url: url !== null && url !== undefined ? String(url) : "",
        method: "pushState",
        reason,
      });
      if (debug) {
        console.debug("[NavSentinel] suspicious pushState", { url: String(url), reason });
      }
    }
    return result;
  };

  const patchedReplaceState = function (
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    const result = nativeReplaceState.call(this, data, unused, url);
    const reason = checkPushStateSuspicious(url, "replaceState");
    if (reason) {
      postToIsolated("ns-pushstate-suspicious", {
        ts: nowMs(),
        url: url !== null && url !== undefined ? String(url) : "",
        method: "replaceState",
        reason,
      });
      if (debug) {
        console.debug("[NavSentinel] suspicious replaceState", { url: String(url), reason });
      }
    }
    return result;
  };
  // Observational hooks only (they call the native and report; never block), so
  // install them WRITABLE + CONFIGURABLE — hardening these to non-writable broke
  // strict-mode SPA routers that reassign history.pushState (grey screen on
  // claude.ai and other TanStack/React-Router apps). See softPatchProto.
  softPatchProto(History.prototype, "pushState", patchedPushState, "History.prototype.pushState");
  softPatchProto(History.prototype, "replaceState", patchedReplaceState, "History.prototype.replaceState");
}

/**
 * Intercept opener.location writes from child windows.
 *
 * In a DoubleClickjacking attack the child window navigates the opener
 * to a sensitive page (OAuth consent, MFA confirm) so the user's second
 * click lands on that page. We detect this by defining a setter on
 * window.opener that records the navigation attempt and forwards it to
 * the isolated world.
 *
 * This only has an effect in the *child* window, where `window.opener`
 * is non-null.  The parent's isolated-world script correlates the
 * opener-nav event with click timing to flag the attack.
 */
function patchOpenerLocation(): void {
  // Only relevant when this page was opened by another page.
  if (!window.opener) return;

  // Capture the real opener reference before anyone can tamper with it.
  const realOpener = window.opener;

  function recordOpenerNav(url: string): void {
    lastOpenerNavTs = nowMs();
    lastOpenerNavUrl = url;
    postToIsolated("ns-dblclick-opener-nav", { url, ts: lastOpenerNavTs });
    if (debug) {
      console.debug("[NavSentinel] opener.location write intercepted", { url });
    }
  }

  // Proxy the Location object to intercept .href setter, .assign(), and .replace().
  // Without this, an attacker can bypass the opener Proxy by calling methods
  // directly on the real Location object returned by the get trap.
  function createLocationProxy(): typeof realOpener.location {
    const realLocation = realOpener.location;
    try {
      return new Proxy(realLocation, {
        set(_target, prop, value) {
          if (prop === "href") {
            const url = String(value);
            recordOpenerNav(url);
            try { realLocation.href = value; } catch { /* cross-origin */ }
            return true;
          }
          try { Reflect.set(realLocation, prop, value); } catch { /* ignore */ }
          return true;
        },
        get(_target, prop) {
          if (prop === "assign") {
            return function assign(url: string | URL): void {
              recordOpenerNav(String(url));
              try { realLocation.assign(url as string); } catch { /* cross-origin */ }
            };
          }
          if (prop === "replace") {
            return function replace(url: string | URL): void {
              recordOpenerNav(String(url));
              try { realLocation.replace(url as string); } catch { /* cross-origin */ }
            };
          }
          try {
            const val = Reflect.get(realLocation, prop);
            if (typeof val === "function") return val.bind(realLocation);
            return val;
          } catch {
            return undefined;
          }
        }
      });
    } catch {
      return realLocation;
    }
  }

  try {
    const locationProxy = createLocationProxy();

    // Watch for direct property assignment: window.opener.location = url
    // We proxy the opener object so we can intercept .location sets.
    const openerProxy = new Proxy(realOpener, {
      set(_target, prop, value) {
        if (prop === "location") {
          const url = String(value);
          recordOpenerNav(url);
          // Allow the navigation to proceed so the attack surface
          // remains observable (the isolated-world will flag the click).
          try {
            realOpener.location = value;
          } catch {
            // cross-origin assignment -- browser will handle it
          }
          return true;
        }
        try {
          Reflect.set(realOpener, prop, value);
        } catch {
          // ignore cross-origin errors
        }
        return true;
      },
      get(_target, prop) {
        if (prop === "location") {
          // Return the proxied Location to intercept .href, .assign(), .replace()
          return locationProxy;
        }
        try {
          const val = Reflect.get(realOpener, prop);
          if (typeof val === "function") return val.bind(realOpener);
          return val;
        } catch {
          return undefined;
        }
      }
    });

    // Use configurable: false to prevent attacker code from redefining
    // window.opener after the proxy is installed.
    // Preserve setter so pages that intentionally do `window.opener = null`
    // (a common security hardening pattern) still work correctly.
    let openerDisowned = false;
    Object.defineProperty(window, "opener", {
      get() { return openerDisowned ? null : openerProxy; },
      set(value) {
        // Allow disowning the opener (security best practice) but do not
        // allow replacing it with an arbitrary object.
        if (value === null || value === undefined) {
          openerDisowned = true;
        }
        // Silently ignore other assignments; the proxy stays in place.
      },
      configurable: false
    });
  } catch (e) {
    // Some environments (cross-origin) may prevent redefining window.opener.
    // Fall back gracefully -- the SW child-close correlation still works.
    if (debug) {
      console.debug("[NavSentinel] patchOpenerLocation failed, SW fallback active", e);
    }
  }
}

// Also intercept document.execCommand("copy") as an evasion vector
const nativeExecCommand = document.execCommand.bind(document);
try {
  document.execCommand = function (command: string, ...rest: [showUI?: boolean, value?: string]): boolean {
    const result = nativeExecCommand(command, ...rest);
    // Only emit clipboard event when the copy actually succeeded
    if (command.toLowerCase() === "copy" && result && !isOff()) {
      // Read the current selection to detect command-like content
      let selText = "";
      try {
        selText = window.getSelection()?.toString() ?? "";
      } catch {
        // getSelection may throw in some contexts
      }
      postToIsolated("ns-clipboard-write", {
        ts: nowMs(),
        contentLength: selText.length || -1,
        looksLikeCommand: selText.length > 0 ? textLooksLikeCommand(selText) : false,
      });
      if (debug) {
        console.debug("[NavSentinel] document.execCommand('copy') intercepted", {
          length: selText.length,
          looksLikeCommand: selText.length > 0 ? textLooksLikeCommand(selText) : false,
        });
      }
    }
    return result;
  } as typeof document.execCommand;
} catch {
  // execCommand may not be configurable
}

/**
 * Track double-click timing for DoubleClickjacking correlation.
 * When two clicks land within DBLCLICK_WINDOW_MS and a window.open
 * fired between them, notify the isolated world.
 */
let lastClickTs = 0;
window.addEventListener(
  "click",
  () => {
    const now = nowMs();
    const gap = now - lastClickTs;
    if (gap > 0 && gap <= DBLCLICK_WINDOW_MS) {
      // This is the second click of a double-click.
      const openBetween = lastWindowOpenTs > lastClickTs && lastWindowOpenTs <= now;
      const openerNavRecent = lastOpenerNavTs > 0 && (now - lastOpenerNavTs) <= OPENER_NAV_STALE_MS;
      if (openBetween || openerNavRecent) {
        postToIsolated("ns-dblclick-second-click", {
          ts: now,
          firstClickTs: lastClickTs,
          windowOpenTs: lastWindowOpenTs,
          openerNavTs: lastOpenerNavTs,
          openerNavUrl: lastOpenerNavUrl
        });
      }
    }
    lastClickTs = now;
  },
  true
);

// patchOpenerLocation must run first to capture window.opener before any
// other script can save a reference to the real opener object.
patchOpenerLocation();
patchOpen();
patchLocation();
patchForms();
patchClipboard();
patchHistory();
postToIsolated("ns-main-guard-ready");
