#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as signPayload,
  verify as verifyPayload,
} from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LAUNCHER_REPOSITORY_PATH = "scripts/run-state-authority-campaign.mjs";
const HELPER_REPOSITORY_PATH = "tests/e2e/extension_build_provenance.ts";
const MATERIALIZER_REPOSITORY_PATH =
  "tests/e2e/materialized_campaign_provenance.ts";
const MANIFEST_REPOSITORY_PATH =
  "tests/e2e/state-authority-campaign-inputs.json";
const REQUIRED_CAMPAIGN_INPUTS = new Set([
  LAUNCHER_REPOSITORY_PATH,
  "scripts/launch-state-authority-campaign.mjs",
  MANIFEST_REPOSITORY_PATH,
  "tests/e2e/state-authority-sink.spec.ts",
  HELPER_REPOSITORY_PATH,
  MATERIALIZER_REPOSITORY_PATH,
  "tests/e2e/extension_test_utils.ts",
  "scripts/content-loader-contract.mjs",
  "tests/e2e/local_fixture_target_bootstrap.ts",
  "tests/e2e/proving_ground_fake_sink.ts",
  "playwright.stress.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "gym/local-fixture-targets.js",
  "gym/rw21-allow-once-double-spend.html",
  "gym/rw24-idle-resume-popup.html",
  "gym/rw25-rapid-close-reopen.html",
]);

const FINAL_RECEIPT_RELATIVE_DIRECTORY =
  "test-results/state-authority-launcher-receipts";
const EXPECTED_SCENARIOS = Object.freeze([
  {
    scenarioId: "NS-ADV-WIN-005",
    journey: "RW-21",
    model: "allow-once double spend",
    mainActionReachesBenign: true,
  },
  {
    scenarioId: "NS-ADV-EVADE-003",
    journey: "RW-24",
    model: "idle-resume time bomb",
    mainActionReachesBenign: false,
  },
  {
    scenarioId: "NS-ADV-STATE-008",
    journey: "RW-25",
    model: "rapid close/reopen stale authority",
    mainActionReachesBenign: false,
  },
]);

function fail(code, message) {
  const error = new Error(
    `State-authority launch TEST_INVALID [${code}]: ${message}`,
  );
  error.name = "StateAuthorityLaunchIntegrityError";
  throw error;
}

export function sanitizedEnvironment(source = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(source)) {
    const normalizedKey = key.toUpperCase();
    if (
      value === undefined
      || normalizedKey.startsWith("GIT_")
      || normalizedKey.startsWith("NAVSENTINEL_STATE_AUTHORITY_")
      || normalizedKey === "NODE_OPTIONS"
      || normalizedKey === "NODE_PATH"
      || normalizedKey === "EXTENSION_PATH"
    ) {
      continue;
    }
    environment[key] = value;
  }
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.LC_ALL = "C";
  environment.LANG = "C";
  return environment;
}

function git(repositoryRoot, args, options = {}) {
  const result = spawnSync(
    "git",
    ["--no-replace-objects", "-C", repositoryRoot, ...args],
    {
      env: sanitizedEnvironment(options.environment ?? process.env),
      input: options.input,
      encoding: options.encoding ?? "utf8",
      maxBuffer: 1024 * 1024 * 1024,
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        "pipe",
        "pipe",
      ],
    },
  );
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
  fail(
    "UNSUPPORTED_OBJECT_FORMAT",
    `unsupported Git object format '${objectFormat}'`,
  );
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
    || relativePath
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail(
      "CAMPAIGN_MANIFEST",
      `non-canonical campaign input '${String(relativePath)}'`,
    );
  }
}

function loadCampaignManifest(content) {
  let parsed;
  try {
    parsed = JSON.parse(content.toString("utf8"));
  } catch (error) {
    fail(
      "CAMPAIGN_MANIFEST",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    !parsed
    || typeof parsed !== "object"
    || parsed.schemaVersion !== 1
    || parsed.campaign !== "state-authority-typed-harm"
    || !Array.isArray(parsed.inputs)
  ) {
    fail(
      "CAMPAIGN_MANIFEST",
      "manifest schema or campaign identity is invalid",
    );
  }
  const inputs = parsed.inputs;
  for (const relativePath of inputs) {
    assertCanonicalManifestPath(relativePath);
  }
  if (new Set(inputs).size !== inputs.length) {
    fail("CAMPAIGN_MANIFEST", "campaign manifest contains duplicate inputs");
  }
  for (const required of REQUIRED_CAMPAIGN_INPUTS) {
    if (!inputs.includes(required)) {
      fail(
        "CAMPAIGN_MANIFEST",
        `campaign manifest omits required input '${required}'`,
      );
    }
  }
  return Object.freeze([...inputs].sort());
}

function readCommittedPath(
  repositoryRoot,
  commit,
  relativePath,
  objectFormat,
) {
  const oid = gitText(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${commit}:${relativePath}`,
  ]);
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
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, content, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") fs.chmodSync(target, 0o600);
}

function loadTrustedTypeScript(repositoryRoot) {
  const requireFromRepository = createRequire(
    path.join(repositoryRoot, "package.json"),
  );
  let typescript;
  try {
    typescript = requireFromRepository("typescript");
  } catch (error) {
    fail(
      "TOOLCHAIN_UNAVAILABLE",
      `TypeScript compiler is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    !typescript
    || typeof typescript.transpileModule !== "function"
    || !typescript.ScriptTarget
    || !typescript.ModuleKind
    || !typescript.DiagnosticCategory
  ) {
    fail(
      "TOOLCHAIN_UNAVAILABLE",
      "installed TypeScript compiler does not expose the required transpilation API",
    );
  }
  return typescript;
}

function formatTypeScriptDiagnostics(typescript, diagnostics) {
  return diagnostics.map((diagnostic) => {
    const message = typescript.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );
    if (!diagnostic.file || typeof diagnostic.start !== "number") {
      return message;
    }
    const location = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    );
    return `${diagnostic.file.fileName}:${location.line + 1}:${
      location.character + 1
    }: ${message}`;
  }).join("; ");
}

function transpileCommittedTypeScriptModule({
  typescript,
  relativePath,
  source,
  runtimeRoot,
}) {
  const transpiled = typescript.transpileModule(
    source.toString("utf8"),
    {
      compilerOptions: {
        target: typescript.ScriptTarget.ES2022,
        module: typescript.ModuleKind.ES2022,
        verbatimModuleSyntax: true,
      },
      fileName: relativePath,
      reportDiagnostics: true,
    },
  );
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) =>
      diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    fail(
      "TRUSTED_HELPER_TRANSPILE",
      formatTypeScriptDiagnostics(typescript, errors),
    );
  }
  const outputPath = path.join(
    runtimeRoot,
    `${path.basename(relativePath, path.extname(relativePath))}.mjs`,
  );
  writePrivateFile(
    outputPath,
    Buffer.from(transpiled.outputText, "utf8"),
  );
  return pathToFileURL(outputPath).href;
}

function materializeCampaign(
  repositoryRoot,
  repositoryCommit,
  objectFormat,
  campaignFiles,
  campaignRoot,
) {
  for (const relativePath of campaignFiles) {
    const committed = readCommittedPath(
      repositoryRoot,
      repositoryCommit,
      relativePath,
      objectFormat,
    );
    writePrivateFile(
      path.join(campaignRoot, ...relativePath.split("/")),
      committed.content,
    );
  }
}

function linkTrustedToolchain(repositoryRoot, campaignRoot) {
  const source = path.join(repositoryRoot, "node_modules");
  let sourceStats;
  try {
    sourceStats = fs.lstatSync(source);
  } catch (error) {
    fail(
      "TOOLCHAIN_UNAVAILABLE",
      `node_modules is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
    fail(
      "TOOLCHAIN_UNAVAILABLE",
      "node_modules must be an ordinary directory",
    );
  }
  fs.symlinkSync(
    source,
    path.join(campaignRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
}

function createEnvelope(payload, key) {
  const mac = createHmac("sha256", key)
    .update(JSON.stringify(payload))
    .digest("hex");
  return { schemaVersion: 3, payload, mac };
}


function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Hex(content) {
  return createHash("sha256").update(content).digest("hex");
}

function assertPrivateDirectory(target, code) {
  let stats;
  try {
    stats = fs.lstatSync(target);
  } catch (error) {
    fail(
      code,
      `directory is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail(code, "path is linked or not an ordinary directory");
  }
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
    fail(code, "directory permissions are too broad");
  }
  const real = fs.realpathSync.native(target);
  if (path.resolve(target) !== path.resolve(real)) {
    fail(code, "directory resolves through a link");
  }
  return real;
}

function resetFinalReceiptDirectory(repositoryRoot) {
  const parent = path.join(repositoryRoot, "test-results");
  if (fs.existsSync(parent)) {
    const stats = fs.lstatSync(parent);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      fail(
        "FINAL_RECEIPT_OUTPUT",
        "test-results is linked or not an ordinary directory",
      );
    }
    if (fs.realpathSync.native(parent) !== path.resolve(parent)) {
      fail("FINAL_RECEIPT_OUTPUT", "test-results resolves through a link");
    }
  } else {
    fs.mkdirSync(parent, { mode: 0o700 });
  }

  const target = path.join(
    repositoryRoot,
    ...FINAL_RECEIPT_RELATIVE_DIRECTORY.split("/"),
  );
  if (fs.existsSync(target)) {
    const stats = fs.lstatSync(target);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      fail(
        "FINAL_RECEIPT_OUTPUT",
        "final receipt output is linked or not an ordinary directory",
      );
    }
    fs.rmSync(target, { recursive: true, force: false });
  }
  fs.mkdirSync(target, { mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(target, 0o700);
  return fs.realpathSync.native(target);
}

function candidateString(candidate, key) {
  const value = candidate[key];
  if (typeof value !== "string" || !value) {
    fail("RECEIPT_CANDIDATE", `missing string field '${key}'`);
  }
  return value;
}

function candidateInteger(candidate, key) {
  const value = candidate[key];
  if (!Number.isInteger(value) || value < 0) {
    fail("RECEIPT_CANDIDATE", `invalid non-negative integer '${key}'`);
  }
  return value;
}

function validateObservationMatrix(candidate, scenario) {
  const observations = candidate.observations;
  if (!Array.isArray(observations) || observations.length !== 4) {
    fail(
      "RECEIPT_CANDIDATE",
      `${scenario.journey} must contain exactly four arm observations`,
    );
  }
  const expectedOutcomes = new Map([
    ["baseline", "HARM_REACHED"],
    ["protected", "BLOCKED_PRE_HARM"],
    ["benign", "BENIGN_REACHED"],
    ["mixed", "BENIGN_REACHED_HARM_BLOCKED"],
  ]);
  const seen = new Set();
  const sanitized = [];
  for (const observation of observations) {
    if (!isRecord(observation)) {
      fail("RECEIPT_CANDIDATE", "observation must be an object");
    }
    const arm = candidateString(observation, "arm");
    const expectedOutcome = expectedOutcomes.get(arm);
    if (!expectedOutcome || seen.has(arm)) {
      fail("RECEIPT_CANDIDATE", `invalid or duplicate arm '${arm}'`);
    }
    seen.add(arm);
    const outcome = candidateString(observation, "outcome");
    if (outcome !== expectedOutcome) {
      fail(
        "RECEIPT_CANDIDATE",
        `${scenario.journey} ${arm} outcome '${outcome}' is not '${expectedOutcome}'`,
      );
    }
    const harmReceipts = candidateInteger(observation, "harmReceipts");
    const benignReceipts = candidateInteger(observation, "benignReceipts");
    const invalidAttempts = candidateInteger(observation, "invalidAttempts");
    const browserBackgroundAttemptsDenied = candidateInteger(
      observation,
      "browserBackgroundAttemptsDenied",
    );
    const expectedHarm = arm === "baseline" ? 1 : 0;
    const expectedBenign = arm === "benign" || arm === "mixed"
      ? 1
      : scenario.mainActionReachesBenign
        ? 1
        : 0;
    if (
      harmReceipts !== expectedHarm
      || benignReceipts !== expectedBenign
      || invalidAttempts !== 0
    ) {
      fail(
        "RECEIPT_CANDIDATE",
        `${scenario.journey} ${arm} typed-sink observation is invalid`,
      );
    }
    sanitized.push({
      arm,
      outcome,
      harmReceipts,
      benignReceipts,
      invalidAttempts,
      browserBackgroundAttemptsDenied,
    });
  }
  return sanitized;
}

function loadCandidateReceipts(
  candidateReceiptDirectory,
  runId,
  finalizationKeyCommitment,
) {
  const realDirectory = assertPrivateDirectory(
    candidateReceiptDirectory,
    "CANDIDATE_DIRECTORY",
  );
  const entries = fs.readdirSync(realDirectory, { withFileTypes: true });
  const expectedNames = EXPECTED_SCENARIOS.map(
    (scenario) =>
      `${scenario.journey.toLowerCase()}-state-authority-candidate.json`,
  ).sort();
  const actualNames = entries.map((entry) => entry.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    fail(
      "RECEIPT_CANDIDATE",
      `candidate set ${JSON.stringify(actualNames)} does not equal ${JSON.stringify(expectedNames)}`,
    );
  }

  return EXPECTED_SCENARIOS.map((scenario) => {
    const filename =
      `${scenario.journey.toLowerCase()}-state-authority-candidate.json`;
    const candidatePath = path.join(realDirectory, filename);
    const stats = fs.lstatSync(candidatePath);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 1024 * 1024) {
      fail(
        "RECEIPT_CANDIDATE",
        `${filename} is linked, not a regular file, or too large`,
      );
    }
    if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
      fail("RECEIPT_CANDIDATE", `${filename} permissions are too broad`);
    }
    const raw = fs.readFileSync(candidatePath);
    let candidate;
    try {
      candidate = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      fail(
        "RECEIPT_CANDIDATE",
        `${filename} is not JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      !isRecord(candidate)
      || candidate.schema_version !== 1
      || candidate.authority !== "playwright-candidate-only"
      || candidate.launcher_finalized !== false
      || candidateString(candidate, "launch_run_id") !== runId
      || candidateString(
        candidate,
        "finalization_key_commitment_sha256",
      ) !== finalizationKeyCommitment
      || candidateString(candidate, "scenario_id") !== scenario.scenarioId
      || candidateString(candidate, "journey") !== scenario.journey
      || candidateString(candidate, "model") !== scenario.model
    ) {
      fail("RECEIPT_CANDIDATE", `${filename} identity is invalid`);
    }
    const browser = candidateString(candidate, "browser");
    if (!browser.startsWith("Playwright bundled Chromium ")) {
      fail("RECEIPT_CANDIDATE", `${filename} browser identity is invalid`);
    }
    const extensionBuildSha256 = candidateString(
      candidate,
      "extension_build_sha256",
    );
    const campaignMaterializedSha256 = candidateString(
      candidate,
      "campaign_materialized_sha256",
    );
    if (
      !/^[0-9a-f]{64}$/u.test(extensionBuildSha256)
      || !/^[0-9a-f]{64}$/u.test(campaignMaterializedSha256)
    ) {
      fail("RECEIPT_CANDIDATE", `${filename} contains malformed hashes`);
    }
    return {
      scenario,
      filename,
      candidateSha256: sha256Hex(raw),
      browser,
      extensionBuildSha256,
      extensionBuildFileCount: candidateInteger(
        candidate,
        "extension_build_file_count",
      ),
      campaignMaterializedSha256,
      observations: validateObservationMatrix(candidate, scenario),
    };
  });
}

function assertSameBuildInputs(initial, current) {
  for (const key of [
    "repositoryCommit",
    "repositoryTree",
    "objectFormat",
    "comparisonMode",
    "gitSha256",
    "executedSha256",
    "trackedInputCount",
    "unexpectedInputCount",
    "specialInputCount",
  ]) {
    if (current[key] !== initial[key]) {
      fail(
        "POST_RUN_AUTHORITY",
        `build input '${key}' changed during the Playwright child`,
      );
    }
  }
}

function authenticateFinalReceipt(unsignedReceipt, finalizationKey) {
  return createHmac("sha256", finalizationKey)
    .update(JSON.stringify(unsignedReceipt))
    .digest("hex");
}

function verifyFinalReceiptMac(receipt, finalizationKey) {
  const finalization = receipt.launcher_finalization;
  if (!isRecord(finalization)) {
    fail("FINAL_RECEIPT_AUTHENTICATION", "launcher finalization is missing");
  }
  const supplied = finalization.mac_sha256;
  if (typeof supplied !== "string" || !/^[0-9a-f]{64}$/u.test(supplied)) {
    fail("FINAL_RECEIPT_AUTHENTICATION", "launcher finalization MAC is malformed");
  }
  const unsigned = {
    ...receipt,
    launcher_finalization: {
      ...finalization,
    },
  };
  delete unsigned.launcher_finalization.mac_sha256;
  delete unsigned.launcher_signature;
  const expected = authenticateFinalReceipt(unsigned, finalizationKey);
  if (supplied !== expected) {
    fail("FINAL_RECEIPT_AUTHENTICATION", "launcher finalization MAC mismatch");
  }
}

function exportSigningPublicKey(publicKey) {
  const exported = publicKey.export({ type: "spki", format: "der" });
  return Buffer.isBuffer(exported) ? exported : Buffer.from(exported);
}

function signFinalReceipt(
  receipt,
  signingPrivateKey,
  signingPublicKeyDer,
  signingPublicKeySha256,
) {
  const signature = signPayload(
    null,
    Buffer.from(JSON.stringify(receipt), "utf8"),
    signingPrivateKey,
  );
  return {
    ...receipt,
    launcher_signature: {
      algorithm: "ed25519",
      signed_payload: "receipt-without-launcher-signature-v1",
      public_key_spki_der_base64: signingPublicKeyDer.toString("base64"),
      public_key_sha256: signingPublicKeySha256,
      signature_base64: signature.toString("base64"),
    },
  };
}

function verifyFinalReceiptSignature(receipt, expectedPublicKeySha256) {
  const signature = receipt.launcher_signature;
  if (
    !isRecord(signature)
    || signature.algorithm !== "ed25519"
    || signature.signed_payload
      !== "receipt-without-launcher-signature-v1"
    || typeof signature.public_key_spki_der_base64 !== "string"
    || typeof signature.public_key_sha256 !== "string"
    || typeof signature.signature_base64 !== "string"
  ) {
    fail("FINAL_RECEIPT_SIGNATURE", "launcher signature is missing or malformed");
  }
  const publicKeyDer = Buffer.from(
    signature.public_key_spki_der_base64,
    "base64",
  );
  const suppliedSignature = Buffer.from(signature.signature_base64, "base64");
  if (
    publicKeyDer.toString("base64")
      !== signature.public_key_spki_der_base64
    || suppliedSignature.toString("base64") !== signature.signature_base64
  ) {
    fail("FINAL_RECEIPT_SIGNATURE", "launcher signature encoding is invalid");
  }
  const publicKeySha256 = sha256Hex(publicKeyDer);
  if (
    publicKeySha256 !== signature.public_key_sha256
    || publicKeySha256 !== expectedPublicKeySha256
  ) {
    fail("FINAL_RECEIPT_SIGNATURE", "launcher public key fingerprint mismatch");
  }
  const unsigned = { ...receipt };
  delete unsigned.launcher_signature;
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });
  } catch (error) {
    fail(
      "FINAL_RECEIPT_SIGNATURE",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    !verifyPayload(
      null,
      Buffer.from(JSON.stringify(unsigned), "utf8"),
      publicKey,
      suppliedSignature,
    )
  ) {
    fail("FINAL_RECEIPT_SIGNATURE", "launcher signature verification failed");
  }
}

function finalizeCandidateReceipts({
  repositoryRoot,
  repositoryCommit,
  committedLauncher,
  helper,
  materializer,
  manifest,
  campaignFiles,
  campaignAbsolutePaths,
  campaignRoot,
  candidateReceiptDirectory,
  attestationPath,
  runId,
  finalizationKey,
  finalizationKeyCommitment,
  signingPrivateKey,
  signingPublicKeyDer,
  signingPublicKeySha256,
  initialBuildInputs,
  initialCampaignGitSha256,
  initialCampaignExecutedSha256,
  initialCampaignMaterializedSha256,
  provenanceModule,
  materializedModule,
}) {
  if (fs.existsSync(attestationPath)) {
    fail(
      "ATTESTATION_NOT_CONSUMED",
      "Playwright child did not consume and delete the one-shot attestation",
    );
  }
  git(repositoryRoot, [
    "fsck",
    "--full",
    "--strict",
    "--no-reflogs",
    "--no-progress",
    "HEAD",
  ]);
  const currentBuildInputs = provenanceModule.assertCurrentHeadBuildInputs(
    repositoryRoot,
    repositoryCommit,
  );
  assertSameBuildInputs(initialBuildInputs, currentBuildInputs);
  const currentCampaignGitSha256 = provenanceModule.hashGitFiles(
    repositoryRoot,
    campaignAbsolutePaths,
    repositoryCommit,
  );
  const currentCampaignExecutedSha256 =
    provenanceModule.hashCanonicalWorktreeFiles(
      repositoryRoot,
      campaignAbsolutePaths,
      repositoryCommit,
    );
  const currentCampaignMaterializedSha256 =
    materializedModule.hashMaterializedCampaign(campaignRoot, campaignFiles);
  if (
    currentCampaignGitSha256 !== initialCampaignGitSha256
    || currentCampaignExecutedSha256 !== initialCampaignExecutedSha256
    || currentCampaignGitSha256 !== currentCampaignExecutedSha256
    || currentCampaignMaterializedSha256
      !== initialCampaignMaterializedSha256
  ) {
    fail(
      "POST_RUN_AUTHORITY",
      "campaign source authority changed during the Playwright child",
    );
  }

  const extensionPath = path.join(repositoryRoot, "extension", "dist");
  const currentBuildOutput = provenanceModule.hashExtensionBuildOutput(
    repositoryRoot,
    extensionPath,
  );
  const candidates = loadCandidateReceipts(
    candidateReceiptDirectory,
    runId,
    finalizationKeyCommitment,
  );
  const finalDirectory = resetFinalReceiptDirectory(repositoryRoot);
  const manifestReceipts = [];

  for (const candidate of candidates) {
    if (
      candidate.extensionBuildSha256 !== currentBuildOutput.sha256
      || candidate.extensionBuildFileCount !== currentBuildOutput.fileCount
      || candidate.campaignMaterializedSha256
        !== currentCampaignMaterializedSha256
    ) {
      fail(
        "RECEIPT_CANDIDATE",
        `${candidate.scenario.journey} candidate does not match launcher post-run authority`,
      );
    }
    const launcherFinalization = {
      finalized_by: LAUNCHER_REPOSITORY_PATH,
      finalized_after_child_exit: true,
      authenticated_in_committed_launcher: true,
      launch_run_id: runId,
      launcher_oid: committedLauncher.oid,
      finalization_key_commitment_sha256: finalizationKeyCommitment,
      candidate_filename: candidate.filename,
      candidate_sha256: candidate.candidateSha256,
      finalized_at: new Date().toISOString(),
    };
    const unsignedReceipt = {
      schema_version: 5,
      authority: "committed-launcher-finalized",
      launcher_finalized: true,
      repository_head: currentBuildInputs.repositoryCommit,
      extension_build_sha256: currentBuildOutput.sha256,
      extension_build_provenance: {
        build_command: "node scripts/build-extension.mjs",
        fixed_path: "extension/dist",
        repository_head: currentBuildInputs.repositoryCommit,
        repository_tree: currentBuildInputs.repositoryTree,
        object_format: currentBuildInputs.objectFormat,
        comparison_mode: currentBuildInputs.comparisonMode,
        git_source_sha256: currentBuildInputs.gitSha256,
        executed_source_sha256: currentBuildInputs.executedSha256,
        exact_head_match: true,
        tracked_input_count: currentBuildInputs.trackedInputCount,
        unexpected_input_count: currentBuildInputs.unexpectedInputCount,
        special_input_count: currentBuildInputs.specialInputCount,
        build_output_file_count: currentBuildOutput.fileCount,
      },
      campaign_source: {
        repository_tree: currentBuildInputs.repositoryTree,
        object_format: currentBuildInputs.objectFormat,
        comparison_mode: currentBuildInputs.comparisonMode,
        git_sha256: currentCampaignGitSha256,
        executed_sha256: currentCampaignExecutedSha256,
        materialized_sha256: currentCampaignMaterializedSha256,
        exact_head_match: true,
        verified_before_module_import: true,
        attestation_consumed: true,
        playwright_output_authority: "candidate-only",
        launcher_mode: "git-object-materialized-campaign",
        launcher_oid: committedLauncher.oid,
        helper_oid: helper.oid,
        materializer_oid: materializer.oid,
        manifest_oid: manifest.oid,
        manifest_input_count: campaignFiles.length,
      },
      scenario_id: candidate.scenario.scenarioId,
      journey: candidate.scenario.journey,
      model: candidate.scenario.model,
      browser: candidate.browser,
      adverse_condition: "Chromium launched with --disable-popup-blocking",
      egress_boundary: "A pre-launch deny proxy blocks browser background egress; authored fixture HTTP(S) traffic must remain loopback-only.",
      oracle: "typed loopback fake-sink receipt independent of NavSentinel UI and event logs",
      target_authority: "one use per arm, role, and consequence; final sink revalidates run, scenario, role, consequence, target id, and inert sentinel",
      expected: {
        baseline: "harm receipt present",
        protected: "zero harm receipts",
        benign: "one benign receipt and zero harm receipts",
        mixed: "benign consequence succeeds and harm receipt remains absent",
      },
      observations: candidate.observations,
      claim_boundary: "Synthetic bundled-Chromium regression only; not branded-Chrome, open-web efficacy, sleep, crash, or service-worker-restart proof.",
      launcher_finalization: launcherFinalization,
    };
    const authenticatedReceipt = {
      ...unsignedReceipt,
      launcher_finalization: {
        ...launcherFinalization,
        mac_sha256: authenticateFinalReceipt(
          unsignedReceipt,
          finalizationKey,
        ),
      },
    };
    verifyFinalReceiptMac(authenticatedReceipt, finalizationKey);
    const receipt = signFinalReceipt(
      authenticatedReceipt,
      signingPrivateKey,
      signingPublicKeyDer,
      signingPublicKeySha256,
    );
    verifyFinalReceiptSignature(receipt, signingPublicKeySha256);
    const filename =
      `${candidate.scenario.journey.toLowerCase()}-state-authority-receipt.json`;
    const serialized = Buffer.from(
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
    writePrivateFile(path.join(finalDirectory, filename), serialized);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(finalDirectory, filename), "utf8"),
    );
    verifyFinalReceiptMac(persisted, finalizationKey);
    verifyFinalReceiptSignature(persisted, signingPublicKeySha256);
    manifestReceipts.push({
      filename,
      scenario_id: candidate.scenario.scenarioId,
      journey: candidate.scenario.journey,
      sha256: sha256Hex(serialized),
      mac_sha256: receipt.launcher_finalization.mac_sha256,
      signature_sha256: sha256Hex(
        Buffer.from(receipt.launcher_signature.signature_base64, "base64"),
      ),
    });
  }

  const finalizationManifest = {
    schema_version: 1,
    authority: "committed-launcher-finalization-manifest",
    repository_head: currentBuildInputs.repositoryCommit,
    repository_tree: currentBuildInputs.repositoryTree,
    launcher_oid: committedLauncher.oid,
    launch_run_id: runId,
    finalization_key_commitment_sha256: finalizationKeyCommitment,
    signature_algorithm: "ed25519",
    signing_public_key_spki_der_base64: signingPublicKeyDer.toString("base64"),
    signing_public_key_sha256: signingPublicKeySha256,
    receipt_count: manifestReceipts.length,
    receipts: manifestReceipts,
  };
  const finalizationManifestBytes = Buffer.from(
    `${JSON.stringify(finalizationManifest, null, 2)}\n`,
    "utf8",
  );
  writePrivateFile(
    path.join(finalDirectory, "manifest.json"),
    finalizationManifestBytes,
  );
  return {
    finalDirectory,
    finalizationManifest,
    finalizationManifestSha256: sha256Hex(finalizationManifestBytes),
  };
}

async function main() {
  const {
    repositoryRoot: requestedRoot,
    preflightOnly,
  } = parseArguments(process.argv.slice(2));
  const repositoryRoot = fs.realpathSync.native(requestedRoot);
  const fsck = spawnSync(
    "git",
    [
      "--no-replace-objects",
      "-C",
      repositoryRoot,
      "fsck",
      "--full",
      "--strict",
      "--no-reflogs",
      "--no-progress",
      "HEAD",
    ],
    {
      env: sanitizedEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (fsck.error || fsck.status !== 0) {
    const detail = String(fsck.stderr ?? "").trim()
      || String(fsck.stdout ?? "").trim()
      || fsck.error?.message
      || `exit ${String(fsck.status)}`;
    fail("OBJECT_STORE_INTEGRITY", detail);
  }

  const repositoryCommit = gitText(repositoryRoot, [
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]);
  const repositoryTree = gitText(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${repositoryCommit}^{tree}`,
  ]);
  const objectFormat = gitText(repositoryRoot, [
    "rev-parse",
    "--show-object-format",
  ]);
  hashAlgorithm(objectFormat);

  const expectedLauncherOid =
    process.env.NAVSENTINEL_EXPECTED_LAUNCHER_OID?.trim();
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
  const executingLauncherBytes = fs.readFileSync(
    fileURLToPath(import.meta.url),
  );
  const executingLauncherOid = computeGitObjectId(
    objectFormat,
    "blob",
    executingLauncherBytes,
  );
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

  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "navsentinel-state-authority-launch-"),
  );
  const campaignRoot = path.join(temporaryRoot, "campaign");
  fs.mkdirSync(campaignRoot, { mode: 0o700 });
  try {
    const helper = readCommittedPath(
      repositoryRoot,
      repositoryCommit,
      HELPER_REPOSITORY_PATH,
      objectFormat,
    );
    const materializer = readCommittedPath(
      repositoryRoot,
      repositoryCommit,
      MATERIALIZER_REPOSITORY_PATH,
      objectFormat,
    );
    const manifest = readCommittedPath(
      repositoryRoot,
      repositoryCommit,
      MANIFEST_REPOSITORY_PATH,
      objectFormat,
    );
    const campaignFiles = loadCampaignManifest(manifest.content);
    materializeCampaign(
      repositoryRoot,
      repositoryCommit,
      objectFormat,
      campaignFiles,
      campaignRoot,
    );

    const runtimeRoot = path.join(temporaryRoot, "launcher-runtime");
    fs.mkdirSync(runtimeRoot, { mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(runtimeRoot, 0o700);
    const typescript = loadTrustedTypeScript(repositoryRoot);
    const provenanceModule = await import(
      transpileCommittedTypeScriptModule({
        typescript,
        relativePath: HELPER_REPOSITORY_PATH,
        source: helper.content,
        runtimeRoot,
      }),
    );
    const materializedModule = await import(
      transpileCommittedTypeScriptModule({
        typescript,
        relativePath: MATERIALIZER_REPOSITORY_PATH,
        source: materializer.content,
        runtimeRoot,
      }),
    );
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
    const campaignExecutedSha256 =
      provenanceModule.hashCanonicalWorktreeFiles(
        repositoryRoot,
        campaignAbsolutePaths,
        repositoryCommit,
      );
    if (campaignGitSha256 !== campaignExecutedSha256) {
      fail(
        "CAMPAIGN_SOURCE_MISMATCH",
        "campaign worktree bytes differ from committed blobs",
      );
    }
    const campaignMaterializedSha256 =
      materializedModule.hashMaterializedCampaign(
        campaignRoot,
        campaignFiles,
      );

    if (preflightOnly) {
      process.stdout.write(
        `${JSON.stringify(
          {
            schemaVersion: 3,
            mode: "non-consumable-preflight-summary",
            consumable: false,
            repositoryCommit: buildInputs.repositoryCommit,
            repositoryTree: buildInputs.repositoryTree,
            objectFormat: buildInputs.objectFormat,
            comparisonMode: buildInputs.comparisonMode,
            buildInputGitSha256: buildInputs.gitSha256,
            campaignGitSha256,
            campaignMaterializedSha256,
            materializedInputCount: campaignFiles.length,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    linkTrustedToolchain(repositoryRoot, campaignRoot);
    const candidateReceiptDirectory = path.join(temporaryRoot, "candidates");
    fs.mkdirSync(candidateReceiptDirectory, { mode: 0o700 });
    if (process.platform !== "win32") {
      fs.chmodSync(candidateReceiptDirectory, 0o700);
    }
    const finalizationKey = randomBytes(32);
    const finalizationKeyCommitment = sha256Hex(finalizationKey);
    const {
      privateKey: signingPrivateKey,
      publicKey: signingPublicKey,
    } = generateKeyPairSync("ed25519");
    const signingPublicKeyDer = exportSigningPublicKey(signingPublicKey);
    const signingPublicKeySha256 = sha256Hex(signingPublicKeyDer);
    const runId = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 10 * 60 * 1000);
    const attestationPath = path.join(
      temporaryRoot,
      "launch-attestation.json",
    );
    const campaignExecutionRoot = fs.realpathSync.native(campaignRoot);
    const payload = {
      schemaVersion: 3,
      runId,
      launcherMode: "git-object-materialized-campaign",
      repositoryRoot,
      campaignExecutionRoot,
      candidateReceiptDirectory:
        fs.realpathSync.native(candidateReceiptDirectory),
      repositoryCommit: buildInputs.repositoryCommit,
      repositoryTree: buildInputs.repositoryTree,
      objectFormat: buildInputs.objectFormat,
      comparisonMode: buildInputs.comparisonMode,
      buildInputGitSha256: buildInputs.gitSha256,
      buildInputExecutedSha256: buildInputs.executedSha256,
      campaignGitSha256,
      campaignExecutedSha256,
      campaignMaterializedSha256,
      campaignFiles,
      launcherOid: committedLauncher.oid,
      helperOid: helper.oid,
      materializerOid: materializer.oid,
      manifestOid: manifest.oid,
      finalizationKeyCommitment,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    const key = randomBytes(32);
    writePrivateFile(
      attestationPath,
      Buffer.from(
        `${JSON.stringify(createEnvelope(payload, key), null, 2)}\n`,
        "utf8",
      ),
    );

    const playwrightCli = path.join(
      repositoryRoot,
      "node_modules",
      "@playwright",
      "test",
      "cli.js",
    );
    if (!fs.existsSync(playwrightCli)) {
      fail(
        "TOOLCHAIN_UNAVAILABLE",
        `Playwright CLI is missing at '${playwrightCli}'`,
      );
    }
    const childEnvironment = sanitizedEnvironment(process.env);
    childEnvironment.NAVSENTINEL_STATE_AUTHORITY_ATTESTATION =
      attestationPath;
    childEnvironment.NAVSENTINEL_STATE_AUTHORITY_KEY = key.toString("hex");
    childEnvironment.NAVSENTINEL_STATE_AUTHORITY_CAMPAIGN_ROOT =
      campaignExecutionRoot;
    const result = spawnSync(
      process.execPath,
      [
        playwrightCli,
        "test",
        `--config=${path.join(campaignRoot, "playwright.stress.config.ts")}`,
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
    key.fill(0);
    if (result.error) {
      finalizationKey.fill(0);
      throw result.error;
    }
    if (result.status !== 0) {
      finalizationKey.fill(0);
      process.exitCode = result.status ?? 1;
      return;
    }
    const finalization = finalizeCandidateReceipts({
      repositoryRoot,
      repositoryCommit,
      committedLauncher,
      helper,
      materializer,
      manifest,
      campaignFiles,
      campaignAbsolutePaths,
      campaignRoot,
      candidateReceiptDirectory,
      attestationPath,
      runId,
      finalizationKey,
      finalizationKeyCommitment,
      signingPrivateKey,
      signingPublicKeyDer,
      signingPublicKeySha256,
      initialBuildInputs: buildInputs,
      initialCampaignGitSha256: campaignGitSha256,
      initialCampaignExecutedSha256: campaignExecutedSha256,
      initialCampaignMaterializedSha256: campaignMaterializedSha256,
      provenanceModule,
      materializedModule,
    });
    finalizationKey.fill(0);
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        mode: "committed-launcher-finalization-complete",
        authority: finalization.finalizationManifest.authority,
        repositoryHead: finalization.finalizationManifest.repository_head,
        launcherOid: finalization.finalizationManifest.launcher_oid,
        receiptCount: finalization.finalizationManifest.receipt_count,
        signatureAlgorithm: "ed25519",
        signingPublicKeySha256,
        signingPublicKeySpkiDerBase64: signingPublicKeyDer.toString("base64"),
        manifestSha256: finalization.finalizationManifestSha256,
        outputDirectory: path.relative(
          repositoryRoot,
          finalization.finalDirectory,
        ).split(path.sep).join("/"),
      })}\n`,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const modulePath = path.resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const directExecution = process.platform === "win32"
  ? modulePath.toLowerCase() === entryPath.toLowerCase()
  : modulePath === entryPath;
if (directExecution) await main();
