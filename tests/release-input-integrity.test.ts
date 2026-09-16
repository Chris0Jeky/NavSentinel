import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    options?: { platform?: NodeJS.Platform; comspec?: string },
  ) => { command: string; args: readonly string[] };
};

const releaseIntegrityModule = (await import("../scripts/release-input-integrity.mjs")) as ReleaseIntegrityModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "..");
const tempRoots: string[] = [];

function makeTempRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `navsentinel-${label}-`));
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

function createRepository(
  label: string,
  files: Record<string, string | Buffer> = { "tracked.txt": "committed\n" },
): string {
  const root = path.join(makeTempRoot(label), "repo");
  fs.mkdirSync(root, { recursive: true });
  runGit(root, ["init", "-b", "main"]);
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
  const root = path.join(makeTempRoot("release-script"), "repo");
  const excluded = new Set([
    ".git",
    ".worktrees",
    "node_modules",
    "extension/dist",
    "artifacts",
    "test-results",
    "playwright-report",
  ]);
  fs.cpSync(repositoryRoot, root, {
    recursive: true,
    filter(source) {
      const relativePath = path.relative(repositoryRoot, source).replaceAll("\\", "/");
      if (!relativePath) return true;
      for (const prefix of excluded) {
        if (relativePath === prefix || relativePath.startsWith(`${prefix}/`)) return false;
      }
      return true;
    },
  });
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.name", "Release Integrity Test"]);
  runGit(root, ["config", "user.email", "release-integrity@example.invalid"]);
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-m", "fixture"]);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
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
    runGit(root, ["config", "filter.release-mask.clean", `node ${filterScript}`]);
    runGit(root, ["config", "filter.release-mask.required", "true"]);
    runGit(root, ["add", "-A"]);
    runGit(root, ["commit", "-m", "add filtered input"]);

    fs.writeFileSync(path.join(root, "raw-input.txt"), "mutated raw bytes\n");
    runGit(root, ["add", "raw-input.txt"]);
    expect(runGit(root, ["status", "--porcelain"])).toBe("");

    expect(() => assertExactCommittedInputs(root)).toThrow(/raw filesystem bytes differ/i);
  });

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

  it("selects a Windows command interpreter for npm while preserving fixed arguments", () => {
    const resolveReleaseCommand = releaseIntegrityModule.resolveReleaseCommand;
    expect(resolveReleaseCommand).toEqual(expect.any(Function));

    expect(resolveReleaseCommand?.("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
      platform: "win32",
      comspec: "C:\\Windows\\System32\\cmd.exe",
    })).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm", "install", "--package-lock-only", "--ignore-scripts"],
    });

    expect(resolveReleaseCommand?.("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
      platform: "linux",
    })).toEqual({
      command: "npm",
      args: ["install", "--package-lock-only", "--ignore-scripts"],
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
  it("fails closed when git status is clean but raw project bytes differ", () => {
    const root = copyRepositoryForReleaseTest();
    const filterScript = path.join(root, ".git-clean-mask.mjs");
    fs.writeFileSync(
      filterScript,
      "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('committed\\n'));\n",
    );
    fs.writeFileSync(path.join(root, ".gitattributes"), "raw-input.txt filter=release-mask\n");
    fs.writeFileSync(path.join(root, "raw-input.txt"), "committed\n");
    runGit(root, ["config", "filter.release-mask.clean", `node ${filterScript}`]);
    runGit(root, ["config", "filter.release-mask.required", "true"]);
    runGit(root, ["add", "-A"]);
    runGit(root, ["commit", "-m", "add filtered release input"]);
    fs.writeFileSync(path.join(root, "raw-input.txt"), "mutated raw bytes\n");
    runGit(root, ["add", "raw-input.txt"]);
    expect(runGit(root, ["status", "--porcelain"])).toBe("");

    const result = spawnSync(process.execPath, ["scripts/release.mjs", "patch", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NAVSENTINEL_BUILD_PROFILE: "interaction-only" },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/raw filesystem bytes differ/i);
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
