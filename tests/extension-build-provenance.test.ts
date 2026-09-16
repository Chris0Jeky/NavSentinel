import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertCurrentHeadBuildInputs,
  assertExtensionBuildOutputHash,
  hashCanonicalWorktreeFiles,
  hashExtensionBuildOutput,
  hashGitFiles,
  resetExtensionBuildOutput,
  sanitizedGitEnvironment,
} from "./e2e/extension_build_provenance";

const temporaryPaths: string[] = [];

function git(repositoryRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function commit(repositoryRoot: string, message: string): string {
  git(repositoryRoot, ["commit", "--quiet", "-m", message]);
  return git(repositoryRoot, ["rev-parse", "HEAD"]);
}

function createRepository(): { root: string; head: string; configPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-build-provenance-"));
  temporaryPaths.push(root);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "NavSentinel Tests"]);
  git(root, ["config", "user.email", "navsentinel-tests@example.invalid"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "core.eol", "lf"]);
  const configPath = path.join(root, "config", "release-profiles.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{"defaultProfile":"interaction-only"}\n', "utf8");
  git(root, ["add", "--", "config/release-profiles.json"]);
  const head = commit(root, "fixture");
  return { root, head, configPath };
}

function addTrackedInput(
  repositoryRoot: string,
  relativePath = "extension/input.txt",
  content = "SAFE\n",
): string {
  const inputPath = path.join(repositoryRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.writeFileSync(inputPath, content, "utf8");
  git(repositoryRoot, ["add", "--", relativePath]);
  return inputPath;
}

function installMaskingCleanFilter(repositoryRoot: string): string {
  const filterScript = path.join(repositoryRoot, "mask-filter.cjs");
  fs.writeFileSync(
    filterScript,
    [
      'let input = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => { process.stdout.write(input.replaceAll("ATTACK", "SAFE")); });',
      "",
    ].join("\n"),
    "utf8",
  );
  const command = `"${process.execPath.replaceAll("\\", "/")}" "${filterScript.replaceAll("\\", "/")}"`;
  git(repositoryRoot, ["config", "filter.mask.clean", command]);
  git(repositoryRoot, ["config", "filter.mask.smudge", "cat"]);
  git(repositoryRoot, ["config", "filter.mask.required", "true"]);
  return filterScript;
}

function expectIntegrityCode(operation: () => unknown, code: string): void {
  expect(operation).toThrow(new RegExp(`\\[${code}\\]`, "u"));
}

function expectIntegrityCodeOneOf(operation: () => unknown, codes: string[]): void {
  expect(operation).toThrow(new RegExp(`\\[(?:${codes.join("|")})\\]`, "u"));
}

afterEach(() => {
  for (const target of temporaryPaths.splice(0).reverse()) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("state-authority extension build provenance", { timeout: 15_000 }, () => {
  it("records immutable commit, tree, object format and raw-byte equality", () => {
    const repository = createRepository();
    const attestation = assertCurrentHeadBuildInputs(repository.root, repository.head);

    expect(attestation.repositoryCommit).toBe(repository.head);
    expect(attestation.repositoryTree).toMatch(/^[0-9a-f]{40,64}$/u);
    expect(attestation.objectFormat).toMatch(/^sha(?:1|256)$/u);
    expect(attestation.comparisonMode).toBe("raw-blob-byte-equality");
    expect(attestation.gitSha256).toBe(attestation.executedSha256);
    expect(attestation.unexpectedInputCount).toBe(0);
    expect(attestation.specialInputCount).toBe(0);
  });

  it("fails closed when tracked release-profile configuration drifts from HEAD", () => {
    const repository = createRepository();
    const initial = assertCurrentHeadBuildInputs(repository.root, repository.head);
    expect(initial.files.map((file) => path.relative(repository.root, file).replaceAll("\\", "/"))).toEqual([
      "config/release-profiles.json",
    ]);

    fs.writeFileSync(repository.configPath, '{"defaultProfile":"tampered"}\n', "utf8");

    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(repository.root, repository.head),
      "RAW_BYTES_MISMATCH",
    );
  });

  it("rejects raw tampering concealed by a repository-local clean filter", () => {
    const repository = createRepository();
    const inputPath = addTrackedInput(repository.root);
    const filterScript = installMaskingCleanFilter(repository.root);
    fs.writeFileSync(path.join(repository.root, ".gitattributes"), "extension/input.txt filter=mask\n", "utf8");
    git(repository.root, [
      "add",
      "--",
      ".gitattributes",
      path.basename(filterScript),
      "extension/input.txt",
    ]);
    const head = commit(repository.root, "masked input");

    fs.writeFileSync(inputPath, "ATTACK\n", "utf8");
    git(repository.root, ["add", "--", "extension/input.txt"]);

    const filteredOid = git(repository.root, [
      "hash-object",
      "--filters",
      "--path=extension/input.txt",
      inputPath,
    ]);
    const committedOid = git(repository.root, ["rev-parse", `${head}:extension/input.txt`]);
    expect(filteredOid).toBe(committedOid);
    expect(git(repository.root, ["status", "--porcelain"])).toBe("");
    expect(fs.readFileSync(inputPath, "utf8")).toBe("ATTACK\n");

    expectIntegrityCode(() => assertCurrentHeadBuildInputs(repository.root, head), "RAW_BYTES_MISMATCH");
  });

  it("rejects CRLF materialization even when Git text normalization reports equality", () => {
    const repository = createRepository();
    const inputPath = addTrackedInput(repository.root, "extension/lines.txt", "one\ntwo\n");
    fs.writeFileSync(path.join(repository.root, ".gitattributes"), "extension/lines.txt text eol=lf\n", "utf8");
    git(repository.root, ["add", "--", ".gitattributes", "extension/lines.txt"]);
    const head = commit(repository.root, "LF input");

    fs.writeFileSync(inputPath, "one\r\ntwo\r\n", "utf8");
    git(repository.root, ["add", "--", "extension/lines.txt"]);

    expect(git(repository.root, ["status", "--porcelain"])).toBe("");
    expectIntegrityCode(() => assertCurrentHeadBuildInputs(repository.root, head), "RAW_BYTES_MISMATCH");
  });

  it("rejects ordinary and ignored unexpected build inputs", () => {
    const ordinary = createRepository();
    addTrackedInput(ordinary.root);
    const ordinaryHead = commit(ordinary.root, "tracked input");
    fs.writeFileSync(path.join(ordinary.root, "extension", "ordinary.ts"), "export {};\n", "utf8");
    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(ordinary.root, ordinaryHead),
      "UNEXPECTED_INPUT",
    );

    const ignored = createRepository();
    addTrackedInput(ignored.root);
    fs.writeFileSync(path.join(ignored.root, ".gitignore"), "extension/ignored.ts\n", "utf8");
    git(ignored.root, ["add", "--", ".gitignore", "extension/input.txt"]);
    const ignoredHead = commit(ignored.root, "ignored rule");
    fs.writeFileSync(path.join(ignored.root, "extension", "ignored.ts"), "export {};\n", "utf8");
    expect(git(ignored.root, ["check-ignore", "extension/ignored.ts"])).toBe("extension/ignored.ts");
    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(ignored.root, ignoredHead),
      "UNEXPECTED_INPUT",
    );
  });

  it("rejects committed symlinks and untracked directory links without following them", () => {
    const committed = createRepository();
    const symlinkBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: committed.root,
      input: "target\n",
      encoding: "utf8",
    }).trim();
    git(committed.root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${symlinkBlob},extension/link`,
    ]);
    const committedHead = commit(committed.root, "symlink entry");
    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(committed.root, committedHead),
      "UNSUPPORTED_TRACKED_MODE",
    );

    const untracked = createRepository();
    addTrackedInput(untracked.root);
    const untrackedHead = commit(untracked.root, "tracked input");
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-linked-input-target-"));
    temporaryPaths.push(target);
    fs.symlinkSync(
      target,
      path.join(untracked.root, "extension", "linked-dir"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(untracked.root, untrackedHead),
      "SPECIAL_INPUT",
    );
  });

  it("rejects index drift and a current HEAD different from the expected commit", () => {
    const repository = createRepository();
    const inputPath = addTrackedInput(repository.root);
    const head = commit(repository.root, "tracked input");

    fs.writeFileSync(inputPath, "staged change\n", "utf8");
    git(repository.root, ["add", "--", "extension/input.txt"]);
    fs.writeFileSync(inputPath, "SAFE\n", "utf8");
    expectIntegrityCode(() => assertCurrentHeadBuildInputs(repository.root, head), "INDEX_MISMATCH");

    git(repository.root, ["reset", "--hard", "--quiet", head]);
    fs.writeFileSync(path.join(repository.root, "outside.txt"), "outside\n", "utf8");
    git(repository.root, ["add", "--", "outside.txt"]);
    commit(repository.root, "advance HEAD");
    expectIntegrityCode(() => assertCurrentHeadBuildInputs(repository.root, head), "HEAD_MISMATCH");
  });

  it("classifies non-repositories and missing blob authority as invalid evidence", () => {
    const nonRepository = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-non-repository-"));
    temporaryPaths.push(nonRepository);
    expectIntegrityCode(() => assertCurrentHeadBuildInputs(nonRepository, "HEAD"), "NOT_A_REPOSITORY");

    const repository = createRepository();
    addTrackedInput(repository.root);
    const head = commit(repository.root, "tracked input");
    const oid = git(repository.root, ["rev-parse", `${head}:extension/input.txt`]);
    const looseObject = path.join(repository.root, ".git", "objects", oid.slice(0, 2), oid.slice(2));
    expect(fs.existsSync(looseObject)).toBe(true);
    fs.rmSync(looseObject);
    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(repository.root, head),
      "MISSING_OBJECT_AUTHORITY",
    );
  });

  it("supports a detached linked worktree at the same immutable commit", () => {
    const repository = createRepository();
    addTrackedInput(repository.root);
    const head = commit(repository.root, "tracked input");
    const linkedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-linked-worktree-"));
    fs.rmSync(linkedRoot, { recursive: true, force: true });
    temporaryPaths.push(linkedRoot);
    git(repository.root, ["worktree", "add", "--quiet", "--detach", linkedRoot, head]);

    const attestation = assertCurrentHeadBuildInputs(linkedRoot, head);
    expect(attestation.repositoryCommit).toBe(head);
    expect(attestation.gitSha256).toBe(attestation.executedSha256);
  });

  it("hashes campaign sources from raw committed and worktree bytes", () => {
    const repository = createRepository();
    const inputPath = addTrackedInput(repository.root);
    const head = commit(repository.root, "tracked input");

    expect(hashGitFiles(repository.root, [inputPath], head)).toBe(
      hashCanonicalWorktreeFiles(repository.root, [inputPath], head),
    );

    fs.writeFileSync(inputPath, "changed\n", "utf8");
    expectIntegrityCode(
      () => hashCanonicalWorktreeFiles(repository.root, [inputPath], head),
      "RAW_BYTES_MISMATCH",
    );
  });

  it("cleans only ordinary fixed output and rejects linked or mutated output", () => {
    const repository = createRepository();
    const outputPath = path.join(repository.root, "extension", "dist");
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(path.join(outputPath, "stale.js"), "stale\n", "utf8");

    resetExtensionBuildOutput(repository.root, outputPath);
    expect(fs.existsSync(outputPath)).toBe(false);

    const linkedTarget = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-linked-output-target-"));
    temporaryPaths.push(linkedTarget);
    fs.symlinkSync(
      linkedTarget,
      outputPath,
      process.platform === "win32" ? "junction" : "dir",
    );
    expectIntegrityCode(
      () => resetExtensionBuildOutput(repository.root, outputPath),
      "BUILD_OUTPUT_SPECIAL",
    );
    fs.rmSync(outputPath, { recursive: true, force: true });

    fs.mkdirSync(outputPath, { recursive: true });
    const manifestPath = path.join(outputPath, "manifest.json");
    fs.writeFileSync(manifestPath, "{}\n", "utf8");
    const attestedOutput = hashExtensionBuildOutput(repository.root, outputPath);
    fs.writeFileSync(manifestPath, '{"changed":true}\n', "utf8");
    expectIntegrityCode(
      () => assertExtensionBuildOutputHash(repository.root, outputPath, attestedOutput),
      "BUILD_OUTPUT_HASH_MISMATCH",
    );
  });

  it("authenticates loose object payloads instead of trusting echoed object IDs", () => {
    const repository = createRepository();
    const inputPath = addTrackedInput(repository.root, "extension/input.txt", "SAFE\n");
    const head = commit(repository.root, "tracked input");
    const oid = git(repository.root, ["rev-parse", `${head}:extension/input.txt`]);
    const gitDirectoryValue = git(repository.root, ["rev-parse", "--git-dir"]);
    const gitDirectory = path.isAbsolute(gitDirectoryValue)
      ? gitDirectoryValue
      : path.resolve(repository.root, gitDirectoryValue);
    const objectPath = path.join(gitDirectory, "objects", oid.slice(0, 2), oid.slice(2));
    expect(fs.existsSync(objectPath)).toBe(true);

    const tampered = Buffer.from("EVIL\n", "utf8");
    const loosePayload = Buffer.concat([
      Buffer.from(`blob ${tampered.length}\0`, "utf8"),
      tampered,
    ]);
    fs.chmodSync(objectPath, 0o600);
    fs.writeFileSync(objectPath, deflateSync(loosePayload));
    fs.writeFileSync(inputPath, tampered);

    expectIntegrityCodeOneOf(
      () => assertCurrentHeadBuildInputs(repository.root, head),
      ["OBJECT_HASH_MISMATCH", "GIT_AUTHORITY_UNAVAILABLE"],
    );
  });

  it("rejects tracked and untracked alternate Vite configuration names", () => {
    const untracked = createRepository();
    addTrackedInput(untracked.root);
    const untrackedHead = commit(untracked.root, "tracked input");
    fs.writeFileSync(path.join(untracked.root, "vite.config.js"), "export default {};\n", "utf8");
    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(untracked.root, untrackedHead),
      "ALTERNATE_VITE_CONFIG",
    );

    const tracked = createRepository();
    addTrackedInput(tracked.root);
    fs.writeFileSync(path.join(tracked.root, "vite.config.mjs"), "export default {};\n", "utf8");
    git(tracked.root, ["add", "--", "vite.config.mjs", "extension/input.txt"]);
    const trackedHead = commit(tracked.root, "alternate config");
    expectIntegrityCode(
      () => assertCurrentHeadBuildInputs(tracked.root, trackedHead),
      "ALTERNATE_VITE_CONFIG",
    );
  });

  it("scrubs mixed-case inherited Git overrides", () => {
    const environment = sanitizedGitEnvironment({
      PATH: process.env.PATH,
      git_index_file: "/tmp/attacker-index",
      Git_Work_Tree: "/tmp/attacker-tree",
      gIt_Object_Directory: "/tmp/attacker-objects",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/tmp/attacker-hooks",
    });

    expect(environment.PATH).toBe(process.env.PATH);
    expect(environment.git_index_file).toBeUndefined();
    expect(environment.Git_Work_Tree).toBeUndefined();
    expect(environment.gIt_Object_Directory).toBeUndefined();
    expect(environment.GIT_CONFIG_COUNT).toBeUndefined();
    expect(environment.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(environment.GIT_CONFIG_VALUE_0).toBeUndefined();
    expect(environment.GIT_NO_REPLACE_OBJECTS).toBe("1");
    expect(environment.GIT_NO_LAZY_FETCH).toBe("1");
  });

});
