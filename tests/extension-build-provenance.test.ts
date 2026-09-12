import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertCurrentHeadBuildInputs } from "./e2e/extension_build_provenance";

const temporaryRepositories: string[] = [];

function git(repositoryRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function createRepository(): { root: string; head: string; configPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-build-provenance-"));
  temporaryRepositories.push(root);
  const configPath = path.join(root, "config", "release-profiles.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{"defaultProfile":"interaction-only"}\n', "utf8");
  git(root, ["init", "--quiet"]);
  git(root, ["add", "--", "config/release-profiles.json"]);
  git(root, [
    "-c",
    "user.name=NavSentinel Tests",
    "-c",
    "user.email=navsentinel-tests@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return { root, head: git(root, ["rev-parse", "HEAD"]), configPath };
}

afterEach(() => {
  for (const repository of temporaryRepositories.splice(0)) {
    fs.rmSync(repository, { recursive: true, force: true });
  }
});

describe("state-authority extension build provenance", () => {
  it("fails closed when tracked release-profile configuration drifts from HEAD", () => {
    const repository = createRepository();
    const initial = assertCurrentHeadBuildInputs(repository.root, repository.head);
    expect(initial.files.map((file) => path.relative(repository.root, file).replaceAll("\\", "/"))).toEqual([
      "config/release-profiles.json",
    ]);

    fs.writeFileSync(repository.configPath, '{"defaultProfile":"tampered"}\n', "utf8");

    expect(() => assertCurrentHeadBuildInputs(repository.root, repository.head)).toThrow(
      "Extension build inputs must match the recorded Git head",
    );
  });
});
