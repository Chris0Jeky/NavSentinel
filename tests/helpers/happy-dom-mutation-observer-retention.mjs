import * as PropertySymbol from "happy-dom/lib/PropertySymbol.js";

const PATCHED = Symbol.for("navsentinel.test.happyDomMutationObserverRetention");
const RETAINED_CALLBACKS = Symbol.for(
  "navsentinel.test.happyDomMutationObserverRetainedCallbacks",
);

function mutationListeners(target) {
  const listeners = target?.[PropertySymbol.mutationListeners];
  return Array.isArray(listeners) ? listeners : [];
}

function retainNewForwardingCallbacks(observer, target, before) {
  const retained = observer[RETAINED_CALLBACKS] ?? [];
  for (const listener of mutationListeners(target)) {
    if (before.has(listener)) continue;
    const callback = listener?.callback?.deref?.();
    if (typeof callback === "function" && !retained.includes(callback)) {
      retained.push(callback);
    }
  }
  Object.defineProperty(observer, RETAINED_CALLBACKS, {
    configurable: true,
    value: retained,
    writable: true,
  });
}

export function retainedHappyDomMutationCallbackCountForTesting(observer) {
  return observer?.[RETAINED_CALLBACKS]?.length ?? 0;
}

/**
 * Happy DOM 20.9.0 keeps its MutationObserver alive, but weak-references a
 * separate forwarding closure created by observe(). A full GC can collect that
 * closure while the observation is still active. Retain the actual WeakRef
 * target on the observer and release it when disconnect() ends the observation.
 *
 * This is test-environment-only and can be removed once the dependency floor
 * includes the upstream strong-reference fix released in Happy DOM 20.11.2.
 */
export function installHappyDomMutationObserverRetention(scope = globalThis) {
  const OriginalMutationObserver = scope?.MutationObserver;
  if (typeof OriginalMutationObserver !== "function") return false;
  if (OriginalMutationObserver[PATCHED]) return true;

  const prototype = OriginalMutationObserver.prototype;
  const originalObserve = prototype.observe;
  const originalDisconnect = prototype.disconnect;

  Object.defineProperty(prototype, "observe", {
    configurable: true,
    writable: true,
    value(target, options) {
      const before = new Set(mutationListeners(target));
      const result = Reflect.apply(originalObserve, this, [target, options]);
      retainNewForwardingCallbacks(this, target, before);
      return result;
    },
  });

  Object.defineProperty(prototype, "disconnect", {
    configurable: true,
    writable: true,
    value(...args) {
      try {
        return Reflect.apply(originalDisconnect, this, args);
      } finally {
        if (Object.prototype.hasOwnProperty.call(this, RETAINED_CALLBACKS)) {
          this[RETAINED_CALLBACKS] = [];
        }
      }
    },
  });

  Object.defineProperty(OriginalMutationObserver, PATCHED, { value: true });
  return true;
}
