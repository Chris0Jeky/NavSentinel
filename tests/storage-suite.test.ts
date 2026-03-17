import { beforeEach, describe, expect, it, vi } from "vitest";

type Store = Record<string, unknown>;

function createChromeMock(initial: Store = {}) {
  const store: Store = { ...initial };
  const changeListeners: Array<(changes: Record<string, { oldValue: unknown; newValue: unknown }>, areaName: string) => void> = [];

  function emitChanges(changes: Record<string, { oldValue: unknown; newValue: unknown }>) {
    if (Object.keys(changes).length === 0) return;
    for (const listener of changeListeners) {
      listener(changes, "local");
    }
  }

  return {
    store,
    chrome: {
      storage: {
        local: {
          async get(keys?: string | string[] | Record<string, unknown>) {
            if (keys === undefined) return { ...store };
            if (typeof keys === "string") {
              return keys in store ? { [keys]: store[keys] } : {};
            }
            if (Array.isArray(keys)) {
              return Object.fromEntries(
                keys
                  .filter((key) => key in store)
                  .map((key) => [key, store[key]])
              );
            }
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [key, key in store ? store[key] : fallback])
            );
          },
          async set(next: Record<string, unknown>) {
            const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};
            for (const [key, value] of Object.entries(next)) {
              const oldValue = store[key];
              store[key] = value;
              changes[key] = { oldValue, newValue: value };
            }
            emitChanges(changes);
          },
          async remove(keys: string | string[]) {
            const allKeys = Array.isArray(keys) ? keys : [keys];
            const changes: Record<string, { oldValue: unknown; newValue: unknown }> = {};
            for (const key of allKeys) {
              if (!(key in store)) continue;
              const oldValue = store[key];
              delete store[key];
              changes[key] = { oldValue, newValue: undefined };
            }
            emitChanges(changes);
          }
        },
        onChanged: {
          addListener(listener: (changes: Record<string, { oldValue: unknown; newValue: unknown }>, areaName: string) => void) {
            changeListeners.push(listener);
          }
        }
      }
    }
  };
}

describe("suite storage and allowlist migration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not resurrect a legacy allowlist when the current key is explicitly empty", async () => {
    const { chrome } = createChromeMock({
      "sentinelsuite:nav_allowlist_v1": {},
      "navsentinel:allowlist": {
        "example.com": ["legacy.example"]
      }
    });
    vi.stubGlobal("chrome", chrome as typeof globalThis.chrome);

    const { getAllowlist } = await import("../extension/src/shared/allowlist");
    const allowlist = await getAllowlist();

    expect(allowlist).toEqual({});
  });

  it("exports a normalized migrated allowlist", async () => {
    const { chrome, store } = createChromeMock({
      "navsentinel:allowlist": {
        " Example.com ": [" Login.Example.com ", 7, "login.example.com"]
      }
    });
    vi.stubGlobal("chrome", chrome as typeof globalThis.chrome);

    const { exportAll } = await import("../extension/src/shared/storage");
    const exported = await exportAll();

    expect(exported.allowlist).toEqual({
      "example.com": ["login.example.com"]
    });
    expect(store["sentinelsuite:nav_allowlist_v1"]).toEqual({
      "example.com": ["login.example.com"]
    });
  });

  it("normalizes imported allowlist payloads before storage", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as typeof globalThis.chrome);

    const { importAll } = await import("../extension/src/shared/storage");
    await importAll({
      allowlist: {
        " Example.com ": [" Login.Example.com ", 7, "login.example.com", ""],
        "": ["ignored.example"]
      }
    });

    expect(store["sentinelsuite:nav_allowlist_v1"]).toEqual({
      "example.com": ["login.example.com"]
    });
  });
});
