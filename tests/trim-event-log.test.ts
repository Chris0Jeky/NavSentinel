import { describe, expect, it } from "vitest";
import { trimEventLog } from "../extension/src/shared/storage";
import type { EventLogEntry } from "../extension/src/shared/storage";

const ev = (id: string, kind: EventLogEntry["kind"], ts: number): EventLogEntry => ({ id, ts, kind });

describe("trimEventLog (#236 protected-tail eviction)", () => {
  it("returns the log unchanged when at or under the limit", () => {
    const log = [ev("a", "nav_click_block", 1), ev("b", "nav_silent_allow", 2)];
    expect(trimEventLog(log, 5)).toEqual(log);
    expect(trimEventLog(log, 2)).toEqual(log);
  });

  it("evicts the oldest silent-decision events first, preserving loud events", () => {
    const log = [
      ev("loud1", "nav_click_block", 1),
      ev("silent1", "nav_silent_allow", 2),
      ev("silent2", "cred_form_evaluated", 3),
      ev("loud2", "cred_submit_prompt", 4),
    ];
    // limit 3 → drop 1: the oldest silent (silent1); both loud events survive.
    expect(trimEventLog(log, 3).map((e) => e.id)).toEqual(["loud1", "silent2", "loud2"]);
  });

  it("never evicts a loud event while any silent event remains droppable", () => {
    const log = [
      ev("loud1", "nav_click_block", 1),
      ev("silent1", "nav_silent_allow", 2),
      ev("silent2", "nav_silent_allow", 3),
      ev("silent3", "nav_silent_allow", 4),
    ];
    // limit 1: must drop 3; all three are silent → loud1 survives.
    expect(trimEventLog(log, 1).map((e) => e.id)).toEqual(["loud1"]);
  });

  it("falls back to trimming oldest loud events only when loud alone exceeds the cap", () => {
    const log = [
      ev("loud1", "nav_click_block", 1),
      ev("loud2", "nav_click_block", 2),
      ev("loud3", "nav_click_block", 3),
    ];
    expect(trimEventLog(log, 2).map((e) => e.id)).toEqual(["loud2", "loud3"]);
  });

  it("matches plain FIFO when the log is all loud (existing behavior preserved)", () => {
    const log = Array.from({ length: 5 }, (_, i) => ev(`l${i}`, "nav_click_block", i));
    expect(trimEventLog(log, 3).map((e) => e.id)).toEqual(["l2", "l3", "l4"]);
  });

  it("drops corrupted entries before trimming", () => {
    const log = [
      null,
      ev("silent1", "nav_silent_allow", 1),
      undefined,
      ev("loud1", "nav_click_block", 2),
    ] as unknown as EventLogEntry[];

    expect(trimEventLog(log, 3).map((e) => e.id)).toEqual(["silent1", "loud1"]);
  });

  it("does not let corrupted rows displace loud events", () => {
    const log = [
      ev("loud1", "nav_click_block", 1),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `bad-${i}` })),
      ev("silent1", "nav_silent_allow", 2),
      ev("loud2", "nav_click_block", 3),
    ] as unknown as EventLogEntry[];

    expect(trimEventLog(log, 2).map((e) => e.id)).toEqual(["loud1", "loud2"]);
  });
});
