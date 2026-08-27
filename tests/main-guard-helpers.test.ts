import { describe, expect, it } from "vitest";
import {
  enforceMapSizeCap,
  pruneTimestampWindow,
  shouldEmitRapidPushState,
  shouldEmitWithCooldown,
  gestureBranchEmissionBound,
} from "../extension/src/content/main_guard_helpers";
// The REAL production constants (not a mirror), so the #377/F1 invariant below fails CI if a
// future change to any of them would let the gesture branch flood the priority buffer.
import {
  PUSHSTATE_GESTURE_WINDOW_MS,
  PUSHSTATE_RAPID_WINDOW_MS,
  PUSHSTATE_RAPID_THRESHOLD,
  CLIPBOARD_WRITE_COOLDOWN_MS,
  MAX_PENDING_OUTBOUND,
  RESERVED_SCARCE_OUTBOUND_SLOTS,
} from "../extension/src/content/main_guard_constants";
// The real pre-bridge buffer + its real priority/floodable classifiers, so the #302
// composed regression below exercises the production queue policy, not a mirror of it.
import {
  OutboundQueue,
  isMainGuardAlertType,
  isFloodableAlertType,
} from "../extension/src/content/bridge_outbound";

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

  it("keeps nothing at cap === 0 (guards the slice(-0) → whole-array footgun) (#401)", () => {
    const now = 5000;
    const inWindow = [now, now, now];
    // slice(-0) would return the whole array; a zero cap must keep nothing.
    expect(pruneTimestampWindow(inWindow, now, 1000, 0)).toEqual([]);
  });

  it("keeps nothing at a negative cap (no front-slice) (#401)", () => {
    const now = 5000;
    // cap magnitude must differ from the array length: at cap === -length the old
    // slice(-cap) would coincidentally start past the end and also yield [], hiding
    // the bug. At cap = -1 the old code did slice(1) and kept the tail (non-empty),
    // so this input genuinely pins the guard's negative branch.
    expect(pruneTimestampWindow([now, now, now], now, 1000, -1)).toEqual([]);
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

describe("shouldEmitWithCooldown (#523)", () => {
  it("emits first, suppresses within the window, and re-emits after it", () => {
    expect(shouldEmitWithCooldown(5000, 0, CLIPBOARD_WRITE_COOLDOWN_MS)).toEqual({
      emit: true,
      lastEmitAt: 5000,
    });
    expect(shouldEmitWithCooldown(5500, 5000, CLIPBOARD_WRITE_COOLDOWN_MS)).toEqual({
      emit: false,
      lastEmitAt: 5000,
    });
    expect(shouldEmitWithCooldown(6000, 5000, CLIPBOARD_WRITE_COOLDOWN_MS)).toEqual({
      emit: true,
      lastEmitAt: 6000,
    });
  });

  it("uses one global anchor when clipboard API shapes alternate", () => {
    let last = 0;
    let emissions = 0;
    for (const now of [5000, 5000, 5000, 5500]) {
      const decision = shouldEmitWithCooldown(now, last, CLIPBOARD_WRITE_COOLDOWN_MS);
      last = decision.lastEmitAt;
      if (decision.emit) emissions++;
    }
    expect(emissions).toBe(1);
    const reemit = shouldEmitWithCooldown(6000, last, CLIPBOARD_WRITE_COOLDOWN_MS);
    expect(reemit.emit).toBe(true);
  });

  it("keeps benign and command-like writes in independent cooldown buckets", () => {
    let commandLikeLast = 0;
    let otherLast = 0;
    const emit = (now: number, looksLikeCommand: boolean) => {
      const decision = shouldEmitWithCooldown(
        now,
        looksLikeCommand ? commandLikeLast : otherLast,
        CLIPBOARD_WRITE_COOLDOWN_MS,
      );
      if (looksLikeCommand) commandLikeLast = decision.lastEmitAt;
      else otherLast = decision.lastEmitAt;
      return decision.emit;
    };

    expect(emit(5000, false)).toBe(true);
    expect(emit(5001, true)).toBe(true);
    expect(emit(5002, false)).toBe(false);
    expect(emit(5002, true)).toBe(false);

    commandLikeLast = 0;
    otherLast = 0;
    expect(emit(7000, true)).toBe(true);
    expect(emit(7001, false)).toBe(true);
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

  it("the production gesture-branch bound stays within the scarce-signal reservation", () => {
    const bound = gestureBranchEmissionBound(
      PUSHSTATE_GESTURE_WINDOW_MS,
      PUSHSTATE_RAPID_WINDOW_MS,
      PUSHSTATE_RAPID_THRESHOLD,
    );
    expect(bound).toBe(6);
    // (a) The gesture branch alone must not be able to fill the non-reserved priority
    // capacity — otherwise it could crowd out OTHER (non-reserved) priority alerts.
    expect(bound).toBeLessThan(MAX_PENDING_OUTBOUND - RESERVED_SCARCE_OUTBOUND_SLOTS);
    // (b) The gesture branch (ns-pushstate-suspicious, a scarce signal) must also fit
    // WITHIN the scarce reservation, so that under a full floodable nav-flood it cannot
    // monopolize the reserved slots and starve the dblclick/js correlation signals. If
    // either assertion fails, a PUSHSTATE_* constant grew unsafely — re-tune it or raise
    // RESERVED_SCARCE_OUTBOUND_SLOTS. (#377/F1, F2)
    expect(bound).toBeLessThanOrEqual(RESERVED_SCARCE_OUTBOUND_SLOTS);
  });
});

describe("#302 composed: a rapid-pushState flood cannot drop a later ns-nav-blocked", () => {
  /**
   * Replays the production pre-bridge path end-to-end for the #302 attack: the rapid
   * branch of checkPushStateSuspicious (buffer cap + cooldown gate) feeding
   * postToIsolated, which enqueues into the SAME OutboundQueue shape main_guard builds
   * (real cap + reservation + real priority/floodable classifiers). The pieces are unit
   * tested individually above; this pins the composition, which is where the bug lived.
   *
   * `dedupe: false` reproduces the PRE-FIX emit-on-every-call behaviour, so the control
   * case below shows these assertions genuinely fail without the cooldown.
   */
  const replayFlood = (opts: { calls: number; stepMs: number; dedupe: boolean }) => {
    const queue = new OutboundQueue(MAX_PENDING_OUTBOUND, RESERVED_SCARCE_OUTBOUND_SLOTS);
    const post = (type: string) =>
      queue.enqueue({ type }, isMainGuardAlertType(type), isFloodableAlertType(type));
    const start = 5000;
    let timestamps: number[] = [];
    let lastEmitAt = 0;
    let alerts = 0;

    for (let i = 0; i < opts.calls; i++) {
      const now = start + i * opts.stepMs;
      timestamps = pruneTimestampWindow(
        [...timestamps, now],
        now,
        PUSHSTATE_RAPID_WINDOW_MS,
        PUSHSTATE_RAPID_THRESHOLD * 2,
      );
      if (timestamps.length < PUSHSTATE_RAPID_THRESHOLD) continue;
      let emit = true;
      if (opts.dedupe) {
        const decision = shouldEmitRapidPushState(now, lastEmitAt, PUSHSTATE_RAPID_WINDOW_MS);
        lastEmitAt = decision.lastEmitAt;
        emit = decision.emit;
      }
      if (!emit) continue;
      alerts++;
      post("ns-pushstate-suspicious");
    }

    // The blocked navigation the page triggers during the same pre-verification window.
    post("ns-nav-blocked");
    const { items, dropped } = queue.drain();
    return { alerts, items, dropped };
  };

  it("bounds the alerts for a 100-call synchronous flood to one per window", () => {
    // All 100 calls share one instant, so the whole burst is a single rapid window.
    expect(replayFlood({ calls: 100, stepMs: 0, dedupe: true }).alerts).toBe(1);
  });

  it("delivers the later ns-nav-blocked once the bridge opens, with nothing dropped", () => {
    const { items, dropped } = replayFlood({ calls: 100, stepMs: 0, dedupe: true });
    expect(items.filter((m) => m.type === "ns-nav-blocked")).toHaveLength(1);
    expect(dropped).toBe(0);
  });

  it("still reports a genuine sustained flood (re-alerting per window), block still delivered", () => {
    // 300 calls 10ms apart = 3s of sustained rapid pushState, the full pre-bridge window.
    const { alerts, items } = replayFlood({ calls: 300, stepMs: 10, dedupe: true });
    // The signal is collapsed per window, NOT suppressed: one alert per elapsed cooldown.
    expect(alerts).toBeGreaterThanOrEqual(3);
    expect(alerts).toBeLessThanOrEqual(4);
    expect(items.some((m) => m.type === "ns-nav-blocked")).toBe(true);
  });

  it("control: without the cooldown the flood saturates the queue and the block is lost", () => {
    const { alerts, items, dropped } = replayFlood({ calls: 100, stepMs: 0, dedupe: false });
    // One alert per call past the 4-call threshold — the pre-fix behaviour.
    expect(alerts).toBe(100 - (PUSHSTATE_RAPID_THRESHOLD - 1));
    // ns-pushstate-suspicious is priority-but-scarce, so it is not floodable-capped: it
    // fills every slot, and the later (also priority) ns-nav-blocked finds no routine
    // message to displace and is dropped — exactly the #302 detection loss.
    expect(items).toHaveLength(MAX_PENDING_OUTBOUND);
    expect(items.some((m) => m.type === "ns-nav-blocked")).toBe(false);
    expect(dropped).toBeGreaterThan(0);
  });
});

describe("#523 composed: clipboard-write flood cannot drop a later ns-nav-blocked", () => {
  const replayClipboardFlood = (opts: {
    calls: number;
    stepMs: number;
    cooldown: boolean;
  }) => {
    const queue = new OutboundQueue(MAX_PENDING_OUTBOUND, RESERVED_SCARCE_OUTBOUND_SLOTS);
    const post = (type: string) =>
      queue.enqueue({ type }, isMainGuardAlertType(type), isFloodableAlertType(type));
    const start = 5000;
    let otherLastEmitAt = 0;
    let alerts = 0;

    for (let i = 0; i < opts.calls; i++) {
      const now = start + i * opts.stepMs;
      let emit = true;
      if (opts.cooldown) {
        // This replay uses the non-command bucket. Production owns a second,
        // independent command-like bucket so a benign write cannot hide a
        // higher-risk transition while either bucket stays bounded.
        const decision = shouldEmitWithCooldown(
          now,
          otherLastEmitAt,
          CLIPBOARD_WRITE_COOLDOWN_MS,
        );
        otherLastEmitAt = decision.lastEmitAt;
        emit = decision.emit;
      }
      if (!emit) continue;
      alerts++;
      post("ns-clipboard-write");
    }

    // Model a blocked navigation arriving before bridge verification completes.
    post("ns-nav-blocked");
    const { items, dropped } = queue.drain();
    return { alerts, items, dropped };
  };

  it("collapses a synchronous clipboard flood to one alert", () => {
    expect(replayClipboardFlood({ calls: 100, stepMs: 0, cooldown: true }).alerts).toBe(1);
  });

  it("preserves a later ns-nav-blocked with zero drops", () => {
    const { items, dropped } = replayClipboardFlood({ calls: 100, stepMs: 0, cooldown: true });
    expect(items.filter((m) => m.type === "ns-nav-blocked")).toHaveLength(1);
    expect(dropped).toBe(0);
  });

  it("re-alerts at a bounded rate during a sustained pre-bridge flood and preserves the block", () => {
    const { alerts, items, dropped } = replayClipboardFlood({
      calls: 300,
      stepMs: 10,
      cooldown: true,
    });
    expect(alerts).toBeGreaterThanOrEqual(3);
    expect(alerts).toBeLessThanOrEqual(4);
    expect(items.some((m) => m.type === "ns-nav-blocked")).toBe(true);
    expect(dropped).toBe(0);
  });

  it("control: without cooldown fills the queue and loses the block", () => {
    const { alerts, items, dropped } = replayClipboardFlood({
      calls: 100,
      stepMs: 0,
      cooldown: false,
    });
    expect(alerts).toBe(100);
    expect(items).toHaveLength(MAX_PENDING_OUTBOUND);
    expect(items.some((m) => m.type === "ns-nav-blocked")).toBe(false);
    expect(dropped).toBeGreaterThan(0);
  });
});
