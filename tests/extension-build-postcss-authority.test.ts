import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertCurrentHeadBuildInputs } from "./e2e/extension_build_provenance";

const temporaryDirectories: string[] = [];

function git(repositoryRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function createRepository(): { root: string; head: string } {
  // Canonicalize an 8.3 short-name TEMP prefix (#764): resolveRepositoryRoot
  // compares against realpathSync.native, so hand it the canonical root.
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-postcss-authority-")),
  );
  temporaryDirectories.push(root);
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.name", "NavSentinel Tests"]);
  git(root, ["config", "user.email", "navsentinel-tests@example.invalid"]);
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.mkdirSync(path.join(root, "extension"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "config", "release-profiles.json"),
    '{"defaultProfile":"interaction-only"}\n',
  );
  fs.writeFileSync(path.join(root, "extension", "input.txt"), "SAFE\n");
  git(root, [
    "add",
    "--",
    "config/release-profiles.json",
    "extension/input.txt",
  ]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  return { root, head: git(root, ["rev-parse", "HEAD"]) };
}

function expectPostCssRejection(
  operation: () => unknown,
  candidate: string,
): void {
  expect(operation).toThrow(
    new RegExp(`\\[AUTO_DISCOVERED_POSTCSS_CONFIG\\].*${candidate.replaceAll(".", "\\.")}`, "u"),
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0).reverse()) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("state-authority PostCSS build-input boundary", { timeout: 15_000 }, () => {
  it("rejects an untracked root PostCSS JavaScript config", () => {
    const repository = createRepository();
    const candidate = "postcss.config.js";
    fs.writeFileSync(
      path.join(repository.root, candidate),
      "export default { plugins: [] };\n",
    );

    expectPostCssRejection(
      () => assertCurrentHeadBuildInputs(repository.root, repository.head),
      candidate,
    );
  });

  it("rejects a tracked root PostCSS rc config", () => {
    const repository = createRepository();
    const candidate = ".postcssrc.mjs";
    fs.writeFileSync(
      path.join(repository.root, candidate),
      "export default { plugins: [] };\n",
    );
    git(repository.root, ["add", "--", candidate]);
    git(repository.root, ["commit", "--quiet", "-m", "postcss config"]);
    const head = git(repository.root, ["rev-parse", "HEAD"]);

    expectPostCssRejection(
      () => assertCurrentHeadBuildInputs(repository.root, head),
      candidate,
    );
  });

  it("rejects an untracked PostCSS config under the Vite project root", () => {
    const repository = createRepository();
    const candidate = "extension/postcss.config.js";
    fs.writeFileSync(
      path.join(repository.root, ...candidate.split("/")),
      "export default { plugins: [] };\n",
    );

    expectPostCssRejection(
      () => assertCurrentHeadBuildInputs(repository.root, repository.head),
      candidate,
    );
  });

  it("rejects a tracked PostCSS rc config under the Vite project root", () => {
    const repository = createRepository();
    const candidate = "extension/.postcssrc";
    fs.writeFileSync(
      path.join(repository.root, ...candidate.split("/")),
      '{"plugins":{}}\n',
    );
    git(repository.root, ["add", "--", candidate]);
    git(repository.root, ["commit", "--quiet", "-m", "extension postcss config"]);
    const head = git(repository.root, ["rev-parse", "HEAD"]);

    expectPostCssRejection(
      () => assertCurrentHeadBuildInputs(repository.root, head),
      candidate,
    );
  });

  it("rejects mixed-case PostCSS config names on case-insensitive filesystems", () => {
    const repository = createRepository();
    const candidate = "extension/PostCSS.Config.js";
    fs.writeFileSync(
      path.join(repository.root, ...candidate.split("/")),
      "export default { plugins: [] };\n",
    );

    expectPostCssRejection(
      () => assertCurrentHeadBuildInputs(repository.root, repository.head),
      candidate,
    );
  });

  it("rejects a mixed-case PostCSS config at the repository root", () => {
    const repository = createRepository();
    const candidate = "PostCSS.Config.js";
    fs.writeFileSync(
      path.join(repository.root, candidate),
      "export default { plugins: [] };\n",
    );

    expectPostCssRejection(
      () => assertCurrentHeadBuildInputs(repository.root, repository.head),
      candidate,
    );
  });
});
