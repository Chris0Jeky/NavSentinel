import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(process.cwd());
const temporaryPaths: string[] = [];

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function extractCommittedLauncher(): {
  launcherOid: string;
  launcherPath: string;
} {
  const launcherOid = git([
    "rev-parse",
    "HEAD:scripts/run-state-authority-campaign.mjs",
  ]);
  const launcherBytes = execFileSync(
    "git",
    ["cat-file", "blob", launcherOid],
    { cwd: repositoryRoot },
  );
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "navsentinel-launcher-contract-"),
  );
  temporaryPaths.push(temporaryRoot);
  const launcherPath = path.join(
    temporaryRoot,
    "run-state-authority-campaign.mjs",
  );
  fs.writeFileSync(launcherPath, launcherBytes, { mode: 0o600 });
  return { launcherOid, launcherPath };
}

afterEach(() => {
  for (const target of temporaryPaths.splice(0).reverse()) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("state-authority launcher replay boundary", () => {
  it("emits a non-consumable preflight summary without launch credentials", () => {
    const { launcherOid, launcherPath } = extractCommittedLauncher();
    const environment = { ...process.env };
    delete environment.NODE_OPTIONS;
    delete environment.NODE_PATH;
    for (const key of Object.keys(environment)) {
      if (key.startsWith("NAVSENTINEL_STATE_AUTHORITY_")) {
        delete environment[key];
      }
    }
    environment.NAVSENTINEL_EXPECTED_LAUNCHER_OID = launcherOid;

    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        launcherPath,
        "--repository",
        repositoryRoot,
        "--preflight-only",
      ],
      {
        cwd: repositoryRoot,
        env: environment,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({
      schemaVersion: 2,
      mode: "non-consumable-preflight-summary",
      consumable: false,
      materializedInputCount: expect.any(Number),
    });
    expect(summary.runId).toBeUndefined();
    expect(summary.expiresAt).toBeUndefined();
    expect(summary.attestationPath).toBeUndefined();
    expect(summary.campaignExecutionRoot).toBeUndefined();
    expect(result.stdout).not.toContain(
      "NAVSENTINEL_STATE_AUTHORITY_KEY",
    );
  });

  it("rejects direct worktree loading before Playwright can list tests", () => {
    const environment = { ...process.env };
    for (const key of Object.keys(environment)) {
      if (key.startsWith("NAVSENTINEL_STATE_AUTHORITY_")) {
        delete environment[key];
      }
    }
    const playwrightCli = path.join(
      repositoryRoot,
      "node_modules",
      "@playwright",
      "test",
      "cli.js",
    );
    const result = spawnSync(
      process.execPath,
      [
        playwrightCli,
        "test",
        "tests/e2e/state-authority-sink.spec.ts",
        "--config=playwright.stress.config.ts",
        "--project=stress",
        "--workers=1",
        "--retries=0",
        "--list",
      ],
      {
        cwd: repositoryRoot,
        env: environment,
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(
      "COMMITTED_CAMPAIGN_EXECUTION_REQUIRED",
    );
  });
});
