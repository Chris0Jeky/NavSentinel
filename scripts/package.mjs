#!/usr/bin/env node
/**
 * Package extension/dist into a deterministic release ZIP with manifest.json
 * at the archive root. The writer is platform-independent and refuses links or
 * ambiguous extraction paths instead of following unreviewed filesystem bytes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectBuiltReleaseProfile } from "./check-release-profile.mjs";
import { createDeterministicZip } from "./deterministic-zip.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const packagePath = path.join(root, "package.json");
const distDir = path.join(root, "extension", "dist");
const manifestPath = path.join(distDir, "manifest.json");
const licensePath = path.join(root, "LICENSE");
const distLicensePath = path.join(distDir, "LICENSE");
const artifactsDir = path.join(root, "artifacts");

function fail(message) {
  console.error(`[package:ext] ${message}`);
  process.exit(1);
}

function requireRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    fail(`${label} not found.`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(`${label} must be a regular file, not a link or special file.`);
  }
}

function requireDirectory(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    fail(`${label} not found.`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(`${label} must be a real directory, not a link or special file.`);
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

requireRegularFile(packagePath, "package.json");
requireDirectory(distDir, "Build output");
requireRegularFile(manifestPath, "Build manifest.json");
requireRegularFile(licensePath, "Root LICENSE");

const licenseText = fs.readFileSync(licensePath, "utf8");
if (!licenseText.includes("Version 3, 29 June 2007")) {
  fail("Root LICENSE does not contain the expected GPL terms.");
}

let builtProfile;
try {
  builtProfile = inspectBuiltReleaseProfile(distDir, { requireReleaseEligible: true }).profile;
} catch (error) {
  fail(`Refusing to package: ${error instanceof Error ? error.message : String(error)}`);
}
console.log(`[package:ext] Verified release profile: ${builtProfile.id}`);

// Binary distributions must carry the GPL terms alongside the extension files.
// Refuse an existing link before writing so a hostile build tree cannot redirect
// this write outside extension/dist.
if (fs.existsSync(distLicensePath)) {
  const stat = fs.lstatSync(distLicensePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("Build LICENSE must be a regular file before replacement.");
  }
}
fs.writeFileSync(distLicensePath, licenseText.replace(/\r\n?/g, "\n"), "utf8");

fs.mkdirSync(artifactsDir, { recursive: true });
requireDirectory(artifactsDir, "Artifacts directory");
const rootRealPath = fs.realpathSync.native(root);
const artifactsRealPath = fs.realpathSync.native(artifactsDir);
if (!isInside(rootRealPath, artifactsRealPath)) {
  fail("Artifacts directory resolves outside the repository.");
}

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const version = String(pkg.version ?? "0.0.0");
const baseName = String(pkg.name ?? "extension")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "") || "extension";
const archivePath = path.join(artifactsDir, `${baseName}-v${version}.zip`);

try {
  const result = createDeterministicZip(distDir, archivePath);
  console.log(
    `[package:ext] Created ${result.archivePath} (${result.entries.length} files, ${result.byteLength} bytes)`,
  );
} catch (error) {
  fail(`Failed to create archive: ${error instanceof Error ? error.message : String(error)}`);
}
