#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str, label: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def patch_playwright_config() -> None:
    replace_once(
        "playwright.config.ts",
        '''  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: topology.fullyParallel,''',
        '''  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  // The state-authority spec is launcher-only. Ordinary Playwright collection
  // must not import it without the committed-object execution boundary.
  testIgnore: "**/state-authority-sink.spec.ts",
  fullyParallel: topology.fullyParallel,''',
        "default Playwright authority exclusion",
    )


def patch_build_provenance() -> None:
    replace_once(
        "tests/e2e/extension_build_provenance.ts",
        '''const VITE_CONFIG_PATHS = new Set<string>(VITE_CONFIG_CANDIDATES);

const BUILD_INPUT_PATHS = [
  "extension",
  "scripts",
  "config",
  "package.json",
  "package-lock.json",
  ...VITE_CONFIG_CANDIDATES,
  "tsconfig.json",
] as const;''',
        '''const VITE_CONFIG_PATHS = new Set<string>(VITE_CONFIG_CANDIDATES);
const POSTCSS_CONFIG_CANDIDATES = [
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.js",
  ".postcssrc.mjs",
  ".postcssrc.cjs",
  ".postcssrc.ts",
  ".postcssrc.mts",
  ".postcssrc.cts",
  "postcss.config.js",
  "postcss.config.mjs",
  "postcss.config.cjs",
  "postcss.config.ts",
  "postcss.config.mts",
  "postcss.config.cts",
] as const;
const POSTCSS_CONFIG_PATHS = new Set<string>(POSTCSS_CONFIG_CANDIDATES);

const BUILD_INPUT_PATHS = [
  "extension",
  "scripts",
  "config",
  "package.json",
  "package-lock.json",
  ...VITE_CONFIG_CANDIDATES,
  ...POSTCSS_CONFIG_CANDIDATES,
  "tsconfig.json",
] as const;''',
        "PostCSS candidate closure",
    )
    replace_once(
        "tests/e2e/extension_build_provenance.ts",
        '''    if (VITE_CONFIG_PATHS.has(rootPath) && rootPath !== EXPECTED_VITE_CONFIG) {
      throw integrityError(
        "ALTERNATE_VITE_CONFIG",
        `alternate Vite configuration '${rootPath}' is not allowed`,
      );
    }
    visit(absolutePath, rootPath);''',
        '''    if (VITE_CONFIG_PATHS.has(rootPath) && rootPath !== EXPECTED_VITE_CONFIG) {
      throw integrityError(
        "ALTERNATE_VITE_CONFIG",
        `alternate Vite configuration '${rootPath}' is not allowed`,
      );
    }
    if (POSTCSS_CONFIG_PATHS.has(rootPath)) {
      throw integrityError(
        "AUTO_DISCOVERED_POSTCSS_CONFIG",
        `auto-discovered PostCSS configuration '${rootPath}' is not allowed`,
      );
    }
    visit(absolutePath, rootPath);''',
        "PostCSS fail-closed check",
    )


def write_receipt_verifier() -> None:
    content = r'''#!/usr/bin/env node

import { createHash, createPublicKey, verify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_JOURNEYS = ["RW-21", "RW-24", "RW-25"];
const EXPECTED_JOURNEY_SET = new Set(EXPECTED_JOURNEYS);

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
  let expectedManifestSha256 = "";
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
    } else if (argument === "--expected-manifest-sha256" && value) {
      expectedManifestSha256 = value;
      index += 1;
    } else if (argument === "--expected-repository-head" && value) {
      expectedRepositoryHead = value;
      index += 1;
    } else {
      fail(`unsupported or incomplete argument '${argument}'`);
    }
  }
  if (
    !directory
    || !/^[0-9a-f]{64}$/u.test(expectedPublicKeySha256)
    || !/^[0-9a-f]{64}$/u.test(expectedManifestSha256)
  ) {
    fail(
      "directory, expected public-key SHA-256, and expected manifest SHA-256 are required",
    );
  }
  return {
    directory: path.resolve(directory),
    expectedPublicKeySha256,
    expectedManifestSha256,
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

function expectedReceiptFilename(journey) {
  return `${journey.toLowerCase()}-state-authority-receipt.json`;
}

export function verifyReceiptDirectory({
  directory,
  expectedPublicKeySha256,
  expectedManifestSha256,
  expectedRepositoryHead = "",
}) {
  if (!/^[0-9a-f]{64}$/u.test(expectedManifestSha256 ?? "")) {
    fail("trusted manifest SHA-256 is required");
  }
  const manifestPath = path.join(directory, "manifest.json");
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestSha256 = sha256Hex(manifestBytes);
  if (manifestSha256 !== expectedManifestSha256) {
    fail("manifest SHA-256 does not match the trusted run digest");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    !isRecord(manifest)
    || manifest.authority !== "committed-launcher-finalization-manifest"
    || manifest.signature_algorithm !== "ed25519"
    || manifest.signing_public_key_sha256 !== expectedPublicKeySha256
    || !Array.isArray(manifest.receipts)
    || manifest.receipts.length !== EXPECTED_JOURNEYS.length
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
  const seenFilenames = new Set();
  const seenJourneys = new Set();
  for (const entry of manifest.receipts) {
    if (
      !isRecord(entry)
      || typeof entry.filename !== "string"
      || typeof entry.sha256 !== "string"
      || typeof entry.journey !== "string"
      || typeof entry.scenario_id !== "string"
      || path.basename(entry.filename) !== entry.filename
    ) {
      fail("manifest receipt entry is malformed");
    }
    if (
      !EXPECTED_JOURNEY_SET.has(entry.journey)
      || entry.filename !== expectedReceiptFilename(entry.journey)
      || seenJourneys.has(entry.journey)
      || seenFilenames.has(entry.filename)
    ) {
      fail("manifest has a duplicate or unexpected journey set");
    }
    seenJourneys.add(entry.journey);
    seenFilenames.add(entry.filename);

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
      || receipt.scenario_id !== entry.scenario_id
      || receipt.journey !== entry.journey
      || receipt.launcher_finalization?.launcher_oid !== manifest.launcher_oid
      || receipt.launcher_finalization?.launch_run_id !== manifest.launch_run_id
    ) {
      fail(`${entry.filename} is not bound to the manifest run and journey`);
    }
    verified.push(entry.filename);
  }
  if (
    seenJourneys.size !== EXPECTED_JOURNEYS.length
    || EXPECTED_JOURNEYS.some((journey) => !seenJourneys.has(journey))
  ) {
    fail("manifest does not contain the exact expected journeys");
  }
  return {
    authority: manifest.authority,
    repositoryHead: manifest.repository_head,
    signingPublicKeySha256: expectedPublicKeySha256,
    manifestSha256,
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
    (ROOT / "scripts/verify-state-authority-receipts.mjs").write_text(
        content,
        encoding="utf-8",
    )


def patch_docs() -> None:
    raw = ROOT / "docs/security-program/RAW_EVIDENCE_AUTHORITY_684.md"
    text = raw.read_text(encoding="utf-8").rstrip()
    text += '''

## Auto-discovered build configuration and manifest-set binding

The build-input verifier rejects every supported root PostCSS configuration
candidate (`.postcssrc*` and `postcss.config.*`) because this release build has
no declared PostCSS configuration. The committed `package.json` remains part of
the authenticated input closure, so a package-level `postcss` field cannot drift
without invalidating raw-byte equality. Configuration found above the repository
root remains part of the explicitly trusted runner/toolchain boundary.

Retained-receipt verification now requires the finalization-manifest SHA-256
published by the trusted launcher run in addition to the signing-key fingerprint
and exact repository head. The verifier checks that digest before parsing the
manifest, then requires exactly one signed receipt for each fixed journey
`RW-21`, `RW-24`, and `RW-25`, with canonical filenames and matching signed
scenario/journey fields. Replacing the manifest or duplicating one valid receipt
therefore fails closed.
'''
    raw.write_text(text + "\n", encoding="utf-8")

    state = ROOT / "docs/security-program/STATE_AUTHORITY_CAMPAIGN.md"
    text = state.read_text(encoding="utf-8").rstrip()
    text += '''

## Retained-set and default-runner boundary

The external verifier requires the trusted run's manifest SHA-256 before it will
parse or accept the retained set. It then enforces the exact unique journey set
`RW-21` / `RW-24` / `RW-25` and binds each canonical filename to the signed
journey and scenario fields.

`state-authority-sink.spec.ts` is excluded from ordinary Playwright collection.
It remains available only through `playwright.stress.config.ts` and the committed
launcher, so the default E2E lane neither bypasses the authority boundary nor
fails merely by importing a launcher-only module.
'''
    state.write_text(text + "\n", encoding="utf-8")


def main() -> None:
    patch_playwright_config()
    patch_build_provenance()
    write_receipt_verifier()
    patch_docs()
    print("Issue #684 manifest, PostCSS, and Playwright boundary repair materialized.")


if __name__ == "__main__":
    main()
