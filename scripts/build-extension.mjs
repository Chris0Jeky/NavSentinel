#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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

console.log(`[build] profile=${profile.id}; releaseEligible=${profile.releaseEligible}`);
const env = { [RELEASE_PROFILE_ENV]: profile.id };
runNode(viteBin, ["build"], env);
runNode(path.join(root, "scripts", "check-mv3-worker-imports.mjs"));
runNode(path.join(root, "scripts", "check-release-profile.mjs"), [`--expect=${profile.id}`]);
