export interface ReleaseInputTreeEntry {
  readonly path: string;
  readonly mode: "100644" | "100755";
  readonly oid: string;
}

export interface ReleaseInputSnapshot {
  readonly repositoryRoot: string;
  readonly commit: string;
  readonly tree: string;
  readonly entries: readonly ReleaseInputTreeEntry[];
  readonly excludedPrefixes: readonly string[];
}

export interface PreparedReleaseChange {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface PreparedReleaseChanges {
  readonly repositoryRoot: string;
  readonly initialCommit: string;
  readonly initialTree: string;
  readonly changes: readonly PreparedReleaseChange[];
}

export interface ReleaseCommitScopeResult {
  readonly changedPaths: readonly string[];
}

export interface ReleaseGitOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly input?: string | Buffer;
  readonly encoding?: BufferEncoding | null;
  readonly maxBuffer?: number;
}

export interface ExactCommittedInputOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly expectedCommit?: string;
  readonly expectedTree?: string;
  readonly excludedPrefixes?: readonly string[];
}

export interface ReleaseSnapshotCheckOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly allowedChangedPaths?: readonly string[];
}

export interface ReleaseCommitScopeOptions extends ReleaseSnapshotCheckOptions {
  readonly preparedChanges?: PreparedReleaseChanges;
  readonly requireAllAllowedPaths?: boolean;
}

export const RELEASE_MUTABLE_PATHS: readonly [
  "CHANGELOG.md",
  "extension/manifest.json",
  "package-lock.json",
  "package.json",
];

export function createSanitizedGitEnvironment(
  source?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;

export function runReleaseGit(
  repositoryRoot: string,
  args: readonly string[],
  options?: ReleaseGitOptions,
): string | Buffer;

export function assertExactCommittedInputs(
  repositoryRoot: string,
  options?: ExactCommittedInputOptions,
): ReleaseInputSnapshot;

export function assertReleaseSnapshotUnchanged(
  snapshot: ReleaseInputSnapshot,
  options?: ReleaseSnapshotCheckOptions,
): true;

export function capturePreparedReleaseChanges(
  initialSnapshot: ReleaseInputSnapshot,
  options?: ReleaseSnapshotCheckOptions,
): PreparedReleaseChanges;

export function assertReleaseCommitScope(
  initialSnapshot: ReleaseInputSnapshot,
  releaseSnapshot: ReleaseInputSnapshot,
  options?: ReleaseCommitScopeOptions,
): ReleaseCommitScopeResult;
