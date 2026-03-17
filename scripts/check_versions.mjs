#!/usr/bin/env node
/**
 * Ensure package.json and extension/manifest.json stay version-aligned.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const packagePath = path.join(root, "package.json");
const manifestPath = path.join(root, "extension", "manifest.json");

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const packageVersion = String(pkg.version ?? "");
const manifestVersion = String(manifest.version ?? "");

if (!packageVersion || !manifestVersion) {
  console.error("[verify:versions] Missing version in package.json or extension/manifest.json");
  process.exit(1);
}

if (packageVersion !== manifestVersion) {
  console.error("[verify:versions] Version mismatch detected:");
  console.error(`  package.json: ${packageVersion}`);
  console.error(`  manifest.json: ${manifestVersion}`);
  process.exit(1);
}

console.log(`[verify:versions] OK: ${packageVersion}`);
