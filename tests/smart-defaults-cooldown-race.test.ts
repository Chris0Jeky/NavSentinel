import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SMART_DEFAULT_COOLDOWNS_KEY } from "../extension/src/shared/smart_defaults";

type Store = Record<string, unknown>;

function createChromeMock(initial: Store = {}) {
  const store: Store = { ...initial };
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
        onChanged: {
          addListener() {},
        },
      },
    },
  };
}

describe("smart-default cooldown overlapping mutations lose no updates", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("two overlapping setCooldown calls both land", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { setCooldown } = await import("../extension/src/shared/smart_defaults");
    // Issued without awaiting between them: without the write queue both read
    // the same empty base and the second write clobbers the first.
    await Promise.all([setCooldown("a.com", "b.com"), setCooldown("c.com", "d.com")]);

    const cooldowns = store[SMART_DEFAULT_COOLDOWNS_KEY] as Record<string, number>;
    expect(Object.keys(cooldowns).sort()).toEqual(["a.com|b.com", "c.com|d.com"]);
  });

  it("an overlapping setCooldown + clearCooldown pair both apply", async () => {
    const future = Date.now() + 60_000;
    const { chrome, store } = createChromeMock({
      [SMART_DEFAULT_COOLDOWNS_KEY]: { "old.com|d.com": future },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { setCooldown, clearCooldown } = await import(
      "../extension/src/shared/smart_defaults"
    );
    await Promise.all([setCooldown("new.com", "d.com"), clearCooldown("old.com", "d.com")]);

    const cooldowns = store[SMART_DEFAULT_COOLDOWNS_KEY] as Record<string, number>;
    expect(cooldowns["new.com|d.com"]).toBeGreaterThan(Date.now());
    expect(cooldowns["old.com|d.com"]).toBeUndefined();
  });
});
