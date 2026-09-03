export type CorpusManifestSource = "openphish" | "phishtank";
export type CorpusManifestErrorCode =
  | "manifest_missing"
  | "manifest_unreadable"
  | "manifest_unparseable"
  | "manifest_schema_invalid"
  | "manifest_counts_invalid"
  | "manifest_entry_invalid"
  | "manifest_no_usable_snapshots"
  | "snapshot_path_invalid"
  | "snapshot_not_regular"
  | "snapshot_missing"
  | "snapshot_size_mismatch"
  | "snapshot_digest_mismatch"
  | "output_invalid"
  | "output_exists"
  | "download_failed"
  | "download_size_mismatch"
  | "download_digest_mismatch"
  | "output_write_failed"
  | "output_publish_failed";

export interface CorpusManifestSuccessEntry {
  filename: string;
  url: string;
  source: CorpusManifestSource;
  fetchDate: string;
  sizeBytes: number;
  sha256: string;
}

export interface CorpusManifestFailedEntry {
  filename: null;
  url: string;
  source: CorpusManifestSource;
  fetchDate: string;
  sizeBytes: 0;
  sha256: null;
  error: "download_failed";
}

export interface CorpusManifest {
  schema_version: "1.0.0";
  generatedAt: string;
  feedSources: CorpusManifestSource[];
  totalUrls: number;
  downloaded: number;
  failed: number;
  entries: Array<CorpusManifestSuccessEntry | CorpusManifestFailedEntry>;
}

export interface CorpusCandidate {
  source: CorpusManifestSource;
  url: string;
}

export interface NormalizedCorpusCandidates {
  entries: CorpusCandidate[];
  invalidCount: number;
  duplicateCount: number;
}

export class CorpusManifestError extends Error {
  constructor(code: CorpusManifestErrorCode);
  readonly outcome: "TEST_INVALID";
  readonly code: CorpusManifestErrorCode;
}

export const CORPUS_MANIFEST_SCHEMA_VERSION: "1.0.0";
export function sha256(bytes: string | Uint8Array): string;
export function snapshotFilename(source: CorpusManifestSource, url: string): string;
export function validateCorpusManifest(value: unknown): CorpusManifest;
export function normalizeCorpusCandidates(entries: unknown): NormalizedCorpusCandidates;
export function createCorpusManifest(value: {
  generatedAt: string;
  feedSources: CorpusManifestSource[];
  entries: Array<CorpusManifestSuccessEntry | CorpusManifestFailedEntry>;
}): CorpusManifest;
export function loadValidatedCorpusManifest(value: { manifestPath: string; snapshotsDir: string }): {
  manifest: CorpusManifest;
  entries: CorpusManifestSuccessEntry[];
};
export function loadCorpusManifest(value: { manifestPath: string }): CorpusManifest;
export function rehydrateCorpusSnapshots(value: {
  manifestPath: string;
  outputDir: string;
  fetchSnapshot(entry: CorpusManifestSuccessEntry): Promise<Uint8Array> | Uint8Array;
}): Promise<{ rehydrated: number; failed: number; filenames: string[] }>;
