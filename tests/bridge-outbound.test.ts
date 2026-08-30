import { describe, expect, it } from "vitest";
import {
  OutboundQueue,
  coalesceKeyForMainGuardMessage,
  isMainGuardAlertType,
  isFloodableAlertType,
  type OutboundMessage,
} from "../extension/src/content/bridge_outbound";
import {
  MAX_PENDING_OUTBOUND,
  RESERVED_SCARCE_OUTBOUND_SLOTS,
} from "../extension/src/content/main_guard_constants";

const msg = (type: string, payload?: Record<string, unknown>): OutboundMessage =>
  payload !== undefined ? { type, payload } : { type };

describe("OutboundQueue (D-BRIDGE: pre-verification bridge buffer)", () => {
  it("retains all messages in order while under capacity", () => {
    const q = new OutboundQueue(4);
    q.enqueue(msg("a"));
    q.enqueue(msg("b"));
    q.enqueue(msg("c"));

    expect(q.size).toBe(3);
    expect(q.droppedCount).toBe(0);

    const { items, dropped } = q.drain();
    expect(items.map((m) => m.type)).toEqual(["a", "b", "c"]);
    expect(dropped).toBe(0);
  });

  it("preserves the EARLIEST messages and drops the newest overflow", () => {
    const q = new OutboundQueue(3);
    // 5 messages into a cap-3 queue.
    for (const t of ["onset", "second", "third", "noise1", "noise2"]) {
      q.enqueue(msg(t));
    }

    expect(q.size).toBe(3);
    expect(q.droppedCount).toBe(2);

    const { items, dropped } = q.drain();
    // Regression guard for the original bug: the OLD policy dropped the oldest,
    // evicting "onset" (the attack-onset signal). The fix keeps it.
    expect(items.map((m) => m.type)).toEqual(["onset", "second", "third"]);
    expect(dropped).toBe(2);
  });

  it("a flood of post-onset noise cannot evict the first alert", () => {
    const q = new OutboundQueue(32);
    q.enqueue(msg("ns-nav-blocked", { id: "1" }));
    for (let i = 0; i < 1000; i++) {
      q.enqueue(msg("noise", { i }));
    }

    const { items, dropped } = q.drain();
    expect(items[0]).toEqual({ type: "ns-nav-blocked", payload: { id: "1" } });
    expect(items.length).toBe(32);
    expect(dropped).toBe(1000 - 31); // 969 newest dropped
  });

  it("drain resets size and dropped count", () => {
    const q = new OutboundQueue(2);
    q.enqueue(msg("a"));
    q.enqueue(msg("b"));
    q.enqueue(msg("c")); // dropped

    q.drain();
    expect(q.size).toBe(0);
    expect(q.droppedCount).toBe(0);

    const again = q.drain();
    expect(again.items).toEqual([]);
    expect(again.dropped).toBe(0);
  });

  it("preserves message payloads exactly", () => {
    const q = new OutboundQueue(8);
    q.enqueue(msg("ns-dblclick-second-click", { ts: 123, firstClickTs: 100 }));
    q.enqueue(msg("ns-bridge-ready"));

    const { items } = q.drain();
    expect(items[0]).toEqual({
      type: "ns-dblclick-second-click",
      payload: { ts: 123, firstClickTs: 100 }
    });
    expect(items[1]).toEqual({ type: "ns-bridge-ready" });
  });

  it("handles a zero/negative/non-finite capacity by dropping everything (no crash)", () => {
    const q = new OutboundQueue(0);
    q.enqueue(msg("a"));
    q.enqueue(msg("b"));
    expect(q.size).toBe(0);
    expect(q.droppedCount).toBe(2);

    const qn = new OutboundQueue(-5);
    qn.enqueue(msg("a"));
    expect(qn.size).toBe(0);
    expect(qn.droppedCount).toBe(1);

    // NaN cap must not leave the queue effectively unbounded (Math.floor(NaN)=NaN
    // would make `length < cap` always false).
    const qnan = new OutboundQueue(Number.NaN);
    qnan.enqueue(msg("a"));
    qnan.enqueue(msg("b"));
    expect(qnan.size).toBe(0);
    expect(qnan.droppedCount).toBe(2);
  });
});

describe("OutboundQueue priority (D-BRIDGE R2: alerts survive routine pressure)", () => {
  it("a buffered alert is never evicted by a flood of routine traffic", () => {
    const q = new OutboundQueue(4);
    q.enqueue(msg("ns-nav-blocked", { id: "alert" }), true); // priority
    for (let i = 0; i < 100; i++) q.enqueue(msg("ns-ping", { i })); // routine flood

    const { items } = q.drain();
    expect(items.some((m) => m.type === "ns-nav-blocked")).toBe(true);
  });

  it("a late alert is admitted by displacing the oldest routine message", () => {
    const q = new OutboundQueue(3);
    // Pre-fill with routine noise (the drop-newest weakness this defends).
    q.enqueue(msg("noise1"));
    q.enqueue(msg("noise2"));
    q.enqueue(msg("noise3"));
    // A real alert arrives after the buffer is already full.
    q.enqueue(msg("ns-dblclick-second-click", { ts: 1 }), true);

    const { items, dropped } = q.drain();
    expect(items.some((m) => m.type === "ns-dblclick-second-click")).toBe(true);
    expect(dropped).toBe(1); // one routine displaced
    expect(items.length).toBe(3);
  });

  it("routine messages cannot displace each other once full (earliest kept)", () => {
    const q = new OutboundQueue(2);
    q.enqueue(msg("a"));
    q.enqueue(msg("b"));
    q.enqueue(msg("c")); // routine, full → dropped

    const { items, dropped } = q.drain();
    expect(items.map((m) => m.type)).toEqual(["a", "b"]);
    expect(dropped).toBe(1);
  });

  it("when full of alerts, the earliest alerts are kept and a new one is dropped", () => {
    const q = new OutboundQueue(2);
    q.enqueue(msg("alert1"), true);
    q.enqueue(msg("alert2"), true);
    q.enqueue(msg("alert3"), true); // all-alert overflow → dropped

    const { items, dropped } = q.drain();
    expect(items.map((m) => m.type)).toEqual(["alert1", "alert2"]);
    expect(dropped).toBe(1);
  });
});

describe("OutboundQueue floodable reservation (#377/F2)", () => {
  it("caps a floodable ns-nav-blocked flood at cap - reserved, keeping room for scarce alerts", () => {
    const q = new OutboundQueue(32, 4); // 4 slots reserved for scarce signals
    // Synchronous flood of 100 blocked navigations (floodable priority).
    for (let i = 0; i < 100; i++) q.enqueue(msg("ns-nav-blocked", { i }), true, true);
    // A scarce once-per-event signal arrives AFTER the flood.
    q.enqueue(msg("ns-dblclick-second-click", { ts: 1 }), true, false);

    const { items } = q.drain();
    // The scarce dblclick signal survives — pre-fix the all-priority buffer dropped it.
    expect(items.some((m) => m.type === "ns-dblclick-second-click")).toBe(true);
    // Floodable telemetry is bounded to cap - reserved.
    expect(items.filter((m) => m.type === "ns-nav-blocked").length).toBe(28);
  });

  it("an allowed-nav flood (ns-nav-allowed + ns-allow-target-nav relay) cannot crowd out a scarce alert", () => {
    const q = new OutboundQueue(32, 4);
    // Each allowed nav emits BOTH the telemetry and its companion relay; both are floodable.
    for (let i = 0; i < 50; i++) {
      q.enqueue(msg("ns-nav-allowed", { i }), true, true);
      q.enqueue(msg("ns-allow-target-nav", { i }), true, true);
    }
    q.enqueue(msg("ns-dblclick-second-click", { ts: 1 }), true, false);

    const { items } = q.drain();
    expect(items.some((m) => m.type === "ns-dblclick-second-click")).toBe(true);
    // Combined floodable (both per-nav message types) is bounded to cap - reserved.
    const floodable = items.filter(
      (m) => m.type === "ns-nav-allowed" || m.type === "ns-allow-target-nav"
    ).length;
    expect(floodable).toBe(28);
  });

  it("does not suppress floodable alerts below the cap (no over-suppression)", () => {
    const q = new OutboundQueue(32, 4);
    for (let i = 0; i < 10; i++) q.enqueue(msg("ns-nav-blocked", { i }), true, true);
    const { items, dropped } = q.drain();
    expect(items.length).toBe(10);
    expect(dropped).toBe(0);
  });

  it("a non-floodable priority alert may still fill all slots (reservation only bounds floodable)", () => {
    const q = new OutboundQueue(8, 4);
    // 8 distinct scarce priority signals — none floodable — may use every slot.
    for (let i = 0; i < 8; i++) q.enqueue(msg(`ns-js-signal-${i}`, { i }), true, false);
    const { items, dropped } = q.drain();
    expect(items.length).toBe(8);
    expect(dropped).toBe(0);
  });

  it("drain resets the floodable count so a second pre-bridge window starts clean", () => {
    const q = new OutboundQueue(8, 2); // floodable capped at 6
    for (let i = 0; i < 10; i++) q.enqueue(msg("ns-nav-blocked", { i }), true, true);
    expect(q.drain().items.length).toBe(6);
    // Second batch must again admit up to 6 (count was reset, not stuck at 10).
    for (let i = 0; i < 10; i++) q.enqueue(msg("ns-nav-blocked", { i }), true, true);
    expect(q.drain().items.length).toBe(6);
  });

  it("reservation is a no-op when reservedForScarce defaults to 0 (back-compat)", () => {
    const q = new OutboundQueue(4); // no reserved arg
    // Floodable priority can use all 4 slots, evicting routine if needed — old behavior.
    q.enqueue(msg("noise"), false, false);
    for (let i = 0; i < 4; i++) q.enqueue(msg("ns-nav-blocked", { i }), true, true);
    const { items } = q.drain();
    expect(items.filter((m) => m.type === "ns-nav-blocked").length).toBe(4);
    expect(items.some((m) => m.type === "noise")).toBe(false); // routine displaced
  });
});

describe("#523 clipboard-pressure malicious baseline", () => {
  it("records HARM_REACHED when clipboard alerts starve a later critical receipt", () => {
    const queue = new OutboundQueue(MAX_PENDING_OUTBOUND, RESERVED_SCARCE_OUTBOUND_SLOTS);

    for (let index = 0; index < 64; index++) {
      queue.enqueue(
        msg("ns-clipboard-write", {
          ts: index,
          contentLength: 32,
          looksLikeCommand: false,
        }),
        true,
        false,
      );
    }
    queue.enqueue(msg("ns-nav-blocked", { id: "critical-after-flood" }), true, true);

    const { items, dropped } = queue.drain();
    const receipt = {
      outcome: items.some((item) => item.payload?.id === "critical-after-flood")
        ? "BLOCKED_PRE_HARM"
        : "HARM_REACHED",
      syntheticClipboardAlerts: 64,
      deliveredClipboardAlerts: items.filter((item) => item.type === "ns-clipboard-write").length,
      criticalReceiptDelivered: items.some(
        (item) => item.type === "ns-nav-blocked" && item.payload?.id === "critical-after-flood",
      ),
      dropped,
    } as const;

    expect(receipt).toEqual({
      outcome: "HARM_REACHED",
      syntheticClipboardAlerts: 64,
      deliveredClipboardAlerts: MAX_PENDING_OUTBOUND,
      criticalReceiptDelivered: false,
      dropped: 65 - MAX_PENDING_OUTBOUND,
    });
  });
});

describe("#523 clipboard-pressure protected, benign, and mixed contracts", () => {
  const enqueueMainGuard = (queue: OutboundQueue, message: OutboundMessage) => {
    queue.enqueue(
      message,
      isMainGuardAlertType(message.type),
      isFloodableAlertType(message.type),
      coalesceKeyForMainGuardMessage(message),
    );
  };

  it("coalesces unverified clipboard alerts by risk shape and retains the latest metadata", () => {
    const queue = new OutboundQueue(MAX_PENDING_OUTBOUND, RESERVED_SCARCE_OUTBOUND_SLOTS);
    for (const [ts, looksLikeCommand] of [
      [1, false],
      [2, true],
      [3, false],
      [4, true],
    ] as const) {
      enqueueMainGuard(queue, msg("ns-clipboard-write", {
        ts,
        contentLength: ts * 10,
        looksLikeCommand,
      }));
    }

    const { items, dropped, coalesced } = queue.drain();
    expect(items).toEqual([
      msg("ns-clipboard-write", { ts: 3, contentLength: 30, looksLikeCommand: false }),
      msg("ns-clipboard-write", { ts: 4, contentLength: 40, looksLikeCommand: true }),
    ]);
    expect(dropped).toBe(0);
    expect(coalesced).toBe(2);
  });

  it("records BLOCKED_PRE_HARM when a protected clipboard flood preserves the critical receipt", () => {
    const queue = new OutboundQueue(MAX_PENDING_OUTBOUND, RESERVED_SCARCE_OUTBOUND_SLOTS);
    for (let index = 0; index < 64; index++) {
      enqueueMainGuard(queue, msg("ns-clipboard-write", {
        ts: index,
        contentLength: 32 + index,
        looksLikeCommand: index % 2 === 1,
      }));
    }
    enqueueMainGuard(queue, msg("ns-nav-blocked", { id: "critical-after-flood" }));

    const { items, dropped, coalesced } = queue.drain();
    const receipt = {
      outcome: items.some((item) => item.payload?.id === "critical-after-flood")
        ? "BLOCKED_PRE_HARM"
        : "HARM_REACHED",
      syntheticClipboardAlerts: 64,
      deliveredClipboardAlerts: items.filter((item) => item.type === "ns-clipboard-write").length,
      criticalReceiptDelivered: items.some(
        (item) => item.type === "ns-nav-blocked" && item.payload?.id === "critical-after-flood",
      ),
      dropped,
      coalesced,
    } as const;

    expect(receipt).toEqual({
      outcome: "BLOCKED_PRE_HARM",
      syntheticClipboardAlerts: 64,
      deliveredClipboardAlerts: 2,
      criticalReceiptDelivered: true,
      dropped: 0,
      coalesced: 62,
    });
  });

  it("keeps a benign clipboard burst usable while a later scarce signal survives mixed pressure", () => {
    const queue = new OutboundQueue(MAX_PENDING_OUTBOUND, RESERVED_SCARCE_OUTBOUND_SLOTS);
    let successfulNativeWrites = 0;
    for (let index = 0; index < 80; index++) {
      successfulNativeWrites++;
      enqueueMainGuard(queue, msg("ns-clipboard-write", {
        ts: index,
        contentLength: 6,
        looksLikeCommand: false,
      }));
    }
    for (let index = 0; index < 100; index++) {
      enqueueMainGuard(queue, msg("ns-nav-allowed", { index }));
    }
    enqueueMainGuard(queue, msg("ns-dblclick-second-click", { id: "mixed-critical" }));

    const { items } = queue.drain();
    expect(successfulNativeWrites).toBe(80);
    expect(items.filter((item) => item.type === "ns-clipboard-write")).toHaveLength(1);
    expect(items.filter((item) => item.type === "ns-nav-allowed")).toHaveLength(
      MAX_PENDING_OUTBOUND - RESERVED_SCARCE_OUTBOUND_SLOTS,
    );
    expect(items).toContainEqual(msg("ns-dblclick-second-click", { id: "mixed-critical" }));
  });

  it("keeps one bounded clipboard budget across repeated unverified handshake attempts", () => {
    const queue = new OutboundQueue(MAX_PENDING_OUTBOUND, RESERVED_SCARCE_OUTBOUND_SLOTS);
    for (let retry = 0; retry < 4; retry++) {
      for (let index = 0; index < 32; index++) {
        enqueueMainGuard(queue, msg("ns-clipboard-write", {
          ts: retry * 32 + index,
          contentLength: index,
          looksLikeCommand: index % 2 === 0,
        }));
      }
      // A failed handshake does not drain or replace the production queue.
      expect(queue.size).toBe(2);
    }

    enqueueMainGuard(queue, msg("ns-pushstate-suspicious", { id: "after-retries" }));
    expect(queue.drain().items).toContainEqual(
      msg("ns-pushstate-suspicious", { id: "after-retries" }),
    );
  });

  it("classifies a missing readiness receipt as TEST_INVALID", () => {
    const classify = (ready: boolean, criticalReceiptDelivered: boolean) => {
      if (!ready) return "TEST_INVALID";
      return criticalReceiptDelivered ? "BLOCKED_PRE_HARM" : "HARM_REACHED";
    };

    expect(classify(false, true)).toBe("TEST_INVALID");
  });

  it("bounds only clipboard alerts and derives no key from page-controlled values", () => {
    expect(coalesceKeyForMainGuardMessage(msg("ns-nav-blocked", {
      looksLikeCommand: true,
    }))).toBeUndefined();
    expect(coalesceKeyForMainGuardMessage(msg("ns-clipboard-write", {
      looksLikeCommand: false,
      content: "page-value-must-not-enter-the-key",
    }))).toBe("ns-clipboard-write:other");
    expect(coalesceKeyForMainGuardMessage(msg("ns-clipboard-write", {
      looksLikeCommand: true,
      content: "different-page-value",
    }))).toBe("ns-clipboard-write:command-like");
  });
});

describe("isFloodableAlertType (#377/F2)", () => {
  it("treats per-navigation telemetry AND the per-nav allow relay as floodable", () => {
    // ns-allow-target-nav accompanies every ns-nav-allowed, so an allowed-nav flood would
    // otherwise refill the buffer past the reservation via the uncapped relay.
    for (const t of ["ns-nav-blocked", "ns-nav-allowed", "ns-allow-target-nav"]) {
      expect(isFloodableAlertType(t)).toBe(true);
    }
  });

  it("treats scarce once-per-event correlation signals as NOT floodable", () => {
    for (const t of [
      "ns-dblclick-second-click", "ns-dblclick-window-open", "ns-pushstate-suspicious",
      "ns-js-exfil-network", "ns-clipboard-write",
    ]) {
      expect(isFloodableAlertType(t)).toBe(false);
    }
  });
});

describe("isMainGuardAlertType (main->isolated priority classification)", () => {
  it("treats detection signals as priority", () => {
    for (const t of ["ns-nav-blocked", "ns-nav-allowed", "ns-clipboard-write", "ns-pushstate-suspicious"]) {
      expect(isMainGuardAlertType(t)).toBe(true);
    }
  });

  it("treats the full DoubleClickjacking chain as priority (incl. the window-open precondition)", () => {
    for (const t of ["ns-dblclick-window-open", "ns-dblclick-opener-nav", "ns-dblclick-second-click"]) {
      expect(isMainGuardAlertType(t)).toBe(true);
    }
  });

  it("treats control relays (ns-allow*) as priority — a dropped pre-auth re-blocks an allowed nav", () => {
    for (const t of ["ns-allow-target-nav", "ns-allow", "ns-allow-once", "ns-allow-action"]) {
      expect(isMainGuardAlertType(t)).toBe(true);
    }
  });

  it("treats the compact verified UI-action relay as priority", () => {
    expect(isMainGuardAlertType("u")).toBe(true);
  });

  it("treats JS-behavior signals as priority", () => {
    for (const t of ["ns-js-exfil-network", "ns-js-credential-read", "ns-js-form-submit-suspicious"]) {
      expect(isMainGuardAlertType(t)).toBe(true);
    }
  });

  it("treats routine control/diagnostic messages as droppable", () => {
    for (const t of [
      "ns-config-ack", "ns-pong", "ns-bridge-ready", "ns-bridge-overflow",
      "ns-main-guard-ready", "ns-debug-nav-record",
    ]) {
      expect(isMainGuardAlertType(t)).toBe(false);
    }
  });
});
