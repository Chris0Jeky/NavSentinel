import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeReleaseTempRoot } from "./helpers/release_temp_cleanup";
import {
  RELEASE_MUTABLE_PATHS,
  assertExactCommittedInputs,
  assertReleaseCommitScope,
  assertReleaseSnapshotUnchanged,
  capturePreparedReleaseChanges,
  createSanitizedGitEnvironment,
} from "../scripts/release-input-integrity.mjs";

type ReleaseIntegrityModule = typeof import("../scripts/release-input-integrity.mjs") & {
  resolveReleaseCommand?: (
    command: string,
    args: readonly string[],
    options?: { nodeExecutable?: string; npmExecPath?: string },
  ) => { command: string; args: readonly string[] };
};

const releaseIntegrityModule = (await import("../scripts/release-input-integrity.mjs")) as ReleaseIntegrityModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "..");
const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
  // Canonicalize an 8.3 short-name TEMP prefix (#764): repository-root
  // assertions compare against realpathSync.native, so hand them the
  // canonical root.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), `navsentinel-${label}-`)),
  );
  tempRoots.push(root);
  return root;
}

function runGit(root: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync("git", args, {
    cwd: root,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureFixtureRepository(root: string): void {
  runGit(root, ["config", "core.autocrlf", "false"]);
  runGit(root, ["config", "core.eol", "lf"]);
}

function releaseFilterCommand(filterScript: string): string {
  const nodeExecutable = process.execPath.replaceAll("\\", "/");
  const normalizedScript = filterScript.replaceAll("\\", "/");
  return `"${nodeExecutable}" "${normalizedScript}"`;
}

function createRepository(
  label: string,
  files: Record<string, string | Buffer> = { "tracked.txt": "committed\n" },
): string {
  const root = path.join(makeTempRoot(label), "repo");
  fs.mkdirSync(root, { recursive: true });
  runGit(root, ["init", "-b", "main"]);
  configureFixtureRepository(root);
  runGit(root, ["config", "user.name", "Release Integrity Test"]);
  runGit(root, ["config", "user.email", "release-integrity@example.invalid"]);
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-m", "fixture"]);
  return root;
}

function copyRepositoryForReleaseTest(): string {
  // Exercise the actual release entry point and its complete local import/data
  // closure. Copying every Gym fixture and archived report makes this security
  // assertion depend on unrelated repository growth, especially on Windows.
  const paths = [
    ...RELEASE_MUTABLE_PATHS,
    "config/release-profiles.json",
    "scripts/release.mjs",
    "scripts/check-bloom-real.mjs",
    "scripts/check-bloom-size.mjs",
    "scripts/release-profile.mjs",
    "scripts/release-input-integrity.mjs",
    "scripts/sensitive-environment.mjs",
  ];
  const files = Object.fromEntries(paths.map((relativePath) => [
    relativePath, fs.readFileSync(path.join(repositoryRoot, relativePath)),
  ]));
  return createRepository("release-script", files);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    removeReleaseTempRoot(root);
  }
});

describe("release input integrity", () => {
  it("attests a full immutable commit/tree and exact raw worktree", () => {
    const root = createRepository("exact");
    const snapshot = assertExactCommittedInputs(root);

    expect(snapshot.commit).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
    expect(snapshot.tree).toMatch(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
    expect(snapshot.entries.map((entry) => entry.path)).toEqual(["tracked.txt"]);
  });

  it("rejects worktree bytes hidden by a repository clean filter", () => {
    const root = createRepository("clean-filter");
    const filterScript = path.join(root, ".git-clean-mask.mjs");
    fs.writeFileSync(
      filterScript,
      "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('committed\\n'));\n",
    );
    fs.writeFileSync(path.join(root, ".gitattributes"), "raw-input.txt filter=release-mask\n");
    fs.writeFileSync(path.join(root, "raw-input.txt"), "committed\n");
    runGit(root, ["config", "filter.release-mask.clean", releaseFilterCommand(filterScript)]);
    runGit(root, ["config", "filter.release-mask.required", "true"]);
    runGit(root, ["add", "-A"]);
    runGit(root, ["commit", "-m", "add filtered input"]);

    fs.writeFileSync(path.join(root, "raw-input.txt"), "mutated raw bytes\n");
    runGit(root, ["add", "raw-input.txt"]);
    expect(runGit(root, ["status", "--porcelain"])).toBe("");

    expect(() => assertExactCommittedInputs(root)).toThrow(/raw filesystem bytes differ/i);
    // 60s cap: repository fixture + seven git spawns + clean-filter node
    // subprocess exceed the 5s default under parallel load on Windows. (#766)
  }, 60_000);

  it("rejects clean LF blobs materialized as CRLF", () => {
    const root = createRepository("crlf", {
      ".gitattributes": "line.txt text\n",
      "line.txt": "line one\nline two\n",
    });
    fs.writeFileSync(path.join(root, "line.txt"), "line one\r\nline two\r\n");
    runGit(root, ["add", "line.txt"]);
    expect(runGit(root, ["status", "--porcelain"])).toBe("");

    expect(() => assertExactCommittedInputs(root)).toThrow(/raw filesystem bytes differ/i);
  });

  it("accepts a normal Windows autocrlf checkout", () => {
    const root = createRepository("windows-autocrlf", {
      ".gitattributes": "line.txt text eol=lf\n",
      "line.txt": "line one\nline two\n",
    });
    runGit(root, ["config", "core.autocrlf", "true"]);
    runGit(root, ["config", "core.eol", "native"]);
    fs.rmSync(path.join(root, "line.txt"));
    runGit(root, ["checkout-index", "--force", "--all"]);

    expect(runGit(root, ["ls-files", "--eol", "--", "line.txt"])).toMatch(/i\/lf\s+w\/lf/);
    expect(() => assertExactCommittedInputs(root)).not.toThrow();
  });

  it.each([
    ["ordinary", "extra.txt"],
    ["ignored", "ignored.txt"],
  ])("rejects %s untracked project inputs", (_label, extraPath) => {
    const root = createRepository("untracked", { ".gitignore": "ignored.txt\n", "tracked.txt": "ok\n" });
    fs.writeFileSync(path.join(root, extraPath), "unexpected\n");

    expect(() => assertExactCommittedInputs(root)).toThrow(/untracked or ignored project input/i);
  });

  it("excludes dependency and generated-output roots from the project-input claim", () => {
    const root = createRepository("excluded-roots");
    fs.mkdirSync(path.join(root, "node_modules", "fixture"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "fixture", "index.js"), "module.exports = 1;\n");
    fs.mkdirSync(path.join(root, "extension", "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "extension", "dist", "generated.js"), "generated\n");

    expect(() => assertExactCommittedInputs(root)).not.toThrow();

    fs.writeFileSync(path.join(root, "extension", "unexpected.txt"), "unexpected\n");
    expect(() => assertExactCommittedInputs(root)).toThrow(
      /untracked or ignored project input/i,
    );
  });

  it("rejects tracked and untracked symbolic links", () => {
    if (process.platform === "win32") return;
    const trackedRoot = createRepository("tracked-link");
    fs.symlinkSync("tracked.txt", path.join(trackedRoot, "linked.txt"));
    runGit(trackedRoot, ["add", "linked.txt"]);
    runGit(trackedRoot, ["commit", "-m", "add linked input"]);
    expect(() => assertExactCommittedInputs(trackedRoot)).toThrow(/symbolic link|unsupported tracked mode/i);

    const untrackedRoot = createRepository("untracked-link");
    fs.symlinkSync("tracked.txt", path.join(untrackedRoot, "linked.txt"));
    expect(() => assertExactCommittedInputs(untrackedRoot)).toThrow(/symbolic link|linked project input/i);
  });

  it("rejects gitlinks and other unsupported tracked modes", () => {
    const root = createRepository("gitlink");
    const head = runGit(root, ["rev-parse", "HEAD"]);
    runGit(root, ["update-index", "--add", "--cacheinfo", `160000,${head},nested-repository`]);
    runGit(root, ["commit", "-m", "add gitlink"]);

    expect(() => assertExactCommittedInputs(root)).toThrow(/gitlink|unsupported tracked mode/i);
  });

  it("rejects filesystem case collisions", () => {
    if (process.platform === "win32" || process.platform === "darwin") return;
    const root = createRepository("case-collision", {
      "Case.txt": "upper\n",
      "case.txt": "lower\n",
    });

    expect(() => assertExactCommittedInputs(root)).toThrow(/case collision/i);
  });

  it("rejects special filesystem entries", () => {
    if (process.platform === "win32") return;
    const root = createRepository("special-entry");
    execFileSync("mkfifo", [path.join(root, "release-input.fifo")]);

    expect(() => assertExactCommittedInputs(root)).toThrow(/special|unsupported filesystem entry/i);
  });

  it("scrubs inherited Git override and lazy-object environments", () => {
    const root = createRepository("git-env");
    const environment = createSanitizedGitEnvironment({
      ...process.env,
      GIT_DIR: "/tmp/attacker-git-dir",
      GIT_WORK_TREE: "/tmp/attacker-work-tree",
      GIT_INDEX_FILE: "/tmp/attacker-index",
      GIT_OBJECT_DIRECTORY: "/tmp/attacker-objects",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "/tmp/attacker-alternates",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.worktree",
      GIT_CONFIG_VALUE_0: "/tmp/attacker-config-worktree",
      git_dir: "/tmp/lowercase-attacker-git-dir",
      Git_Work_Tree: "/tmp/mixed-case-attacker-work-tree",
      git_index_file: "/tmp/lowercase-attacker-index",
      Git_Config_Count: "1",
      git_config_key_0: "core.worktree",
      Git_Config_Value_0: "/tmp/mixed-case-attacker-config-worktree",
    });

    expect(environment.GIT_DIR).toBeUndefined();
    expect(environment.GIT_WORK_TREE).toBeUndefined();
    expect(environment.GIT_INDEX_FILE).toBeUndefined();
    expect(environment.GIT_OBJECT_DIRECTORY).toBeUndefined();
    expect(environment.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBeUndefined();
    expect(environment.GIT_CONFIG_COUNT).toBeUndefined();
    expect(environment.git_dir).toBeUndefined();
    expect(environment.Git_Work_Tree).toBeUndefined();
    expect(environment.git_index_file).toBeUndefined();
    expect(environment.Git_Config_Count).toBeUndefined();
    expect(environment.git_config_key_0).toBeUndefined();
    expect(environment.Git_Config_Value_0).toBeUndefined();
    expect(environment.GIT_NO_REPLACE_OBJECTS).toBe("1");
    expect(environment.GIT_NO_LAZY_FETCH).toBe("1");
    expect(() => assertExactCommittedInputs(root, { environment })).not.toThrow();
  });

  it("selects Node plus npm's JavaScript entry point without a command shell", () => {
    const resolveReleaseCommand = releaseIntegrityModule.resolveReleaseCommand;
    expect(resolveReleaseCommand).toEqual(expect.any(Function));
    const root = makeTempRoot("npm-cli-entry");
    const npmExecPath = path.join(root, "npm-cli.js");
    fs.writeFileSync(npmExecPath, "process.exitCode = 0;\n");

    expect(resolveReleaseCommand?.("npm", ["install", "argument with spaces & shell syntax"], {
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath,
    })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        fs.realpathSync.native(npmExecPath),
        "install",
        "argument with spaces & shell syntax",
      ],
    });
  });

  it("attests a detached linked worktree without trusting its .git indirection file", () => {
    const root = createRepository("linked-worktree");
    const linked = path.join(path.dirname(root), "linked");
    runGit(root, ["worktree", "add", "--detach", linked, "HEAD"]);

    const snapshot = assertExactCommittedInputs(linked);
    expect(snapshot.commit).toBe(runGit(root, ["rev-parse", "HEAD"]));
  });

  it("detects unrelated tracked mutation between the initial and pre-commit boundaries", () => {
    const root = createRepository("mid-run", {
      "package.json": "{\"version\":\"0.0.0\"}\n",
      "tracked.txt": "committed\n",
    });
    const initial = assertExactCommittedInputs(root);
    fs.writeFileSync(path.join(root, "tracked.txt"), "mutated mid-release\n");

    expect(() =>
      assertReleaseSnapshotUnchanged(initial, { allowedChangedPaths: ["package.json"] }),
    ).toThrow(/changed after the release snapshot|raw filesystem bytes differ/i);
  });

  it("allows only declared release metadata changes before commit", () => {
    const root = createRepository("allowed-mid-run", {
      "package.json": "{\"version\":\"0.0.0\"}\n",
      "tracked.txt": "committed\n",
    });
    const initial = assertExactCommittedInputs(root);
    fs.writeFileSync(path.join(root, "package.json"), "{\"version\":\"0.0.1\"}\n");

    expect(() =>
      assertReleaseSnapshotUnchanged(initial, { allowedChangedPaths: ["package.json"] }),
    ).not.toThrow();
  });

  it("accepts a one-parent release commit changing exactly the declared paths", () => {
    const root = createRepository("release-scope", {
      "package.json": "{\"version\":\"0.0.0\"}\n",
      "tracked.txt": "committed\n",
    });
    const initial = assertExactCommittedInputs(root);
    fs.writeFileSync(path.join(root, "package.json"), "{\"version\":\"0.0.1\"}\n");
    runGit(root, ["add", "package.json"]);
    runGit(root, ["commit", "-m", "release"]);
    const release = assertExactCommittedInputs(root);

    expect(() =>
      assertReleaseCommitScope(initial, release, { allowedChangedPaths: ["package.json"] }),
    ).not.toThrow();
  });

  it("rejects a release commit that captures an undeclared path", () => {
    const root = createRepository("release-scope-extra", {
      "package.json": "{\"version\":\"0.0.0\"}\n",
      "tracked.txt": "committed\n",
    });
    const initial = assertExactCommittedInputs(root);
    fs.writeFileSync(path.join(root, "package.json"), "{\"version\":\"0.0.1\"}\n");
    fs.writeFileSync(path.join(root, "tracked.txt"), "captured unexpectedly\n");
    runGit(root, ["add", "package.json", "tracked.txt"]);
    runGit(root, ["commit", "-m", "release plus extra"]);
    const release = assertExactCommittedInputs(root);

    expect(() =>
      assertReleaseCommitScope(initial, release, { allowedChangedPaths: ["package.json"] }),
    ).toThrow(/undeclared release path|changed path/i);
  });

  it("binds declared release paths to the exact bytes prepared before commit", () => {
    const root = createRepository("release-prepared-bytes", {
      "package.json": "{\"version\":\"0.0.0\"}\n",
    });
    const initial = assertExactCommittedInputs(root);
    fs.writeFileSync(path.join(root, "package.json"), "{\"version\":\"0.0.1\"}\n");
    const prepared = capturePreparedReleaseChanges(initial, {
      allowedChangedPaths: ["package.json"],
    });

    fs.writeFileSync(path.join(root, "package.json"), "{\"version\":\"hook-replaced\"}\n");
    runGit(root, ["add", "package.json"]);
    runGit(root, ["commit", "-m", "release with hook mutation"]);
    const release = assertExactCommittedInputs(root);

    expect(() =>
      assertReleaseCommitScope(initial, release, {
        allowedChangedPaths: ["package.json"],
        preparedChanges: prepared,
      }),
    ).toThrow(/prepared release bytes/i);
  });
});

describe("release script integration", () => {
  it("rejects substituted committed bytes before the release command can mutate metadata", () => {
    const root = copyRepositoryForReleaseTest();
    const runDryRelease = () => spawnSync(process.execPath, ["scripts/release.mjs", "patch", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, NAVSENTINEL_BUILD_PROFILE: "interaction-only" },
    });
    const clean = runDryRelease();
    expect(clean.error).toBeUndefined();
    expect(clean.status, `${clean.stdout}\n${clean.stderr}`).toBe(0);
    expect(clean.stdout).toContain("[dry-run] No changes made.");

    const head = runGit(root, ["rev-parse", "HEAD"]);
    const blob = runGit(root, ["rev-parse", "HEAD:CHANGELOG.md"]);
    const changed = Buffer.concat([
      fs.readFileSync(path.join(root, "CHANGELOG.md")), Buffer.from("\nSubstituted release notes.\n"),
    ]);
    const objectPath = path.join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2));
    fs.rmSync(objectPath);
    fs.writeFileSync(objectPath, deflateSync(Buffer.concat([Buffer.from(`blob ${changed.length}\0`), changed])));
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), changed);
    // Git returns the forged object bytes and the worktree matches those bytes.
    // Rejection must be for the OID mismatch, not a missing import or dirty file.
    expect(execFileSync("git", ["cat-file", "blob", blob], { cwd: root })).toEqual(changed);
    const metadata = RELEASE_MUTABLE_PATHS.map((entry) => fs.readFileSync(path.join(root, entry)));
    const result = runDryRelease();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/object hash mismatch for blob/i);
    expect(result.stdout).not.toContain("[dry-run] No changes made.");
    expect(runGit(root, ["rev-parse", "HEAD"])).toBe(head);
    expect(runGit(root, ["tag", "--list"])).toBe("");
    expect(RELEASE_MUTABLE_PATHS.map((entry) => fs.readFileSync(path.join(root, entry)))).toEqual(metadata);
  }, 30_000);

  it("fails closed when git status is clean but raw project bytes differ", () => {
    const root = copyRepositoryForReleaseTest();
    const runDryRelease = () => spawnSync(process.execPath, ["scripts/release.mjs", "patch", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, NAVSENTINEL_BUILD_PROFILE: "interaction-only" },
    });
    const originalHead = runGit(root, ["rev-parse", "HEAD"]);
    const originalMetadata = RELEASE_MUTABLE_PATHS.map((entry) => fs.readFileSync(path.join(root, entry)));
    // A positive run proves the reduced fixture is complete and the real entry
    // point executes. Missing imports or broken setup cannot count as rejection.
    const clean = runDryRelease();
    expect(clean.error).toBeUndefined();
    expect(clean.status, `${clean.stdout}\n${clean.stderr}`).toBe(0);
    expect(clean.stdout).toContain("[dry-run] No changes made.");
    expect(runGit(root, ["rev-parse", "HEAD"])).toBe(originalHead);
    expect(runGit(root, ["tag", "--list"])).toBe("");
    expect(runGit(root, ["status", "--porcelain"])).toBe("");
    expect(RELEASE_MUTABLE_PATHS.map((entry) => fs.readFileSync(path.join(root, entry)))).toEqual(originalMetadata);

    const filterScript = path.join(root, ".git-clean-mask.mjs");
    fs.writeFileSync(
      filterScript,
      "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('committed\\n'));\n",
    );
    fs.writeFileSync(path.join(root, ".gitattributes"), "raw-input.txt filter=release-mask\n");
    fs.writeFileSync(path.join(root, "raw-input.txt"), "committed\n");
    runGit(root, ["config", "filter.release-mask.clean", releaseFilterCommand(filterScript)]);
    runGit(root, ["config", "filter.release-mask.required", "true"]);
    runGit(root, ["add", "-A"]);
    runGit(root, ["commit", "-m", "add filtered release input"]);
    fs.writeFileSync(path.join(root, "raw-input.txt"), "mutated raw bytes\n");
    runGit(root, ["add", "raw-input.txt"]);
    expect(runGit(root, ["status", "--porcelain"])).toBe("");

    const filteredHead = runGit(root, ["rev-parse", "HEAD"]);
    const result = runDryRelease();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/raw filesystem bytes differ/i);
    expect(runGit(root, ["rev-parse", "HEAD"])).toBe(filteredHead);
    expect(runGit(root, ["tag", "--list"])).toBe("");
    expect(RELEASE_MUTABLE_PATHS.map((entry) => fs.readFileSync(path.join(root, entry)))).toEqual(originalMetadata);
  }, 30_000);

  it("declares the only paths a release commit may change", () => {
    expect(RELEASE_MUTABLE_PATHS).toEqual([
      "CHANGELOG.md",
      "extension/manifest.json",
      "package-lock.json",
      "package.json",
    ]);
  });
});

const pathIdentityEnvironment = createSanitizedGitEnvironment(process.env);
function pathGit(root: string, ...args: string[]): Buffer {
  return execFileSync("git", args, { cwd: root, env: pathIdentityEnvironment, stdio: ["ignore", "pipe", "pipe"] });
}
function pathFixture(format: "sha1" | "sha256", name: string): string {
  const root = makeTempRoot("path-identity");
  pathGit(root, "init", "-q", `--object-format=${format}`);
  pathGit(root, "config", "core.autocrlf", "false");
  pathGit(root, "config", "user.name", "Path Identity Fixture");
  pathGit(root, "config", "user.email", "path-identity@example.invalid");
  pathGit(root, "config", "commit.gpgsign", "false");
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "identical blob bytes\n");
  pathGit(root, "add", ".");
  pathGit(root, "commit", "-qm", "exact path fixture");
  expect(pathGit(root, "ls-files", "-z")).toEqual(Buffer.from(`${name}\0`, "utf8"));
  return root;
}

for (const format of ["sha1", "sha256"] as const) {
  describe(`release path byte identity (${format})`, () => {
    for (const name of ["\uFEFFproof.txt", "\uFEFFfolder/proof.txt"]) {
      it(`preserves the leading U+FEFF in ${JSON.stringify(name)}`, () => {
        const root = pathFixture(format, name);
        expect(assertExactCommittedInputs(root).entries.map((entry) => entry.path)).toEqual([name]);
      });

      it(`rejects a same-content worktree alias for ${JSON.stringify(name)}`, () => {
        const root = pathFixture(format, name);
        const before = pathGit(root, "rev-parse", "HEAD");
        const first = name.split("/")[0]!;
        fs.renameSync(path.join(root, first), path.join(root, first.slice(1)));
        // Neither the commit nor the index changed. Only the filesystem name
        // differs; attesting the equal-content alias would attest the wrong path.
        expect(pathGit(root, "rev-parse", "HEAD")).toEqual(before);
        expect(pathGit(root, "ls-files", "-z")).toEqual(Buffer.from(`${name}\0`, "utf8"));
        expect(() => assertExactCommittedInputs(root)).toThrow(/missing|untracked/i);
      });
    }

    it("keeps a U+FEFF in a later path component without normalizing it", () => {
      const name = "folder/\uFEFFproof.txt";
      const root = pathFixture(format, name);
      expect(assertExactCommittedInputs(root).entries.map((entry) => entry.path)).toEqual([name]);
    });
  });
}
