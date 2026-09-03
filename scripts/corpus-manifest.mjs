import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CORPUS_MANIFEST_SCHEMA_VERSION = "1.0.0";

const SOURCES = new Set(["openphish", "phishtank"]);
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** A fail-closed corpus error safe to report without source URLs or page content. */
export class CorpusManifestError extends Error {
  constructor(code) {
    super(`TEST_INVALID:${code}`);
    this.name = "CorpusManifestError";
    this.outcome = "TEST_INVALID";
    this.code = code;
  }
}

function fail(code) {
  throw new CorpusManifestError(code);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value;
}

function isSource(value) {
  return typeof value === "string" && SOURCES.has(value);
}

function isSafeUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function canonicalUrl(value) {
  return new URL(value).href;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The producer and consumer share this deterministic snapshot name. */
export function snapshotFilename(source, url) {
  return `${source}-${sha256(url).slice(0, 16)}.html`;
}

function validateEntry(entry, feedSources) {
  if (!isRecord(entry) || !isSafeUrl(entry.url) || !isSource(entry.source) || !feedSources.has(entry.source) || !isTimestamp(entry.fetchDate) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
    fail("manifest_entry_invalid");
  }

  const isSuccess = entry.filename !== null;
  if (isSuccess) {
    if (typeof entry.filename !== "string" || entry.filename !== snapshotFilename(entry.source, entry.url) || !DIGEST_PATTERN.test(entry.sha256 ?? "") || entry.sizeBytes === 0 || Object.hasOwn(entry, "error")) {
      fail("manifest_entry_invalid");
    }
    return {
      filename: entry.filename,
      url: entry.url,
      source: entry.source,
      fetchDate: entry.fetchDate,
      sizeBytes: entry.sizeBytes,
      sha256: entry.sha256,
    };
  }

  if (entry.sizeBytes !== 0 || entry.sha256 !== null || entry.error !== "download_failed") {
    fail("manifest_entry_invalid");
  }
  return {
    filename: null,
    url: entry.url,
    source: entry.source,
    fetchDate: entry.fetchDate,
    sizeBytes: 0,
    sha256: null,
    error: "download_failed",
  };
}

/**
 * Validate data structure only. Loading adds snapshot existence and byte-integrity checks.
 * Errors deliberately contain only stable codes, never paths, URLs, or page bytes.
 */
export function validateCorpusManifest(value) {
  if (!isRecord(value) || value.schema_version !== CORPUS_MANIFEST_SCHEMA_VERSION || !isTimestamp(value.generatedAt) || !Array.isArray(value.feedSources) || !Array.isArray(value.entries) || !Number.isSafeInteger(value.totalUrls) || !Number.isSafeInteger(value.downloaded) || !Number.isSafeInteger(value.failed) || value.totalUrls < 0 || value.downloaded < 0 || value.failed < 0) {
    fail("manifest_schema_invalid");
  }

  const feedSources = new Set(value.feedSources);
  if (feedSources.size === 0 || feedSources.size !== value.feedSources.length || !value.feedSources.every(isSource)) {
    fail("manifest_schema_invalid");
  }

  const entries = value.entries.map((entry) => validateEntry(entry, feedSources));
  const urls = new Set(entries.map((entry) => canonicalUrl(entry.url)));
  const filenames = new Set(entries.filter((entry) => entry.filename !== null).map((entry) => entry.filename));
  const successful = entries.filter((entry) => entry.filename !== null);

  if (urls.size !== entries.length || filenames.size !== successful.length) fail("manifest_entry_invalid");
  if (value.totalUrls !== entries.length || value.downloaded !== successful.length || value.failed !== entries.length - successful.length) {
    fail("manifest_counts_invalid");
  }

  return {
    schema_version: CORPUS_MANIFEST_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    feedSources: [...value.feedSources],
    totalUrls: value.totalUrls,
    downloaded: value.downloaded,
    failed: value.failed,
    entries,
  };
}

/** Build a count-consistent, schema-versioned manifest for the fetch producer. */
export function createCorpusManifest({ generatedAt, feedSources, entries }) {
  const successful = Array.isArray(entries) ? entries.filter((entry) => entry?.filename !== null) : [];
  return validateCorpusManifest({
    schema_version: CORPUS_MANIFEST_SCHEMA_VERSION,
    generatedAt,
    feedSources,
    totalUrls: Array.isArray(entries) ? entries.length : -1,
    downloaded: successful.length,
    failed: Array.isArray(entries) ? entries.length - successful.length : -1,
    entries,
  });
}

/**
 * Read and prove every usable snapshot before a test can treat it as corpus input.
 * Failed downloads remain accounted for in the manifest but are intentionally not test entries.
 */
export function loadValidatedCorpusManifest({ manifestPath, snapshotsDir }) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (error) {
    fail(error && typeof error === "object" && error.code === "ENOENT" ? "manifest_missing" : "manifest_unreadable");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("manifest_unparseable");
  }

  const manifest = validateCorpusManifest(parsed);
  const snapshotRoot = path.resolve(snapshotsDir);
  const entries = manifest.entries.filter((entry) => entry.filename !== null);
  if (entries.length === 0) fail("manifest_no_usable_snapshots");

  for (const entry of entries) {
    const snapshotPath = path.resolve(snapshotRoot, entry.filename);
    if (!snapshotPath.startsWith(`${snapshotRoot}${path.sep}`)) fail("snapshot_path_invalid");

    let metadata;
    try {
      metadata = fs.lstatSync(snapshotPath);
    } catch {
      fail("snapshot_missing");
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail("snapshot_not_regular");

    let bytes;
    try {
      bytes = fs.readFileSync(snapshotPath);
    } catch {
      fail("snapshot_missing");
    }
    if (bytes.length !== entry.sizeBytes) fail("snapshot_size_mismatch");
    if (sha256(bytes) !== entry.sha256) fail("snapshot_digest_mismatch");
  }

  return { manifest, entries };
}
