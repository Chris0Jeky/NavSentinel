#!/usr/bin/env node

/**
 * Release script for NavSentinel.
 * Usage: node scripts/release.mjs <major|minor|patch> [--dry-run]
 *
 * Steps:
 * 1. Validates clean working tree
 * 2. Bumps version in package.json and manifest.json
 * 3. Updates CHANGELOG.md (moves Unreleased to new version)
 * 4. Commits the version bump
 * 5. Creates a git tag
 * 6. Prints instructions for pushing
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectBloomFilter, MIN_REAL_FILTER_BITS } from "./check-bloom-real.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, encoding: "utf8", ...opts }).trim();
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function bumpVersion(version, type) {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver: ${version}`);
  }
  const [major, minor, patch] = parts;
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump type: ${type}`);
  }
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bumpType = args.find((a) => ["major", "minor", "patch"].includes(a));

if (!bumpType) {
  console.error("Usage: node scripts/release.mjs <major|minor|patch> [--dry-run]");
  process.exit(1);
}

// 1. Validate clean working tree
const status = run("git status --porcelain");
if (status) {
  console.error("Working tree is not clean. Commit or stash changes first.");
  if (!dryRun) process.exit(1);
  console.log("[dry-run] WARNING: working tree is dirty -- real release would abort.");
}

// Validate we're on the main branch
const branch = run("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") {
  console.error(`Release must be run from main branch (currently on ${branch})`);
  if (!dryRun) process.exit(1);
  console.log("[dry-run] WARNING: not on main branch -- real release would abort.");
}

// 1c. Refuse to release the placeholder/test reputation filter (#321 companion).
//     The production feed (npm run build:bloom) has m in the millions; the
//     committed placeholder is ~300 bits. Shipping it would contradict the
//     threat-feed protection claimed in README/PRIVACY/SECURITY/the store listing.
const bloomPath = path.join(root, "extension", "public", "reputation_data.bin");
try {
  const info = inspectBloomFilter(fs.readFileSync(bloomPath));
  if (!info.real) {
    const detail = `reputation_data.bin is not a production threat-feed filter (m=${info.m} bits < ${MIN_REAL_FILTER_BITS} floor). Build/rebuild the real feed with 'npm run build:bloom' first — the committed default is a placeholder, and a below-floor filter can also mean a threat feed failed at build time (issue #321 / AI-9).`;
    if (process.env.NAVSENTINEL_ALLOW_TEST_BLOOM === "1") {
      console.log(`WARNING (NAVSENTINEL_ALLOW_TEST_BLOOM=1): releasing with ${detail}`);
    } else {
      console.error(`Refusing to release: ${detail}`);
      if (!dryRun) process.exit(1);
      console.log("[dry-run] WARNING: real release would abort on the placeholder bloom filter.");
    }
  }
} catch (err) {
  console.error(`Refusing to release: cannot validate reputation_data.bin (${err instanceof Error ? err.message : String(err)}).`);
  if (!dryRun) process.exit(1);
  console.log("[dry-run] WARNING: real release would abort -- bloom filter unreadable/invalid.");
}

// 2. Read current version
const packagePath = path.join(root, "package.json");
const manifestPath = path.join(root, "extension", "manifest.json");
const changelogPath = path.join(root, "CHANGELOG.md");

const pkg = readJSON(packagePath);
const manifest = readJSON(manifestPath);

const currentVersion = pkg.version;
if (currentVersion !== manifest.version) {
  console.error(
    `Version mismatch: package.json=${currentVersion}, manifest.json=${manifest.version}`
  );
  process.exit(1);
}

// 3. Compute new version
const newVersion = bumpVersion(currentVersion, bumpType);

if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`Computed version is not valid semver: ${newVersion}`);
  process.exit(1);
}

// 3b. Abort if tag already exists
const existingTags = run("git tag --list").split("\n").map(t => t.trim()).filter(Boolean);
if (existingTags.includes(`v${newVersion}`)) {
  console.error(`Tag v${newVersion} already exists. Aborting.`);
  process.exit(1);
}

console.log(`Bump: ${currentVersion} -> ${newVersion} (${bumpType})`);

if (dryRun) {
  console.log("[dry-run] Would update package.json version");
  console.log("[dry-run] Would update manifest.json version");
  console.log("[dry-run] Would update CHANGELOG.md with new release section");
  console.log(`[dry-run] Would commit: Release v${newVersion}`);
  console.log(`[dry-run] Would tag: v${newVersion}`);
  console.log("[dry-run] No changes made.");
  process.exit(0);
}

// 4. Update package.json
pkg.version = newVersion;
writeJSON(packagePath, pkg);
console.log(`Updated package.json -> ${newVersion}`);

// 5. Update manifest.json
manifest.version = newVersion;
writeJSON(manifestPath, manifest);
console.log(`Updated manifest.json -> ${newVersion}`);

// 6. Update CHANGELOG.md
let changelog = fs.readFileSync(changelogPath, "utf8");
const unreleasedHeading = "## [Unreleased]";
const idx = changelog.indexOf(unreleasedHeading);
if (idx === -1) {
  console.error("Could not find '## [Unreleased]' in CHANGELOG.md");
  process.exit(1);
}

const afterUnreleased = idx + unreleasedHeading.length;
const nextSectionIdx = changelog.indexOf("\n## [", afterUnreleased);

// Content between [Unreleased] heading and the next version section
const unreleasedContent = nextSectionIdx === -1
  ? changelog.slice(afterUnreleased)
  : changelog.slice(afterUnreleased, nextSectionIdx);

const rest = nextSectionIdx === -1 ? "" : changelog.slice(nextSectionIdx);

const trimmedContent = unreleasedContent.trim();
if (!trimmedContent) {
  console.error("No changes under [Unreleased]. Add changelog entries before releasing.");
  process.exit(1);
}

const releaseDate = todayISO();

changelog = changelog.slice(0, afterUnreleased)
  + "\n"
  + `\n## [${newVersion}] - ${releaseDate}`
  + unreleasedContent
  + rest;

fs.writeFileSync(changelogPath, changelog, "utf8");
console.log(`Updated CHANGELOG.md with [${newVersion}] - ${releaseDate}`);

// 6b. Sync package-lock.json
if (!dryRun) {
  run("npm install --package-lock-only --ignore-scripts");
}

// 7. Stage and commit
run("git add package.json extension/manifest.json CHANGELOG.md package-lock.json");
run(`git commit -m "Release v${newVersion}"`);
console.log(`Committed: Release v${newVersion}`);

// 8. Create annotated tag
run(`git tag -a "v${newVersion}" -m "v${newVersion}"`);
console.log(`Tagged: v${newVersion}`);

// 9. Done
console.log(`\nDone! Push with: git push origin main --tags`);
