import { describe, expect, it } from "vitest";
import { OutboundQueue, type OutboundMessage } from "../extension/src/content/bridge_outbound";

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

  it("handles a zero/negative capacity by dropping everything (no crash)", () => {
    const q = new OutboundQueue(0);
    q.enqueue(msg("a"));
    q.enqueue(msg("b"));
    expect(q.size).toBe(0);
    expect(q.droppedCount).toBe(2);

    const qn = new OutboundQueue(-5);
    qn.enqueue(msg("a"));
    expect(qn.size).toBe(0);
    expect(qn.droppedCount).toBe(1);
  });
});
