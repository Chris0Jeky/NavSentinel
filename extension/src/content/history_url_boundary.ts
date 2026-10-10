/**
 * Preserve the History API's single observable URL-coercion boundary.
 *
 * The MAIN-world guard calls the browser first and then inspects the URL. A
 * stateful object must therefore expose one stable primitive to both consumers
 * rather than being coerced again after the browser committed navigation state.
 */

type HistoryMethod = typeof History.prototype.pushState;
type HistoryMethodName = "pushState" | "replaceState";

const stringify = String;
const toPrimitive = Symbol.toPrimitive;

/** Return a lazily memoized URL value without replacing native primitive errors. */
export function stabilizeHistoryUrl(url: unknown): unknown {
  if (
    url === null ||
    url === undefined ||
    typeof url === "string" ||
    typeof url === "symbol"
  ) {
    return url;
  }

  let resolved = false;
  let value = "";
  return {
    [toPrimitive](): string {
      if (!resolved) {
        value = stringify(url);
        resolved = true;
      }
      return value;
    },
  };
}

function installMethodBoundary(name: HistoryMethodName): void {
  const descriptor = Object.getOwnPropertyDescriptor(History.prototype, name);
  if (!descriptor || typeof descriptor.value !== "function") return;

  const monitored = descriptor.value as HistoryMethod;
  const wrapped: HistoryMethod = function (
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    Reflect.apply(monitored, this, [data, unused, stabilizeHistoryUrl(url)]);
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

/** Wrap the already-installed observational hooks with a stable coercion boundary. */
export function installStableHistoryBoundary(): void {
  installMethodBoundary("pushState");
  installMethodBoundary("replaceState");
}
