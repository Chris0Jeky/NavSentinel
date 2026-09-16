#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LAUNCHER_REPOSITORY_PATH = "scripts/run-state-authority-campaign.mjs";
const HELPER_REPOSITORY_PATH = "tests/e2e/extension_build_provenance.ts";
const MANIFEST_REPOSITORY_PATH = "tests/e2e/state-authority-campaign-inputs.json";
const REQUIRED_CAMPAIGN_INPUTS = new Set([
  LAUNCHER_REPOSITORY_PATH,
  MANIFEST_REPOSITORY_PATH,
  "tests/e2e/state-authority-sink.spec.ts",
  HELPER_REPOSITORY_PATH,
  "tests/e2e/extension_test_utils.ts",
  "scripts/content-loader-contract.mjs",
  "tests/e2e/local_fixture_target_bootstrap.ts",
  "tests/e2e/proving_ground_fake_sink.ts",
  "playwright.stress.config.ts",
  "gym/local-fixture-targets.js",
  "gym/rw21-allow-once-double-spend.html",
  "gym/rw24-idle-resume-popup.html",
  "gym/rw25-rapid-close-reopen.html",
]);

function fail(code, message) {
  const error = new Error(`State-authority launch TEST_INVALID [${code}]: ${message}`);
  error.name = "StateAuthorityLaunchIntegrityError";
  throw error;
}

function sanitizedEnvironment(source = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || key.toUpperCase().startsWith("GIT_")) continue;
    environment[key] = value;
  }
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.LC_ALL = "C";
  environment.LANG = "C";
  return environment;
}

function git(repositoryRoot, args, options = {}) {
  const result = spawnSync("git", ["--no-replace-objects", "-C", repositoryRoot, ...args], {
    env: sanitizedEnvironment(options.environment ?? process.env),
    input: options.input,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr ?? "").trim()
      || String(result.stdout ?? "").trim()
      || result.error?.message
      || `exit ${String(result.status)}`;
    fail("GIT_AUTHORITY_UNAVAILABLE", `git ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout;
}

function gitText(repositoryRoot, args) {
  return String(git(repositoryRoot, args)).trim();
}

function gitBuffer(repositoryRoot, args) {
  const output = git(repositoryRoot, args, { encoding: "buffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function hashAlgorithm(objectFormat) {
  if (objectFormat === "sha1" || objectFormat === "sha256") return objectFormat;
  fail("UNSUPPORTED_OBJECT_FORMAT", `unsupported Git object format '${objectFormat}'`);
}

function computeGitObjectId(objectFormat, type, content) {
  const hash = createHash(hashAlgorithm(objectFormat));
  hash.update(Buffer.from(`${type} ${content.length}\0`, "utf8"));
  hash.update(content);
  return hash.digest("hex");
}

function parseArguments(argv) {
  let repositoryRoot = process.cwd();
  let preflightOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repository") {
      const value = argv[index + 1];
      if (!value) fail("ARGUMENTS", "--repository requires a value");
      repositoryRoot = value;
      index += 1;
    } else if (argument === "--preflight-only") {
      preflightOnly = true;
    } else {
      fail("ARGUMENTS", `unsupported argument '${argument}'`);
    }
  }
  return { repositoryRoot: path.resolve(repositoryRoot), preflightOnly };
}

function assertCanonicalManifestPath(relativePath) {
  if (
    typeof relativePath !== "string"
    || !relativePath
    || relativePath.startsWith("/")
    || relativePath.includes("\\")
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail("CAMPAIGN_MANIFEST", `non-canonical campaign input '${String(relativePath)}'`);
  }
}

function loadCampaignManifest(content) {
  let parsed;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch (error) {
    fail("CAMPAIGN_MANIFEST", error instanceof Error ? error.message : String(error));
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || parsed.schemaVersion !== 1
    || parsed.campaign !== "state-authority-typed-harm"
    || !Array.isArray(parsed.inputs)
  ) {
    fail("CAMPAIGN_MANIFEST", "manifest schema or campaign identity is invalid");
  }
  const inputs = parsed.inputs;
  for (const relativePath of inputs) assertCanonicalManifestPath(relativePath);
  if (new Set(inputs).size !== inputs.length) {
    fail("CAMPAIGN_MANIFEST", "campaign manifest contains duplicate inputs");
  }
  for (const required of REQUIRED_CAMPAIGN_INPUTS) {
    if (!inputs.includes(required)) {
      fail("CAMPAIGN_MANIFEST", `campaign manifest omits required input '${required}'`);
    }
  }
  return Object.freeze([...inputs].sort());
}

function readCommittedPath(repositoryRoot, commit, relativePath, objectFormat) {
  const oid = gitText(repositoryRoot, ["rev-parse", "--verify", `${commit}:${relativePath}`]);
  const content = gitBuffer(repositoryRoot, ["cat-file", "blob", oid]);
  const computed = computeGitObjectId(objectFormat, "blob", content);
  if (computed !== oid) {
    fail(
      "OBJECT_HASH_MISMATCH",
      `committed path '${relativePath}' hashes to ${computed}, not claimed object ${oid}`,
    );
  }
  return { oid, content };
}

function writePrivateFile(target, content) {
  fs.writeFileSync(target, content, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") fs.chmodSync(target, 0o600);
}

async function main() {
  const { repositoryRoot: requestedRoot, preflightOnly } = parseArguments(process.argv.slice(2));
  const repositoryRoot = fs.realpathSync.native(requestedRoot);
  const fsck = spawnSync(
    "git",
    ["--no-replace-objects", "-C", repositoryRoot, "fsck", "--full", "--strict", "--no-reflogs", "--no-progress", "HEAD"],
    { env: sanitizedEnvironment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (fsck.error || fsck.status !== 0) {
    const detail = String(fsck.stderr ?? "").trim()
      || String(fsck.stdout ?? "").trim()
      || fsck.error?.message
      || `exit ${String(fsck.status)}`;
    fail("OBJECT_STORE_INTEGRITY", detail);
  }

  const repositoryCommit = gitText(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const repositoryTree = gitText(repositoryRoot, ["rev-parse", "--verify", `${repositoryCommit}^{tree}`]);
  const objectFormat = gitText(repositoryRoot, ["rev-parse", "--show-object-format"]);
  hashAlgorithm(objectFormat);

  const expectedLauncherOid = process.env.NAVSENTINEL_EXPECTED_LAUNCHER_OID?.trim();
  if (!expectedLauncherOid) {
    fail(
      "LAUNCHER_BOOTSTRAP",
      "authoritative execution requires NAVSENTINEL_EXPECTED_LAUNCHER_OID from an external Git-object extraction step",
    );
  }
  const committedLauncher = readCommittedPath(
    repositoryRoot,
    repositoryCommit,
    LAUNCHER_REPOSITORY_PATH,
    objectFormat,
  );
  const executingLauncherBytes = fs.readFileSync(fileURLToPath(import.meta.url));
  const executingLauncherOid = computeGitObjectId(objectFormat, "blob", executingLauncherBytes);
  if (
    committedLauncher.oid !== expectedLauncherOid
    || executingLauncherOid !== expectedLauncherOid
    || !executingLauncherBytes.equals(committedLauncher.content)
  ) {
    fail(
      "LAUNCHER_BOOTSTRAP",
      `executing launcher ${executingLauncherOid} is not exact committed launcher ${committedLauncher.oid}`,
    );
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-state-authority-launch-"));
  try {
    const helper = readCommittedPath(
      repositoryRoot,
      repositoryCommit,
      HELPER_REPOSITORY_PATH,
      objectFormat,
    );
    const manifest = readCommittedPath(
      repositoryRoot,
      repositoryCommit,
      MANIFEST_REPOSITORY_PATH,
      objectFormat,
    );
    const helperPath = path.join(temporaryRoot, "extension_build_provenance.ts");
    writePrivateFile(helperPath, helper.content);
    const campaignFiles = loadCampaignManifest(manifest.content);

    const provenanceModule = await import(pathToFileURL(helperPath).href);
    const buildInputs = provenanceModule.assertCurrentHeadBuildInputs(
      repositoryRoot,
      repositoryCommit,
    );
    const campaignAbsolutePaths = campaignFiles.map((relativePath) =>
      path.join(repositoryRoot, ...relativePath.split("/"))
    );
    const campaignGitSha256 = provenanceModule.hashGitFiles(
      repositoryRoot,
      campaignAbsolutePaths,
      repositoryCommit,
    );
    const campaignExecutedSha256 = provenanceModule.hashCanonicalWorktreeFiles(
      repositoryRoot,
      campaignAbsolutePaths,
      repositoryCommit,
    );
    if (campaignGitSha256 !== campaignExecutedSha256) {
      fail("CAMPAIGN_SOURCE_MISMATCH", "campaign worktree bytes differ from committed blobs");
    }

    const runId = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 15 * 60 * 1000);
    const attestationPath = path.join(temporaryRoot, "launch-attestation.json");
    const attestation = {
      schemaVersion: 1,
      runId,
      launcherMode: "git-object-extracted",
      repositoryRoot,
      repositoryCommit: buildInputs.repositoryCommit,
      repositoryTree: buildInputs.repositoryTree,
      objectFormat: buildInputs.objectFormat,
      comparisonMode: buildInputs.comparisonMode,
      buildInputGitSha256: buildInputs.gitSha256,
      buildInputExecutedSha256: buildInputs.executedSha256,
      campaignGitSha256,
      campaignExecutedSha256,
      campaignFiles,
      launcherOid: committedLauncher.oid,
      helperOid: helper.oid,
      manifestOid: manifest.oid,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    writePrivateFile(attestationPath, Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`, "utf8"));

    if (preflightOnly) {
      process.stdout.write(`${JSON.stringify(attestation, null, 2)}\n`);
      return;
    }

    const playwrightCli = path.join(
      repositoryRoot,
      "node_modules",
      "@playwright",
      "test",
      "cli.js",
    );
    if (!fs.existsSync(playwrightCli)) {
      fail("TOOLCHAIN_UNAVAILABLE", `Playwright CLI is missing at '${playwrightCli}'`);
    }
    const childEnvironment = sanitizedEnvironment(process.env);
    delete childEnvironment.EXTENSION_PATH;
    childEnvironment.NAVSENTINEL_STATE_AUTHORITY_ATTESTATION = attestationPath;
    childEnvironment.NAVSENTINEL_STATE_AUTHORITY_RUN_ID = runId;
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
        "--grep=independent harm oracle",
      ],
      {
        cwd: repositoryRoot,
        env: childEnvironment,
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
