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

function commit(repositoryRoot: string, message: string): string {
  git(repositoryRoot, [
    "-c",
    "user.name=NavSentinel Tests",
    "-c",
    "user.email=navsentinel-tests@example.invalid",
    "commit",
    "--quiet",
    "-m",
    message,
  ]);
  return git(repositoryRoot, ["rev-parse", "HEAD"]);
}

function createRepository(): { root: string; head: string; configPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-build-provenance-"));
  temporaryRepositories.push(root);
  const configPath = path.join(root, "config", "release-profiles.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, '{"defaultProfile":"interaction-only"}\n', "utf8");
  git(root, ["init", "--quiet"]);
  git(root, ["add", "--", "config/release-profiles.json"]);
  const head = commit(root, "fixture");
  return { root, head, configPath };
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

  it("rejects raw tampering concealed by a repository-local clean filter", () => {
    const repository = createRepository();
    const inputPath = path.join(repository.root, "extension", "input.txt");
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    const filterScript = installMaskingCleanFilter(repository.root);
    fs.writeFileSync(path.join(repository.root, ".gitattributes"), "extension/input.txt filter=mask\n", "utf8");
    fs.writeFileSync(inputPath, "SAFE\n", "utf8");
    git(repository.root, [
      "add",
      "--",
      ".gitattributes",
      path.basename(filterScript),
      "extension/input.txt",
    ]);
    const head = commit(repository.root, "masked input");

    fs.writeFileSync(inputPath, "ATTACK\n", "utf8");

    const filteredOid = git(repository.root, [
      "hash-object",
      "--filters",
      "--path=extension/input.txt",
      inputPath,
    ]);
    const committedOid = git(repository.root, ["rev-parse", `${head}:extension/input.txt`]);
    expect(filteredOid).toBe(committedOid);
    expect(git(repository.root, ["status", "--porcelain"])).toBe("");

    expect(() => assertCurrentHeadBuildInputs(repository.root, head)).toThrow("RAW_BYTES_MISMATCH");
  });
});
