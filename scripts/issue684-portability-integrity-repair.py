#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_once(path: str, pattern: str, replacement: str, label: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    target.write_text(updated, encoding="utf-8")


def patch_launcher() -> None:
    path = "scripts/run-state-authority-campaign.mjs"
    replace_once(
        path,
        '''import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";''',
        '''import {
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
import os from "node:os";''',
        "portable crypto and module imports",
    )

    regex_once(
        path,
        r'''function sanitizedEnvironment\(source = process\.env\) \{.*?\n\}\n\nfunction git\(''',
        '''export function sanitizedEnvironment(source = process.env) {
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

function git(''',
        "case-insensitive environment authority",
    )

    transpiler = r'''
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
'''.strip("\n")

    replace_once(
        path,
        '''function writePrivateFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, content, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") fs.chmodSync(target, 0o600);
}

function materializeCampaign(''',
        '''function writePrivateFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, content, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") fs.chmodSync(target, 0o600);
}

''' + transpiler + '''

function materializeCampaign(''',
        "trusted TypeScript transpiler",
    )

    replace_once(
        path,
        '''    const provenanceModule = await import(
      pathToFileURL(
        path.join(campaignRoot, ...HELPER_REPOSITORY_PATH.split("/")),
      ).href
    );
    const materializedModule = await import(
      pathToFileURL(
        path.join(campaignRoot, ...MATERIALIZER_REPOSITORY_PATH.split("/")),
      ).href
    );''',
        '''    const runtimeRoot = path.join(temporaryRoot, "launcher-runtime");
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
    );''',
        "portable authenticated-helper imports",
    )

    signature_helpers = r'''
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
'''.strip("\n")

    replace_once(
        path,
        '''function verifyFinalReceiptMac(receipt, finalizationKey) {
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
  const expected = authenticateFinalReceipt(unsigned, finalizationKey);
  if (supplied !== expected) {
    fail("FINAL_RECEIPT_AUTHENTICATION", "launcher finalization MAC mismatch");
  }
}

function finalizeCandidateReceipts({''',
        '''function verifyFinalReceiptMac(receipt, finalizationKey) {
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
  const expected = authenticateFinalReceipt(unsigned, finalizationKey);
  if (supplied !== expected) {
    fail("FINAL_RECEIPT_AUTHENTICATION", "launcher finalization MAC mismatch");
  }
}

''' + signature_helpers + '''

function finalizeCandidateReceipts({''',
        "externally verifiable receipt helpers",
    )

    replace_once(
        path,
        '''  finalizationKey,
  finalizationKeyCommitment,
  initialBuildInputs,''',
        '''  finalizationKey,
  finalizationKeyCommitment,
  signingPrivateKey,
  signingPublicKeyDer,
  signingPublicKeySha256,
  initialBuildInputs,''',
        "finalizer signature authority parameters",
    )

    replace_once(
        path,
        '''    const receipt = {
      ...unsignedReceipt,
      launcher_finalization: {
        ...launcherFinalization,
        mac_sha256: authenticateFinalReceipt(
          unsignedReceipt,
          finalizationKey,
        ),
      },
    };
    verifyFinalReceiptMac(receipt, finalizationKey);
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
    manifestReceipts.push({
      filename,
      scenario_id: candidate.scenario.scenarioId,
      journey: candidate.scenario.journey,
      sha256: sha256Hex(serialized),
      mac_sha256: receipt.launcher_finalization.mac_sha256,
    });''',
        '''    const authenticatedReceipt = {
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
    });''',
        "signed persisted receipts",
    )

    replace_once(
        path,
        '''    finalization_key_commitment_sha256: finalizationKeyCommitment,
    receipt_count: manifestReceipts.length,
    receipts: manifestReceipts,
  };
  writePrivateFile(
    path.join(finalDirectory, "manifest.json"),
    Buffer.from(
      `${JSON.stringify(finalizationManifest, null, 2)}\n`,
      "utf8",
    ),
  );
  return {
    finalDirectory,
    finalizationManifest,
  };''',
        '''    finalization_key_commitment_sha256: finalizationKeyCommitment,
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
  };''',
        "signed finalization manifest",
    )

    replace_once(
        path,
        '''    const finalizationKey = randomBytes(32);
    const finalizationKeyCommitment = sha256Hex(finalizationKey);
    const runId = randomUUID();''',
        '''    const finalizationKey = randomBytes(32);
    const finalizationKeyCommitment = sha256Hex(finalizationKey);
    const {
      privateKey: signingPrivateKey,
      publicKey: signingPublicKey,
    } = generateKeyPairSync("ed25519");
    const signingPublicKeyDer = exportSigningPublicKey(signingPublicKey);
    const signingPublicKeySha256 = sha256Hex(signingPublicKeyDer);
    const runId = randomUUID();''',
        "launcher-only signing authority",
    )

    replace_once(
        path,
        '''    const childEnvironment = sanitizedEnvironment(process.env);
    delete childEnvironment.EXTENSION_PATH;
    childEnvironment.NAVSENTINEL_STATE_AUTHORITY_ATTESTATION =''',
        '''    const childEnvironment = sanitizedEnvironment(process.env);
    childEnvironment.NAVSENTINEL_STATE_AUTHORITY_ATTESTATION =''',
        "centralized extension path scrub",
    )

    replace_once(
        path,
        '''      finalizationKey,
      finalizationKeyCommitment,
      initialBuildInputs: buildInputs,''',
        '''      finalizationKey,
      finalizationKeyCommitment,
      signingPrivateKey,
      signingPublicKeyDer,
      signingPublicKeySha256,
      initialBuildInputs: buildInputs,''',
        "finalizer signing arguments",
    )

    replace_once(
        path,
        '''        receiptCount: finalization.finalizationManifest.receipt_count,
        outputDirectory: path.relative(
          repositoryRoot,
          finalization.finalDirectory,
        ).split(path.sep).join("/"),''',
        '''        receiptCount: finalization.finalizationManifest.receipt_count,
        signatureAlgorithm: "ed25519",
        signingPublicKeySha256,
        signingPublicKeySpkiDerBase64: signingPublicKeyDer.toString("base64"),
        manifestSha256: finalization.finalizationManifestSha256,
        outputDirectory: path.relative(
          repositoryRoot,
          finalization.finalDirectory,
        ).split(path.sep).join("/"),''',
        "verifier-usable launcher summary",
    )

    replace_once(
        path,
        "await main();\n",
        '''const modulePath = path.resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const directExecution = process.platform === "win32"
  ? modulePath.toLowerCase() === entryPath.toLowerCase()
  : modulePath === entryPath;
if (directExecution) await main();
''',
        "import-safe direct execution guard",
    )


def write_verifier() -> None:
    verifier = r'''#!/usr/bin/env node

import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error(`State-authority receipt verification failed: ${message}`);
}

function sha256Hex(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(argv) {
  let directory = "";
  let expectedPublicKeySha256 = "";
  let expectedRepositoryHead = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--directory" && value) {
      directory = value;
      index += 1;
    } else if (argument === "--expected-public-key-sha256" && value) {
      expectedPublicKeySha256 = value;
      index += 1;
    } else if (argument === "--expected-repository-head" && value) {
      expectedRepositoryHead = value;
      index += 1;
    } else {
      fail(`unsupported or incomplete argument '${argument}'`);
    }
  }
  if (!directory || !/^[0-9a-f]{64}$/u.test(expectedPublicKeySha256)) {
    fail("directory and expected public-key SHA-256 are required");
  }
  return {
    directory: path.resolve(directory),
    expectedPublicKeySha256,
    expectedRepositoryHead,
  };
}

function verifySignedReceipt(receipt, expectedPublicKeySha256) {
  if (!isRecord(receipt) || receipt.authority !== "committed-launcher-finalized") {
    fail("receipt authority is invalid");
  }
  const signature = receipt.launcher_signature;
  if (
    !isRecord(signature)
    || signature.algorithm !== "ed25519"
    || signature.signed_payload !== "receipt-without-launcher-signature-v1"
    || typeof signature.public_key_spki_der_base64 !== "string"
    || typeof signature.public_key_sha256 !== "string"
    || typeof signature.signature_base64 !== "string"
  ) {
    fail("receipt signature envelope is malformed");
  }
  const publicKeyDer = Buffer.from(signature.public_key_spki_der_base64, "base64");
  const signatureBytes = Buffer.from(signature.signature_base64, "base64");
  if (
    publicKeyDer.toString("base64") !== signature.public_key_spki_der_base64
    || signatureBytes.toString("base64") !== signature.signature_base64
  ) {
    fail("receipt signature encoding is invalid");
  }
  const fingerprint = sha256Hex(publicKeyDer);
  if (
    fingerprint !== signature.public_key_sha256
    || fingerprint !== expectedPublicKeySha256
  ) {
    fail("receipt public key is not the trusted run key");
  }
  const unsigned = { ...receipt };
  delete unsigned.launcher_signature;
  const publicKey = createPublicKey({
    key: publicKeyDer,
    format: "der",
    type: "spki",
  });
  if (
    !verify(
      null,
      Buffer.from(JSON.stringify(unsigned), "utf8"),
      publicKey,
      signatureBytes,
    )
  ) {
    fail("receipt signature is invalid");
  }
  return receipt;
}

export function verifyReceiptDirectory({
  directory,
  expectedPublicKeySha256,
  expectedRepositoryHead = "",
}) {
  const manifestPath = path.join(directory, "manifest.json");
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    !isRecord(manifest)
    || manifest.authority !== "committed-launcher-finalization-manifest"
    || manifest.signature_algorithm !== "ed25519"
    || manifest.signing_public_key_sha256 !== expectedPublicKeySha256
    || !Array.isArray(manifest.receipts)
    || manifest.receipts.length !== manifest.receipt_count
  ) {
    fail("manifest identity is invalid");
  }
  if (
    expectedRepositoryHead
    && manifest.repository_head !== expectedRepositoryHead
  ) {
    fail("manifest repository head does not match the trusted run");
  }
  const verified = [];
  for (const entry of manifest.receipts) {
    if (
      !isRecord(entry)
      || typeof entry.filename !== "string"
      || typeof entry.sha256 !== "string"
      || path.basename(entry.filename) !== entry.filename
    ) {
      fail("manifest receipt entry is malformed");
    }
    const receiptBytes = fs.readFileSync(path.join(directory, entry.filename));
    if (sha256Hex(receiptBytes) !== entry.sha256) {
      fail(`${entry.filename} digest does not match the manifest`);
    }
    const receipt = verifySignedReceipt(
      JSON.parse(receiptBytes.toString("utf8")),
      expectedPublicKeySha256,
    );
    if (
      receipt.repository_head !== manifest.repository_head
      || receipt.launcher_finalization?.launcher_oid !== manifest.launcher_oid
      || receipt.launcher_finalization?.launch_run_id !== manifest.launch_run_id
    ) {
      fail(`${entry.filename} is not bound to the manifest run`);
    }
    verified.push(entry.filename);
  }
  return {
    authority: manifest.authority,
    repositoryHead: manifest.repository_head,
    signingPublicKeySha256: expectedPublicKeySha256,
    manifestSha256: sha256Hex(manifestBytes),
    receiptCount: verified.length,
    receipts: verified,
  };
}

const modulePath = path.resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const directExecution = process.platform === "win32"
  ? modulePath.toLowerCase() === entryPath.toLowerCase()
  : modulePath === entryPath;
if (directExecution) {
  const result = verifyReceiptDirectory(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
'''
    target = ROOT / "scripts/verify-state-authority-receipts.mjs"
    if target.exists():
        raise RuntimeError("receipt verifier already exists")
    target.write_text(verifier, encoding="utf-8")


def write_contract_test() -> None:
    content = r'''import { execFileSync, spawnSync } from "node:child_process";
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
  const module = await import(
    "../scripts/run-state-authority-campaign.mjs"
  );
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
    expect(launcher).toContain("signingPublicKeySha256");
    expect(launcher).toContain("finalization_key_commitment_sha256");
    expect(launcher).not.toContain(
      "childEnvironment.NAVSENTINEL_STATE_AUTHORITY_FINALIZATION_KEY",
    );
  });
});
'''
    (ROOT / "tests/state-authority-launcher-contract.test.ts").write_text(
        content,
        encoding="utf-8",
    )


def patch_docs() -> None:
    raw = ROOT / "docs/security-program/RAW_EVIDENCE_AUTHORITY_684.md"
    text = raw.read_text(encoding="utf-8")
    old = '''`scripts/run-state-authority-campaign.mjs` from `HEAD`, supplies its object ID via
`NAVSENTINEL_EXPECTED_LAUNCHER_OID`, and executes that exact blob with Node's
TypeScript stripping enabled.'''
    new = '''`scripts/run-state-authority-campaign.mjs` from `HEAD`, supplies its object ID via
`NAVSENTINEL_EXPECTED_LAUNCHER_OID`, and executes that exact blob with plain
Node. The launcher uses the repository's installed TypeScript compiler to
transpile only the two already-authenticated authority helpers into a private
runtime directory. Those generated modules are trusted-toolchain output, not an
expansion of the committed project-source claim.'''
    if text.count(old) != 1:
        raise RuntimeError("raw authority Node-floor wording did not match once")
    text = text.replace(old, new, 1)
    text = text.replace(
        "Git, Playwright, Chromium, the operating system, and the runner remain trusted",
        "Git, TypeScript, Playwright, Chromium, the operating system, and the runner remain trusted",
        1,
    )
    text = text.replace(
        "- scrubs inherited Git variables case-insensitively, which matters on Windows;",
        "- scrubs inherited Git, state-authority, Node preload/module-path, and extension-path variables case-insensitively before constructing child environments;",
        1,
    )
    text += '''

## Portable launcher, environment, and artifact verification

The committed launcher runs with plain Node across the repository engine floor.
Only the two authenticated TypeScript authority helpers are transpiled, using the
already-installed compiler, into a private runtime directory outside the
materialized campaign source tree. Their original committed and materialized
TypeScript bytes remain the receipt authority; generated JavaScript is an
explicit trusted-toolchain output.

Inherited environment keys are classified through `key.toUpperCase()` before a
child environment is built. Every spelling of `GIT_*`,
`NAVSENTINEL_STATE_AUTHORITY_*`, `NODE_OPTIONS`, `NODE_PATH`, and
`EXTENSION_PATH` is removed before trusted uppercase values are added. This does
not claim that JavaScript can neutralize code already preloaded into the launcher
process itself: the launcher must be started by a trusted external workflow or
owner shell with Node preload authority cleared. Inherited pre-launch Node code
and a hostile same-user process remain outside this bounded claim.

Launcher-finalized receipts retain their launcher-only HMAC for immediate
read-back checks and additionally carry an Ed25519 signature. The launcher logs
the signing public-key fingerprint and SPKI bytes after finalization; the trusted
GitHub Actions run binds that key to the exact launcher execution. The uploaded
bundle can then be checked with `scripts/verify-state-authority-receipts.mjs`
using the fingerprint from the independent run log. An embedded replacement key
alone is not trusted.
'''
    raw.write_text(text.rstrip() + "\n", encoding="utf-8")

    state = ROOT / "docs/security-program/STATE_AUTHORITY_CAMPAIGN.md"
    text = state.read_text(encoding="utf-8")
    text = text.replace(
        "The executable receipt emitted by\n`tests/e2e/state-authority-sink.spec.ts` is authoritative for a run.",
        "The Playwright spec emits non-authoritative candidates; only the exact committed launcher may finalize authoritative receipts for a run.",
        1,
    )
    text += '''

## Node-floor and external-verification checkpoint

The exact launcher must execute with plain Node on the repository's supported
engine floor. It transpiles only the two authenticated TypeScript authority
helpers into a private runtime directory with the repository's installed
compiler, while every campaign/source hash continues to cover the original
committed TypeScript bytes.

Child environments remove all case variants of Git, state-authority, Node
preload/module-path, and extension-path variables. The launcher process itself
still trusts the external workflow or owner shell to clear Node preload authority
before Node starts; that pre-process boundary is explicit rather than silently
claimed by in-process cleanup.

Each finalized receipt is signed with a launcher-only Ed25519 key. The exact run
log publishes the public-key fingerprint and SPKI bytes, and the retained artifact
is verified against that independently bound fingerprint with
`scripts/verify-state-authority-receipts.mjs`. The internal HMAC remains only a
same-process/read-back control and is not presented as long-term artifact
authentication.
'''
    state.write_text(text.rstrip() + "\n", encoding="utf-8")


def main() -> None:
    patch_launcher()
    write_verifier()
    write_contract_test()
    patch_docs()
    print("Issue #684 portability, environment, and signature repair materialized.")


if __name__ == "__main__":
    main()
