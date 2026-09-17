const PATCHED = Symbol.for("navsentinel.test.happyDomMutationObserverRetention");

function retainHappyDomBoundCallback(callback) {
  const retained = [];
  const wrapped = function (...args) {
    return Reflect.apply(callback, this, args);
  };

  Object.defineProperty(wrapped, "bind", {
    configurable: true,
    value(thisArg, ...args) {
      const bound = Reflect.apply(Function.prototype.bind, wrapped, [thisArg, ...args]);
      retained.push(bound);
      return bound;
    },
  });

  return wrapped;
}

/**
 * Happy DOM 20.9.0 weak-references the callback created by MutationObserver.observe().
 * A full GC can therefore sever an active observer before mutation delivery. Keep the
 * internally bound forwarding callbacks alive for exactly the lifetime of the observer.
 * This is test-environment-only and can be removed after the dependency floor includes
 * the upstream strong-reference fix released in Happy DOM 20.11.2.
 */
export function installHappyDomMutationObserverRetention(scope = globalThis) {
  const OriginalMutationObserver = scope?.MutationObserver;
  if (typeof OriginalMutationObserver !== "function") return false;
  if (OriginalMutationObserver[PATCHED]) return true;

  let RetainingMutationObserver;
  RetainingMutationObserver = new Proxy(OriginalMutationObserver, {
    construct(target, args, newTarget) {
      const [callback, ...rest] = args;
      const retainedCallback =
        typeof callback === "function" ? retainHappyDomBoundCallback(callback) : callback;
      return Reflect.construct(
        target,
        [retainedCallback, ...rest],
        newTarget === RetainingMutationObserver ? target : newTarget,
      );
    },
  });

  Object.defineProperty(RetainingMutationObserver, PATCHED, { value: true });
  const descriptor = Object.getOwnPropertyDescriptor(scope, "MutationObserver");
  Object.defineProperty(scope, "MutationObserver", {
    configurable: descriptor?.configurable ?? true,
    enumerable: descriptor?.enumerable ?? false,
    writable: "writable" in (descriptor ?? {}) ? descriptor.writable : true,
    value: RetainingMutationObserver,
  });
  return true;
}
