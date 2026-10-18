import { describe, expect, it } from "vitest";
import { filterEvidence, projectEvidence } from "../extension/src/evidence/evidence_model";
import type { EventLogEntry } from "../extension/src/shared/storage";

const event = (patch: Partial<EventLogEntry> = {}): EventLogEntry => ({
  id: "private-correlation-id",
  ts: 1_700_000_000_000,
  kind: "nav_click_block",
  site: "example.com",
  ...patch,
});

const rows = () =>
  projectEvidence([
    event({ ts: 1_700_000_000_000, site: "example.com" }),
    event({ ts: 1_700_000_000_001, kind: "cred_submit_prompt", site: "other.test" }),
  ]);

describe("filterEvidence null query", () => {
  it("treats null/undefined as empty without throwing", () => {
    const events = rows();
    const expected = filterEvidence(events, "", "all", false);
    expect(() => filterEvidence(events, null, "all", false)).not.toThrow();
    expect(() => filterEvidence(events, undefined, "all", false)).not.toThrow();
    expect(filterEvidence(events, null, "all", false)).toEqual(expected);
    expect(filterEvidence(events, undefined, "all", false)).toEqual(expected);
  });

  it("treats empty query as no hostname filter", () => {
    const events = rows();
    expect(filterEvidence(events, "", "all", false)).toHaveLength(events.length);
  });
});
