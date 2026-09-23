import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error Release helpers are plain ESM and intentionally have no declaration file.
import { findCrlfWorktreeFiles } from "../scripts/checkout-eol.mjs";

const checkerPath = path.resolve(__dirname, "../scripts/checkout-eol.mjs");

function withRoot(check: (root: string) => void) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-eol-")));
  try {
    check(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function git(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initGit(root: string, contents: string) {
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "--quiet"]);
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["config", "core.safecrlf", "false"]);
  fs.writeFileSync(path.join(root, ".gitattributes"), "* text=auto eol=lf\n");
  fs.writeFileSync(path.join(root, "input.txt"), "one\ntwo\n");
  git(root, ["add", "."]);
  fs.writeFileSync(path.join(root, "input.txt"), contents);
}

function runChecker(root: string, cwd = root) {
  // Exercise the default entry point from a module inside the fixture project,
  // rather than injecting a root argument that production never supplies.
  const target = path.join(root, "scripts", "checkout-eol.mjs");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(checkerPath, target);
  const result = spawnSync(process.execPath, [
    "--input-type=module", "--eval",
    `import check from ${JSON.stringify(pathToFileURL(target).href)}; await check();`,
  ], { cwd, encoding: "utf8", timeout: 10_000 });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

describe("findCrlfWorktreeFiles (#763)", () => {
  it("flags w/crlf entries and reports their paths", () => {
    const output = [
      "i/lf    w/crlf  attr/text=auto eol=lf \tREADME.md",
      "i/lf    w/crlf  attr/text=auto eol=lf \tconfig/release-profiles.json",
      "",
    ].join("\n");
    expect(findCrlfWorktreeFiles(output)).toEqual([
      "README.md",
      "config/release-profiles.json",
    ]);
  });

  it("also flags mixed LF/CRLF bytes", () => {
    expect(findCrlfWorktreeFiles(
      "i/lf    w/mixed attr/text=auto eol=lf \tmixed.txt\n",
    )).toEqual(["mixed.txt"]);
  });

  it("passes clean LF, unmodified, and binary entries", () => {
    const output = [
      "i/lf    w/lf    attr/text=auto eol=lf \tREADME.md",
      "i/-text w/-text attr/-text \tlogo.png",
      "i/none  w/none  attr/-text \t.gitignore",
      "",
    ].join("\n");
    expect(findCrlfWorktreeFiles(output)).toEqual([]);
  });

  it("handles empty output and blank lines", () => {
    expect(findCrlfWorktreeFiles("")).toEqual([]);
    expect(findCrlfWorktreeFiles("\n\n")).toEqual([]);
  });

  it("is not confused by C-quoted paths containing spaces", () => {
    const output = 'i/lf    w/crlf  attr/text=auto eol=lf \t"my docs/notes.md"\n';
    expect(findCrlfWorktreeFiles(output)).toEqual(['"my docs/notes.md"']);
  });

  it("does not flag a path that merely mentions crlf", () => {
    const output = "i/lf    w/lf    attr/text=auto eol=lf \tcrlf-notes.md\n";
    expect(findCrlfWorktreeFiles(output)).toEqual([]);
  });
});

describe("checkout preflight with real Git bytes", { timeout: 30_000 }, () => {
  it.each([
    ["LF", "one\ntwo\n", false],
    ["CRLF", "one\r\ntwo\r\n", true],
    ["mixed", "one\r\ntwo\n", true],
  ] as const)("classifies %s without rewriting local work", (_label, contents, rejected) => {
    withRoot((root) => {
      initGit(root, contents);
      const input = path.join(root, "input.txt");
      // This used to be the recommended repair. It changes the index, not the
      // worktree: the preflight must still reject contaminated bytes afterward.
      git(root, ["add", "--renormalize", "."]);
      expect(fs.readFileSync(input, "utf8")).toBe(contents);
      const result = runChecker(root);
      expect(result.status).toBe(rejected ? 1 : 0);
      if (rejected) {
        expect(result.stderr).toContain("CRLF or mixed line endings");
        expect(result.stderr).toContain("new directory");
        expect(result.stderr).not.toContain("git add --renormalize");
      }
      expect(fs.readFileSync(input, "utf8")).toBe(contents);
    });
  });

  it("ignores a parent checkout's unrelated CRLF files", () => {
    withRoot((root) => {
      initGit(root, "one\r\ntwo\r\n");
      const copy = path.join(root, "source-copy");
      fs.mkdirSync(copy);
      expect(runChecker(copy).status).toBe(0);
    });
  });

  it("does not borrow a parent index for a source copy without its own Git root", () => {
    withRoot((root) => {
      initGit(root, "one\ntwo\n");
      const copy = path.join(root, "source-copy");
      fs.mkdirSync(copy);
      const input = path.join(copy, "parent-tracked.txt");
      fs.writeFileSync(input, "one\ntwo\n");
      git(root, ["add", "."]);
      fs.writeFileSync(input, "one\r\ntwo\r\n");
      expect(runChecker(copy).status).toBe(0);
      expect(fs.readFileSync(input, "utf8")).toBe("one\r\ntwo\r\n");
    });
  });

  it("accepts a clean nested checkout with its own Git root", () => {
    withRoot((root) => {
      initGit(root, "one\r\ntwo\r\n");
      const nested = path.join(root, "nested");
      initGit(nested, "one\ntwo\n");
      expect(runChecker(nested).status).toBe(0);
    });
  });

  it("checks the entire project when invoked from a subdirectory", () => {
    withRoot((root) => {
      initGit(root, "one\r\ntwo\r\n");
      const subdirectory = path.join(root, "empty");
      fs.mkdirSync(subdirectory);
      expect(runChecker(root, subdirectory).status).toBe(1);
    });
  });

  it("does not inspect an unrelated process working directory", () => {
    withRoot((root) => {
      const project = path.join(root, "project");
      const other = path.join(root, "other");
      initGit(project, "one\ntwo\n");
      initGit(other, "one\r\ntwo\r\n");
      expect(runChecker(project, other).status).toBe(0);
    });
  });
});
