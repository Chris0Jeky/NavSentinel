import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStateManager } from "../extension/src/shared/session_state";

function createSessionStorageMock(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  return {
    store,
    mock: {
      async get(keys?: string | string[]) {
        if (keys === undefined) return { ...store };
        if (typeof keys === "string") return { [keys]: store[keys] };
        const result: Record<string, unknown> = {};
        for (const key of keys) result[key] = store[key];
        return result;
      },
      async set(items: Record<string, unknown>) {
        Object.assign(store, items);
      },
    },
  };
}

describe("session restore seats int-only non-negative tab keys", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects fractional, negative and empty-string map keys while keeping valid tabs", async () => {
    const session = createSessionStorageMock({
      "ns_sw:allowUntil": {
        "7": 12345,
        "1.5": 999,
        "-1": 999,
        "": 999,
        "   ": 999,
        "007": 42,
      },
    });
    vi.stubGlobal("chrome", { storage: { session: session.mock } });

    const manager = new SessionStateManager();
    await manager.hydrate();

    // Only integer, non-negative keys restore. "007" is a valid int spelling of
    // tab 7 and (as the later entry) wins over "7".
    expect(manager.allowUntilByTab.get(7)).toBe(42);
    expect(manager.allowUntilByTab.has(1.5)).toBe(false);
    expect(manager.allowUntilByTab.has(-1)).toBe(false);
    // Number("") is 0: without the empty-key guard this would seat tab 0.
    expect(manager.allowUntilByTab.has(0)).toBe(false);
    expect(manager.allowUntilByTab.size).toBe(1);
  });

  it("rejects fractional and negative readyTabs entries while keeping valid tabs", async () => {
    const session = createSessionStorageMock({
      "ns_sw:readyTabs": [3, 1.5, -1, "4", Number.NaN, 0],
    });
    vi.stubGlobal("chrome", { storage: { session: session.mock } });

    const manager = new SessionStateManager();
    await manager.hydrate();

    expect([...manager.readyTabs].sort()).toEqual([0, 3]);
  });
});
