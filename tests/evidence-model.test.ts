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
  it("rejects malformed records and omits non-finite, negative and implausible scores", () => {
    const rows = projectEvidence([event({ ts: NaN }), event({ ts: 1e30 }), event({ kind: "invented" as EventLogEntry["kind"] }), ...[NaN, Infinity, -1, 1000.01, 5000].map(score => event({ score })), event({ score: 0 })]);
    expect(rows).toHaveLength(6);
    expect(rows.slice(0, 5).every(row => row.score === undefined)).toBe(true);
    expect(rows[5]?.score).toBe(0);
  });
  it("shows real scores above 100 as 100 instead of dropping them (#883)", () => {
    // computeNRS applies diminishing returns above 100 rather than clamping, so
    // the riskiest blocks journal scores such as 104. The popup gauge (#715)
    // clamps the same way, and the Lab importer accepts only 0-100.
    const rows = projectEvidence([100.01, 104, 150, 1000].map(score => event({ score })));
    expect(rows.map(row => row.score)).toEqual([100, 100, 100, 100]);
    expect(summarizeEvidence(rows).scored).toBe(4);
    expect(createEvidenceExport(rows, new Date(0)).events.map(row => row.score)).toEqual([100, 100, 100, 100]);
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
  it("strips journal-only codes on export while preserving the portable code", () => {
    const local = projectEvidence([event({ reasons: ["NON_HTTPS_PAGE", "IP_HOST", "no_accessible_name", "unrecognized-free-text-xyz"] })]);
    expect(local[0]?.reasons).toEqual(["NON_HTTPS_PAGE", "IP_HOST", "no_accessible_name"]);
    const result = createEvidenceExport(local, new Date(0));
    expect(result.events[0]?.reasons).toEqual(["no_accessible_name"]);
    expect(JSON.stringify(result)).not.toContain("NON_HTTPS_PAGE");
    expect(JSON.stringify(result)).not.toContain("IP_HOST");
    expect(JSON.stringify(result)).not.toContain("unrecognized-free-text-xyz");
  });
  it("exports empty reasons when only journal-only and unrecognized codes are present", () => {
    const local = projectEvidence([event({ reasons: ["NON_HTTPS_PAGE", "IP_HOST", "unrecognized-free-text-xyz"] })]);
    expect(local[0]?.reasons).toEqual(["NON_HTTPS_PAGE", "IP_HOST"]);
    const result = createEvidenceExport(local, new Date(0));
    expect(result.events[0]?.reasons).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("NON_HTTPS_PAGE");
    expect(JSON.stringify(result)).not.toContain("IP_HOST");
    expect(JSON.stringify(result)).not.toContain("unrecognized-free-text-xyz");
  });
});
