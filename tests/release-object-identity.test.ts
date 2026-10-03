import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeReleaseTempRoot } from "./helpers/release_temp_cleanup";
import {
  assertExactCommittedInputs,
  assertReleaseCommitScope,
  assertReleaseSnapshotUnchanged,
  capturePreparedReleaseChanges,
} from "../scripts/release-input-integrity.mjs";

type ObjectFormat = "sha1" | "sha256";
const roots: string[] = [];
function git(root: string, args: string[], input?: Buffer): Buffer {
  return execFileSync("git", args, { cwd: root, input, stdio: ["pipe", "pipe", "pipe"] });
}
function oid(root: string, name: string): string {
  return git(root, ["rev-parse", name]).toString().trim();
}
function repository(format: ObjectFormat): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ns-object-identity-")));
  roots.push(root);
  git(root, ["init", "-b", "main", `--object-format=${format}`]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "user.name", "Release Object Test"]);
  git(root, ["config", "user.email", "release-object@example.invalid"]);
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "package.json"), '{"version":"0.0.0"}\n');
  fs.writeFileSync(path.join(root, "src", "input.txt"), "committed\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "fixture"]);
  return root;
}
function substitute(root: string, object: string, type: "blob" | "tree" | "commit", body: Buffer): void {
  const raw = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
  expect(createHash(object.length === 40 ? "sha1" : "sha256").update(raw).digest("hex")).not.toBe(object);
  const location = path.join(root, ".git", "objects", object.slice(0, 2), object.slice(2));
  fs.mkdirSync(path.dirname(location), { recursive: true });
  // Only disposable fixture objects are replaced. A syntactically valid loose
  // object can be read by cat-file under a filename that is not its own digest.
  fs.rmSync(location, { force: true });
  fs.writeFileSync(location, deflateSync(raw));
  expect(git(root, ["cat-file", type, object])).toEqual(body);
  expect(git(root, ["for-each-ref", "refs/replace/"]).length).toBe(0);
}
function editCommit(root: string, commit: string): void {
  const body = git(root, ["cat-file", "commit", commit]);
  substitute(root, commit, "commit", Buffer.concat([body, Buffer.from("changed identity\n")]));
}
function editTree(root: string, tree: string): void {
  const body = git(root, ["cat-file", "tree", tree]);
  const changed = Buffer.from(body);
  const index = body.indexOf(Buffer.from("100644 "));
  expect(index).toBeGreaterThanOrEqual(0);
  changed.write("100755 ", index, "ascii");
  substitute(root, tree, "tree", changed);
}
afterEach(() => {
  for (const root of roots.splice(0)) removeReleaseTempRoot(root);
});

describe.each<ObjectFormat>(["sha1", "sha256"])("release object identity (%s)", (format) => {
  it("accepts packed objects, empty/binary blobs and UTF-8 nested paths", () => {
    const root = repository(format);
    fs.writeFileSync(path.join(root, "src", "données.txt"), Buffer.from([0, 0xff, 0x0a, 0x80]));
    fs.writeFileSync(path.join(root, "empty.txt"), "");
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "binary input"]);
    git(root, ["repack", "-ad"]);
    const snapshot = assertExactCommittedInputs(root);
    expect(snapshot.commit).toHaveLength(format === "sha1" ? 40 : 64);
    expect(snapshot.entries.map((entry) => entry.path)).toContain("src/données.txt");
    expect(assertReleaseSnapshotUnchanged(snapshot)).toBe(true);
  });

  it("rejects a hash-valid tree whose non-ASCII mode resembles a supported mode", () => {
    const root = repository(format);
    const rawTree = git(root, ["cat-file", "tree", "HEAD^{tree}"]);
    rawTree[0] = rawTree.readUInt8(0) | 0x80;
    const tree = git(root, ["hash-object", "--literally", "-w", "-t", "tree", "--stdin"], rawTree).toString().trim();
    const commitBody = git(root, ["cat-file", "commit", "HEAD"]).toString().replace(/^tree [0-9a-f]+/u, `tree ${tree}`);
    const commit = git(root, ["hash-object", "-w", "-t", "commit", "--stdin"], Buffer.from(commitBody)).toString().trim();
    git(root, ["update-ref", "refs/heads/main", commit]);
    expect(() => assertExactCommittedInputs(root)).toThrow(/unsupported tracked mode|malformed tree/i);
  });

  it("rejects a substituted blob even when raw worktree bytes match it", () => {
    const root = repository(format);
    const commit = oid(root, "HEAD");
    const blob = oid(root, "HEAD:src/input.txt");
    const bytes = Buffer.from("substituted\n");
    substitute(root, blob, "blob", bytes);
    fs.writeFileSync(path.join(root, "src", "input.txt"), bytes);
    expect(oid(root, "HEAD")).toBe(commit);
    expect(() => assertExactCommittedInputs(root, { expectedCommit: commit })).toThrow(/hash mismatch/i);
  });

  it.each(["HEAD^{tree}", "HEAD:src"])("rejects substituted tree content at %s", (treeName) => {
    const root = repository(format);
    const commit = oid(root, "HEAD");
    editTree(root, oid(root, treeName));
    // Align the filesystem with the substituted tree so raw-byte/mode checks
    // cannot conceal the missing object-identity check on the old implementation.
    fs.chmodSync(path.join(root, treeName === "HEAD:src" ? "src/input.txt" : "package.json"), 0o755);
    expect(oid(root, "HEAD")).toBe(commit);
    expect(() => assertExactCommittedInputs(root, { expectedCommit: commit })).toThrow(/hash mismatch/i);
  });

  it("rejects a substituted commit under the same HEAD and tree identifiers", () => {
    const root = repository(format);
    const snapshot = assertExactCommittedInputs(root);
    editCommit(root, snapshot.commit);
    expect(oid(root, "HEAD")).toBe(snapshot.commit);
    expect(git(root, ["cat-file", "commit", snapshot.commit]).toString()).toContain(`tree ${snapshot.tree}\n`);
    expect(() => assertExactCommittedInputs(root, { expectedCommit: snapshot.commit, expectedTree: snapshot.tree }))
      .toThrow(/hash mismatch/i);
  });

  it.each(["commit", "tree", "blob"])("rechecks %s identity at the pre-commit snapshot boundary", (type) => {
    const root = repository(format);
    const snapshot = assertExactCommittedInputs(root);
    if (type === "commit") editCommit(root, snapshot.commit);
    else if (type === "tree") editTree(root, oid(root, "HEAD:src"));
    else {
      const bytes = Buffer.from('{"version":"0.0.1"}\n');
      substitute(root, oid(root, "HEAD:package.json"), "blob", bytes);
      fs.writeFileSync(path.join(root, "package.json"), bytes);
    }
    expect(() => assertReleaseSnapshotUnchanged(snapshot, { allowedChangedPaths: ["package.json"] }))
      .toThrow(/hash mismatch/i);
  });

  it("does not let a Git graft hide an extra release parent", () => {
    const root = repository(format);
    const initial = assertExactCommittedInputs(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"version":"0.0.1"}\n');
    git(root, ["add", "package.json"]);
    const tree = git(root, ["write-tree"]).toString().trim();
    const otherParent = git(root, ["commit-tree", initial.tree, "-m", "unrelated root"]).toString().trim();
    const releaseCommit = git(root, ["commit-tree", tree, "-p", initial.commit, "-p", otherParent, "-m", "merge release"]).toString().trim();
    git(root, ["update-ref", "refs/heads/main", releaseCommit]);
    const release = assertExactCommittedInputs(root);
    fs.writeFileSync(path.join(root, ".git", "info", "grafts"), `${releaseCommit} ${initial.commit}\n`);
    expect(git(root, ["rev-list", "--parents", "-n", "1", releaseCommit]).toString().trim())
      .toBe(`${releaseCommit} ${initial.commit}`);
    expect(() => assertReleaseCommitScope(initial, release, { allowedChangedPaths: ["package.json"] }))
      .toThrow(/exactly the attested initial commit|graft/i);
  });

  it("rechecks release commit identity rather than trusting an earlier snapshot", () => {
    const root = repository(format);
    const initial = assertExactCommittedInputs(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"version":"0.0.1"}\n');
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-m", "release"]);
    const release = assertExactCommittedInputs(root);
    editCommit(root, release.commit);
    expect(() => assertReleaseCommitScope(initial, release, { allowedChangedPaths: ["package.json"] }))
      .toThrow(/hash mismatch/i);
  });

  it("rejects a substituted release blob even when it matches prepared metadata", () => {
    const root = repository(format);
    const initial = assertExactCommittedInputs(root);
    const preparedBytes = Buffer.from('{"version":"0.0.1"}\n');
    fs.writeFileSync(path.join(root, "package.json"), preparedBytes);
    const prepared = capturePreparedReleaseChanges(initial, { allowedChangedPaths: ["package.json"] });
    fs.writeFileSync(path.join(root, "package.json"), '{"version":"hook-changed"}\n');
    git(root, ["add", "package.json"]);
    git(root, ["commit", "-m", "release"]);
    const release = assertExactCommittedInputs(root);
    substitute(root, oid(root, "HEAD:package.json"), "blob", preparedBytes);
    expect(() => assertReleaseCommitScope(initial, release, {
      allowedChangedPaths: ["package.json"], preparedChanges: prepared,
    })).toThrow(/hash mismatch/i);
  });
});
