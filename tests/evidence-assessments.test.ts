import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { readEventAssessment } from "../extension/src/shared/event_assessment";
import { projectProtection, summarizeProtection } from "../extension/src/evidence/protection_model";
import { MAX_EVIDENCE_EXPORT_BYTES, prepareReviewExport } from "../extension/src/evidence/evidence_export";
import { MAX_EVIDENCE_EVENTS } from "../extension/src/evidence/evidence_model";

const lab = createRequire(import.meta.url)("../experiments/vision-lab/shared/evidence.js") as { parseImport(text: string): unknown };
const entry = { id: "private-id", ts: 1000, kind: "nav_click_block", site: "private.test", url: "https://private.test/token?secret=yes",
  destHost: "target.test", score: 42, reasons: ["no_accessible_name", "IP_HOST", "secret"], extra: { value: "private" },
  assessment: { kind: "should-block", ts: 2000, text: "private comment" } };

describe("separate local assessments and explicit review export", () => {
  it("preserves observed facts and row identity when an opinion changes", () => {
    const first = projectProtection([entry]).events[0]!;
    const next = projectProtection([{ ...entry, assessment: { kind: "should-allow", ts: 3000 } }]).events[0]!;
    expect(first.id).toBe(next.id);
    expect(first.record).not.toBe(next.record);
    expect(first.outcome).toBe("recorded");
    expect(summarizeProtection([first], "history", new Date(4000))).toEqual(summarizeProtection([next], "history", new Date(4000)));
    expect(first.assessment).toEqual({ kind: "should-block", ts: 2000 });
    expect(projectProtection([{ ...entry, assessment: { kind: "private", ts: 2000 } }]).events[0]?.assessment).toBeUndefined();
  });

  it("exports only assessed portable rows, strips private fields and imports in the existing Lab", () => {
    const events = projectProtection([entry, { ...entry, id: "unassessed", assessment: undefined },
      { ...entry, id: "journal-only", kind: "fullscreen_locker_exit" }]).events;
    const snapshot = prepareReviewExport(events, new Date(4000));
    const payload = JSON.parse(snapshot.text);
    expect(payload.events).toEqual([{ id: "event-1", timestamp: "1970-01-01T00:00:01.000Z", kind: "nav_click_block", sourceSite: null,
      destinationSite: null, outcome: "recorded", reasons: ["no_accessible_name"] }]);
    expect(payload.corrections).toEqual([{ eventId: "event-1", kind: "should-block", timestamp: "1970-01-01T00:00:02.000Z" }]);
    expect(snapshot.text).not.toMatch(/private|secret|score|IP_HOST|target.test|journal-only/);
    expect(lab.parseImport(snapshot.text)).toEqual(payload);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("bounds records and rejects hostile assessment timestamps", () => {
    for (const ts of [NaN, Infinity, -1, 1e30, 1.5]) expect(readEventAssessment({ kind: "should-block", ts })).toBeUndefined();
    const row = projectProtection([entry]).events[0]!;
    const payload = JSON.parse(prepareReviewExport(Array(MAX_EVIDENCE_EVENTS + 2).fill(row), new Date(4000)).text);
    expect(payload.events).toHaveLength(MAX_EVIDENCE_EVENTS);
    expect(payload.corrections.at(-1).eventId).toBe(`event-${MAX_EVIDENCE_EVENTS}`);
  });

  it("enforces the same exact byte ceiling on review packages", () => {
    const events = projectProtection([entry]).events;
    const original = prepareReviewExport(events, new Date(4000)).text;
    const stringify = vi.spyOn(JSON, "stringify").mockReturnValueOnce(original.padEnd(MAX_EVIDENCE_EXPORT_BYTES, " "));
    try {
      expect(prepareReviewExport(events, new Date(4000)).bytes).toBe(MAX_EVIDENCE_EXPORT_BYTES);
      stringify.mockReturnValueOnce(original.padEnd(MAX_EVIDENCE_EXPORT_BYTES + 1, " "));
      expect(() => prepareReviewExport(events, new Date(4000))).toThrow("exceeds 8 MiB");
    } finally { stringify.mockRestore(); }
  });
});
