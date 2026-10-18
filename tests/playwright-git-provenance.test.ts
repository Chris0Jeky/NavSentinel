import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
const testModule = require.resolve("@playwright/test");

function command(cwd: string, file: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(file, args, { cwd, env, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined, `${file}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${file} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

// Run the actual locked Playwright metadata plugin, without a browser, against a
// disposable LOCAL remote. Neither GitHub nor the working repository is touched.
function probe(configName: string, forceDiff = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ns-playwright-git-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("GIT_") || key.startsWith("GITHUB_") || key.startsWith("NAVSENTINEL_")) delete env[key];
    }
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(directory, "gitconfig"),
      GIT_ALLOW_PROTOCOL: "file", GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      NAVSENTINEL_BRANDED_CHROME: "0", NAVSENTINEL_REALISTIC_CHROME: "0",
      CI: "1", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "fixture/local-only",
      GITHUB_SERVER_URL: "https://github.invalid", GITHUB_RUN_ID: "1",
    });
    fs.writeFileSync(env.GIT_CONFIG_GLOBAL!, "");
    const seed = path.join(directory, "seed");
    const checkout = path.join(directory, "checkout");
    fs.mkdirSync(seed);
    const git = (cwd: string, ...args: string[]) => command(cwd, "git", args, env);
    git(seed, "init", "--quiet");
    const commits: string[] = [];
    for (let index = 0; index < 3; index++) {
      fs.writeFileSync(path.join(seed, "fixture.txt"), String(index));
      git(seed, "add", "fixture.txt");
      git(seed, "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", `fixture ${index}`);
      commits.push(git(seed, "rev-parse", "HEAD"));
    }
    git(directory, "clone", "--quiet", "--no-local", seed, checkout);
    assert.equal(git(checkout, "rev-parse", "--is-shallow-repository"), "false");
    git(checkout, "merge-base", "--is-ancestor", commits[0]!, "HEAD");
    env.GITHUB_SHA = commits[2];
    env.GITHUB_EVENT_PATH = path.join(directory, "event.json");
    fs.writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify({
      pull_request: { title: "local provenance probe", number: 1, base: { sha: commits[1] } },
    }));
    const reportPath = path.join(directory, "report.json");
    // Preserve the repository's ESM config semantics, including import.meta.url.
    const config = path.join(checkout, "probe.config.mts");
    fs.writeFileSync(config, `
import base from ${JSON.stringify(pathToFileURL(path.join(root, configName)).href)};
import playwright from ${JSON.stringify(pathToFileURL(testModule).href)};
const { defineConfig } = playwright;
export default defineConfig(base, {
  testDir: ".", testMatch: "probe.spec.cjs", testIgnore: [],
  projects: [{ name: "checkout-probe", testMatch: "probe.spec.cjs" }],
  fullyParallel: false, workers: 1, retries: 0,
  reporter: [["json", { outputFile: ${JSON.stringify(reportPath)} }]],
  outputDir: ${JSON.stringify(path.join(directory, "results"))},
  ${forceDiff ? "captureGitInfo: { commit: true, diff: true }," : ""}
});
`);
    fs.writeFileSync(path.join(checkout, "probe.spec.cjs"), `
const { test, expect } = require(${JSON.stringify(testModule)});
test("metadata-only probe", () => expect(1).toBe(1));
`);
    command(checkout, process.execPath, [cli, "test", "--config", config], env);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    assert.equal(report.stats.expected, 1, "the real Playwright test must execute");
    assert.equal(report.stats.unexpected, 0);
    assert.equal(report.config.metadata.gitCommit.hash, commits[2], "read-only commit metadata remains available");
    return {
      shallow: git(checkout, "rev-parse", "--is-shallow-repository"),
      revisions: Number(git(checkout, "rev-list", "--count", "HEAD")),
      ancestorStatus: spawnSync("git", ["merge-base", "--is-ancestor", commits[0]!, "HEAD"], { cwd: checkout, env }).status,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

describe("Playwright Git metadata preserves acceptance provenance (#948)", () => {
  for (const config of ["playwright.config.ts", "playwright.branded.config.ts", "playwright.acceptance.config.ts"]) {
    it(`${config} preserves a full checkout and historical ancestors on pull_request`, () => {
      assert.deepEqual(probe(config), { shallow: "false", revisions: 3, ancestorStatus: 0 });
    }, 60_000);
  }

  it("reproduces the locked plugin's destructive shallow-fetch control", () => {
    assert.deepEqual(probe("playwright.config.ts", true), { shallow: "true", revisions: 2, ancestorStatus: 1 });
  }, 60_000);
});
