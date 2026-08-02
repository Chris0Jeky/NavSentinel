import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  RELEASE_PROFILE_RECEIPT,
  assertReleaseProfileReceipt,
} from "./release-profile.mjs";
import { validateBloomBinary } from "./check-bloom-size.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDistDir = path.resolve(__dirname, "..", "extension", "dist");

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function manifestResources(manifest) {
  if (!Array.isArray(manifest.web_accessible_resources)) return [];
  return manifest.web_accessible_resources.flatMap((entry) =>
    Array.isArray(entry.resources) ? entry.resources : [],
  );
}

const PROHIBITED_INTERACTION_ONLY_UI_CLAIMS = [
  { pattern: /\bSafe\s+Browsing\b/i, label: "Safe Browsing comparison" },
  { pattern: /\bknown[-\s]+bad\s+domains?\b/i, label: "known-bad domain protection" },
  { pattern: /\bknown\s+malicious\s+domains?\b/i, label: "known malicious domain protection" },
  { pattern: /\breputation\b/i, label: "reputation protection" },
  { pattern: /browsers?\s+(?:cannot|can['’]t)\s+see/i, label: "browser-visibility superiority" },
  { pattern: /other\s+extensions\s+miss/i, label: "extension superiority" },
  { pattern: /only\s+browser\s+extension/i, label: "exclusive extension capability" },
];

function listFilesWithExtension(dir, extension) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesWithExtension(fullPath, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(fullPath);
  }
  return files;
}

export function inspectBuiltReleaseProfile(
  distDir = defaultDistDir,
  { expectedProfile, requireReleaseEligible = false } = {},
) {
  const receipt = readJson(
    path.join(distDir, RELEASE_PROFILE_RECEIPT),
    RELEASE_PROFILE_RECEIPT,
  );
  const profile = assertReleaseProfileReceipt(receipt);
  if (expectedProfile && profile.id !== expectedProfile) {
    throw new Error(`built profile is '${profile.id}', expected '${expectedProfile}'`);
  }
  if (requireReleaseEligible && !profile.releaseEligible) {
    throw new Error(`profile '${profile.id}' is explicitly not release eligible`);
  }

  const manifestPath = path.join(distDir, "manifest.json");
  const manifest = readJson(manifestPath, "built manifest.json");
  const resources = manifestResources(manifest);
  const reputationPath = path.join(distDir, "reputation_data.bin");
  const hasReputationAsset = fs.existsSync(reputationPath);
  const exposesReputation = resources.includes("reputation_data.bin");

  if (profile.capabilities.reputation) {
    if (!hasReputationAsset || !exposesReputation) {
      throw new Error("reputation research profile must emit and expose reputation_data.bin");
    }
    validateBloomBinary(fs.readFileSync(reputationPath));
  } else {
    if (hasReputationAsset || exposesReputation) {
      throw new Error("interaction-only profile must omit reputation_data.bin from dist and manifest");
    }
    for (const filePath of listFilesWithExtension(distDir, ".js")) {
      if (fs.readFileSync(filePath, "utf8").includes("reputation_data.bin")) {
        throw new Error(
          `interaction-only bundle still contains a reputation asset loader: ${path.relative(distDir, filePath)}`,
        );
      }
    }
    for (const filePath of listFilesWithExtension(distDir, ".html")) {
      const html = fs.readFileSync(filePath, "utf8");
      for (const claim of PROHIBITED_INTERACTION_ONLY_UI_CLAIMS) {
        if (claim.pattern.test(html)) {
          throw new Error(
            `interaction-only UI contains a prohibited ${claim.label} claim: ${path.relative(distDir, filePath)}`,
          );
        }
      }
    }
  }

  return { profile, manifest, hasReputationAsset, exposesReputation };
}

function main() {
  const expectedArg = process.argv.find((arg) => arg.startsWith("--expect="));
  const expectedProfile = expectedArg?.slice("--expect=".length);
  const requireReleaseEligible = process.argv.includes("--release");
  const unknown = process.argv.slice(2).filter((arg) =>
    arg !== "--release" && !arg.startsWith("--expect="),
  );
  if (unknown.length > 0) {
    console.error(`Unknown arguments: ${unknown.join(", ")}`);
    process.exit(1);
  }

  try {
    const result = inspectBuiltReleaseProfile(defaultDistDir, {
      ...(expectedProfile ? { expectedProfile } : {}),
      requireReleaseEligible,
    });
    console.log(
      `PASS: profile=${result.profile.id}; releaseEligible=${result.profile.releaseEligible}; ` +
      `reputation=${result.profile.capabilities.reputation}`,
    );
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
