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
import { stripSensitiveEnvironment } from "./sensitive-environment.mjs";

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
// Git paths are byte identities, not text documents. Preserve a leading U+FEFF
// rather than interpreting it as an encoding signature and stripping it.
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

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
  const environment = stripSensitiveEnvironment(source, {
    preserveNormalizedKeys: [...PRESERVED_GIT_IDENTITY_KEYS],
  });
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.LC_ALL = "C";
  environment.LANG = "C";
  return environment;
}

export function resolveReleaseCommand(command, args, options = {}) {
  if (command !== "npm") return { command, args: [...args] };
  const npmExecPath = options.npmExecPath ?? process.env.npm_execpath;
  if (typeof npmExecPath !== "string" || !path.isAbsolute(npmExecPath)) {
    throw integrityError(
      "absolute npm CLI path is unavailable; invoke release through an npm release script so npm_execpath is set",
    );
  }
  let resolvedNpmExecPath;
  try {
    resolvedNpmExecPath = fs.realpathSync.native(npmExecPath);
  } catch (error) {
    throw integrityError(
      `npm_execpath cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!fs.lstatSync(resolvedNpmExecPath).isFile()) {
    throw integrityError("npm_execpath does not name an ordinary file");
  }
  return {
    command: options.nodeExecutable ?? process.execPath,
    args: [resolvedNpmExecPath, ...args],
  };
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

function decodeUtf8Path(pathBytes) {
  try {
    return UTF8_DECODER.decode(pathBytes);
  } catch {
    throw integrityError("non-UTF-8 repository paths are not supported by the release gate");
  }
}

// cat-file reports the requested OID even when a loose object's filename no
// longer matches its content. Authenticate exactly the bytes we consume, not
// only Git's projection of their type, paths or history.
function readGitObjects(repositoryRoot, objects, environment) {
  if (objects.length === 0) return new Map();
  const unique = new Map();
  for (const object of objects) {
    if (!HASH_RE.test(object.oid) || !["commit", "tree", "blob"].includes(object.type)) {
      throw integrityError("invalid object request");
    }
    const previous = unique.get(object.oid);
    if (previous && previous.type !== object.type) throw integrityError("conflicting object types");
    unique.set(object.oid, object);
  }
  const input = Buffer.from(`${[...unique.keys()].join("\n")}\n`, "ascii");
  const result = gitInvocation(repositoryRoot, ["cat-file", "--batch"], {
    environment, input, encoding: null, maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw formatGitFailure(["cat-file", "--batch"], result);
  const output = result.stdout;
  const contents = new Map();
  let offset = 0;
  for (const { oid, type } of unique.values()) {
    const newline = output.indexOf(0x0a, offset);
    if (newline === -1) throw integrityError(`missing cat-file header for ${oid}`);
    const header = output.subarray(offset, newline).toString("ascii");
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (commit|tree|blob) (0|[1-9]\d*)$/.exec(header);
    if (!match || match[1] !== oid || match[2] !== type) {
      throw integrityError(`unexpected cat-file response for ${oid}: '${header}'`);
    }
    const size = Number(match[3]);
    const start = newline + 1;
    const end = start + size;
    if (!Number.isSafeInteger(size) || !Number.isSafeInteger(end) ||
        end >= output.length || output[end] !== 0x0a) {
      throw integrityError(`invalid or truncated cat-file body for ${oid}`);
    }
    const body = output.subarray(start, end);
    const actual = createHash(oid.length === 40 ? "sha1" : "sha256")
      .update(`${type} ${size}\0`, "ascii").update(body).digest("hex");
    if (actual !== oid) throw integrityError(`object hash mismatch for ${type} ${oid}`);
    contents.set(oid, body);
    offset = end + 1;
  }
  if (offset !== output.length) throw integrityError("unexpected trailing bytes from git cat-file --batch");
  return contents;
}

function readTreeEntries(repositoryRoot, tree, environment) {
  const entries = [];
  const canonicalPaths = new Map();
  let pending = [{ path: "", oid: tree, type: "tree" }];
  // Parse only authenticated binary tree bodies. A second ls-tree invocation
  // could otherwise project a different object between verification and use.
  while (pending.length > 0) {
    const trees = readGitObjects(repositoryRoot, pending, environment);
    const next = [];
    for (const directory of pending) {
      const body = trees.get(directory.oid);
      const oidBytes = directory.oid.length / 2;
      let offset = 0;
      while (offset < body.length) {
        const space = body.indexOf(0x20, offset);
        const nul = body.indexOf(0, space + 1);
        if (space < offset || nul <= space + 1 || nul + 1 + oidBytes > body.length) {
          throw integrityError(`malformed tree object ${directory.oid}`);
        }
        const mode = body.subarray(offset, space).toString("utf8");
        const name = decodeUtf8Path(body.subarray(space + 1, nul));
        if (name.includes("/")) throw integrityError(`non-canonical tree entry '${name}'`);
        const relativePath = directory.path ? `${directory.path}/${name}` : name;
        assertValidRelativePath(relativePath);
        const key = canonicalPathKey(relativePath);
        if (canonicalPaths.has(key)) {
          throw integrityError(`filesystem case collision or duplicate tree path '${relativePath}'`);
        }
        canonicalPaths.set(key, relativePath);
        const oid = body.subarray(nul + 1, nul + 1 + oidBytes).toString("hex");
        offset = nul + 1 + oidBytes;
        if (mode === "40000") {
          next.push({ path: relativePath, oid, type: "tree" });
          continue;
        }
        if (mode === "160000") throw integrityError(`gitlink '${relativePath}' is not a supported release input`);
        if (mode === "120000") throw integrityError(`symbolic link '${relativePath}' is not a supported release input`);
        if (!SUPPORTED_TRACKED_MODES.has(mode)) {
          throw integrityError(`unsupported tracked mode ${mode} for release input '${relativePath}'`);
        }
        entries.push({ path: relativePath, mode, oid });
      }
    }
    pending = next;
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return entries;
}

function readCommittedBlobs(repositoryRoot, entries, environment) {
  const objects = readGitObjects(repositoryRoot, entries.map((entry) => ({ ...entry, type: "blob" })), environment);
  return new Map(entries.map((entry) => [entry.path, objects.get(entry.oid)]));
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

function isAncestorOfExcludedProjectPath(relativePath, excludedPrefixes) {
  return excludedPrefixes.some((prefix) => prefix.startsWith(`${relativePath}/`));
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
      if (
        stats.isDirectory() &&
        isAncestorOfExcludedProjectPath(relativePath, excludedPrefixes)
      ) {
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

function readCommitIdentity(repositoryRoot, commit, environment) {
  const body = readGitObjects(repositoryRoot, [{ oid: commit, type: "commit" }], environment).get(commit);
  const headerEnd = body.indexOf(Buffer.from("\n\n"));
  if (headerEnd < 0) throw integrityError(`malformed commit headers for ${commit}`);
  const headers = body.subarray(0, headerEnd).toString("utf8").split("\n");
  const tree = headers[0].startsWith("tree ") ? headers[0].slice(5) : "";
  const parents = headers.filter((line) => line.startsWith("parent ")).map((line) => line.slice(7));
  if (!HASH_RE.test(tree) || tree.length !== commit.length ||
      headers.slice(1).some((line) => line.startsWith("tree ")) ||
      parents.some((parent) => !HASH_RE.test(parent) || parent.length !== commit.length)) {
    throw integrityError(`malformed tree/parent identity in commit ${commit}`);
  }
  return { commit, tree, parents };
}

function resolveIdentity(repositoryRoot, environment) {
  const commit = String(runReleaseGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"], { environment }));
  if (!HASH_RE.test(commit)) throw integrityError(`Git returned a non-full commit identity (${commit})`);
  return readCommitIdentity(repositoryRoot, commit, environment);
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

  const entries = readTreeEntries(root, identity.tree, environment);
  if (JSON.stringify(entries) !== JSON.stringify(snapshot.entries)) {
    throw integrityError("committed tree entries changed after the release snapshot");
  }
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
  // rev-list can hide parents through grafts or commit-graph projections.
  // Parentage must come from the same authenticated raw object as its tree.
  const identity = readCommitIdentity(releaseSnapshot.repositoryRoot, releaseSnapshot.commit, environment);
  if (identity.tree !== releaseSnapshot.tree) throw integrityError("release tree differs from its snapshot");
  if (identity.parents.length !== 1 || identity.parents[0] !== initialSnapshot.commit) {
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
