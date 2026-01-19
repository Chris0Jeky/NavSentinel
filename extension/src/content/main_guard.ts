const NS_SOURCE = "__navsentinel__";
const GESTURE_TTL_MS = 800;
const MAX_OPENS_PER_GESTURE = 1;
const ALLOW_ONCE_TTL_MS = 1200;

let lastGestureTs = 0;
let openCount = 0;
let allowOnceRemaining = 0;
let allowOnceUntil = 0;

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

function canOpenNow(): boolean {
  const now = performance.now();
  if (allowOnceRemaining > 0 && now <= allowOnceUntil) return true;
  return hasActiveGesture() && openCount < MAX_OPENS_PER_GESTURE;
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

function postBlocked(params: {
  url?: string;
  target?: string;
  features?: string;
}): void {
  window.postMessage(
    {
      source: NS_SOURCE,
      type: "ns-window-open-blocked",
      url: params.url ?? "",
      target: params.target ?? "",
      features: params.features ?? "",
      ts: performance.now()
    },
    "*"
  );
}

const nativeProtoOpen = Window.prototype.open;
const nativeOpen = window.open;

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

  postBlocked({
    url: url ? String(url) : "",
    target,
    features
  });

  return null;
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
    const data = event.data as { source?: string; type?: string };
    if (!data || data.source !== NS_SOURCE) return;

    if (data.type === "ns-gesture-allow") {
      markGesture();
    }

    if (data.type === "ns-allow-once") {
      setAllowOnce();
    }
  },
  true
);

patchOpen();

(window as any).__navsentinelMainGuard = true;
