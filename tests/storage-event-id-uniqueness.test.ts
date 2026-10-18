import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_LOG_KEY } from "../extension/src/shared/storage";

type Store = Record<string, unknown>;

function createChromeMock(initial: Store = {}) {
  const store: Store = { ...initial };
  const sessionStore: Store = {};
  return {
    store,
    chrome: {
      // No `runtime.sendMessage`: appends take the direct lane, minting ids via
      // the module-private makeId (which is deliberately not exported).
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

describe("event-id uniqueness across rapid mints through public seams", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mints unique ids for rapid concurrent appends within one millisecond", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    // Freeze the clock so every mint shares one millisecond: the timestamp
    // alone cannot separate them, only the counter + randomness can.
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const { appendEvent, getEventLog } = await import("../extension/src/shared/storage");
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        appendEvent({ kind: "nav_click_block", site: `rapid-${i}.test` }),
      ),
    );

    // persistEventLogEntry dedups by id, so a collision would silently drop an
    // event: both the count and the id set must be complete.
    expect(store[EVENT_LOG_KEY]).toHaveLength(50);
    const log = await getEventLog();
    const ids = log.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(50);
  });
});
