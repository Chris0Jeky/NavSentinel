#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  contentAddressedLoaderPath,
  finalizeUiGuardLoader,
  installEarlyMainClockText,
  uiGuardLoaderTemplate,
} from "./content-loader-contract.mjs";
import { compactKnownOptionsHtml } from "./packaged-html.mjs";
import { RELEASE_PROFILE_ENV, resolveReleaseProfile } from "./release-profile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");

if (process.argv.length > 3) {
  console.error("Usage: node scripts/build-extension.mjs [interaction-only|research-reputation]");
  process.exit(1);
}

let profile;
try {
  // An ambient shell variable must not silently turn the normal release build
  // into a research artifact. Positional profile selection is explicit; no
  // argument resolves the committed default even when the parent environment
  // contains NAVSENTINEL_BUILD_PROFILE.
  profile = resolveReleaseProfile(process.argv[2] ?? "");
} catch (error) {
  console.error(`[build] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function runNode(scriptPath, args = [], extraEnv = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function compactPackagedHtml() {
  const distSrc = path.join(root, "extension", "dist", "src");
  const distAssets = path.join(root, "extension", "dist", "assets");
  const stylesheetsByHref = new Map();
  try {
    for (const entry of fs.readdirSync(distAssets, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".css")) continue;
      stylesheetsByHref.set(
        `/assets/${entry.name}`,
        fs.readFileSync(path.join(distAssets, entry.name), "utf8"),
      );
    }
  } catch {
    // The options-only compactor treats an empty map as unresolved and returns
    // the original HTML. Later build checks remain responsible for missing assets.
  }
  for (const relative of fs.readdirSync(distSrc, { recursive: true })) {
    if (!relative.endsWith(".html")) continue;
    const file = path.join(distSrc, relative);
    const html = fs.readFileSync(file, "utf8");
    // Comments are source guidance, not extension payload. Keep conditional
    // comments if one is ever added, and make artifact bytes platform-stable.
    const normalized = html
      .replace(/\r\n?/g, "\n")
      .replace(/<!--(?!\[if\b)[\s\S]*?-->/gi, "");
    const compacted = compactKnownOptionsHtml(
      relative.split(path.sep).join("/"),
      normalized,
      stylesheetsByHref,
    );
    if (compacted !== html) fs.writeFileSync(file, compacted, "utf8");
  }
}

// The built manifest is written compact: Chrome only parses it, and the bytes
// count against the total-dist budget.
function installEarlyUiFence() {
  const dist = path.join(root, "extension", "dist");
  const manifestPath = path.join(dist, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const captureEntry = manifest.content_scripts?.find(
    (entry) => entry.world === "ISOLATED" && /capture_isolated/.test(entry.js?.[0] ?? ""),
  );
  const captureScript = captureEntry?.js?.[0];
  if (!captureScript) throw new Error("Isolated-world capture content-script loader is missing");
  const loaderPath = path.join(dist, captureScript);
  const generated = fs.readFileSync(loaderPath, "utf8");
  const chunkPath = generated.match(/chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/)?.[1];
  if (!chunkPath) throw new Error("Isolated-world capture content-script chunk import is missing");

  // The synchronous document_start fence and focus/PiP recorder: see
  // uiGuardLoaderTemplate in content-loader-contract.mjs.
  const fencedLoaderTemplate = uiGuardLoaderTemplate(chunkPath);
  const { content: fencedLoader, revision } = finalizeUiGuardLoader(fencedLoaderTemplate);
  const finalCaptureScript = contentAddressedLoaderPath(captureScript, fencedLoader);
  const finalLoaderPath = path.join(dist, finalCaptureScript);
  fs.writeFileSync(finalLoaderPath, fencedLoader, "utf8");
  if (finalLoaderPath !== loaderPath) fs.rmSync(loaderPath, { force: true });
  captureEntry.js[0] = finalCaptureScript;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
  return revision;
}

function installEarlyMainClock() {
  const dist = path.join(root, "extension", "dist");
  const manifestPath = path.join(dist, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const mainEntry = manifest.content_scripts?.find(
    (entry) => entry.world === "MAIN" && /main_guard/.test(entry.js?.[0] ?? ""),
  );
  const loaderScript = mainEntry?.js?.[0];
  if (!loaderScript) throw new Error("MAIN-world guard content-script loader is missing");
  const loaderPath = path.join(dist, loaderScript);
  const generated = fs.readFileSync(loaderPath, "utf8");
  const finalLoader = installEarlyMainClockText(generated);
  const finalScript = contentAddressedLoaderPath(loaderScript, finalLoader);
  const finalPath = path.join(dist, finalScript);
  fs.writeFileSync(finalPath, finalLoader, "utf8");
  if (finalPath !== loaderPath) fs.rmSync(loaderPath, { force: true });
  mainEntry.js[0] = finalScript;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
}

console.log(`[build] profile=${profile.id}; releaseEligible=${profile.releaseEligible}`);
const env = { [RELEASE_PROFILE_ENV]: profile.id };
runNode(viteBin, ["build", "--config", path.join(root, "vite.config.ts")], env);
const uiGuardRevision = installEarlyUiFence();
installEarlyMainClock();
runNode(path.join(root, "scripts", "check-content-loader-identity.mjs"));
compactPackagedHtml();
runNode(path.join(root, "scripts", "check-mv3-worker-imports.mjs"));
runNode(path.join(root, "scripts", "check-release-profile.mjs"), [`--expect=${profile.id}`]);

console.log(
  "[build] owner action for unpacked Chrome: load or reload extension/dist before reloading target pages."
);
console.log(
  `[build] expected runtime markers: capture=1, bridge=1, ui-guard=${uiGuardRevision}; ` +
  "browser automation cannot prove that Chrome accepted this artifact."
);
