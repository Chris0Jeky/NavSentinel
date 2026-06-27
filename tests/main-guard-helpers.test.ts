import { describe, expect, it } from "vitest";
import {
  enforceMapSizeCap,
  pruneTimestampWindow,
  shouldEmitRapidPushState,
  gestureBranchEmissionBound,
} from "../extension/src/content/main_guard_helpers";

// Mirror of the production PUSHSTATE_* constants in main_guard.ts and the OutboundQueue
// capacity in main_guard.ts. Kept here so the #377/F1 invariant test fails if a future
// constant change would let the gesture-branch flood the priority buffer. (#377/F1)
const PUSHSTATE_GESTURE_WINDOW_MS = 2000;
const PUSHSTATE_RAPID_WINDOW_MS = 1000;
const PUSHSTATE_RAPID_THRESHOLD = 4;
const MAX_PENDING_OUTBOUND = 32;
const RESERVED_SCARCE_OUTBOUND_SLOTS = 4;

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

describe("pruneTimestampWindow (#302)", () => {
  it("drops timestamps older than the window", () => {
    const now = 10_000;
    const out = pruneTimestampWindow([8000, 8999, 9000, 9500, 10_000], now, 1000, 100);
    // cutoff = 9000; 8000 and 8999 are dropped.
    expect(out).toEqual([9000, 9500, 10_000]);
  });

  it("caps the buffer to the most-recent `cap` (synchronous flood: all === now, none pruned)", () => {
    const now = 5000;
    const flood = Array.from({ length: 10_000 }, () => now); // all identical -> nothing pruned
    const out = pruneTimestampWindow(flood, now, 1000, 8);
    expect(out.length).toBe(8);
    expect(out.every((t) => t === now)).toBe(true);
  });

  it("returns empty when everything is outside the window", () => {
    expect(pruneTimestampWindow([1, 2, 3], 10_000, 1000, 8)).toEqual([]);
  });
});

describe("shouldEmitRapidPushState (#302)", () => {
  const COOLDOWN = 1000;

  it("emits on the first call (lastEmitAt 0) and records the time", () => {
    expect(shouldEmitRapidPushState(5000, 0, COOLDOWN)).toEqual({ emit: true, lastEmitAt: 5000 });
  });

  it("suppresses within the cooldown window, then re-emits once it elapses", () => {
    // 500ms after the last emit at 5000 -> still in cooldown -> suppressed (lastEmitAt unchanged).
    expect(shouldEmitRapidPushState(5500, 5000, COOLDOWN)).toEqual({ emit: false, lastEmitAt: 5000 });
    // Exactly one window later -> re-emit.
    expect(shouldEmitRapidPushState(6000, 5000, COOLDOWN)).toEqual({ emit: true, lastEmitAt: 6000 });
  });

  it("a sustained flood emits at a bounded rate (~once per window), not once per call", () => {
    let last = 0;
    let emissions = 0;
    // 1000 synchronous calls all at the same instant -> only the first emits.
    for (let i = 0; i < 1000; i++) {
      const d = shouldEmitRapidPushState(5000, last, COOLDOWN);
      last = d.lastEmitAt;
      if (d.emit) emissions++;
    }
    expect(emissions).toBe(1);
    // Over a 3s pre-bridge window, an ongoing flood emits at most ~3 (one per cooldown) —
    // far below the 32-slot queue, so ns-nav-blocked is never crowded out.
    let last2 = 0;
    let emissions2 = 0;
    for (let t = 5000; t < 8000; t += 10) {
      const d = shouldEmitRapidPushState(t, last2, COOLDOWN);
      last2 = d.lastEmitAt;
      if (d.emit) emissions2++;
    }
    expect(emissions2).toBeLessThanOrEqual(4);
  });
});

describe("gestureBranchEmissionBound (#377/F1)", () => {
  it("computes the ceil(window / spacing) bound for sample constants", () => {
    // 2000ms window, 3 events per 1000ms => 333.3ms spacing => ceil(2000/333.3) = 6.
    expect(gestureBranchEmissionBound(2000, 1000, 4)).toBe(6);
    // Wider gesture window raises the bound proportionally.
    expect(gestureBranchEmissionBound(4000, 1000, 4)).toBe(12);
    // A higher rapid threshold (more below-threshold events) raises it too.
    expect(gestureBranchEmissionBound(2000, 1000, 7)).toBe(12);
  });

  it("is 0 when the rapid threshold is 1 (no below-threshold events can fire the branch)", () => {
    expect(gestureBranchEmissionBound(2000, 1000, 1)).toBe(0);
  });

  it("returns +Infinity for a non-positive rapid window (guards a divide-by-zero)", () => {
    expect(gestureBranchEmissionBound(2000, 0, 4)).toBe(Number.POSITIVE_INFINITY);
    expect(gestureBranchEmissionBound(2000, Number.NaN, 4)).toBe(Number.POSITIVE_INFINITY);
  });

  it("the production gesture-branch bound stays well under the scarce-signal capacity", () => {
    const bound = gestureBranchEmissionBound(
      PUSHSTATE_GESTURE_WINDOW_MS,
      PUSHSTATE_RAPID_WINDOW_MS,
      PUSHSTATE_RAPID_THRESHOLD,
    );
    expect(bound).toBe(6);
    // The gesture branch emits ns-pushstate-suspicious, a SCARCE (non-floodable) signal.
    // It must never on its own approach the reservable priority capacity, or it could
    // crowd out other scarce signals. If this fails, a PUSHSTATE_* constant changed
    // unsafely — re-tune it or the buffer reservation. (#377/F1)
    expect(bound).toBeLessThan(MAX_PENDING_OUTBOUND - RESERVED_SCARCE_OUTBOUND_SLOTS);
  });
});
