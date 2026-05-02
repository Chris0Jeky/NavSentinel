import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  isChildFrame,
  isKnownBadDomain,
  initReputation,
  reputationReady,
  _resetFilter,
  createFilter,
  insertDomain,
  serializeFilter,
  optimalParams,
} from "../extension/src/shared/reputation";

// ---------------------------------------------------------------------------
// Per-frame bloom filter loading optimization (P2-13)
// ---------------------------------------------------------------------------

describe("frame detection – isChildFrame()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when window === window.top (top frame)", () => {
    const fakeWindow = {} as Window & typeof globalThis;
    (fakeWindow as Record<string, unknown>)["top"] = fakeWindow;
    vi.stubGlobal("window", fakeWindow);

    expect(isChildFrame()).toBe(false);
  });

  it("returns true when window !== window.top (child frame)", () => {
    const fakeTop = {} as Window;
    const fakeWindow = { top: fakeTop } as Window & typeof globalThis;
    vi.stubGlobal("window", fakeWindow);

    expect(isChildFrame()).toBe(true);
  });

  it("returns true when accessing window.top throws (cross-origin iframe)", () => {
    const fakeWindow = {} as Window & typeof globalThis;
    Object.defineProperty(fakeWindow, "top", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
      configurable: true,
    });
    vi.stubGlobal("window", fakeWindow);

    expect(isChildFrame()).toBe(true);
  });

  it("returns true when window is not defined (graceful in Node env)", () => {
    // In a pure Node environment with no window global, isChildFrame
    // should not throw — it returns true via the catch clause.
    vi.stubGlobal("window", undefined);
    expect(isChildFrame()).toBe(true);
  });
});

describe("child frame graceful degradation", () => {
  beforeEach(() => {
    _resetFilter();
  });

  it("isKnownBadDomain returns false when reputation not initialized (child frame scenario)", () => {
    // Simulates a child frame where initReputation() was never called.
    expect(reputationReady()).toBe(false);
    expect(isKnownBadDomain("evil-phishing-test.example")).toBe(false);
    expect(isKnownBadDomain("any-domain.com")).toBe(false);
  });

  it("isKnownBadDomain does not throw when reputation not initialized", () => {
    expect(() => isKnownBadDomain("anything")).not.toThrow();
  });

  it("initReputation can be safely skipped without affecting isKnownBadDomain", () => {
    // In child frames, initReputation is never called.
    // isKnownBadDomain must remain safe and return false.
    for (let i = 0; i < 10; i++) {
      expect(isKnownBadDomain(`domain-${i}.example`)).toBe(false);
    }
  });

  it("top frame still works normally after initReputation", () => {
    const domains = ["bad-site.example", "phish.example"];
    const { m, k } = optimalParams(domains.length, 0.0001);
    const filter = createFilter(m, k);
    for (const d of domains) {
      insertDomain(filter, d);
    }
    const binary = serializeFilter(filter);

    expect(initReputation(binary)).toBe(true);
    expect(reputationReady()).toBe(true);
    expect(isKnownBadDomain("bad-site.example")).toBe(true);
    expect(isKnownBadDomain("safe-site.example")).toBe(false);
  });

  it("_resetFilter clears state back to uninitialized", () => {
    const { m, k } = optimalParams(1, 0.0001);
    const filter = createFilter(m, k);
    insertDomain(filter, "test.example");
    initReputation(serializeFilter(filter));

    expect(reputationReady()).toBe(true);
    _resetFilter();
    expect(reputationReady()).toBe(false);
    expect(isKnownBadDomain("test.example")).toBe(false);
  });
});
