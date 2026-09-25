import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";
import { createEvidenceExport, evidenceHostname, filterEvidence, projectEvidence, type EvidenceExport } from "../extension/src/evidence/evidence_model";
import { MAX_EVIDENCE_EXPORT_BYTES, measureEvidenceExport, prepareEvidenceExport } from "../extension/src/evidence/evidence_export";
import { browserMajorFromUserAgent, createOverlayDiagnosticBundle, MAX_OVERLAY_DIAGNOSTIC_BYTES, measureOverlayDiagnosticExport, prepareOverlayDiagnosticExport, sanitizeBrowserMajor, sanitizeProductVersion } from "../extension/src/evidence/overlay_diagnostic_export";

const consumer = createRequire(resolve("package.json"))("./experiments/vision-lab/shared/evidence.js") as {
  parse(text: string): EvidenceExport;
};
const event = (ts: number, site: string): EventLogEntry => ({ id: "private-id", ts, kind: "nav_click_block", site });

describe("portable evidence hostname and ordering boundaries (#691, #689)", () => {
  it.each([
    ["[2001:0DB8:0:0:0:0:0:1]", "2001:db8::1"],
    ["2001:db8::1", "2001:db8::1"],
    ["::1", "::1"],
    ["::ffff:192.0.2.128", "::ffff:c000:280"],
    ["127.000.000.001", "127.0.0.1"],
    ["127.1", "127.0.0.1"],
    ["2130706433", "127.0.0.1"],
    ["0x7f000001", "127.0.0.1"],
    ["0x7f.0.0.1", "127.0.0.1"],
    ["1.2.3", "1.2.0.3"],
    ["PORTAL.Example.Test.", "portal.example.test"],
  ])("canonicalizes hostname-only metadata %s", (value, expected) => {
    expect(evidenceHostname(value)).toBe(expected);
  });

  it.each([
    "https://[::1]/private?token=secret", "[::1]:443", "[::1]/path", "::1?secret",
    "fe80::1%eth0", "1::2::3", "999.0.0.1", "4294967296", "0x100000000",
    "1.2.3.999", "example.999", "a.1", "08", "user@source.test", "source.test/private",
    " source.test", "source.test\n", "[source.test]", "", undefined, null,
  ])("never extracts hosts from malformed metadata %j", value => {
    expect(evidenceHostname(value)).toBeNull();
  });

  it("preserves IPv6 across the real extension-to-Lab/desktop file contract", () => {
    const rows = projectEvidence([{
      ...event(0, "legacy.test"), pageSite: "[2001:0DB8:0:0:0:0:0:1]",
      destHost: "::ffff:192.0.2.128", url: "https://legacy.test/private?secret",
    }]);
    const payload = createEvidenceExport(rows, new Date(0));
    expect(consumer.parse(JSON.stringify(payload))).toEqual(payload);
    expect(payload.events[0]).toMatchObject({ sourceSite: "2001:db8::1", destinationSite: "::ffff:c000:280" });
    expect(JSON.stringify(payload)).not.toMatch(/private|secret/);
  });

  it("sorts retained imported timestamps, keeps stable ties, and rejects invalid dates", () => {
    const rows = [event(3000, "late.test"), event(1000, "first.test"), event(NaN, "invalid.test"),
      event(2000, "middle.test"), event(1000, "tie.test"), event(1e30, "invalid.test")];
    const original = rows.slice();
    const projected = projectEvidence(rows);
    expect(projected.map(row => row.sourceSite)).toEqual(["first.test", "tie.test", "middle.test", "late.test"]);
    const view = filterEvidence(projected, "", "all", false);
    expect(view.map(row => row.sourceSite)).toEqual(["late.test", "middle.test", "tie.test", "first.test"]);
    const exported = createEvidenceExport(view.slice().reverse(), new Date(0));
    expect(exported.events.map(row => row.sourceSite)).toEqual(["first.test", "tie.test", "middle.test", "late.test"]);
    expect(rows).toEqual(original);
  });
});

describe("evidence UTF-8 byte limit and immutable snapshot (#689)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts exactly 8 MiB and rejects one byte more using bounded valid JSON", () => {
    const text = JSON.stringify(createEvidenceExport([], new Date(0))).padEnd(MAX_EVIDENCE_EXPORT_BYTES, " ");
    expect(measureEvidenceExport(text)).toBe(MAX_EVIDENCE_EXPORT_BYTES);
    expect(() => measureEvidenceExport(text + " ")).toThrow(RangeError);
    // Exercise the production prepare path, not just the measuring helper.
    vi.spyOn(JSON, "stringify").mockReturnValueOnce(text).mockReturnValueOnce(text + " ");
    expect(prepareEvidenceExport([], new Date(0)).bytes).toBe(MAX_EVIDENCE_EXPORT_BYTES);
    expect(() => prepareEvidenceExport([], new Date(0))).toThrow(/exceeds 8 MiB/);
  });

  it("counts UTF-8 bytes rather than UTF-16 code units", () => {
    const text = " ".repeat(MAX_EVIDENCE_EXPORT_BYTES - 2) + "é";
    expect(text.length).toBe(MAX_EVIDENCE_EXPORT_BYTES - 1);
    expect(measureEvidenceExport(text)).toBe(MAX_EVIDENCE_EXPORT_BYTES);
    expect(() => measureEvidenceExport(text + " ")).toThrow(RangeError);
  });

  it("freezes minimized chronological bytes independently of later source edits", () => {
    const source = projectEvidence([event(2000, "late.test"), event(1000, "early.test")]);
    const snapshot = prepareEvidenceExport(source, new Date(0));
    const reviewed = snapshot.text;
    source[0]!.sourceSite = "changed.test";
    source.reverse();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.text).toBe(reviewed);
    expect(snapshot.bytes).toBe(new Blob([reviewed]).size);
    expect(JSON.parse(reviewed).events.map((row: { sourceSite: string }) => row.sourceSite)).toEqual(["early.test", "late.test"]);
    expect(reviewed).not.toContain("private-id");
    expect(snapshot.filename).toBe("navsentinel-evidence-1970-01-01.json");
  });
});

describe("strict overlay diagnostic allowlist and sanitization (#591)", () => {
  const overlay = (patch: Partial<EventLogEntry> = {}): EventLogEntry => ({
    id: "private-id",
    ts: 1_700_000_000_000,
    kind: "mutation_alert",
    site: "synthetic.test",
    pageSite: "synthetic.test",
    url: "https://synthetic.test/private/path?token=secret#frag",
    destHost: "destination.test",
    score: 99,
    reasons: ["overlay_injected"],
    extra: {
      details: "Overlay detected: position=fixed, z-index=10000, coverage=55.5%",
      severity: "high",
      overlayReviewLabel: "should_block",
      overlayCleanupOutcome: "suppressed",
      overlayDiag: { frame: "top", positionBucket: "fixed", coverageBucket: "half_to_full", stackingBucket: "topmost", retryCount: 2, readiness: "ready", error: "none" },
      password: "secret",
      html: "<div>raw</div>",
      text: "element text",
      clipboard: "clipboard text",
      cookies: "cookie=value",
      body: "request body",
    },
    ...patch,
  });
  const context = { productVersion: "0.4.0", browserMajor: 141 };

  it("projects finite schema fields only, excluding identifiers, URLs, details, labels, and raw content", () => {
    const bundle = createOverlayDiagnosticBundle([overlay()], context, new Date(0));
    expect(bundle).toMatchObject({ format: "navsentinel-overlay-diagnostics", schema: 1, productVersion: "0.4.0", browserMajor: 141 });
    expect(bundle.records).toHaveLength(1);
    expect(Object.keys(bundle.records[0]!).sort()).toEqual(
      ["error", "frame", "geometryBucket", "outcome", "positionBucket", "readiness", "reasonCodes", "retryCount", "stackingBucket", "timestamp"].sort(),
    );
    expect(bundle.records[0]).toMatchObject({
      frame: "top", outcome: "suppressed", reasonCodes: ["overlay_injected"],
      positionBucket: "fixed", geometryBucket: "half_to_full", stackingBucket: "topmost",
      retryCount: 2, readiness: "ready", error: "none",
    });
    const text = JSON.stringify(bundle);
    expect(text).not.toMatch(/private-id|synthetic\.test|destination\.test|https:\/\/|token=secret|frag|password|secret|clipboard|cookie|request body|element text|<div>|severity|should_block|overlayReviewLabel|overlayDiag|extra|site|url|score/);
  });

  it("keeps only finite reason codes, capped and deduplicated", () => {
    const bundle = createOverlayDiagnosticBundle([
      overlay({ reasons: ["overlay_injected", "overlay_injected", "overlay_cleanup_undo", "form_action_changed", "password_injected", "suspicious_iframe", "overlay_detected", "overlay_user_reported_miss", "overlay_cleanup_setting_off", "extra-ninth"] }),
      overlay({ id: "x2", ts: 1_700_000_000_001, reasons: ["form_action_changed"], extra: { overlayCleanupOutcome: "suppressed" } }),
    ], context, new Date(0));
    expect(bundle.records[0]!.reasonCodes).toEqual(["overlay_injected", "overlay_cleanup_undo", "overlay_detected", "overlay_user_reported_miss", "overlay_cleanup_setting_off"]);
    expect(bundle.records).toHaveLength(1);
  });

  it("maps hostile frames, buckets, retries, readiness, and errors to safe finite defaults", () => {
    const bundle = createOverlayDiagnosticBundle([
      overlay({ extra: { overlayCleanupOutcome: "budget_exhausted", overlayDiag: { frame: "window", positionBucket: "static", geometryBucket: "huge", stackingBucket: -5, retryCount: 999, readiness: "loading", error: "boom" } } }),
      overlay({ id: "x2", ts: 1_700_000_000_001, extra: { overlayCleanupOutcome: "bogus", overlayDiag: "not-an-object" } }),
      overlay({ id: "x3", ts: 1_700_000_000_002, reasons: ["overlay_cleanup_undo"], extra: {} }),
    ], context, new Date(0));
    expect(bundle.records.map((r) => r.outcome)).toEqual(["budget_limited", "observed", "restored"]);
    expect(bundle.records[0]).toMatchObject({ frame: "unknown", positionBucket: "unknown", geometryBucket: "unknown", stackingBucket: "unknown", retryCount: 128, readiness: "unknown", error: "unknown" });
    expect(bundle.records[1]).toMatchObject({ frame: "unknown", retryCount: 0, readiness: "unknown", error: "unknown" });
  });

  it("sanitizes version and browser major, bounds records and strings, and never throws on hostile input", () => {
    expect(sanitizeProductVersion("0.4.0")).toBe("0.4.0");
    for (const hostile of ["", "  ", "<img>", "v1.0; rm", "a".repeat(33), 123, null, undefined, {}]) {
      expect(sanitizeProductVersion(hostile)).toBe("unknown");
    }
    expect(sanitizeBrowserMajor(141)).toBe(141);
    for (const hostile of [-1, 1000, NaN, Infinity, "141", null, undefined, {}]) {
      expect(sanitizeBrowserMajor(hostile)).toBe(0);
    }
    expect(browserMajorFromUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0")).toBe(141);
    expect(browserMajorFromUserAgent("not a ua")).toBe(0);
    expect(browserMajorFromUserAgent(null)).toBe(0);

    const many = Array.from({ length: 5005 }, (_, i) => overlay({ id: `synthetic-${i}`, ts: 1_700_000_000_000 + i }));
    let projected: ReturnType<typeof createOverlayDiagnosticBundle>["records"] | undefined;
    expect(() => { projected = createOverlayDiagnosticBundle(many, context, new Date(0)).records; }).not.toThrow();
    expect(projected).toHaveLength(5000);
    expect(projected![0]!.timestamp).toBe(new Date(1_700_000_000_005).toISOString());

    const hostileLog = [
      null,
      { kind: "nav_click_block", ts: 1_700_000_000_000 },
      overlay({ ts: NaN }),
      { id: "t", ts: 1_700_000_000_000, kind: "mutation_alert", reasons: "nope", extra: { get overlayDiag() { throw new Error("hostile"); } } },
    ] as unknown as EventLogEntry[];
    expect(() => createOverlayDiagnosticBundle(hostileLog, context, new Date(0))).not.toThrow();
  });

  it("records count and output bytes with an exact-byte frozen snapshot", () => {
    const log = [overlay(), overlay({ id: "synthetic-2", ts: 1_700_000_000_001, reasons: ["overlay_detected"] })];
    const snapshot = prepareOverlayDiagnosticExport(log, context, new Date(0));
    expect(snapshot.count).toBe(2);
    expect(snapshot.bytes).toBe(new Blob([snapshot.text]).size);
    expect(snapshot.filename).toBe("navsentinel-overlay-diagnostics-1970-01-01.json");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(JSON.parse(snapshot.text).records).toHaveLength(2);
    expect(snapshot.text).not.toMatch(/private-id|synthetic\.test|should_block/);

    const text = JSON.stringify(createOverlayDiagnosticBundle([], context, new Date(0))).padEnd(MAX_OVERLAY_DIAGNOSTIC_BYTES, " ");
    expect(measureOverlayDiagnosticExport(text)).toBe(MAX_OVERLAY_DIAGNOSTIC_BYTES);
    expect(() => measureOverlayDiagnosticExport(`${text} `)).toThrow(RangeError);
    vi.spyOn(JSON, "stringify").mockReturnValueOnce(text).mockReturnValueOnce(`${text} `);
    expect(prepareOverlayDiagnosticExport([], context, new Date(0)).bytes).toBe(MAX_OVERLAY_DIAGNOSTIC_BYTES);
    expect(() => prepareOverlayDiagnosticExport([], context, new Date(0))).toThrow(/256 KiB/);
  });
});
