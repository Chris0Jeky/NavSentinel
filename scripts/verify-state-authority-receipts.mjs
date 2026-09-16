#!/usr/bin/env node

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
