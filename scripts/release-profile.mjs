import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "..", "config", "release-profiles.json");

export const RELEASE_PROFILE_ENV = "NAVSENTINEL_BUILD_PROFILE";
export const RELEASE_PROFILE_RECEIPT = "navsentinel-profile.json";

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function loadReleaseProfileConfig(filePath = CONFIG_PATH) {
  const config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assertPlainObject(config, "release profile config");
  if (!Number.isInteger(config.schemaVersion) || config.schemaVersion < 1) {
    throw new Error("release profile schemaVersion must be a positive integer");
  }
  if (typeof config.defaultProfile !== "string" || !config.defaultProfile) {
    throw new Error("release profile defaultProfile must be a non-empty string");
  }
  assertPlainObject(config.profiles, "release profile profiles");

  for (const [id, rawProfile] of Object.entries(config.profiles)) {
    assertPlainObject(rawProfile, `release profile ${id}`);
    assertPlainObject(rawProfile.capabilities, `release profile ${id}.capabilities`);
    if (typeof rawProfile.description !== "string" || !rawProfile.description.trim()) {
      throw new Error(`release profile ${id}.description must be non-empty`);
    }
    if (typeof rawProfile.releaseEligible !== "boolean") {
      throw new Error(`release profile ${id}.releaseEligible must be boolean`);
    }
    if (typeof rawProfile.capabilities.reputation !== "boolean") {
      throw new Error(`release profile ${id}.capabilities.reputation must be boolean`);
    }
  }

  if (!Object.hasOwn(config.profiles, config.defaultProfile)) {
    throw new Error(`unknown default release profile: ${config.defaultProfile}`);
  }
  return config;
}

const CONFIG = loadReleaseProfileConfig();

export function resolveReleaseProfile(requested = process.env[RELEASE_PROFILE_ENV]) {
  const id = requested?.trim() || CONFIG.defaultProfile;
  const configured = CONFIG.profiles[id];
  if (!configured) {
    const choices = Object.keys(CONFIG.profiles).sort().join(", ");
    throw new Error(`unknown release profile '${id}' (expected one of: ${choices})`);
  }
  return {
    id,
    schemaVersion: CONFIG.schemaVersion,
    description: configured.description,
    releaseEligible: configured.releaseEligible,
    capabilities: {
      reputation: configured.capabilities.reputation,
    },
  };
}

export function createReleaseProfileReceipt(profile) {
  return {
    schemaVersion: profile.schemaVersion,
    profile: profile.id,
    releaseEligible: profile.releaseEligible,
    capabilities: {
      reputation: profile.capabilities.reputation,
    },
  };
}

export function serializeReleaseProfileReceipt(profile) {
  return `${JSON.stringify(createReleaseProfileReceipt(profile), null, 2)}\n`;
}

export function configureManifestForProfile(baseManifest, profile) {
  const manifest = structuredClone(baseManifest);
  const entries = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources
    : [];

  for (const entry of entries) {
    if (!Array.isArray(entry.resources)) continue;
    entry.resources = entry.resources.filter((resource) => resource !== "reputation_data.bin");
  }

  if (profile.capabilities.reputation) {
    let entry = entries.find((candidate) =>
      Array.isArray(candidate.matches) && candidate.matches.includes("<all_urls>"),
    );
    if (!entry) {
      entry = { resources: [], matches: ["<all_urls>"] };
      entries.push(entry);
    }
    if (!Array.isArray(entry.resources)) entry.resources = [];
    if (!entry.resources.includes("reputation_data.bin")) {
      entry.resources.push("reputation_data.bin");
    }
  }

  manifest.web_accessible_resources = entries.filter((entry) =>
    !Array.isArray(entry.resources) || entry.resources.length > 0,
  );
  return manifest;
}

export function assertReleaseProfileReceipt(receipt) {
  assertPlainObject(receipt, "release profile receipt");
  if (typeof receipt.profile !== "string") {
    throw new Error("release profile receipt.profile must be a string");
  }
  const profile = resolveReleaseProfile(receipt.profile);
  const expected = createReleaseProfileReceipt(profile);
  if (JSON.stringify(receipt) !== JSON.stringify(expected)) {
    throw new Error(`release profile receipt does not match committed profile '${profile.id}'`);
  }
  return profile;
}
