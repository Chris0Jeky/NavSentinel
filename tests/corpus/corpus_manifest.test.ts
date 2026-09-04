import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CorpusManifestError,
  createCorpusManifest,
  loadCorpusManifest,
  loadValidatedCorpusManifest,
  snapshotFilename,
  type CorpusManifestFailedEntry,
  type CorpusManifestSuccessEntry,
} from "../../scripts/corpus-manifest.mjs";

const FETCH_DATE = "2026-09-03T12:00:00.000Z";
const URL = "https://example.test/login";
const BYTES = Buffer.from("<!doctype html><p>inert corpus fixture</p>", "utf8");
const temporaryDirectories: string[] = [];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeDirectory(): { corpusDir: string; manifestPath: string; snapshotsDir: string } {
  const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-corpus-manifest-"));
  temporaryDirectories.push(corpusDir);
  const snapshotsDir = path.join(corpusDir, "snapshots");
  fs.mkdirSync(snapshotsDir);
  return { corpusDir, manifestPath: path.join(corpusDir, "manifest.json"), snapshotsDir };
}

function successfulEntry(overrides: Record<string, unknown> = {}) {
  return {
    filename: snapshotFilename("openphish", URL),
    url: URL,
    source: "openphish",
    fetchDate: FETCH_DATE,
    sizeBytes: BYTES.length,
    sha256: sha256(BYTES),
    ...overrides,
  };
}

function manifest(entries: unknown = [successfulEntry()]) {
  return createCorpusManifest({
    generatedAt: FETCH_DATE,
    feedSources: ["openphish"],
    entries: entries as Array<CorpusManifestSuccessEntry | CorpusManifestFailedEntry>,
  });
}

function writeManifest(manifestPath: string, value: unknown): void {
  fs.writeFileSync(manifestPath, JSON.stringify(value), "utf8");
}

function expectInvalid(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected corpus manifest validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CorpusManifestError);
    expect(error).toMatchObject({ outcome: "TEST_INVALID", code });
    expect((error as Error).message).toBe(`TEST_INVALID:${code}`);
    expect((error as Error).message).not.toContain(URL);
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("corpus manifest contract", () => {
  it("loads a versioned manifest only after proving exact synthetic snapshot bytes", () => {
    const { manifestPath, snapshotsDir } = makeDirectory();
    const filename = snapshotFilename("openphish", URL);
    fs.writeFileSync(path.join(snapshotsDir, filename), BYTES);
    writeManifest(manifestPath, manifest([
      successfulEntry({ discardedDiagnostic: "inert-page-content-must-not-survive" }),
      {
        filename: null,
        url: "https://www.example.test/unavailable",
        source: "openphish",
        fetchDate: FETCH_DATE,
        sizeBytes: 0,
        sha256: null,
        error: "download_failed",
      },
    ]));

    const loaded = loadValidatedCorpusManifest({ manifestPath, snapshotsDir });
    expect(loaded.manifest.schema_version).toBe("1.0.0");
    expect(loaded.manifest).toMatchObject({ totalUrls: 2, downloaded: 1, failed: 1 });
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0]?.filename).toBe(filename);
    expect(loaded.entries[0]?.bytes).toEqual(BYTES);
    expect(loaded.entries[0]).not.toHaveProperty("discardedDiagnostic");
  });

  it("classifies missing and malformed manifests as TEST_INVALID without input disclosure", () => {
    const { manifestPath, snapshotsDir } = makeDirectory();
    expectInvalid(() => loadValidatedCorpusManifest({ manifestPath, snapshotsDir }), "manifest_missing");
    fs.writeFileSync(manifestPath, "not JSON", "utf8");
    expectInvalid(() => loadValidatedCorpusManifest({ manifestPath, snapshotsDir }), "manifest_unparseable");
  });

  it("rejects a manifest with no usable snapshots instead of silently skipping it", () => {
    const { manifestPath, snapshotsDir } = makeDirectory();
    writeManifest(manifestPath, manifest([{
      filename: null,
      url: URL,
      source: "openphish",
      fetchDate: FETCH_DATE,
      sizeBytes: 0,
      sha256: null,
      error: "download_failed",
    }]));
    expectInvalid(() => loadValidatedCorpusManifest({ manifestPath, snapshotsDir }), "manifest_no_usable_snapshots");
  });

  it("keeps a valid legacy manifest URL spelling while structure-only loading", () => {
    const { manifestPath } = makeDirectory();
    const legacyUrl = "https://EXAMPLE.test:443/login";
    writeManifest(manifestPath, manifest([
      successfulEntry({
        url: legacyUrl,
        filename: snapshotFilename("openphish", legacyUrl),
      }),
    ]));

    expect(loadCorpusManifest({ manifestPath }).entries[0]?.url).toBe(legacyUrl);
  });

  it("rejects non-canonical recorded URLs before browser replay", () => {
    const { manifestPath, snapshotsDir } = makeDirectory();
    const legacyUrl = "https://EXAMPLE.test:443/login";
    const entry = successfulEntry({ url: legacyUrl, filename: snapshotFilename("openphish", legacyUrl) });
    writeManifest(manifestPath, manifest([entry]));
    fs.writeFileSync(path.join(snapshotsDir, entry.filename), BYTES);
    expectInvalid(() => loadValidatedCorpusManifest({ manifestPath, snapshotsDir }), "replay_url_not_canonical");
  });

  it("rejects unsafe names, duplicate URLs, inconsistent counts, and invalid entry fields", () => {
    const { manifestPath, snapshotsDir } = makeDirectory();
    const validManifest = manifest();
    const invalidManifests: Array<{ value: unknown; code: string }> = [
      { value: { ...validManifest, schema_version: "2.0.0" }, code: "manifest_schema_invalid" },
      { value: { ...validManifest, entries: [successfulEntry({ filename: "../outside.html" })] }, code: "manifest_entry_invalid" },
      { value: { ...validManifest, totalUrls: 2, downloaded: 2, entries: [successfulEntry(), successfulEntry({ url: "https://EXAMPLE.test/login", filename: snapshotFilename("openphish", "https://EXAMPLE.test/login") })] }, code: "manifest_entry_invalid" },
      { value: { ...validManifest, downloaded: 2 }, code: "manifest_counts_invalid" },
      { value: { ...validManifest, entries: [successfulEntry({ url: "not-a-url" })] }, code: "manifest_entry_invalid" },
      { value: { ...validManifest, entries: [successfulEntry({ source: "unknown-source" })] }, code: "manifest_entry_invalid" },
      { value: { ...validManifest, entries: [successfulEntry({ fetchDate: "not-a-date" })] }, code: "manifest_entry_invalid" },
      { value: { ...validManifest, entries: [successfulEntry({ sha256: "A".repeat(64) })] }, code: "manifest_entry_invalid" },
    ];

    for (const invalidManifest of invalidManifests) {
      writeManifest(manifestPath, invalidManifest.value);
      expectInvalid(() => loadValidatedCorpusManifest({ manifestPath, snapshotsDir }), invalidManifest.code);
    }
  });

  it("fails closed when a declared snapshot is missing, resized, or has different bytes", () => {
    const { manifestPath, snapshotsDir } = makeDirectory();
    const filename = snapshotFilename("openphish", URL);
    writeManifest(manifestPath, manifest());
    expectInvalid(() => loadValidatedCorpusManifest({ manifestPath, snapshotsDir }), "snapshot_missing");

    fs.writeFileSync(path.join(snapshotsDir, filename), Buffer.from("short", "utf8"));
    expectInvalid(() => loadValidatedCorpusManifest({ manifestPath, snapshotsDir }), "snapshot_size_mismatch");

    const sameLengthDifferentBytes = Buffer.from(BYTES.map((byte) => byte ^ 1));
    fs.writeFileSync(path.join(snapshotsDir, filename), sameLengthDifferentBytes);
    expectInvalid(() => loadValidatedCorpusManifest({ manifestPath, snapshotsDir }), "snapshot_digest_mismatch");
  });
});
