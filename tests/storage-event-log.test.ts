import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = Record<string, unknown>;

function createChromeMock(initial: Store = {}) {
  const store: Store = { ...initial };
  const sessionStore: Store = {};
  return {
    store,
    chrome: {
      // No `runtime.sendMessage`: appends take the direct lane so the test
      // exercises buildEventLogEntry -> persistEventLogEntry in-process.
      storage: {
        local: {
          async get(keys?: string | string[] | Record<string, unknown>) {
            if (keys === undefined) return { ...store };
            if (typeof keys === "string") {
              return keys in store ? { [keys]: store[keys] } : {};
            }
            if (Array.isArray(keys)) {
              return Object.fromEntries(
                keys.filter((key) => key in store).map((key) => [key, store[key]]),
              );
            }
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [
                key,
                key in store ? store[key] : fallback,
              ]),
            );
          },
          async set(next: Record<string, unknown>) {
            for (const [key, value] of Object.entries(next)) {
              store[key] = value;
            }
          },
          async remove(keys: string | string[]) {
            const allKeys = Array.isArray(keys) ? keys : [keys];
            for (const key of allKeys) delete store[key];
          },
        },
        session: {
          async get(keys?: string | string[] | Record<string, unknown>) {
            if (keys === undefined) return { ...sessionStore };
            if (typeof keys === "string") {
              return keys in sessionStore ? { [keys]: sessionStore[keys] } : {};
            }
            if (Array.isArray(keys)) {
              return Object.fromEntries(
                keys
                  .filter((key) => key in sessionStore)
                  .map((key) => [key, sessionStore[key]]),
              );
            }
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [
                key,
                key in sessionStore ? sessionStore[key] : fallback,
              ]),
            );
          },
          async set(next: Record<string, unknown>) {
            for (const [key, value] of Object.entries(next)) {
              sessionStore[key] = value;
            }
          },
        },
        onChanged: {
          addListener() {},
        },
      },
    },
  };
}

describe("event-log malformed append (non-string fields surface at build time)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("persists a numeric runtime id as a string instead of silently dropping the entry", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent, getEventLog } = await import("../extension/src/shared/storage");

    await appendEvent({ kind: "nav_click_block", id: 123 as unknown as string });

    // Resolved: the entry must actually be persisted with the coerced string id.
    const log = await getEventLog();
    const entry = log.find((item) => item.id === "123");
    expect(entry).toBeDefined();
    expect(typeof entry!.id).toBe("string");
  });
});
