import { describe, expect, it } from "vitest";
import { createEvidenceExport, evidenceHostname, filterEvidence, MAX_EVIDENCE_EVENTS, overlayReviewOutcomeLabel, projectEvidence, projectOverlayReviews, summarizeEvidence } from "../extension/src/evidence/evidence_model";
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

describe("overlay cleanup review queue (#591)", () => {
  const overlay = (patch: Partial<EventLogEntry> = {}): EventLogEntry => ({
    id: "private-id", ts: 1_700_000_000_000, kind: "mutation_alert", site: "source.test",
    url: "https://source.test/private?token=secret", reasons: ["overlay_injected"],
    extra: { details: "Overlay detected: position=fixed, z-index=10000", severity: "high", overlayCleanupOutcome: "suppressed", overlayDiag: { frame: "top", positionBucket: "fixed", coverageBucket: "half_to_full", stackingBucket: "topmost", retryCount: 2, readiness: "ready", error: "none" } }, ...patch,
  });
  it("projects finite outcomes, buckets, and labels without URLs, hostnames, details, or scores", () => {
    const items = projectOverlayReviews([overlay({ extra: { overlayCleanupOutcome: "budget_exhausted", overlayReviewLabel: "should_block", overlayDiag: { frame: "child", positionBucket: "fixed", coverageBucket: "quarter_to_half", stackingBucket: "high", retryCount: 128, readiness: "degraded", error: "none" } } })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ outcome: "budget_limited", frame: "child", positionBucket: "fixed", coverageBucket: "quarter_to_half", stackingBucket: "high", label: "should_block" });
    expect(overlayReviewOutcomeLabel(items[0]!.outcome)).toBe("Budget-limited");
    expect(JSON.stringify(items)).not.toMatch(/private-id|source\.test|https:\/\/|token=secret|details|severity/);
  });
  it("shows restored, reported misses, and observed lanes while ignoring hostile extras", () => {
    const hostile = { get frame() { throw new Error("hostile"); } } as unknown as Record<string, unknown>;
    const items = projectOverlayReviews([
      overlay({ id: "a", ts: 2, reasons: ["overlay_cleanup_undo"], extra: { overlayCleanupOutcome: "restored" } }),
      overlay({ id: "b", ts: 3, reasons: ["overlay_user_reported_miss"], extra: { overlayCleanupOutcome: "user_reported_miss" } }),
      overlay({ id: "c", ts: 4, reasons: ["overlay_detected"], extra: { overlayDiag: hostile } }),
      { id: "d", ts: 5, kind: "nav_click_block" } as EventLogEntry,
      overlay({ id: "e", ts: NaN, reasons: ["overlay_injected"] }),
    ]);
    expect(items.map((i) => i.outcome)).toEqual(["restored", "user_reported_miss", "observed"]);
    expect(items[2]).toMatchObject({ frame: "unknown", positionBucket: "unknown" });
    expect(items.every((i) => i.label === undefined)).toBe(true);
  });
  it("ignores invalid labels and caps hostile reason lists", () => {
    const items = projectOverlayReviews([overlay({ extra: { overlayCleanupOutcome: "suppressed", overlayReviewLabel: "__proto__", overlayDiag: { frame: "top" } }, reasons: ["overlay_injected", "<img>", "__proto__", "overlay_injected", "overlay_cleanup_undo", "form_action_changed", "password_injected", "suspicious_iframe", "overlay_detected", "overlay_user_reported_miss", "overlay_cleanup_setting_off"] })]);
    expect(items[0]!.label).toBeUndefined();
    expect(items[0]!.reasons).toHaveLength(5);
    expect(JSON.stringify(items[0])).not.toContain("<img>");
  });
  it("does not classify an imported finite outcome without an overlay reason", () => {
    const imported = overlay({ reasons: ["form_action_changed"], extra: { overlayCleanupOutcome: "suppressed" } });
    expect(projectOverlayReviews([imported])).toEqual([]);
  });
  it("covers every retained outcome and never mutates stored entries", () => {
    const log = [
      overlay({ id: "s1", ts: 1, reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "suppressed" } }),
      overlay({ id: "s2", ts: 2, reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "reasserted" } }),
      overlay({ id: "s3", ts: 3, reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "already_hidden" } }),
      overlay({ id: "s4", ts: 4, reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "budget_exhausted" } }),
      overlay({ id: "s5", ts: 5, reasons: ["overlay_cleanup_setting_off"], extra: {} }),
      overlay({ id: "s6", ts: 6, reasons: ["overlay_user_reported_miss"], extra: {} }),
      overlay({ id: "s7", ts: 7, reasons: ["overlay_detected"], extra: {} }),
      { id: "s8", ts: 8, kind: "nav_click_block" } as EventLogEntry,
    ];
    const before = JSON.stringify(log);
    expect(projectOverlayReviews(log).map((i) => i.outcome)).toEqual(["suppressed", "reasserted", "already_hidden", "budget_limited", "restored", "user_reported_miss", "observed"]);
    expect(JSON.stringify(log)).toBe(before);
  });
});
