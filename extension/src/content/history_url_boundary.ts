/**
 * Preserve the History API's single observable URL-coercion boundary.
 *
 * Loaded immediately after main_guard.ts in the same MAIN-world content-script
 * entry. The guard calls the browser first and then inspects the URL. A stateful
 * object must therefore expose one stable string to both consumers rather than
 * being coerced again after the browser has already committed navigation state.
 */

type HistoryMethod = typeof History.prototype.pushState;
type HistoryMethodName = "pushState" | "replaceState";

const stringify = String;
const toPrimitive = Symbol.toPrimitive;

function stableHistoryUrl(url: unknown): unknown {
  if (url === null || url === undefined || typeof url === "string") return url;

  let resolved = false;
  let value = "";
  return {
    [toPrimitive](): string {
      if (!resolved) {
        // Web IDL DOMString conversion rejects a Symbol primitive. String(symbol)
        // is unusually permissive, so preserve the browser boundary explicitly.
        if (typeof url === "symbol") {
          throw new TypeError("Cannot convert a Symbol value to a string");
        }
        value = stringify(url);
        resolved = true;
      }
      return value;
    },
  };
}

function installStableHistoryBoundary(name: HistoryMethodName): void {
  const descriptor = Object.getOwnPropertyDescriptor(History.prototype, name);
  if (!descriptor || typeof descriptor.value !== "function") return;

  const monitored = descriptor.value as HistoryMethod;
  const wrapped: HistoryMethod = function (
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    Reflect.apply(monitored, this, [data, unused, stableHistoryUrl(url)]);
  };

  try {
    Object.defineProperty(History.prototype, name, {
      ...descriptor,
      value: wrapped,
    });
  } catch {
    // Match main_guard's soft-patch policy: hardened pages degrade rather than
    // breaking their own History API or the rest of NavSentinel.
  }
}

installStableHistoryBoundary("pushState");
installStableHistoryBoundary("replaceState");

export {};
