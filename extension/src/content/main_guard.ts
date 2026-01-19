const NS_SOURCE = "__navsentinel__";
const GESTURE_TTL_MS = 800;
const MAX_OPENS_PER_GESTURE = 1;
const ALLOW_ONCE_TTL_MS = 1200;
const BLOCKED_ACTION_TTL_MS = 5000;

let lastGestureTs = 0;
let openCount = 0;
let allowOnceRemaining = 0;
let allowOnceUntil = 0;
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

function markGesture(): void {
  lastGestureTs = performance.now();
  openCount = 0;
}

function setAllowOnce(): void {
  allowOnceRemaining = 1;
  allowOnceUntil = performance.now() + ALLOW_ONCE_TTL_MS;
}

function hasActiveGesture(): boolean {
  return performance.now() - lastGestureTs <= GESTURE_TTL_MS;
}

function consumeAllowance(): "allow_once" | "gesture" | "none" {
  const now = performance.now();
  if (allowOnceRemaining > 0 && now <= allowOnceUntil) {
    allowOnceRemaining -= 1;
    return "allow_once";
  }
  if (hasActiveGesture() && openCount < MAX_OPENS_PER_GESTURE) {
    openCount += 1;
    return "gesture";
  }
  return "none";
}

function makeId(): string {
  return `${Math.floor(performance.now())}-${Math.random().toString(16).slice(2)}`;
}

function pruneBlockedActions(): void {
  const now = performance.now();
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
  window.postMessage(
    {
      source: NS_SOURCE,
      type: "ns-nav-blocked",
      id: params.id,
      kind: params.kind,
      url: params.url ?? "",
      target: params.target ?? "",
      features: params.features ?? "",
      ts: performance.now()
    },
    "*"
  );
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
    expiresAt: performance.now() + BLOCKED_ACTION_TTL_MS,
    kind: params.kind,
    url: params.url,
    target: params.target,
    features: params.features
  });
  postBlocked({ id, kind: params.kind, url: params.url, target: params.target, features: params.features });
}

const nativeProtoOpen = Window.prototype.open;
const nativeOpen = window.open;
const nativeAssign = Location.prototype.assign;
const nativeReplace = Location.prototype.replace;
const nativeFormSubmit = HTMLFormElement.prototype.submit;
const nativeFormRequestSubmit = HTMLFormElement.prototype.requestSubmit;

function callNativeOpen(thisArg: Window, url?: string | URL, target?: string, features?: string): Window | null {
  if (nativeProtoOpen) {
    return nativeProtoOpen.call(thisArg, url as any, target, features);
  }
  return nativeOpen.call(thisArg, url as any, target, features);
}

function patchedOpen(this: Window, url?: string | URL, target?: string, features?: string): Window | null {
  const allowance = consumeAllowance();
  if (allowance !== "none") {
    return callNativeOpen(this, url, target, features);
  }

  registerBlockedAction({
    kind: "window_open",
    url: url ? String(url) : "",
    target,
    features,
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
  Location.prototype.assign = function (url: string | URL): void {
    const allowance = consumeAllowance();
    if (allowance !== "none") {
      nativeAssign.call(this, url);
      return;
    }
    registerBlockedAction({
      kind: "location_assign",
      url: String(url),
      action: () => nativeAssign.call(this, url)
    });
  };

  Location.prototype.replace = function (url: string | URL): void {
    const allowance = consumeAllowance();
    if (allowance !== "none") {
      nativeReplace.call(this, url);
      return;
    }
    registerBlockedAction({
      kind: "location_replace",
      url: String(url),
      action: () => nativeReplace.call(this, url)
    });
  };
}

function patchForms(): void {
  HTMLFormElement.prototype.submit = function (): void {
    const allowance = consumeAllowance();
    if (allowance !== "none") {
      nativeFormSubmit.call(this);
      return;
    }
    const actionUrl = resolveFormAction(this);
    registerBlockedAction({
      kind: "form_submit",
      url: actionUrl,
      action: () => nativeFormSubmit.call(this)
    });
  };

  if (nativeFormRequestSubmit) {
    HTMLFormElement.prototype.requestSubmit = function (submitter?: HTMLElement | null): void {
      const allowance = consumeAllowance();
      if (allowance !== "none") {
        nativeFormRequestSubmit.call(this, submitter as any);
        return;
      }
      const actionUrl = resolveFormAction(this);
      registerBlockedAction({
        kind: "form_request_submit",
        url: actionUrl,
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
    Window.prototype.open = function (url?: string | URL, target?: string, features?: string): Window | null {
      return patchedOpen.call(this, url, target, features);
    } as any;
  }
}

window.addEventListener(
  "message",
  (event) => {
    if (event.source !== window) return;
    const data = event.data as { source?: string; type?: string; id?: string };
    if (!data || data.source !== NS_SOURCE) return;

    if (data.type === "ns-gesture-allow") {
      markGesture();
    }

    if (data.type === "ns-allow-once") {
      setAllowOnce();
    }

    if (data.type === "ns-allow-action" && data.id) {
      const entry = blockedActions.get(data.id);
      if (!entry) return;
      if (entry.expiresAt <= performance.now()) {
        blockedActions.delete(data.id);
        return;
      }
      blockedActions.delete(data.id);
      entry.action();
    }
  },
  true
);

window.addEventListener(
  "pointerdown",
  () => {
    markGesture();
  },
  true
);

window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Enter" || e.key === " ") {
      markGesture();
    }
  },
  true
);

patchOpen();
patchLocation();
patchForms();

(window as any).__navsentinelMainGuard = true;
