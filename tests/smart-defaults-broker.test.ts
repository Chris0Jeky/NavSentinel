import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Defaults = typeof import("../extension/src/shared/smart_defaults");
const key = "sentinelsuite:smart_default_cooldowns_v1";
const sender = {
  id: "test-extension", url: "https://first.example/", tab: { id: 1 }, frameId: 0, documentId: "doc-1",
} as chrome.runtime.MessageSender;
const setMessage = (sourceDomain = "first.example") => ({
  type: "ns-smart-default-cooldown", op: "set", sourceDomain, destDomain: "destination.example",
});

let broker: Defaults;
let first: Defaults;
let second: Defaults;
let store: Record<string, unknown>;
const read = vi.fn(async () => structuredClone(store));
const write = vi.fn(async (next: Record<string, unknown>) => { Object.assign(store, structuredClone(next)); });
const send = vi.fn(async (message: unknown): Promise<unknown> => broker.handleSmartDefaultCooldownMessage(message, sender));
const pairs = () => Object.keys(store[key] as Record<string, number>).sort();

beforeEach(async () => {
  vi.resetAllMocks();
  store = {};
  vi.stubGlobal("document", {});
  vi.stubGlobal("chrome", {
    storage: { local: { get: read, set: write } },
    runtime: { id: "test-extension", getURL: (p: string) => `chrome-extension://test-extension/${p}`, sendMessage: send },
  });
  // Independent module instances model different extension worlds, not three
  // calls accidentally protected by the same content world's local queue.
  vi.resetModules();
  broker = await import("../extension/src/shared/smart_defaults");
  vi.resetModules();
  first = await import("../extension/src/shared/smart_defaults");
  vi.resetModules();
  second = await import("../extension/src/shared/smart_defaults");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("worker-owned smart-default cooldown mutations (#976)", () => {
  it("preserves overlapping writes from independent content worlds", async () => {
    expect(first).not.toBe(second);
    expect(first).not.toBe(broker);
    await Promise.all([
      first.setCooldown("first.example", "destination.example"),
      second.setCooldown("second.example", "destination.example"),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(pairs()).toEqual(["first.example|destination.example", "second.example|destination.example"]);
  });

  it("serializes stale pruning with set and clear without losing unrelated pairs", async () => {
    store[key] = { "expired.example|destination.example": 1, "old.example|destination.example": Date.now() + 60_000 };
    await Promise.all([
      first.getCooldowns(), second.setCooldown("new.example", "destination.example"),
      first.clearCooldown("old.example", "destination.example"),
    ]);
    expect(send).toHaveBeenCalledWith({ type: "ns-smart-default-cooldown", op: "prune" });
    expect(pairs()).toEqual(["new.example|destination.example"]);
  });

  it("returns a clean read without messaging or rewriting", async () => {
    const map = { "source.example|destination.example": Date.now() + 60_000 };
    store[key] = map;
    expect(await first.getCooldowns()).toEqual(map);
    expect(send).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects foreign and incomplete sender identities before reading storage", async () => {
    for (const invalid of [undefined, { ...sender, id: "other" }, { ...sender, documentId: undefined },
      { ...sender, frameId: -1 }, { ...sender, tab: undefined }]) {
      expect(await broker.handleSmartDefaultCooldownMessage(setMessage(), invalid)).toMatchObject({ ok: false });
    }
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("accepts the owning extension page and canonicalizes pair case", async () => {
    expect(await broker.handleSmartDefaultCooldownMessage(setMessage("FIRST.EXAMPLE"), {
      id: sender.id, url: "chrome-extension://test-extension/src/options/options.html",
    })).toMatchObject({ ok: true });
    expect(pairs()).toEqual(["first.example|destination.example"]);
  });

  it("rejects malformed operations and delimiter-ambiguous pairs before storage", async () => {
    for (const invalid of [null, [], {}, { ...setMessage(), op: "replace" },
      { ...setMessage(), sourceDomain: "a|b" }, { ...setMessage(), sourceDomain: " a.example" },
      { ...setMessage(), destDomain: "" }, { ...setMessage(), destDomain: "x".repeat(254) }]) {
      expect(await broker.handleSmartDefaultCooldownMessage(invalid, sender)).toMatchObject({ ok: false });
    }
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("preserves TTL and the cap while removing non-finite persisted entries", async () => {
    const now = Date.now();
    store[key] = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`pair-${i}|dest`, now + 60_000 + i]));
    Object.assign(store[key] as object, { infinite: Infinity, invalid: NaN, expired: 1 });
    await first.setCooldown("latest.example", "destination.example");
    const map = store[key] as Record<string, number>;
    expect(Object.keys(map)).toHaveLength(broker.SMART_DEFAULT_COOLDOWN_LIMIT);
    expect(map["latest.example|destination.example"]).toBeGreaterThanOrEqual(now + broker.SMART_DEFAULT_COOLDOWN_MS);
    expect(map["latest.example|destination.example"]).toBeLessThanOrEqual(Date.now() + broker.SMART_DEFAULT_COOLDOWN_MS);
    expect(map.infinite).toBeUndefined();
    expect(map.invalid).toBeUndefined();
    expect(map.expired).toBeUndefined();
    expect(map["pair-0|dest"]).toBeUndefined();
  });

  it("propagates failed persistence and recovers the worker queue", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    write.mockRejectedValueOnce(new Error("injected write failure"));
    const failed = first.setCooldown("failed.example", "destination.example");
    const following = second.setCooldown("following.example", "destination.example");
    await expect(failed).rejects.toThrow("injected write failure");
    await following;
    expect(pairs()).toEqual(["following.example|destination.example"]);
  });

  it("never falls back to document-local writes after a missing or rejected broker response", async () => {
    send.mockResolvedValueOnce(undefined);
    await expect(first.setCooldown("unconfirmed.example", "destination.example")).rejects.toThrow("confirmed");
    send.mockRejectedValueOnce(new Error("worker unavailable"));
    await expect(second.clearCooldown("source.example", "destination.example")).rejects.toThrow("worker unavailable");
    expect(write).not.toHaveBeenCalled();
  });
});
