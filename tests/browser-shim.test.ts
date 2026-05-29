import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------
//
// browser.ts resolves `ext` and `storageSessionShim` at module load, so tests
// that depend on the global state (isFirefox, ext resolution, session-area
// presence) install the desired globals first and then dynamically import a
// fresh module instance via vi.resetModules().

type GlobalWithExt = {
  chrome?: unknown;
  browser?: unknown;
};

const g = globalThis as GlobalWithExt;

// An in-memory storage.local double shared across helpers.
function makeLocalStore() {
  const store = new Map<string, unknown>();

  function get(keys?: string | string[] | Record<string, unknown> | null) {
    const result: Record<string, unknown> = {};
    if (keys === null || keys === undefined) {
      for (const [k, v] of store) result[k] = structuredClone(v);
      return Promise.resolve(result);
    }
    const ks = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    for (const k of ks) {
      if (store.has(k)) result[k] = structuredClone(store.get(k));
    }
    return Promise.resolve(result);
  }

  function set(items: Record<string, unknown>) {
    for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
    return Promise.resolve();
  }

  function remove(keys: string | string[]) {
    const ks = Array.isArray(keys) ? keys : [keys];
    for (const k of ks) store.delete(k);
    return Promise.resolve();
  }

  return {
    store,
    local: {
      get: vi.fn(get),
      set: vi.fn(set),
      remove: vi.fn(remove),
    },
  };
}

const originalChrome = g.chrome;
const originalBrowser = g.browser;

afterEach(() => {
  // Restore the global state so module-load tests stay isolated.
  if (originalChrome === undefined) delete g.chrome;
  else g.chrome = originalChrome;
  if (originalBrowser === undefined) delete g.browser;
  else g.browser = originalBrowser;
  vi.resetModules();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isFirefox()
// ---------------------------------------------------------------------------

describe("isFirefox", () => {
  it("returns true when the `browser` global is present", async () => {
    g.chrome = { runtime: {}, storage: {} };
    g.browser = { runtime: {}, storage: {} };
    vi.resetModules();
    const { isFirefox } = await import("../extension/src/shared/browser");
    expect(isFirefox()).toBe(true);
  });

  it("returns false when the `browser` global is absent", async () => {
    g.chrome = { runtime: {}, storage: {} };
    delete g.browser;
    vi.resetModules();
    const { isFirefox } = await import("../extension/src/shared/browser");
    expect(isFirefox()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ext resolution
// ---------------------------------------------------------------------------

describe("ext", () => {
  it("resolves to `browser` when present (Firefox)", async () => {
    const browserNs = { runtime: { id: "ff" }, storage: {} };
    g.chrome = { runtime: { id: "chrome" }, storage: {} };
    g.browser = browserNs;
    vi.resetModules();
    const { ext } = await import("../extension/src/shared/browser");
    expect(ext).toBe(browserNs);
  });

  it("resolves to `chrome` when `browser` is absent", async () => {
    const chromeNs = { runtime: { id: "chrome" }, storage: {} };
    g.chrome = chromeNs;
    delete g.browser;
    vi.resetModules();
    const { ext } = await import("../extension/src/shared/browser");
    expect(ext).toBe(chromeNs);
  });
});

// ---------------------------------------------------------------------------
// sendMessageP()
// ---------------------------------------------------------------------------

describe("sendMessageP", () => {
  it("resolves with the response on success", async () => {
    const sendMessage = vi.fn(
      (_msg: object, cb: (response: unknown) => void) => {
        cb({ ok: true });
      },
    );
    g.chrome = { runtime: { sendMessage, lastError: undefined }, storage: {} };
    delete g.browser;
    vi.resetModules();
    const { sendMessageP } = await import("../extension/src/shared/browser");

    await expect(sendMessageP<{ ok: boolean }>({ type: "ping" })).resolves.toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledWith({ type: "ping" }, expect.any(Function));
  });

  it("rejects with an Error carrying lastError.message", async () => {
    const runtime = {
      lastError: { message: "no receiving end" } as chrome.runtime.LastError,
      sendMessage: vi.fn((_msg: object, cb: (response: unknown) => void) => {
        cb(undefined);
      }),
    };
    g.chrome = { runtime, storage: {} };
    delete g.browser;
    vi.resetModules();
    const { sendMessageP } = await import("../extension/src/shared/browser");

    await expect(sendMessageP({ type: "ping" })).rejects.toThrow("no receiving end");
  });

  it("rejects when sendMessage throws synchronously", async () => {
    const sendMessage = vi.fn(() => {
      throw new Error("boom");
    });
    g.chrome = { runtime: { sendMessage, lastError: undefined }, storage: {} };
    delete g.browser;
    vi.resetModules();
    const { sendMessageP } = await import("../extension/src/shared/browser");

    await expect(sendMessageP({ type: "ping" })).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// storageSessionShim — Chrome path (native storage.session)
// ---------------------------------------------------------------------------

describe("storageSessionShim (Chrome with storage.session)", () => {
  it("delegates directly to chrome.storage.session", async () => {
    const session = {
      get: vi.fn(() => Promise.resolve({ a: 1 })),
      set: vi.fn(() => Promise.resolve()),
      remove: vi.fn(() => Promise.resolve()),
    };
    g.chrome = { runtime: {}, storage: { session, local: makeLocalStore().local } };
    delete g.browser;
    vi.resetModules();
    const { storageSessionShim } = await import("../extension/src/shared/browser");

    expect(storageSessionShim).toBe(session);
    await storageSessionShim.set({ a: 1 });
    expect(session.set).toHaveBeenCalledWith({ a: 1 });
  });
});

// ---------------------------------------------------------------------------
// storageSessionShim — Firefox fallback (namespaced storage.local)
// ---------------------------------------------------------------------------

describe("storageSessionShim (Firefox fallback to storage.local)", () => {
  let local: ReturnType<typeof makeLocalStore>;

  beforeEach(() => {
    local = makeLocalStore();
    // Firefox: `browser` present, no storage.session.
    const ns = { runtime: {}, storage: { local: local.local } };
    g.browser = ns;
    g.chrome = ns;
    vi.resetModules();
  });

  it("set() namespaces keys with the ns_session: prefix", async () => {
    const { storageSessionShim } = await import("../extension/src/shared/browser");
    await storageSessionShim.set({ foo: 42, bar: "x" });
    expect(local.store.get("ns_session:foo")).toBe(42);
    expect(local.store.get("ns_session:bar")).toBe("x");
    expect(local.store.has("foo")).toBe(false);
  });

  it("get() reads namespaced keys and returns un-prefixed key names", async () => {
    const { storageSessionShim } = await import("../extension/src/shared/browser");
    local.store.set("ns_session:foo", 42);
    const result = await storageSessionShim.get("foo");
    expect(result).toEqual({ foo: 42 });
  });

  it("get() with an array of keys returns only present entries", async () => {
    const { storageSessionShim } = await import("../extension/src/shared/browser");
    local.store.set("ns_session:foo", 1);
    const result = await storageSessionShim.get(["foo", "missing"]);
    expect(result).toEqual({ foo: 1 });
  });

  it("get() with an object applies defaults for missing keys", async () => {
    const { storageSessionShim } = await import("../extension/src/shared/browser");
    local.store.set("ns_session:foo", 1);
    const result = await storageSessionShim.get({ foo: 0, baz: "default" });
    expect(result).toEqual({ foo: 1, baz: "default" });
  });

  it("get(null) returns all namespaced entries with prefix stripped", async () => {
    const { storageSessionShim } = await import("../extension/src/shared/browser");
    local.store.set("ns_session:foo", 1);
    local.store.set("ns_session:bar", 2);
    local.store.set("persistent", 99); // non-namespaced; must be excluded
    const result = await storageSessionShim.get(null);
    expect(result).toEqual({ foo: 1, bar: 2 });
  });

  it("remove() deletes namespaced keys only", async () => {
    const { storageSessionShim } = await import("../extension/src/shared/browser");
    local.store.set("ns_session:foo", 1);
    local.store.set("persistent", 99);
    await storageSessionShim.remove("foo");
    expect(local.store.has("ns_session:foo")).toBe(false);
    expect(local.store.has("persistent")).toBe(true);
  });

  it("remove() accepts an array of keys", async () => {
    const { storageSessionShim } = await import("../extension/src/shared/browser");
    local.store.set("ns_session:a", 1);
    local.store.set("ns_session:b", 2);
    await storageSessionShim.remove(["a", "b"]);
    expect(local.store.size).toBe(0);
  });

  it("round-trips set then get through the fallback", async () => {
    const { storageSessionShim } = await import("../extension/src/shared/browser");
    await storageSessionShim.set({ token: "abc" });
    const result = await storageSessionShim.get("token");
    expect(result).toEqual({ token: "abc" });
  });
});
