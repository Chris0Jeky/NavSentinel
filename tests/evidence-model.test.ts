import { describe, expect, it } from "vitest";
import { createEvidenceExport, evidenceHostname, filterEvidence, MAX_EVIDENCE_EVENTS, projectEvidence, summarizeEvidence } from "../extension/src/evidence/evidence_model";
import type { EventLogEntry } from "../extension/src/shared/storage";

const event = (patch: Partial<EventLogEntry> = {}): EventLogEntry => ({
  id: "private-correlation-id", ts: 1_700_000_000_000, kind: "nav_click_block", site: "Example.COM", ...patch,
});
describe("minimized extension evidence", () => {
  it("projects only allowlisted fields and known reasons, never IDs, URL, extra or free text", () => {
    const output = projectEvidence([event({ url: "https://example.com/private?token=secret", extra: { password: "secret" }, reasons: ["no_accessible_name", "secret", "__proto__", "no_accessible_name"], destHost: "target.example", score: 42 })]);
    expect(output).toEqual([{ id: "event-1", timestamp: "2023-11-14T22:13:20.000Z", kind: "nav_click_block", sourceSite: "example.com", destinationSite: "target.example", outcome: "recorded", reasons: ["no_accessible_name"], score: 42 }]);
    expect(JSON.stringify(output)).not.toMatch(/secret|private|password|__proto__/);
  });
  it.each(["https://example.com", "user@example.com", "example.com/path", "example.com?secret", " example.com", "example.com:443", "a..com", "-a.com", "a-.com", "x".repeat(64) + ".com", "example.com\n"])("rejects non-host metadata %j", host => {
    expect(evidenceHostname(host)).toBeNull();
  });
  it("uses browser-associated page hostname and preserves unknown endpoints as null", () => {
    expect(projectEvidence([event({ pageSite: "TOP.EXAMPLE", destHost: "https://target.example/secret" })])[0]).toMatchObject({ sourceSite: "top.example", destinationSite: null });
  });
  it("rejects malformed records and omits non-finite/out-of-range scores", () => {
    const rows = projectEvidence([event({ ts: NaN }), event({ ts: 1e30 }), event({ kind: "invented" as EventLogEntry["kind"] }), ...[NaN, Infinity, -1, 101].map(score => event({ score })), event({ score: 0 })]);
    expect(rows).toHaveLength(5);
    expect(rows.slice(0, 4).every(row => row.score === undefined)).toBe(true);
    expect(rows[4]?.score).toBe(0);
  });
  it("bounds history and does not mutate stored entries", () => {
    const rows = Array.from({ length: MAX_EVIDENCE_EVENTS + 2 }, (_, i) => event({ ts: i }));
    const original = JSON.stringify(rows);
    const projected = projectEvidence(rows);
    expect(projected).toHaveLength(MAX_EVIDENCE_EVENTS);
    expect(projected[0]?.timestamp).toBe(new Date(2).toISOString());
    expect(JSON.stringify(rows)).toBe(original);
  });
  it("exports a fresh allowlist even when an intermediate event has extra fields", () => {
    const rows = projectEvidence([event()]);
    const result = createEvidenceExport([{ ...rows[0]!, url: "secret" } as typeof rows[number]], new Date(0));
    expect(result).toMatchObject({ format: "navsentinel-evidence", schema: 1, exportedAt: "1970-01-01T00:00:00.000Z", source: "navsentinel-extension", evidence: "recorded-observation" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("combines hostname/category/score filters, newest first, without claiming prevention", () => {
    const rows = projectEvidence([event({ score: 0 }), event({ kind: "cred_submit_prompt", destHost: "target.test", score: 50 }), event({ kind: "suite_config_update", site: "" })]);
    expect(filterEvidence(rows, "TARGET", "credential", true).map(row => row.kind)).toEqual(["cred_submit_prompt"]);
    expect(filterEvidence(rows, "", "all", false)[0]?.kind).toBe("suite_config_update");
    expect(filterEvidence(rows, "", "navigation", true)).toHaveLength(1);
    expect(summarizeEvidence(rows)).toEqual({ recorded: 3, scored: 2, sites: 2 });
    expect(rows.every(row => row.outcome === "recorded")).toBe(true);
  });
});
