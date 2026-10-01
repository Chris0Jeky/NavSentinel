/**
 * Build a deliberately regressed copy of `extension/dist` for the AI-47 row 8
 * failure proof (#947). It removes PR #599's pre-verification clipboard
 * coalescing exactly the way NS-ADV-SELF-005's "malicious browser baseline"
 * does (tests/e2e/bridge-clipboard-pressure.spec.ts): the built
 * coalesceKeyForMainGuardMessage() is rewritten to return undefined, so every
 * unverified `ns-clipboard-write` receipt takes its own priority slot again.
 *
 *   node tests/acceptance/pr599-regressed-bundle.ts [output directory]
 *
 * Prints the regressed extension directory. Point the acceptance lane at it:
 *
 *   EXTENSION_PATH=<printed path> npx playwright test -c playwright.acceptance.config.ts \
 *     tests/acceptance/ai47-8-clipboard-pressure.spec.ts
 *
 * ai47-8-clipboard-pressure.spec.ts must FAIL on this copy and PASS on the real
 * build. The copy carries `navsentinel-pr599-regressed.json` so the spec's
 * receipt says which bundle it ran on. Test tooling only: never package or load
 * the copy for anything else, and delete it after the proof run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REGRESSED_BUNDLE_MARKER = "navsentinel-pr599-regressed.json";

// Same pattern as createVulnerableExtensionCopy() in bridge-clipboard-pressure.spec.ts.
const COALESCING_FUNCTION = /function ([A-Za-z_$][\w$]*)\(e\)\{if\(e\.type===`ns-clipboard-write`\)return e\.payload\?\.looksLikeCommand===!0\?`ns-clipboard-write:command-like`:`ns-clipboard-write:other`\}/gu;

export function buildPr599RegressedBundle(sourceDist: string, outputRoot: string): { extensionPath: string; patchedAsset: string } {
  if (!fs.existsSync(path.join(sourceDist, "manifest.json"))) {
    throw new Error(`TEST_INVALID: no built extension at ${sourceDist}; run npm run build first`);
  }
  const extensionPath = path.join(outputRoot, "extension");
  if (fs.existsSync(extensionPath)) throw new Error(`TEST_INVALID: ${extensionPath} already exists`);
  fs.cpSync(sourceDist, extensionPath, { recursive: true });

  const assetDirectory = path.join(extensionPath, "assets");
  const matches = fs.readdirSync(assetDirectory)
    .filter((name) => name.endsWith(".js"))
    .flatMap((name) => {
      const count = [...fs.readFileSync(path.join(assetDirectory, name), "utf8").matchAll(COALESCING_FUNCTION)].length;
      return count > 0 ? [{ name, count }] : [];
    });
  if (matches.length !== 1 || matches[0]?.count !== 1) {
    throw new Error(`TEST_INVALID: expected one coalescing function in exactly one built asset, found ${JSON.stringify(matches)}`);
  }
  const patchedAsset = matches[0].name;
  const assetPath = path.join(assetDirectory, patchedAsset);
  const source = fs.readFileSync(assetPath, "utf8");
  const patched = source.replace(COALESCING_FUNCTION, "function $1(e){return}");
  if (patched === source || patched.includes("ns-clipboard-write:command-like")) {
    throw new Error("TEST_INVALID: the regressed bundle was not patched exactly");
  }
  fs.writeFileSync(assetPath, patched, "utf8");
  fs.writeFileSync(path.join(extensionPath, REGRESSED_BUNDLE_MARKER), `${JSON.stringify({
    purpose: "AI-47 row 8 failure proof (#947): PR #599 clipboard coalescing removed",
    sourceDist: path.resolve(sourceDist),
    patchedAsset,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`);
  return { extensionPath, patchedAsset };
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const outputRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-pr599-regressed-"));
  const { extensionPath, patchedAsset } = buildPr599RegressedBundle(path.join(repoRoot, "extension", "dist"), outputRoot);
  console.log(`patched ${patchedAsset}`);
  console.log(extensionPath);
}
