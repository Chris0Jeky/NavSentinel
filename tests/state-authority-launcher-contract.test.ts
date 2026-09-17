import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(process.cwd());
const temporaryPaths: string[] = [];

type LauncherModule = {
  sanitizedEnvironment: (source: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
};

type BootstrapModule = {
  sanitizedBootstrapEnvironment: (source: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  gitObjectId: (type: string, content: Buffer, objectFormat: string) => string;
};

async function loadLauncherModule(): Promise<LauncherModule> {
  // The committed launcher is plain ESM JavaScript and deliberately has no
  // declaration file; the runtime shape is asserted by these contracts.
  // @ts-expect-error -- committed launcher has no declaration file
  const module = await import("../scripts/run-state-authority-campaign.mjs");
  return module as unknown as LauncherModule;
}

async function loadBootstrapModule(): Promise<BootstrapModule> {
  // @ts-expect-error -- the dependency-free bootstrap has no declaration file
  const module = await import("../scripts/launch-state-authority-campaign.mjs");
  return module as unknown as BootstrapModule;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function repositoryIsShallow(): boolean {
  return git(["rev-parse", "--is-shallow-repository"]) === "true";
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
  it("recomputes the extracted launcher's Git object ID before execution", async () => {
    const { gitObjectId } = await loadBootstrapModule();
    const launcherBytes = Buffer.from("console.log('trusted launcher');\n", "utf8");
    const expectedOid = execFileSync("git", ["hash-object", "--stdin"], {
      cwd: repositoryRoot,
      input: launcherBytes,
      encoding: "utf8",
    }).trim();

    expect(gitObjectId("blob", launcherBytes, "sha1")).toBe(expectedOid);
    expect(() => gitObjectId("blob", launcherBytes, "md5")).toThrow(
      /unsupported Git object format/u,
    );
  });

  it("rejects a substituted loose launcher object before Node executes it", () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "navsentinel-bootstrap-object-integrity-"),
    );
    temporaryPaths.push(temporaryRoot);
    fs.mkdirSync(path.join(temporaryRoot, "scripts"));
    const launcherPath = path.join(
      temporaryRoot,
      "scripts",
      "run-state-authority-campaign.mjs",
    );
    fs.writeFileSync(launcherPath, "process.exitCode = 0;\n", "utf8");
    execFileSync("git", ["init"], { cwd: temporaryRoot });
    execFileSync("git", ["add", "."], { cwd: temporaryRoot });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=NavSentinel Test",
        "-c",
        "user.email=navsentinel-test@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: temporaryRoot },
    );
    const launcherOid = execFileSync(
      "git",
      ["rev-parse", "HEAD:scripts/run-state-authority-campaign.mjs"],
      { cwd: temporaryRoot, encoding: "utf8" },
    ).trim();
    const markerPath = path.join(temporaryRoot, "substituted-launcher-ran.txt");
    const substitutedBytes = Buffer.from(
      `import fs from "node:fs"; fs.writeFileSync(process.env.MARKER_PATH, "executed");\n`,
      "utf8",
    );
    const looseObjectPath = path.join(
      temporaryRoot,
      ".git",
      "objects",
      launcherOid.slice(0, 2),
      launcherOid.slice(2),
    );
    fs.chmodSync(looseObjectPath, 0o600);
    fs.writeFileSync(
      looseObjectPath,
      deflateSync(Buffer.concat([
        Buffer.from(`blob ${substitutedBytes.length}\0`, "utf8"),
        substitutedBytes,
      ])),
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts", "launch-state-authority-campaign.mjs"),
        "--preflight-only",
      ],
      {
        cwd: temporaryRoot,
        env: { ...process.env, MARKER_PATH: markerPath },
        encoding: "utf8",
      },
    );

    expect(result.status).not.toBe(0);
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/corrupt|mismatch/u);
  });

  it("scrubs preload and repository authority before extracting the launcher", async () => {
    const { sanitizedBootstrapEnvironment } = await loadBootstrapModule();
    const environment = sanitizedBootstrapEnvironment({
      PATH: process.env.PATH ?? "",
      git_dir: "/tmp/alternate-git-dir",
      NavSentinel_State_Authority_Key: "caller-key",
      NoDe_OpTiOnS: "--require=caller-preload.cjs",
      node_path: "/tmp/caller-modules",
      Extension_Path: "/tmp/caller-extension",
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

  it("fails closed in shallow checkouts and emits a non-consumable preflight summary from full history", async () => {
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
    const output = `${result.stdout}\n${result.stderr}`;

    if (repositoryIsShallow()) {
      expect(result.status).not.toBe(0);
      expect(output).toContain("TEST_INVALID [SHALLOW_REPOSITORY]");
      expect(result.stdout).not.toContain("NAVSENTINEL_STATE_AUTHORITY_KEY");
      return;
    }

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
  }, 15_000);

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
