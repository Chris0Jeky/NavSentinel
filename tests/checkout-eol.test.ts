import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error Release helpers are plain ESM and intentionally have no declaration file.
import { findCrlfWorktreeFiles } from "../scripts/checkout-eol.mjs";

const checkerUrl = pathToFileURL(path.resolve(__dirname, "../scripts/checkout-eol.mjs")).href;

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
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-eol-")));
    const git = (args: string[]) => execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      git(["init", "--quiet"]);
      git(["config", "core.autocrlf", "false"]);
      git(["config", "core.safecrlf", "false"]);
      fs.writeFileSync(path.join(root, ".gitattributes"), "* text=auto eol=lf\n");
      const input = path.join(root, "input.txt");
      fs.writeFileSync(input, "one\ntwo\n");
      git(["add", "."]);
      fs.writeFileSync(input, contents);
      // This used to be the recommended repair. It must NOT be mistaken for
      // rematerializing the worktree: only the index is normalized.
      git(["add", "--renormalize", "."]);
      expect(fs.readFileSync(input, "utf8")).toBe(contents);
      const result = spawnSync(process.execPath, [
        "--input-type=module", "--eval",
        `import check from ${JSON.stringify(checkerUrl)}; await check();`,
      ], { cwd: root, encoding: "utf8", timeout: 10_000 });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(rejected ? 1 : 0);
      if (rejected) {
        expect(result.stderr).toContain("CRLF or mixed line endings");
        expect(result.stderr).toContain("new directory");
        expect(result.stderr).not.toContain("git add --renormalize");
      }
      expect(fs.readFileSync(input, "utf8")).toBe(contents);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
