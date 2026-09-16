#!/usr/bin/env python3
from pathlib import Path
import re

path = Path(__file__).with_name("issue684-portability-integrity-repair.py")
text = path.read_text(encoding="utf-8")
text = text.replace(
    "updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)",
    "updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)",
    1,
)

pattern = re.compile(
    r'''    replace_once\(\n        path,\n        '''    const receipt = \{.*?        "signed finalization manifest",\n    \)\n\n''',
    re.S,
)
replacement = r'''    regex_once(
        path,
        r'''    const receipt = \{.*?\n  return \{\n    finalDirectory,\n    finalizationManifest,\n  \};''',
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
      `${JSON.stringify(receipt, null, 2)}\\n`,
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
    `${JSON.stringify(finalizationManifest, null, 2)}\\n`,
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
        "signed receipts and manifest",
    )

'''
text, count = pattern.subn(lambda _match: replacement, text, count=1)
if count != 1:
    raise SystemExit(f"expected one receipt/manifest patch block, found {count}")
path.write_text(text, encoding="utf-8")
