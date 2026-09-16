import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error -- the committed JavaScript verifier has no declaration file
import { verifyReceiptDirectory as untypedVerifyReceiptDirectory } from "../scripts/verify-state-authority-receipts.mjs";

type VerifyReceiptDirectory = (options: {
  directory: string;
  expectedPublicKeySha256: string;
  expectedManifestSha256: string;
  expectedRepositoryHead?: string;
}) => {
  receiptCount: number;
  receipts: string[];
};

const verifyReceiptDirectory =
  untypedVerifyReceiptDirectory as VerifyReceiptDirectory;
const temporaryDirectories: string[] = [];
const REPOSITORY_HEAD = "a".repeat(40);
const LAUNCHER_OID = "b".repeat(40);
const RUN_ID = "receipt-verifier-contract-run";
const JOURNEYS = ["RW-21", "RW-24", "RW-25"] as const;

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function exportPublicKey(publicKey: KeyObject): Buffer {
  const exported = publicKey.export({ type: "spki", format: "der" });
  return Buffer.isBuffer(exported) ? exported : Buffer.from(exported);
}

function signedReceipt(
  journey: (typeof JOURNEYS)[number],
  privateKey: KeyObject,
  publicKeyDer: Buffer,
  publicKeySha256: string,
): Record<string, unknown> {
  const unsigned = {
    schema_version: 5,
    authority: "committed-launcher-finalized",
    repository_head: REPOSITORY_HEAD,
    scenario_id: `scenario-${journey.toLowerCase()}`,
    journey,
    launcher_finalization: {
      launcher_oid: LAUNCHER_OID,
      launch_run_id: RUN_ID,
    },
  };
  const signature = sign(
    null,
    Buffer.from(JSON.stringify(unsigned), "utf8"),
    privateKey,
  );
  return {
    ...unsigned,
    launcher_signature: {
      algorithm: "ed25519",
      signed_payload: "receipt-without-launcher-signature-v1",
      public_key_spki_der_base64: publicKeyDer.toString("base64"),
      public_key_sha256: publicKeySha256,
      signature_base64: signature.toString("base64"),
    },
  };
}

function writeBundle(): {
  directory: string;
  publicKeySha256: string;
  manifestSha256: string;
} {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "navsentinel-receipt-verifier-"),
  );
  temporaryDirectories.push(directory);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = exportPublicKey(publicKey);
  const publicKeySha256 = sha256Hex(publicKeyDer);
  const receipts = JOURNEYS.map((journey) => {
    const filename = `${journey.toLowerCase()}-state-authority-receipt.json`;
    const bytes = Buffer.from(
      `${JSON.stringify(
        signedReceipt(journey, privateKey, publicKeyDer, publicKeySha256),
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(directory, filename), bytes);
    return {
      filename,
      scenario_id: `scenario-${journey.toLowerCase()}`,
      journey,
      sha256: sha256Hex(bytes),
    };
  });
  const manifest = {
    schema_version: 1,
    authority: "committed-launcher-finalization-manifest",
    repository_head: REPOSITORY_HEAD,
    repository_tree: "c".repeat(40),
    launcher_oid: LAUNCHER_OID,
    launch_run_id: RUN_ID,
    signature_algorithm: "ed25519",
    signing_public_key_sha256: publicKeySha256,
    receipt_count: receipts.length,
    receipts,
  };
  const manifestBytes = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(directory, "manifest.json"), manifestBytes);
  return {
    directory,
    publicKeySha256,
    manifestSha256: sha256Hex(manifestBytes),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0).reverse()) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("retained state-authority receipt verification", () => {
  it("accepts the trusted manifest and exact three-journey set", () => {
    const bundle = writeBundle();

    const result = verifyReceiptDirectory({
      directory: bundle.directory,
      expectedPublicKeySha256: bundle.publicKeySha256,
      expectedManifestSha256: bundle.manifestSha256,
      expectedRepositoryHead: REPOSITORY_HEAD,
    });

    expect(result.receiptCount).toBe(3);
    expect(result.receipts).toEqual([
      "rw-21-state-authority-receipt.json",
      "rw-24-state-authority-receipt.json",
      "rw-25-state-authority-receipt.json",
    ]);
  });

  it("rejects a manifest whose bytes differ from the trusted run digest", () => {
    const bundle = writeBundle();
    const manifestPath = path.join(bundle.directory, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest["untrusted_note"] = "replacement manifest";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() =>
      verifyReceiptDirectory({
        directory: bundle.directory,
        expectedPublicKeySha256: bundle.publicKeySha256,
        expectedManifestSha256: bundle.manifestSha256,
        expectedRepositoryHead: REPOSITORY_HEAD,
      }),
    ).toThrow(/manifest.*digest|manifest.*sha-?256/iu);
  });

  it("rejects a digest-matched manifest that duplicates one journey", () => {
    const bundle = writeBundle();
    const manifestPath = path.join(bundle.directory, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      receipts: Record<string, unknown>[];
      receipt_count: number;
    };
    const first = manifest.receipts[0]!;
    manifest.receipts = [first, first, first];
    manifest.receipt_count = manifest.receipts.length;
    const forgedBytes = Buffer.from(
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(manifestPath, forgedBytes);

    expect(() =>
      verifyReceiptDirectory({
        directory: bundle.directory,
        expectedPublicKeySha256: bundle.publicKeySha256,
        expectedManifestSha256: sha256Hex(forgedBytes),
        expectedRepositoryHead: REPOSITORY_HEAD,
      }),
    ).toThrow(/duplicate|journey set|expected journeys/iu);
  });
});
