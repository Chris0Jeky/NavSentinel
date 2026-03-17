#!/usr/bin/env node
/**
 * Package extension/dist into a release zip with manifest.json at the archive root.
 * Uses PowerShell on Windows and zip on Unix-like systems.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const packagePath = path.join(root, "package.json");
const distDir = path.join(root, "extension", "dist");
const manifestPath = path.join(distDir, "manifest.json");
const artifactsDir = path.join(root, "artifacts");

if (!fs.existsSync(packagePath)) {
  console.error("[package:ext] package.json not found.");
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.error("[package:ext] Build output missing.");
  console.error("[package:ext] Run `npm run build` first.");
  process.exit(1);
}

fs.mkdirSync(artifactsDir, { recursive: true });

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const version = String(pkg.version ?? "0.0.0");
const baseName = String(pkg.name ?? "extension")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9._-]+/g, "-")
  .replace(/^-+|-+$/g, "") || "extension";
const archivePath = path.join(artifactsDir, `${baseName}-v${version}.zip`);

if (fs.existsSync(archivePath)) {
  fs.rmSync(archivePath, { force: true });
}

function packageWithPowerShell() {
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `
        $ErrorActionPreference = 'Stop'
        $dest = [System.IO.Path]::GetFullPath('${archivePath.replace(/'/g, "''")}')
        $items = Get-ChildItem -Force | ForEach-Object { $_.FullName }
        if (-not $items -or $items.Count -eq 0) { throw 'No files found to package.' }
        Compress-Archive -Path $items -DestinationPath $dest -CompressionLevel Optimal
      `
    ],
    { cwd: distDir, stdio: "inherit" }
  );
}

function packageWithZip() {
  execFileSync("zip", ["-qr", archivePath, "."], { cwd: distDir, stdio: "inherit" });
}

try {
  if (process.platform === "win32") {
    packageWithPowerShell();
  } else {
    packageWithZip();
  }
} catch (error) {
  console.error("[package:ext] Failed to create archive.");
  throw error;
}

console.log(`[package:ext] Created ${archivePath}`);
