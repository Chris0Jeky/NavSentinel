import { describe, expect, it, vi } from "vitest";
import {
  checkReputationViaMessage,
  initReputation,
  isKnownBadDomain,
  reputationReady,
} from "../extension/src/shared/reputation_runtime.production";
import { isKnownBadDestination } from "../extension/src/shared/reputation_runtime.enabled";
import {
  createFilter,
  insertDomain,
  optimalParams,
  serializeFilter,
} from "../extension/src/shared/reputation";

function headerBuffer({ m, k }: { m: number; k: number }): ArrayBuffer {
  const buffer = new ArrayBuffer(16 + Math.ceil(m / 8));
  const view = new DataView(buffer);
  view.setUint32(0, 0x424c4f4d, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, k, true);
  view.setUint32(12, m, true);
  return buffer;
}

describe("production reputation runtime", () => {
  it("loads a bounded filter and reports readiness", () => {
    const { m, k } = optimalParams(1, 0.0001);
    const filter = createFilter(m, k);
    insertDomain(filter, "known-bad.example");
    expect(initReputation(serializeFilter(filter).buffer as ArrayBuffer)).toBe(true);
    expect(reputationReady()).toBe(true);
    expect(isKnownBadDomain("known-bad.example")).toBe(true);
    expect(isKnownBadDomain("not-in-filter.example")).toBe(false);
  });

  it("fails closed on malformed input", () => {
    expect(initReputation(new ArrayBuffer(4))).toBe(false);
    expect(reputationReady()).toBe(false);
    expect(isKnownBadDomain("anything.example")).toBe(false);
  });

  it.each([
    [{ m: 0, k: 1 }, "zero-bit filter"],
    [{ m: 64, k: 0 }, "zero-hash filter"],
  ])("fails closed on a %s", (header) => {
    expect(initReputation(headerBuffer(header))).toBe(false);
    expect(reputationReady()).toBe(false);
    expect(isKnownBadDomain("anything.example")).toBe(false);
  });

  it.each([
    [{ m: 16 * 1024 * 1024 + 1, k: 1 }, "oversized bit filter"],
    [{ m: 64, k: 31 }, "oversized hash filter"],
  ])("fails closed on a %s", (header) => {
    expect(initReputation(headerBuffer(header))).toBe(false);
    expect(reputationReady()).toBe(false);
    expect(isKnownBadDomain("anything.example")).toBe(false);
  });

  it("keeps top-frame known-bad lookup synchronous through the production alias", () => {
    const filter = createFilter(8, 1);
    insertDomain(filter, "known-bad.example");
    expect(initReputation(serializeFilter(filter).buffer as ArrayBuffer)).toBe(true);
    expect(isKnownBadDestination("known-bad.example", "deep.known-bad.example")).toBe(true);
    expect(isKnownBadDestination("clean.example", "deep.clean.example")).toBe(false);
  });

  it("keeps child-frame reputation delegation asynchronous and fail-closed", async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (response: unknown) => void) => {
      callback({ knownBad: true, filterReady: true });
    });
    vi.stubGlobal("chrome", { runtime: { lastError: null, sendMessage } });

    await expect(checkReputationViaMessage("known-bad.example")).resolves.toEqual({
      knownBad: true,
      filterReady: true,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      { type: "ns-reputation-check", domain: "known-bad.example" },
      expect.any(Function),
    );
    vi.unstubAllGlobals();
  });
});
