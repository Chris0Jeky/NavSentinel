import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(process.cwd());
const temporaryPaths: string[] = [];

type LauncherModule = {
  sanitizedEnvironment: (source: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

async function loadLauncherModule(): Promise<LauncherModule> {
  // The committed launcher is plain ESM JavaScript and deliberately has no
  // declaration file; the runtime shape is asserted by these contracts.
  // @ts-expect-error -- committed launcher has no declaration file
  const module = await import("../scripts/run-state-authority-campaign.mjs");
  return module as unknown as LauncherModule;
}

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
  it("scrubs every sensitive environment spelling case-insensitively", async () => {
    const { sanitizedEnvironment } = await loadLauncherModule();
    const environment = sanitizedEnvironment({
      PATH: process.env.PATH ?? "",
      Git_DIR: "/tmp/alternate-git-dir",
      navsentinel_state_authority_key: "caller-key",
      nOdE_oPtIoNs: "--require=caller-preload.cjs",
      node_path: "/tmp/caller-modules",
      extension_path: "/tmp/caller-extension",
      SAFE_VALUE: "retained",
    });

    expect(environment).toMatchObject({
      SAFE_VALUE: "retained",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_OPTIONAL_LOCKS: "0",
    });
    const normalizedKeys = Object.keys(environment).map((key) => key.toUpperCase());
    expect(normalizedKeys.some((key) => key.startsWith("NAVSENTINEL_STATE_AUTHORITY_"))).toBe(false);
    expect(normalizedKeys.some((key) => key.startsWith("GIT_") && ![
      "GIT_NO_REPLACE_OBJECTS",
      "GIT_NO_LAZY_FETCH",
      "GIT_OPTIONAL_LOCKS",
    ].includes(key))).toBe(false);
    expect(normalizedKeys).not.toContain("NODE_OPTIONS");
    expect(normalizedKeys).not.toContain("NODE_PATH");
    expect(normalizedKeys).not.toContain("EXTENSION_PATH");
  });

  it("emits a non-consumable preflight summary without launch credentials on the Node floor", async () => {
    const { launcherOid, launcherPath } = extractCommittedLauncher();
    const { sanitizedEnvironment } = await loadLauncherModule();
    const environment = sanitizedEnvironment(process.env);
    environment.NAVSENTINEL_EXPECTED_LAUNCHER_OID = launcherOid;

    const result = spawnSync(
      process.execPath,
      [
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
      schemaVersion: 3,
      mode: "non-consumable-preflight-summary",
      consumable: false,
      materializedInputCount: expect.any(Number),
    });
    expect(summary.runId).toBeUndefined();
    expect(summary.expiresAt).toBeUndefined();
    expect(summary.attestationPath).toBeUndefined();
    expect(summary.campaignExecutionRoot).toBeUndefined();
    expect(summary.candidateReceiptDirectory).toBeUndefined();
    expect(summary.finalizationKeyCommitment).toBeUndefined();
    expect(result.stdout).not.toContain(
      "NAVSENTINEL_STATE_AUTHORITY_KEY",
    );
  });

  it("rejects direct worktree loading before Playwright can list tests", async () => {
    const { sanitizedEnvironment } = await loadLauncherModule();
    const environment = sanitizedEnvironment(process.env);
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

  it("keeps authoritative receipt issuance and signing in the committed launcher", () => {
    const launcher = fs.readFileSync(
      path.join(repositoryRoot, "scripts", "run-state-authority-campaign.mjs"),
      "utf8",
    );
    const campaign = fs.readFileSync(
      path.join(repositoryRoot, "tests", "e2e", "state-authority-sink.spec.ts"),
      "utf8",
    );

    expect(campaign).toContain('authority: "playwright-candidate-only"');
    expect(campaign).toContain("launcher_finalized: false");
    expect(campaign).not.toContain("testInfo.attach(");
    expect(campaign).not.toContain('authority: "committed-launcher-finalized"');
    expect(campaign).not.toContain("NAVSENTINEL_STATE_AUTHORITY_FINALIZATION_KEY");

    expect(launcher).toContain("function transpileCommittedTypeScriptModule");
    expect(launcher).toContain("typescript.transpileModule");
    expect(launcher).not.toContain("--experimental-strip-types");
    expect(launcher).toContain("function finalizeCandidateReceipts");
    expect(launcher).toContain('authority: "committed-launcher-finalized"');
    expect(launcher).toContain("finalized_after_child_exit: true");
    expect(launcher).toContain("const finalizationKey = randomBytes(32)");
    expect(launcher).toContain("generateKeyPairSync(\"ed25519\")");
    expect(launcher).toContain("function verifyFinalReceiptSignature");
    expect(launcher).toContain("delete unsigned.launcher_signature");
    expect(launcher).toContain("signingPublicKeySha256");
    expect(launcher).toContain("finalization_key_commitment_sha256");
    expect(launcher).not.toContain(
      "childEnvironment.NAVSENTINEL_STATE_AUTHORITY_FINALIZATION_KEY",
    );
  });
});
