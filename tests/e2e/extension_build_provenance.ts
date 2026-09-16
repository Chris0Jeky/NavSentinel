import { spawnSync } from "node:child_process";
import { createHash, type Hash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BUILD_INPUT_PATHS = [
  "extension",
  "scripts",
  "config",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
] as const;

const FIXED_OUTPUT_RELATIVE_PATH = "extension/dist";
const SUPPORTED_TRACKED_MODES = new Set(["100644", "100755"]);
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const ZERO = Buffer.from([0]);

export const RAW_BLOB_COMPARISON_MODE = "raw-blob-byte-equality" as const;

type TreeEntry = {
  path: string;
  mode: "100644" | "100755";
  oid: string;
};

type RepositoryAuthority = {
  root: string;
  commit: string;
  tree: string;
  objectFormat: string;
};

export type BuildInputAttestation = {
  files: string[];
  repositoryCommit: string;
  repositoryTree: string;
  objectFormat: string;
  comparisonMode: typeof RAW_BLOB_COMPARISON_MODE;
  gitSha256: string;
  executedSha256: string;
  trackedInputCount: number;
  unexpectedInputCount: 0;
  specialInputCount: 0;
};

export type BuildOutputAttestation = {
  sha256: string;
  fileCount: number;
};

type GitResult = {
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error?: Error;
};

function integrityError(code: string, message: string): Error {
  const error = new Error(`State-authority evidence TEST_INVALID [${code}]: ${message}`);
  error.name = "StateAuthorityEvidenceIntegrityError";
  return error;
}

function lstatIfPresent(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw integrityError(
      "FILESYSTEM_WALK_FAILED",
      `cannot inspect '${target}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

function canonicalPathKey(relativePath: string): string {
  return relativePath.normalize("NFC").toLowerCase();
}

function sameNativePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function assertValidRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\")) {
    throw integrityError("NON_CANONICAL_PATH", `unsupported repository path '${relativePath}'`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw integrityError("NON_CANONICAL_PATH", `unsupported repository path '${relativePath}'`);
  }
  if (path.posix.normalize(relativePath) !== relativePath) {
    throw integrityError("NON_CANONICAL_PATH", `unsupported repository path '${relativePath}'`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(relativePath)) {
    throw integrityError("NON_CANONICAL_PATH", `control character in repository path '${relativePath}'`);
  }
}

function sanitizedGitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || key.startsWith("GIT_")) continue;
    environment[key] = value;
  }
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.LC_ALL = "C";
  environment.LANG = "C";
  return environment;
}

function invokeGit(repositoryRoot: string, args: string[], input?: Buffer): GitResult {
  const result = spawnSync("git", ["--no-replace-objects", "-C", repositoryRoot, ...args], {
    env: sanitizedGitEnvironment(),
    input,
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
    error: result.error,
  };
}

function gitFailure(args: string[], result: GitResult): Error {
  const detail = result.stderr.toString("utf8").trim()
    || result.stdout.toString("utf8").trim()
    || result.error?.message
    || `exit ${String(result.status)}`;
  return integrityError("GIT_AUTHORITY_UNAVAILABLE", `git ${args.join(" ")} failed: ${detail}`);
}

function gitBuffer(repositoryRoot: string, args: string[], input?: Buffer): Buffer {
  const result = invokeGit(repositoryRoot, args, input);
  if (result.error || result.status !== 0) throw gitFailure(args, result);
  return result.stdout;
}

function gitText(repositoryRoot: string, args: string[]): string {
  return gitBuffer(repositoryRoot, args).toString("utf8").trim();
}

function tryGit(repositoryRoot: string, args: string[]): GitResult {
  return invokeGit(repositoryRoot, args);
}

function resolveRepositoryRoot(repositoryRoot: string): string {
  const requested = path.resolve(repositoryRoot);
  let requestedStats: fs.Stats;
  try {
    requestedStats = fs.lstatSync(requested);
  } catch (error) {
    throw integrityError(
      "NOT_A_REPOSITORY",
      `repository root is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (requestedStats.isSymbolicLink() || !requestedStats.isDirectory()) {
    throw integrityError("NOT_A_REPOSITORY", `repository root is not an ordinary directory: ${requested}`);
  }

  let requestedReal: string;
  try {
    requestedReal = fs.realpathSync.native(requested);
  } catch (error) {
    throw integrityError(
      "NOT_A_REPOSITORY",
      `repository root cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!sameNativePath(requested, requestedReal)) {
    throw integrityError("ROOT_LINKED", `repository root resolves through a link: ${requested}`);
  }

  let reported: string;
  try {
    reported = gitText(requestedReal, ["rev-parse", "--show-toplevel"]);
  } catch (error) {
    throw integrityError("NOT_A_REPOSITORY", error instanceof Error ? error.message : String(error));
  }
  let reportedReal: string;
  try {
    reportedReal = fs.realpathSync.native(reported);
  } catch (error) {
    throw integrityError(
      "NOT_A_REPOSITORY",
      `Git top-level cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!sameNativePath(reportedReal, requestedReal)) {
    throw integrityError(
      "REPOSITORY_ROOT_MISMATCH",
      `Git top-level '${reportedReal}' differs from requested root '${requestedReal}'`,
    );
  }
  if (gitText(requestedReal, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    throw integrityError("NOT_A_REPOSITORY", `${requestedReal} is not a Git worktree`);
  }
  return requestedReal;
}

function assertSelfContainedObjectAuthority(repositoryRoot: string): void {
  if (gitText(repositoryRoot, ["rev-parse", "--is-shallow-repository"]) === "true") {
    throw integrityError("SHALLOW_REPOSITORY", "exact-head evidence requires a non-shallow repository");
  }

  const alternatesValue = gitText(repositoryRoot, [
    "rev-parse",
    "--git-path",
    "objects/info/alternates",
  ]);
  const alternatesPath = path.isAbsolute(alternatesValue)
    ? alternatesValue
    : path.resolve(repositoryRoot, alternatesValue);
  const alternatesStats = lstatIfPresent(alternatesPath);
  if (alternatesStats) {
    if (alternatesStats.isSymbolicLink() || !alternatesStats.isFile()) {
      throw integrityError("OBJECT_ALTERNATES", "repository alternates authority is linked or special");
    }
    if (fs.readFileSync(alternatesPath, "utf8").trim()) {
      throw integrityError("OBJECT_ALTERNATES", "repository object alternates are not allowed");
    }
  }

  if (gitText(repositoryRoot, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/replace/",
  ])) {
    throw integrityError("REPLACEMENT_OBJECTS", "replace refs are not allowed for exact-head evidence");
  }

  const promisor = tryGit(repositoryRoot, [
    "config",
    "--local",
    "--get-regexp",
    "^(extensions\\.partialClone|remote\\..*\\.promisor)$",
  ]);
  if (promisor.error || (promisor.status !== 0 && promisor.status !== 1)) {
    throw gitFailure(["config", "--local", "--get-regexp", "promisor configuration"], promisor);
  }
  if (promisor.status === 0 && promisor.stdout.toString("utf8").trim()) {
    throw integrityError("PROMISOR_OBJECTS", "partial-clone/promisor objects are not allowed");
  }
}

function resolveRepositoryAuthority(repositoryRoot: string, expectedHead: string): RepositoryAuthority {
  const root = resolveRepositoryRoot(repositoryRoot);
  assertSelfContainedObjectAuthority(root);

  const objectFormat = gitText(root, ["rev-parse", "--show-object-format"]);
  let currentCommit: string;
  let expectedCommit: string;
  try {
    currentCommit = gitText(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
    expectedCommit = gitText(root, ["rev-parse", "--verify", `${expectedHead}^{commit}`]);
  } catch (error) {
    throw integrityError(
      "MISSING_COMMIT_AUTHORITY",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!OID_RE.test(currentCommit) || !OID_RE.test(expectedCommit)) {
    throw integrityError("INVALID_OBJECT_ID", "Git returned a non-canonical commit object ID");
  }
  if (currentCommit !== expectedCommit) {
    throw integrityError(
      "HEAD_MISMATCH",
      `current HEAD ${currentCommit} differs from expected ${expectedCommit}`,
    );
  }

  let tree: string;
  try {
    tree = gitText(root, ["rev-parse", "--verify", `${currentCommit}^{tree}`]);
  } catch (error) {
    throw integrityError(
      "MISSING_TREE_AUTHORITY",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!OID_RE.test(tree)) {
    throw integrityError("INVALID_OBJECT_ID", "Git returned a non-canonical tree object ID");
  }
  return { root, commit: currentCommit, tree, objectFormat };
}

function splitNulRecords(buffer: Buffer, source: string): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  while (start < buffer.length) {
    const end = buffer.indexOf(0, start);
    if (end === -1) {
      throw integrityError("MALFORMED_GIT_OUTPUT", `${source} returned an unterminated NUL record`);
    }
    if (end > start) records.push(buffer.subarray(start, end));
    start = end + 1;
  }
  return records;
}

function decodeUtf8Path(pathBytes: Buffer): string {
  try {
    return UTF8_DECODER.decode(pathBytes);
  } catch {
    throw integrityError("NON_UTF8_PATH", "non-UTF-8 repository paths are not supported");
  }
}

function registerCanonicalPath(canonicalPaths: Map<string, string>, relativePath: string): void {
  const key = canonicalPathKey(relativePath);
  const existing = canonicalPaths.get(key);
  if (existing && existing !== relativePath) {
    throw integrityError(
      "CASE_COLLISION",
      `filesystem-normalized path collision between '${existing}' and '${relativePath}'`,
    );
  }
  canonicalPaths.set(key, relativePath);
}

function readTreeEntries(authority: RepositoryAuthority, paths: readonly string[]): TreeEntry[] {
  const output = gitBuffer(
    authority.root,
    ["ls-tree", "-rz", "--full-tree", authority.tree, "--", ...paths],
  );
  const entries: TreeEntry[] = [];
  const canonicalPaths = new Map<string, string>();
  for (const record of splitNulRecords(output, "git ls-tree")) {
    const tab = record.indexOf(0x09);
    if (tab === -1) {
      throw integrityError("MALFORMED_GIT_OUTPUT", "git ls-tree returned a malformed record");
    }
    const header = record.subarray(0, tab).toString("ascii");
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})$/u.exec(header);
    if (!match) {
      throw integrityError("MALFORMED_GIT_OUTPUT", `unsupported git ls-tree header '${header}'`);
    }
    const [, mode, type, oid] = match;
    const relativePath = decodeUtf8Path(record.subarray(tab + 1));
    assertValidRelativePath(relativePath);
    registerCanonicalPath(canonicalPaths, relativePath);

    if (relativePath === FIXED_OUTPUT_RELATIVE_PATH
      || relativePath.startsWith(`${FIXED_OUTPUT_RELATIVE_PATH}/`)) {
      throw integrityError(
        "TRACKED_BUILD_OUTPUT",
        `${FIXED_OUTPUT_RELATIVE_PATH} must remain generated and untracked`,
      );
    }
    if (mode === "120000") {
      throw integrityError("UNSUPPORTED_TRACKED_MODE", `committed symlink '${relativePath}' is not allowed`);
    }
    if (mode === "160000" || type === "commit") {
      throw integrityError("UNSUPPORTED_TRACKED_MODE", `gitlink '${relativePath}' is not allowed`);
    }
    if (!SUPPORTED_TRACKED_MODES.has(mode) || type !== "blob") {
      throw integrityError(
        "UNSUPPORTED_TRACKED_MODE",
        `unsupported tracked entry ${mode} ${type} at '${relativePath}'`,
      );
    }
    entries.push({ path: relativePath, mode: mode as TreeEntry["mode"], oid });
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return entries;
}

function readIndexEntries(
  authority: RepositoryAuthority,
  paths: readonly string[],
): Map<string, { mode: string; oid: string }> {
  const output = gitBuffer(authority.root, ["ls-files", "--stage", "-z", "--", ...paths]);
  const entries = new Map<string, { mode: string; oid: string }>();
  const canonicalPaths = new Map<string, string>();
  for (const record of splitNulRecords(output, "git ls-files")) {
    const tab = record.indexOf(0x09);
    if (tab === -1) {
      throw integrityError("MALFORMED_GIT_OUTPUT", "git ls-files returned a malformed record");
    }
    const header = record.subarray(0, tab).toString("ascii");
    const match = /^(\d{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/u.exec(header);
    if (!match) {
      throw integrityError("MALFORMED_GIT_OUTPUT", `unsupported git index header '${header}'`);
    }
    const [, mode, oid, stage] = match;
    const relativePath = decodeUtf8Path(record.subarray(tab + 1));
    assertValidRelativePath(relativePath);
    registerCanonicalPath(canonicalPaths, relativePath);
    if (stage !== "0") {
      throw integrityError("INDEX_MISMATCH", `unmerged index stage ${stage} at '${relativePath}'`);
    }
    entries.set(relativePath, { mode, oid });
  }
  return entries;
}

function assertIndexMatchesTree(
  authority: RepositoryAuthority,
  treeEntries: TreeEntry[],
  paths: readonly string[],
): void {
  const indexEntries = readIndexEntries(authority, paths);
  if (indexEntries.size !== treeEntries.length) {
    throw integrityError(
      "INDEX_MISMATCH",
      `index contains ${indexEntries.size} selected entries but HEAD contains ${treeEntries.length}`,
    );
  }
  for (const entry of treeEntries) {
    const indexed = indexEntries.get(entry.path);
    if (!indexed || indexed.mode !== entry.mode || indexed.oid !== entry.oid) {
      throw integrityError("INDEX_MISMATCH", `index entry differs from HEAD at '${entry.path}'`);
    }
  }
}

function readCommittedBlobs(
  authority: RepositoryAuthority,
  entries: TreeEntry[],
): Map<string, Buffer> {
  if (entries.length === 0) return new Map();
  const input = Buffer.from(`${entries.map((entry) => entry.oid).join("\n")}\n`, "ascii");
  const output = gitBuffer(authority.root, ["cat-file", "--batch"], input);
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  for (const entry of entries) {
    const newline = output.indexOf(0x0a, offset);
    if (newline === -1) {
      throw integrityError("MISSING_BLOB_AUTHORITY", `missing blob header for '${entry.path}'`);
    }
    const header = output.subarray(offset, newline).toString("ascii");
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (\d+)$/u.exec(header);
    if (!match || match[1] !== entry.oid) {
      throw integrityError(
        "MISSING_BLOB_AUTHORITY",
        `unexpected blob authority for '${entry.path}': '${header}'`,
      );
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw integrityError("MISSING_BLOB_AUTHORITY", `invalid blob size for '${entry.path}'`);
    }
    const contentStart = newline + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw integrityError("MISSING_BLOB_AUTHORITY", `truncated blob for '${entry.path}'`);
    }
    blobs.set(entry.path, Buffer.from(output.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  if (offset !== output.length) {
    throw integrityError("MALFORMED_GIT_OUTPUT", "git cat-file returned unexpected trailing bytes");
  }
  return blobs;
}

function trackedDirectorySet(entries: TreeEntry[]): Set<string> {
  const directories = new Set<string>();
  for (const entry of entries) {
    const segments = entry.path.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      directories.add(current);
    }
  }
  return directories;
}

function assertContainedDirectPath(
  repositoryRoot: string,
  absolutePath: string,
  relativePath: string,
): void {
  let realPath: string;
  try {
    realPath = fs.realpathSync.native(absolutePath);
  } catch (error) {
    throw integrityError(
      "MISSING_WORKTREE_INPUT",
      `cannot resolve '${relativePath}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const relative = path.relative(repositoryRoot, realPath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw integrityError("SPECIAL_INPUT", `linked input '${relativePath}' escapes the worktree`);
  }
  if (!sameNativePath(realPath, absolutePath)) {
    throw integrityError("SPECIAL_INPUT", `linked input '${relativePath}' is not a direct path`);
  }
}

function assertTrackedWorktreeFile(
  authority: RepositoryAuthority,
  entry: TreeEntry,
  expectedBytes: Buffer,
): Buffer {
  const absolutePath = path.join(authority.root, ...entry.path.split("/"));
  const segments = entry.path.split("/");
  let current = authority.root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      throw integrityError("MISSING_WORKTREE_INPUT", `tracked input '${entry.path}' is missing`);
    }
    if (stats.isSymbolicLink()) {
      throw integrityError("SPECIAL_INPUT", `symbolic link or junction at '${entry.path}'`);
    }
    if (index < segments.length - 1) {
      if (!stats.isDirectory()) {
        throw integrityError("SPECIAL_INPUT", `non-directory ancestor at '${entry.path}'`);
      }
      continue;
    }
    if (!stats.isFile()) {
      throw integrityError("SPECIAL_INPUT", `tracked input '${entry.path}' is not a regular file`);
    }
    assertContainedDirectPath(authority.root, current, entry.path);
    if (process.platform !== "win32") {
      const executable = (stats.mode & 0o111) !== 0;
      const expectedExecutable = entry.mode === "100755";
      if (executable !== expectedExecutable) {
        throw integrityError("MODE_MISMATCH", `filesystem mode differs from HEAD at '${entry.path}'`);
      }
    }
    const actualBytes = fs.readFileSync(current);
    if (!actualBytes.equals(expectedBytes)) {
      throw integrityError("RAW_BYTES_MISMATCH", `raw filesystem bytes differ at '${entry.path}'`);
    }
    return actualBytes;
  }
  throw integrityError("MISSING_WORKTREE_INPUT", `tracked input '${entry.path}' is missing`);
}

function assertNoUnexpectedBuildInputs(
  authority: RepositoryAuthority,
  entries: TreeEntry[],
): void {
  const trackedFiles = new Set(entries.map((entry) => entry.path));
  const trackedDirectories = trackedDirectorySet(entries);
  const canonicalPaths = new Map<string, string>();
  for (const directory of trackedDirectories) registerCanonicalPath(canonicalPaths, directory);
  for (const entry of entries) registerCanonicalPath(canonicalPaths, entry.path);

  const visit = (absolutePath: string, relativePath: string): void => {
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(absolutePath);
    } catch (error) {
      throw integrityError(
        "FILESYSTEM_WALK_FAILED",
        `cannot inspect '${relativePath}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    assertValidRelativePath(relativePath);
    registerCanonicalPath(canonicalPaths, relativePath);
    if (stats.isSymbolicLink()) {
      throw integrityError("SPECIAL_INPUT", `symbolic link or junction at '${relativePath}'`);
    }
    assertContainedDirectPath(authority.root, absolutePath, relativePath);

    if (relativePath === FIXED_OUTPUT_RELATIVE_PATH) {
      if (!stats.isDirectory()) {
        throw integrityError("BUILD_OUTPUT_SPECIAL", `${FIXED_OUTPUT_RELATIVE_PATH} is not an ordinary directory`);
      }
      return;
    }
    if (stats.isDirectory()) {
      if (!trackedDirectories.has(relativePath)) {
        throw integrityError("UNEXPECTED_INPUT", `unexpected build directory '${relativePath}'`);
      }
      const names = fs.readdirSync(absolutePath).sort();
      for (const name of names) visit(path.join(absolutePath, name), `${relativePath}/${name}`);
      return;
    }
    if (!stats.isFile()) {
      throw integrityError("SPECIAL_INPUT", `special filesystem input '${relativePath}' is not allowed`);
    }
    if (!trackedFiles.has(relativePath)) {
      throw integrityError("UNEXPECTED_INPUT", `unexpected build input '${relativePath}'`);
    }
  };

  for (const rootPath of BUILD_INPUT_PATHS) {
    const absolutePath = path.join(authority.root, ...rootPath.split("/"));
    if (!lstatIfPresent(absolutePath)) continue;
    visit(absolutePath, rootPath);
  }
}

function frameHash(hash: Hash, entry: Pick<TreeEntry, "path" | "mode">, bytes: Buffer): void {
  hash.update(Buffer.from(entry.path, "utf8"));
  hash.update(ZERO);
  hash.update(Buffer.from(entry.mode, "ascii"));
  hash.update(ZERO);
  const byteLength = Buffer.allocUnsafe(8);
  byteLength.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(byteLength);
  hash.update(bytes);
}

function hashEntryBytes(entries: TreeEntry[], bytesByPath: Map<string, Buffer>): string {
  const hash = createHash("sha256");
  for (const entry of entries) {
    const bytes = bytesByPath.get(entry.path);
    if (!bytes) {
      throw integrityError("MISSING_BLOB_AUTHORITY", `missing bytes for '${entry.path}'`);
    }
    frameHash(hash, entry, bytes);
  }
  return hash.digest("hex");
}

function relativeTrackedPaths(repositoryRoot: string, files: string[]): string[] {
  const relativePaths = files.map((file) => {
    const absolute = path.resolve(file);
    const relative = normalizeRelativePath(path.relative(repositoryRoot, absolute));
    if (relative === ".." || relative.startsWith("../") || path.posix.isAbsolute(relative)) {
      throw integrityError("PATH_ESCAPE", `file '${file}' is outside the repository root`);
    }
    assertValidRelativePath(relative);
    return relative;
  });
  relativePaths.sort();
  if (new Set(relativePaths).size !== relativePaths.length) {
    throw integrityError("DUPLICATE_PATH", "duplicate paths are not allowed in an evidence hash");
  }
  return relativePaths;
}

function entriesForExactFiles(
  authority: RepositoryAuthority,
  relativePaths: string[],
): TreeEntry[] {
  const entries = readTreeEntries(authority, relativePaths);
  if (entries.length !== relativePaths.length) {
    throw integrityError("UNTRACKED_CAMPAIGN_INPUT", "campaign source closure is not exactly tracked at HEAD");
  }
  for (let index = 0; index < relativePaths.length; index += 1) {
    if (entries[index]?.path !== relativePaths[index]) {
      throw integrityError(
        "UNTRACKED_CAMPAIGN_INPUT",
        `campaign source '${relativePaths[index]}' is not an exact tracked file`,
      );
    }
  }
  assertIndexMatchesTree(authority, entries, relativePaths);
  return entries;
}

export function assertCurrentHeadBuildInputs(
  repositoryRoot: string,
  expectedHead: string,
): BuildInputAttestation {
  const authority = resolveRepositoryAuthority(repositoryRoot, expectedHead);
  const entries = readTreeEntries(authority, BUILD_INPUT_PATHS);
  assertIndexMatchesTree(authority, entries, BUILD_INPUT_PATHS);
  const committedBytes = readCommittedBlobs(authority, entries);
  const executedBytes = new Map<string, Buffer>();
  for (const entry of entries) {
    const expected = committedBytes.get(entry.path);
    if (!expected) {
      throw integrityError("MISSING_BLOB_AUTHORITY", `missing committed bytes for '${entry.path}'`);
    }
    executedBytes.set(entry.path, assertTrackedWorktreeFile(authority, entry, expected));
  }
  assertNoUnexpectedBuildInputs(authority, entries);

  const gitSha256 = hashEntryBytes(entries, committedBytes);
  const executedSha256 = hashEntryBytes(entries, executedBytes);
  if (gitSha256 !== executedSha256) {
    throw integrityError("RAW_BYTES_MISMATCH", "executed input hash differs from immutable Git blobs");
  }
  return {
    files: entries.map((entry) => path.join(authority.root, ...entry.path.split("/"))),
    repositoryCommit: authority.commit,
    repositoryTree: authority.tree,
    objectFormat: authority.objectFormat,
    comparisonMode: RAW_BLOB_COMPARISON_MODE,
    gitSha256,
    executedSha256,
    trackedInputCount: entries.length,
    unexpectedInputCount: 0,
    specialInputCount: 0,
  };
}

export function trackedBuildInputs(repositoryRoot: string, expectedHead: string): string[] {
  return assertCurrentHeadBuildInputs(repositoryRoot, expectedHead).files;
}

export function hashGitFiles(
  repositoryRoot: string,
  files: string[],
  expectedHead: string,
): string {
  const authority = resolveRepositoryAuthority(repositoryRoot, expectedHead);
  const relativePaths = relativeTrackedPaths(authority.root, files);
  const entries = entriesForExactFiles(authority, relativePaths);
  return hashEntryBytes(entries, readCommittedBlobs(authority, entries));
}

export function hashCanonicalWorktreeFiles(
  repositoryRoot: string,
  files: string[],
  expectedHead = "HEAD",
): string {
  const authority = resolveRepositoryAuthority(repositoryRoot, expectedHead);
  const relativePaths = relativeTrackedPaths(authority.root, files);
  const entries = entriesForExactFiles(authority, relativePaths);
  const committedBytes = readCommittedBlobs(authority, entries);
  const worktreeBytes = new Map<string, Buffer>();
  for (const entry of entries) {
    const committed = committedBytes.get(entry.path);
    if (!committed) {
      throw integrityError("MISSING_BLOB_AUTHORITY", `missing committed bytes for '${entry.path}'`);
    }
    worktreeBytes.set(entry.path, assertTrackedWorktreeFile(authority, entry, committed));
  }
  return hashEntryBytes(entries, worktreeBytes);
}

function resolveFixedOutputPath(
  repositoryRoot: string,
  outputPath: string,
): { root: string; output: string } {
  const root = resolveRepositoryRoot(repositoryRoot);
  const expected = path.join(root, "extension", "dist");
  const output = path.resolve(outputPath);
  if (!sameNativePath(expected, output)) {
    throw integrityError(
      "BUILD_OUTPUT_PATH",
      `state-authority evidence may own only '${FIXED_OUTPUT_RELATIVE_PATH}'`,
    );
  }
  const extensionRoot = path.join(root, "extension");
  let extensionStats: fs.Stats;
  try {
    extensionStats = fs.lstatSync(extensionRoot);
  } catch {
    throw integrityError("BUILD_OUTPUT_PATH", "extension source directory is missing");
  }
  if (extensionStats.isSymbolicLink() || !extensionStats.isDirectory()) {
    throw integrityError("BUILD_OUTPUT_SPECIAL", "extension source directory is linked or special");
  }
  assertContainedDirectPath(root, extensionRoot, "extension");
  return { root, output };
}

export function resetExtensionBuildOutput(repositoryRoot: string, outputPath: string): void {
  const { output } = resolveFixedOutputPath(repositoryRoot, outputPath);
  const existingOutput = lstatIfPresent(output);
  if (existingOutput) {
    if (existingOutput.isSymbolicLink() || !existingOutput.isDirectory()) {
      throw integrityError("BUILD_OUTPUT_SPECIAL", `${FIXED_OUTPUT_RELATIVE_PATH} is linked or special`);
    }
    fs.rmSync(output, { recursive: true, force: true });
  }
  if (lstatIfPresent(output)) {
    throw integrityError("BUILD_OUTPUT_NOT_CLEAN", `${FIXED_OUTPUT_RELATIVE_PATH} was not removed`);
  }
}

export function hashExtensionBuildOutput(
  repositoryRoot: string,
  outputPath: string,
): BuildOutputAttestation {
  const { root, output } = resolveFixedOutputPath(repositoryRoot, outputPath);
  let outputStats: fs.Stats;
  try {
    outputStats = fs.lstatSync(output);
  } catch {
    throw integrityError("BUILD_OUTPUT_MISSING", `${FIXED_OUTPUT_RELATIVE_PATH} is missing`);
  }
  if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
    throw integrityError("BUILD_OUTPUT_SPECIAL", `${FIXED_OUTPUT_RELATIVE_PATH} is linked or special`);
  }
  assertContainedDirectPath(root, output, FIXED_OUTPUT_RELATIVE_PATH);

  const entries: Array<{ path: string; mode: TreeEntry["mode"]; bytes: Buffer }> = [];
  const canonicalPaths = new Map<string, string>();
  const visit = (directory: string): void => {
    const names = fs.readdirSync(directory).sort();
    for (const name of names) {
      const absolutePath = path.join(directory, name);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
      assertValidRelativePath(relativePath);
      registerCanonicalPath(canonicalPaths, relativePath);
      const stats = fs.lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        throw integrityError("BUILD_OUTPUT_SPECIAL", `linked output '${relativePath}' is not allowed`);
      }
      assertContainedDirectPath(root, absolutePath, relativePath);
      if (stats.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stats.isFile()) {
        throw integrityError("BUILD_OUTPUT_SPECIAL", `special output '${relativePath}' is not allowed`);
      }
      const executable = process.platform !== "win32" && (stats.mode & 0o111) !== 0;
      entries.push({
        path: relativePath,
        mode: executable ? "100755" : "100644",
        bytes: fs.readFileSync(absolutePath),
      });
    }
  };
  visit(output);
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const hash = createHash("sha256");
  for (const entry of entries) frameHash(hash, entry, entry.bytes);
  return { sha256: hash.digest("hex"), fileCount: entries.length };
}

export function assertExtensionBuildOutputHash(
  repositoryRoot: string,
  outputPath: string,
  expected: BuildOutputAttestation,
): BuildOutputAttestation {
  const current = hashExtensionBuildOutput(repositoryRoot, outputPath);
  if (current.sha256 !== expected.sha256 || current.fileCount !== expected.fileCount) {
    throw integrityError(
      "BUILD_OUTPUT_HASH_MISMATCH",
      `${FIXED_OUTPUT_RELATIVE_PATH} changed after the attested build`,
    );
  }
  return current;
}
