import { describe, expect, it } from "vitest";
import { enforceMapSizeCap, shouldEmitRapidPushState } from "../extension/src/content/main_guard_helpers";

describe("enforceMapSizeCap (#301)", () => {
  const mapOf = (n: number) => {
    const m = new Map<number, string>();
    for (let i = 0; i < n; i++) m.set(i, `v${i}`);
    return m;
  };

  it("evicts nothing when under or at the cap", () => {
    const m = mapOf(5);
    expect(enforceMapSizeCap(m, 5)).toBe(0);
    expect(m.size).toBe(5);
    expect(enforceMapSizeCap(m, 10)).toBe(0);
    expect(m.size).toBe(5);
  });

  it("evicts the OLDEST entries until size equals the cap", () => {
    const m = mapOf(10); // keys 0..9, insertion order
    const evicted = enforceMapSizeCap(m, 4);
    expect(evicted).toBe(6);
    expect(m.size).toBe(4);
    // The 6 oldest (0..5) are gone; the 4 newest (6..9) survive.
    expect([...m.keys()]).toEqual([6, 7, 8, 9]);
  });

  it("simulates a flood: a tight burst stays bounded at the cap", () => {
    const m = new Map<number, string>();
    for (let i = 0; i < 10000; i++) {
      m.set(i, `closure${i}`);
      enforceMapSizeCap(m, 256);
    }
    expect(m.size).toBe(256);
    expect(m.has(9999)).toBe(true); // newest kept
    expect(m.has(0)).toBe(false); // oldest evicted
  });

  it("maxSize 0 clears the map; negative is treated as 0", () => {
    const m = mapOf(3);
    expect(enforceMapSizeCap(m, 0)).toBe(3);
    expect(m.size).toBe(0);
    const m2 = mapOf(2);
    enforceMapSizeCap(m2, -5);
    expect(m2.size).toBe(0);
  });

  it("is a no-op on an empty map", () => {
    expect(enforceMapSizeCap(new Map(), 10)).toBe(0);
  });
});

describe("shouldEmitRapidPushState (#302)", () => {
  const THRESHOLD = 4;

  it("does not emit below the threshold (and re-arms the flag)", () => {
    expect(shouldEmitRapidPushState(1, THRESHOLD, false)).toEqual({ emit: false, emitted: false });
    expect(shouldEmitRapidPushState(3, THRESHOLD, true)).toEqual({ emit: false, emitted: false });
  });

  it("emits ONCE on the rising edge, then suppresses for the sustained burst", () => {
    // First call that reaches the threshold: emit.
    const first = shouldEmitRapidPushState(4, THRESHOLD, false);
    expect(first).toEqual({ emit: true, emitted: true });
    // Every subsequent above-threshold call while the flag is set: suppressed.
    expect(shouldEmitRapidPushState(5, THRESHOLD, true)).toEqual({ emit: false, emitted: true });
    expect(shouldEmitRapidPushState(99, THRESHOLD, true)).toEqual({ emit: false, emitted: true });
  });

  it("re-arms after the burst subsides so a new burst emits again", () => {
    // Burst ends (count drops below threshold) -> flag clears.
    const subsided = shouldEmitRapidPushState(2, THRESHOLD, true);
    expect(subsided).toEqual({ emit: false, emitted: false });
    // New burst -> rising edge emits again.
    expect(shouldEmitRapidPushState(4, THRESHOLD, false)).toEqual({ emit: true, emitted: true });
  });

  it("a 100-call flood produces exactly one emission", () => {
    let flag = false;
    let emissions = 0;
    let count = 0;
    for (let i = 0; i < 100; i++) {
      count = Math.min(count + 1, 10); // windowed count stays >= threshold during the flood
      const d = shouldEmitRapidPushState(count, THRESHOLD, flag);
      flag = d.emitted;
      if (d.emit) emissions++;
    }
    expect(emissions).toBe(1);
  });
});
