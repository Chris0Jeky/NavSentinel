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
  normalizeCorpusCandidates,
  rehydrateCorpusSnapshots,
  snapshotFilename,
  type CorpusManifestFailedEntry,
  type CorpusManifestSuccessEntry,
} from "../../scripts/corpus-manifest.mjs";

const FETCH_DATE = "2026-09-03T12:00:00.000Z";
const temporaryDirectories: string[] = [];

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeDirectory(): { root: string; manifestPath: string; outputDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-corpus-rehydrate-"));
  temporaryDirectories.push(root);
  return { root, manifestPath: path.join(root, "manifest.json"), outputDir: path.join(root, "snapshots") };
}

function successfulEntry(source: "openphish" | "phishtank", url: string, bytes: Uint8Array): CorpusManifestSuccessEntry {
  return {
    filename: snapshotFilename(source, url),
    url,
    source,
    fetchDate: FETCH_DATE,
    sizeBytes: bytes.length,
    sha256: digest(bytes),
  };
}

function writeManifest(manifestPath: string, entries: Array<CorpusManifestSuccessEntry | CorpusManifestFailedEntry>): string {
  const manifest = createCorpusManifest({
    generatedAt: FETCH_DATE,
    feedSources: ["openphish", "phishtank"],
    entries,
  });
  const raw = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(manifestPath, raw, "utf8");
  return raw;
}

async function expectInvalid(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action();
    throw new Error("Expected corpus rehydration to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(CorpusManifestError);
    expect(error).toMatchObject({ outcome: "TEST_INVALID", code });
    expect((error as Error).message).toBe(`TEST_INVALID:${code}`);
    expect((error as Error).message).not.toContain(".test/");
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("corpus manifest rehydration", () => {
  it("rehydrates exact inert benign, malicious, and mixed bytes without changing the manifest", async () => {
    const { manifestPath, outputDir } = makeDirectory();
    const fixtures = [
      ["openphish", "https://benign.example.test/form", Buffer.from("<main>benign inert fixture</main>")] as const,
      ["phishtank", "https://malicious.example.test/login", Buffer.from("<main>malicious inert fixture</main>")] as const,
      ["openphish", "https://mixed.example.test/page", Buffer.from("<main>mixed inert fixture</main>")] as const,
    ];
    const entries = fixtures.map(([source, url, bytes]) => successfulEntry(source, url, bytes));
    const original = writeManifest(manifestPath, [
      ...entries,
      {
        filename: null,
        url: "https://unavailable.example.test/page",
        source: "openphish",
        fetchDate: FETCH_DATE,
        sizeBytes: 0,
        sha256: null,
        error: "download_failed",
      },
    ]);
    const bytesByUrl = new Map<string, Uint8Array>(fixtures.map(([, url, bytes]) => [url, bytes]));

    const result = await rehydrateCorpusSnapshots({
      manifestPath,
      outputDir,
      fetchSnapshot: (entry) => bytesByUrl.get(entry.url)!,
    });

    expect(result).toMatchObject({ rehydrated: 3, failed: 1 });
    expect(result.filenames).toEqual(entries.map((entry) => entry.filename));
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(original);
    expect(loadCorpusManifest({ manifestPath }).downloaded).toBe(3);
    expect(loadValidatedCorpusManifest({ manifestPath, snapshotsDir: outputDir }).entries).toHaveLength(3);
    for (const [source, url, bytes] of fixtures) {
      expect(fs.readFileSync(path.join(outputDir, snapshotFilename(source, url)))).toEqual(bytes);
    }
  });

  it("rejects wrong download length and same-length wrong digest without publishing output", async () => {
    const { manifestPath, outputDir } = makeDirectory();
    const bytes = Buffer.from("inert expected bytes");
    const entry = successfulEntry("openphish", "https://length.example.test/page", bytes);
    writeManifest(manifestPath, [entry]);

    await expectInvalid(
      () => rehydrateCorpusSnapshots({ manifestPath, outputDir, fetchSnapshot: () => Buffer.from("short") }),
      "download_size_mismatch",
    );
    expect(fs.existsSync(outputDir)).toBe(false);

    const sameLengthWrongBytes = Buffer.from(bytes.map((byte) => byte ^ 1));
    await expectInvalid(
      () => rehydrateCorpusSnapshots({ manifestPath, outputDir, fetchSnapshot: () => sameLengthWrongBytes }),
      "download_digest_mismatch",
    );
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it("leaves no partial corpus when a later injected download fails", async () => {
    const { root, manifestPath, outputDir } = makeDirectory();
    const first = successfulEntry("openphish", "https://first.example.test/page", Buffer.from("first fixture"));
    const second = successfulEntry("phishtank", "https://second.example.test/page", Buffer.from("second fixture"));
    const original = writeManifest(manifestPath, [first, second]);
    let calls = 0;

    await expectInvalid(
      () => rehydrateCorpusSnapshots({
        manifestPath,
        outputDir,
        fetchSnapshot: () => {
          calls++;
          if (calls === 1) return Buffer.from("first fixture");
          throw new Error("inert transport failure");
        },
      }),
      "download_failed",
    );

    expect(calls).toBe(2);
    expect(fs.existsSync(outputDir)).toBe(false);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(original);
    expect(fs.readdirSync(root)).toEqual(["manifest.json"]);
  });

  it("refuses an existing output before calling transport", async () => {
    const { manifestPath, outputDir } = makeDirectory();
    const bytes = Buffer.from("existing output fixture");
    writeManifest(manifestPath, [successfulEntry("openphish", "https://existing.example.test/page", bytes)]);
    fs.mkdirSync(outputDir);
    let calls = 0;

    await expectInvalid(
      () => rehydrateCorpusSnapshots({ manifestPath, outputDir, fetchSnapshot: () => { calls++; return bytes; } }),
      "output_exists",
    );
    expect(calls).toBe(0);
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });

  it("quarantines unsafe candidates and deduplicates canonical URLs before selection", () => {
    const result = normalizeCorpusCandidates([
      { source: "openphish", url: "https://Example.test:443/path" },
      { source: "phishtank", url: "https://example.test/path" },
      { source: "unknown", url: "https://unknown.example.test/" },
      { source: "openphish", url: "https://user:pass@credentials.example.test/" },
      { source: "openphish", url: "ftp://ftp.example.test/" },
      { source: "openphish", url: "https://fragment.example.test/#part" },
      { source: "openphish", url: " https://whitespace.example.test/" },
    ]);

    expect(result).toEqual({
      entries: [{ source: "openphish", url: "https://example.test/path" }],
      invalidCount: 5,
      duplicateCount: 1,
    });
  });
});
