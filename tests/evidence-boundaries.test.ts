import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";
import { createEvidenceExport, evidenceHostname, filterEvidence, projectEvidence, type EvidenceExport } from "../extension/src/evidence/evidence_model";
import { MAX_EVIDENCE_EXPORT_BYTES, measureEvidenceExport, prepareEvidenceExport } from "../extension/src/evidence/evidence_export";

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
    ["PORTAL.Example.Test.", "portal.example.test"],
  ])("canonicalizes hostname-only metadata %s", (value, expected) => {
    expect(evidenceHostname(value)).toBe(expected);
  });

  it.each([
    "https://[::1]/private?token=secret", "[::1]:443", "[::1]/path", "::1?secret",
    "fe80::1%eth0", "1::2::3", "999.0.0.1", "user@source.test", "source.test/private",
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
