/**
 * Raw release-input attestation for the version/tag path.
 *
 * Git status, diff, hash-object --filters, and the index are intentionally not
 * byte authority here: repository clean filters and line-ending conversion can
 * make altered worktree bytes compare equal to a committed blob. This module
 * pins an immutable commit/tree, reads blobs directly with `git cat-file`, and
 * compares them with raw filesystem bytes before the release mutates anything.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const RELEASE_MUTABLE_PATHS = Object.freeze([
  "CHANGELOG.md",
  "extension/manifest.json",
  "package-lock.json",
  "package.json",
]);

const SUPPORTED_TRACKED_MODES = new Set(["100644", "100755"]);
const HASH_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DEFAULT_EXCLUDED_PREFIXES = Object.freeze([
  ".git",
  ".worktrees",
  "worktrees",
  ".claude/worktrees",
  "extension/dist",
  "dist",
  ".vite",
  "artifacts",
  "test-results",
  "playwright-report",
  "RESOURCES",
  "coverage",
]);
const DEFAULT_EXCLUDED_SEGMENTS = new Set(["node_modules", "__pycache__"]);
const PRESERVED_GIT_IDENTITY_KEYS = new Set([
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
]);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function integrityError(message) {
  return new Error(`Release input integrity failure: ${message}`);
}

function normalizeRelativePath(relativePath) {
  return relativePath.replaceAll("\\", "/");
}

function canonicalPathKey(relativePath) {
  return relativePath.normalize("NFC").toLowerCase();
}

function assertValidRelativePath(relativePath) {
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\")) {
    throw integrityError(`unsupported repository path '${relativePath}'`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw integrityError(`non-canonical repository path '${relativePath}'`);
  }
  if (path.posix.normalize(relativePath) !== relativePath) {
    throw integrityError(`non-canonical repository path '${relativePath}'`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(relativePath)) {
    throw integrityError(`control characters are not supported in release path '${relativePath}'`);
  }
}

export function createSanitizedGitEnvironment(source = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (key.startsWith("GIT_") && !PRESERVED_GIT_IDENTITY_KEYS.has(key)) continue;
    environment[key] = value;
  }

  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.LC_ALL = "C";
  environment.LANG = "C";
  return environment;
}

function gitInvocation(repositoryRoot, args, options = {}) {
  const environment = createSanitizedGitEnvironment(options.environment ?? process.env);
  return spawnSync("git", ["--no-replace-objects", "-C", repositoryRoot, ...args], {
    env: environment,
    input: options.input,
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    maxBuffer: options.maxBuffer ?? 512 * 1024 * 1024,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function formatGitFailure(args, result) {
  const stderr = Buffer.isBuffer(result.stderr)
    ? result.stderr.toString("utf8")
    : String(result.stderr ?? "");
  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout.toString("utf8")
    : String(result.stdout ?? "");
  const detail = stderr.trim() || stdout.trim() || result.error?.message || `exit ${result.status}`;
  return integrityError(`git ${args.join(" ")} failed: ${detail}`);
}

export function runReleaseGit(repositoryRoot, args, options = {}) {
  const result = gitInvocation(repositoryRoot, args, options);
  if (result.error || result.status !== 0) throw formatGitFailure(args, result);
  if (Buffer.isBuffer(result.stdout)) return result.stdout;
  return String(result.stdout ?? "").trim();
}

function tryReleaseGit(repositoryRoot, args, options = {}) {
  const result = gitInvocation(repositoryRoot, args, options);
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout)
      ? result.stdout
      : String(result.stdout ?? ""),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : String(result.stderr ?? ""),
    error: result.error,
  };
}

function resolveRepositoryRoot(repositoryRoot, environment) {
  const requested = fs.realpathSync.native(path.resolve(repositoryRoot));
  const stats = fs.lstatSync(requested);
  if (!stats.isDirectory()) {
    throw integrityError(`repository root is not a directory: ${requested}`);
  }
  const reported = String(
    runReleaseGit(requested, ["rev-parse", "--show-toplevel"], { environment }),
  );
  const reportedReal = fs.realpathSync.native(reported);
  if (reportedReal !== requested) {
    throw integrityError(
      `Git top-level '${reportedReal}' does not match requested release root '${requested}'`,
    );
  }
  const inside = String(
    runReleaseGit(requested, ["rev-parse", "--is-inside-work-tree"], { environment }),
  );
  if (inside !== "true") {
    throw integrityError(`release root is not a Git worktree: ${requested}`);
  }
  return requested;
}

function assertSelfContainedObjectStore(repositoryRoot, environment) {
  const shallow = String(
    runReleaseGit(repositoryRoot, ["rev-parse", "--is-shallow-repository"], { environment }),
  );
  if (shallow === "true") {
    throw integrityError("release must run from a non-shallow repository");
  }

  const alternatesValue = String(
    runReleaseGit(repositoryRoot, ["rev-parse", "--git-path", "objects/info/alternates"], {
      environment,
    }),
  );
  const alternatesPath = path.isAbsolute(alternatesValue)
    ? alternatesValue
    : path.resolve(repositoryRoot, alternatesValue);
  if (fs.existsSync(alternatesPath) && fs.readFileSync(alternatesPath, "utf8").trim()) {
    throw integrityError("repository object alternates are not allowed for a release attestation");
  }

  const replacements = String(
    runReleaseGit(repositoryRoot, ["for-each-ref", "--format=%(refname)", "refs/replace/"], {
      environment,
    }),
  );
  if (replacements) {
    throw integrityError("replace refs are not allowed for a release attestation");
  }

  const promisor = tryReleaseGit(
    repositoryRoot,
    ["config", "--local", "--get-regexp", "^(extensions\\.partialClone|remote\\..*\\.promisor)$"],
    { environment },
  );
  if (promisor.ok && String(promisor.stdout).trim()) {
    throw integrityError("partial-clone/promisor object stores are not allowed for a release attestation");
  }
  if (!promisor.ok && promisor.status !== 1) {
    throw formatGitFailure(
      ["config", "--local", "--get-regexp", "promisor configuration"],
      promisor,
    );
  }
}

function splitNulRecords(buffer) {
  const records = [];
  let start = 0;
  while (start < buffer.length) {
    const end = buffer.indexOf(0, start);
    if (end === -1) throw integrityError("unterminated NUL record from git ls-tree");
    if (end > start) records.push(buffer.subarray(start, end));
    start = end + 1;
  }
  return records;
}

function decodeUtf8Path(pathBytes) {
  try {
    return UTF8_DECODER.decode(pathBytes);
  } catch {
    throw integrityError("non-UTF-8 repository paths are not supported by the release gate");
  }
}

function readTreeEntries(repositoryRoot, tree, environment) {
  const output = runReleaseGit(
    repositoryRoot,
    ["ls-tree", "-rz", "--full-tree", tree],
    { environment, encoding: null },
  );
  const entries = [];
  const canonicalPaths = new Map();

  for (const record of splitNulRecords(output)) {
    const tab = record.indexOf(0x09);
    if (tab === -1) throw integrityError("malformed git ls-tree record");
    const header = record.subarray(0, tab).toString("ascii");
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(header);
    if (!match) throw integrityError(`malformed git ls-tree header '${header}'`);
    const [, mode, type, oid] = match;
    const relativePath = decodeUtf8Path(record.subarray(tab + 1));
    assertValidRelativePath(relativePath);

    const collisionKey = canonicalPathKey(relativePath);
    const existing = canonicalPaths.get(collisionKey);
    if (existing && existing !== relativePath) {
      throw integrityError(`filesystem case collision between '${existing}' and '${relativePath}'`);
    }
    canonicalPaths.set(collisionKey, relativePath);

    if (mode === "160000" || type === "commit") {
      throw integrityError(`gitlink '${relativePath}' is not a supported release input`);
    }
    if (mode === "120000") {
      throw integrityError(`symbolic link '${relativePath}' is not a supported release input`);
    }
    if (!SUPPORTED_TRACKED_MODES.has(mode) || type !== "blob") {
      throw integrityError(
        `unsupported tracked mode/type ${mode} ${type} for release input '${relativePath}'`,
      );
    }
    entries.push({ path: relativePath, mode, oid });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return entries;
}

function readCommittedBlobs(repositoryRoot, entries, environment) {
  if (entries.length === 0) return new Map();
  const input = Buffer.from(`${entries.map((entry) => entry.oid).join("\n")}\n`, "ascii");
  const result = gitInvocation(repositoryRoot, ["cat-file", "--batch"], {
    environment,
    input,
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw formatGitFailure(["cat-file", "--batch"], result);
  }

  const output = result.stdout;
  const blobs = new Map();
  let offset = 0;
  for (const entry of entries) {
    const newline = output.indexOf(0x0a, offset);
    if (newline === -1) throw integrityError(`missing cat-file header for '${entry.path}'`);
    const header = output.subarray(offset, newline).toString("ascii");
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (\d+)$/.exec(header);
    if (!match || match[1] !== entry.oid) {
      throw integrityError(`unexpected cat-file response for '${entry.path}': '${header}'`);
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw integrityError(`invalid blob size for '${entry.path}'`);
    }
    const contentStart = newline + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw integrityError(`truncated cat-file response for '${entry.path}'`);
    }
    blobs.set(entry.path, Buffer.from(output.subarray(contentStart, contentEnd)));
    offset = contentEnd + 1;
  }
  if (offset !== output.length) {
    throw integrityError("unexpected trailing bytes from git cat-file --batch");
  }
  return blobs;
}

function trackedDirectorySet(entries) {
  const directories = new Set([""]);
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

function isExcludedProjectPath(relativePath, excludedPrefixes) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => DEFAULT_EXCLUDED_SEGMENTS.has(segment))) return true;
  return excludedPrefixes.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  );
}

function assertContainedRealPath(repositoryRoot, absolutePath, relativePath) {
  const realPath = fs.realpathSync.native(absolutePath);
  const rootWithSeparator = repositoryRoot.endsWith(path.sep)
    ? repositoryRoot
    : `${repositoryRoot}${path.sep}`;
  if (realPath !== repositoryRoot && !realPath.startsWith(rootWithSeparator)) {
    throw integrityError(`linked project input '${relativePath}' escapes the release root`);
  }
  if (path.resolve(realPath) !== path.resolve(absolutePath)) {
    throw integrityError(`linked project input '${relativePath}' is not a direct filesystem path`);
  }
}

function assertTrackedFilesystemEntry(repositoryRoot, entry, expectedBytes, allowByteChange) {
  const absolutePath = path.join(repositoryRoot, ...entry.path.split("/"));
  const segments = entry.path.split("/");
  let current = repositoryRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      throw integrityError(`tracked release input '${entry.path}' is missing from the worktree`);
    }
    if (stats.isSymbolicLink()) {
      throw integrityError(`symbolic link or junction encountered at '${entry.path}'`);
    }
    if (index < segments.length - 1) {
      if (!stats.isDirectory()) {
        throw integrityError(`non-directory ancestor in tracked release input '${entry.path}'`);
      }
      continue;
    }
    if (!stats.isFile()) {
      throw integrityError(`unsupported filesystem entry for tracked release input '${entry.path}'`);
    }
    assertContainedRealPath(repositoryRoot, current, entry.path);
    if (process.platform !== "win32") {
      const executable = (stats.mode & 0o111) !== 0;
      const expectedExecutable = entry.mode === "100755";
      if (executable !== expectedExecutable) {
        throw integrityError(
          `filesystem executable mode differs from committed mode for '${entry.path}'`,
        );
      }
    }
    if (!allowByteChange) {
      const actualBytes = fs.readFileSync(current);
      if (!actualBytes.equals(expectedBytes)) {
        throw integrityError(`raw filesystem bytes differ from committed blob for '${entry.path}'`);
      }
    }
  }
}

function assertNoUntrackedProjectInputs(repositoryRoot, entries, excludedPrefixes) {
  const trackedFiles = new Set(entries.map((entry) => entry.path));
  const trackedDirectories = trackedDirectorySet(entries);
  const observedCanonicalPaths = new Map();

  function visit(relativeDirectory) {
    const absoluteDirectory = relativeDirectory
      ? path.join(repositoryRoot, ...relativeDirectory.split("/"))
      : repositoryRoot;
    const names = fs.readdirSync(absoluteDirectory).sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    for (const name of names) {
      const relativePath = normalizeRelativePath(
        relativeDirectory ? `${relativeDirectory}/${name}` : name,
      );
      if (isExcludedProjectPath(relativePath, excludedPrefixes)) continue;
      const absolutePath = path.join(repositoryRoot, ...relativePath.split("/"));
      const stats = fs.lstatSync(absolutePath);

      const collisionKey = canonicalPathKey(relativePath);
      const existing = observedCanonicalPaths.get(collisionKey);
      if (existing && existing !== relativePath) {
        throw integrityError(`filesystem case collision between '${existing}' and '${relativePath}'`);
      }
      observedCanonicalPaths.set(collisionKey, relativePath);

      if (stats.isSymbolicLink()) {
        throw integrityError(`linked project input '${relativePath}' is not allowed`);
      }
      if (trackedFiles.has(relativePath)) {
        if (!stats.isFile()) {
          throw integrityError(`unsupported filesystem entry for tracked release input '${relativePath}'`);
        }
        continue;
      }
      if (trackedDirectories.has(relativePath)) {
        if (!stats.isDirectory()) {
          throw integrityError(`tracked directory '${relativePath}' is not a directory`);
        }
        assertContainedRealPath(repositoryRoot, absolutePath, relativePath);
        visit(relativePath);
        continue;
      }
      if (!stats.isFile() && !stats.isDirectory()) {
        throw integrityError(`unsupported special filesystem entry '${relativePath}'`);
      }
      throw integrityError(`untracked or ignored project input '${relativePath}' is present`);
    }
  }

  visit("");
}

function resolveIdentity(repositoryRoot, environment) {
  const commit = String(
    runReleaseGit(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], { environment }),
  );
  const tree = String(
    runReleaseGit(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"], { environment }),
  );
  if (!HASH_RE.test(commit) || !HASH_RE.test(tree)) {
    throw integrityError(`Git returned a non-full commit/tree identity (${commit}, ${tree})`);
  }
  runReleaseGit(repositoryRoot, ["cat-file", "-e", `${commit}^{commit}`], { environment });
  runReleaseGit(repositoryRoot, ["cat-file", "-e", `${tree}^{tree}`], { environment });
  return { commit, tree };
}

function normalizeAllowedPaths(paths) {
  const normalized = [...new Set(paths.map(normalizeRelativePath))].sort();
  for (const relativePath of normalized) assertValidRelativePath(relativePath);
  return normalized;
}

function createSnapshot(repositoryRoot, identity, entries, excludedPrefixes) {
  return Object.freeze({
    repositoryRoot,
    commit: identity.commit,
    tree: identity.tree,
    entries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry }))),
    excludedPrefixes: Object.freeze([...excludedPrefixes]),
  });
}

export function assertExactCommittedInputs(repositoryRoot, options = {}) {
  const environment = createSanitizedGitEnvironment(options.environment ?? process.env);
  const root = resolveRepositoryRoot(repositoryRoot, environment);
  assertSelfContainedObjectStore(root, environment);
  const identity = resolveIdentity(root, environment);
  if (options.expectedCommit && identity.commit !== options.expectedCommit) {
    throw integrityError(
      `HEAD changed: expected commit ${options.expectedCommit}, observed ${identity.commit}`,
    );
  }
  if (options.expectedTree && identity.tree !== options.expectedTree) {
    throw integrityError(`tree changed: expected ${options.expectedTree}, observed ${identity.tree}`);
  }

  const entries = readTreeEntries(root, identity.tree, environment);
  const blobs = readCommittedBlobs(root, entries, environment);
  for (const entry of entries) {
    assertTrackedFilesystemEntry(root, entry, blobs.get(entry.path), false);
  }
  const excludedPrefixes = normalizeAllowedPaths(
    options.excludedPrefixes ?? DEFAULT_EXCLUDED_PREFIXES,
  );
  assertNoUntrackedProjectInputs(root, entries, excludedPrefixes);
  return createSnapshot(root, identity, entries, excludedPrefixes);
}

export function assertReleaseSnapshotUnchanged(snapshot, options = {}) {
  const allowedChangedPaths = new Set(normalizeAllowedPaths(options.allowedChangedPaths ?? []));
  const environment = createSanitizedGitEnvironment(
    options.environment ?? process.env,
  );
  const root = resolveRepositoryRoot(snapshot.repositoryRoot, environment);
  const identity = resolveIdentity(root, environment);
  if (identity.commit !== snapshot.commit || identity.tree !== snapshot.tree) {
    throw integrityError(
      `Git HEAD/tree changed after the release snapshot (${snapshot.commit}/${snapshot.tree} -> ${identity.commit}/${identity.tree})`,
    );
  }

  const indexTree = String(runReleaseGit(root, ["write-tree"], { environment }));
  if (indexTree !== snapshot.tree) {
    throw integrityError("Git index changed after the release snapshot");
  }

  const entries = snapshot.entries.map((entry) => ({ ...entry }));
  const blobs = readCommittedBlobs(root, entries, environment);
  for (const entry of entries) {
    assertTrackedFilesystemEntry(
      root,
      entry,
      blobs.get(entry.path),
      allowedChangedPaths.has(entry.path),
    );
  }
  assertNoUntrackedProjectInputs(root, entries, snapshot.excludedPrefixes);
  return true;
}

function entryMap(snapshot) {
  return new Map(snapshot.entries.map((entry) => [entry.path, entry]));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function capturePreparedReleaseChanges(initialSnapshot, options = {}) {
  const allowedChangedPaths = normalizeAllowedPaths(options.allowedChangedPaths ?? []);
  assertReleaseSnapshotUnchanged(initialSnapshot, {
    allowedChangedPaths,
    environment: options.environment,
  });

  const initialEntries = entryMap(initialSnapshot);
  const changes = allowedChangedPaths.map((relativePath) => {
    const entry = initialEntries.get(relativePath);
    if (!entry) {
      throw integrityError(`declared release path is not tracked: ${relativePath}`);
    }
    const absolutePath = path.join(
      initialSnapshot.repositoryRoot,
      ...relativePath.split("/"),
    );
    const bytes = fs.readFileSync(absolutePath);
    return Object.freeze({
      path: relativePath,
      size: bytes.length,
      sha256: sha256(bytes),
    });
  });

  return Object.freeze({
    repositoryRoot: initialSnapshot.repositoryRoot,
    initialCommit: initialSnapshot.commit,
    initialTree: initialSnapshot.tree,
    changes: Object.freeze(changes),
  });
}

export function assertReleaseCommitScope(initialSnapshot, releaseSnapshot, options = {}) {
  if (initialSnapshot.repositoryRoot !== releaseSnapshot.repositoryRoot) {
    throw integrityError("initial and release snapshots come from different worktrees");
  }
  const allowedChangedPaths = normalizeAllowedPaths(options.allowedChangedPaths ?? []);
  const allowedSet = new Set(allowedChangedPaths);
  const environment = createSanitizedGitEnvironment(
    options.environment ?? process.env,
  );
  const parentLine = String(
    runReleaseGit(
      releaseSnapshot.repositoryRoot,
      ["rev-list", "--parents", "-n", "1", releaseSnapshot.commit],
      { environment },
    ),
  );
  const commitAndParents = parentLine.split(/\s+/u).filter(Boolean);
  if (
    commitAndParents.length !== 2 ||
    commitAndParents[0] !== releaseSnapshot.commit ||
    commitAndParents[1] !== initialSnapshot.commit
  ) {
    throw integrityError(
      `release commit must have exactly the attested initial commit ${initialSnapshot.commit} as its parent`,
    );
  }

  const initialEntries = entryMap(initialSnapshot);
  const releaseEntries = entryMap(releaseSnapshot);
  const paths = new Set([...initialEntries.keys(), ...releaseEntries.keys()]);
  const changed = [];
  for (const relativePath of [...paths].sort()) {
    const initial = initialEntries.get(relativePath);
    const release = releaseEntries.get(relativePath);
    if (!initial || !release || initial.mode !== release.mode || initial.oid !== release.oid) {
      changed.push(relativePath);
    }
  }

  const undeclared = changed.filter((relativePath) => !allowedSet.has(relativePath));
  if (undeclared.length > 0) {
    throw integrityError(`undeclared release path changed: ${undeclared.join(", ")}`);
  }
  const missing = allowedChangedPaths.filter((relativePath) => !changed.includes(relativePath));
  if ((options.requireAllAllowedPaths ?? true) && missing.length > 0) {
    throw integrityError(`declared release path did not change: ${missing.join(", ")}`);
  }

  if (options.preparedChanges) {
    const prepared = options.preparedChanges;
    if (
      prepared.repositoryRoot !== initialSnapshot.repositoryRoot ||
      prepared.initialCommit !== initialSnapshot.commit ||
      prepared.initialTree !== initialSnapshot.tree
    ) {
      throw integrityError("prepared release bytes do not belong to the initial snapshot");
    }
    const preparedByPath = new Map(
      prepared.changes.map((change) => [change.path, change]),
    );
    const preparedPaths = [...preparedByPath.keys()].sort();
    if (JSON.stringify(preparedPaths) !== JSON.stringify(allowedChangedPaths)) {
      throw integrityError("prepared release bytes do not cover exactly the declared paths");
    }
    const releaseBlobs = readCommittedBlobs(
      releaseSnapshot.repositoryRoot,
      allowedChangedPaths.map((relativePath) => {
        const entry = releaseEntries.get(relativePath);
        if (!entry) throw integrityError(`release commit removed declared path '${relativePath}'`);
        return entry;
      }),
      environment,
    );
    for (const relativePath of allowedChangedPaths) {
      const preparedChange = preparedByPath.get(relativePath);
      const releaseBytes = releaseBlobs.get(relativePath);
      if (
        !preparedChange ||
        !releaseBytes ||
        releaseBytes.length !== preparedChange.size ||
        sha256(releaseBytes) !== preparedChange.sha256
      ) {
        throw integrityError(
          `prepared release bytes differ from committed blob for '${relativePath}'`,
        );
      }
    }
  }
  return Object.freeze({ changedPaths: Object.freeze(changed) });
}
