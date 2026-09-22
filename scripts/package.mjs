#!/usr/bin/env node
/**
 * Package extension/dist into a deterministic release ZIP with manifest.json
 * at the archive root. The writer is platform-independent and refuses links or
 * ambiguous extraction paths instead of following unreviewed filesystem bytes.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectBuiltReleaseProfile } from "./check-release-profile.mjs";
import {
  collectDeterministicZipEntries,
  createDeterministicZip,
} from "./deterministic-zip.mjs";
import { assertRepositoryPath } from "./safe-release-path.mjs";

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

function requireRepositoryPath(filePath, expectedType, label) {
  try {
    return assertRepositoryPath(root, filePath, { expectedType, label });
  } catch (error) {
    fail(`${label} is not a safe repository ${expectedType}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

requireRepositoryPath(packagePath, "file", "package.json");
requireRepositoryPath(distDir, "directory", "Build output");
requireRepositoryPath(manifestPath, "file", "Build manifest.json");
requireRepositoryPath(licensePath, "file", "Root LICENSE");

// Reject links, special files and cross-platform path collisions before any
// build-tree file is interpreted or replaced. The final writer repeats this
// walk after LICENSE is materialized, closing ordinary mutation windows.
try {
  collectDeterministicZipEntries(distDir);
} catch (error) {
  fail(`Unsafe build output: ${error instanceof Error ? error.message : String(error)}`);
}

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
// Never truncate the destination inode: a regular file can still be a hard link.
// Publish an exclusively created sibling instead, leaving old bytes intact if
// writing or rename fails. A last-moment leaf symlink is replaced, not followed.
function checkLicenseDestination() {
  assertRepositoryPath(root, distDir, { expectedType: "directory", label: "Build output" });
  try {
    assertRepositoryPath(root, distLicensePath, { expectedType: "file", label: "Build LICENSE" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

checkLicenseDestination();
const temporaryLicensePath = path.join(distDir, `.LICENSE.${randomUUID()}.tmp`);
let temporaryLicenseCreated = false;
try {
  const descriptor = fs.openSync(temporaryLicensePath, "wx", 0o644);
  temporaryLicenseCreated = true;
  try {
    fs.writeFileSync(descriptor, licenseText.replace(/\r\n?/g, "\n"), "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  checkLicenseDestination();
  fs.renameSync(temporaryLicensePath, distLicensePath);
} finally {
  if (temporaryLicenseCreated) fs.rmSync(temporaryLicensePath, { force: true });
}
requireRepositoryPath(distLicensePath, "file", "Build LICENSE");

fs.mkdirSync(artifactsDir, { recursive: true });
requireRepositoryPath(artifactsDir, "directory", "Artifacts directory");

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const version = String(pkg.version ?? "0.0.0");
const baseName = String(pkg.name ?? "extension")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "") || "extension";
const archivePath = path.join(artifactsDir, `${baseName}-v${version}.zip`);

try {
  // Re-check the logical/physical ancestry immediately before the final walk so
  // a replaced `extension` or `dist` directory cannot redirect packaging.
  requireRepositoryPath(distDir, "directory", "Build output");
  requireRepositoryPath(artifactsDir, "directory", "Artifacts directory");
  const result = createDeterministicZip(distDir, archivePath);
  console.log(
    `[package:ext] Created ${result.archivePath} (${result.entries.length} files, ${result.byteLength} bytes)`,
  );
} catch (error) {
  fail(`Failed to create archive: ${error instanceof Error ? error.message : String(error)}`);
}
