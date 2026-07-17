#!/usr/bin/env node
/**
 * Verify that the emitted MV3 service-worker graph is statically importable.
 *
 * Chrome extension service workers declared as modules support static imports,
 * but not dynamic import(). Keep this check on the built graph so a bundler
 * change cannot silently reintroduce an unloadable worker.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const DYNAMIC_IMPORT_PATTERN =
  /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\(/;
const PRELOAD_PATTERN = /\b(?:__vitePreload|modulepreload)\b/;
const STATIC_IMPORT_PATTERN = /\bimport\s*(?:[^"'();]+?\bfrom\s*)?["']([^"']+)["']/g;
const STATIC_REEXPORT_PATTERN =
  /\bexport\s*(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or invalid: ${filePath}`, { cause: error });
  }
}

function ensureInsideDist(distDir, candidate, label) {
  const relative = path.relative(distDir, candidate);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes extension/dist: ${candidate}`);
  }
  return candidate;
}

function resolveManifestEntry(distDir, specifier) {
  if (
    typeof specifier !== "string" ||
    specifier.length === 0 ||
    specifier.includes("\\") ||
    specifier.includes("://") ||
    specifier.startsWith("//") ||
    path.posix.isAbsolute(specifier) ||
    specifier.includes("?") ||
    specifier.includes("#")
  ) {
    throw new Error(`Invalid background.service_worker path: ${String(specifier)}`);
  }
  return ensureInsideDist(distDir, path.resolve(distDir, specifier), "Background worker");
}

function resolveStaticImport(distDir, importer, specifier) {
  if (
    !specifier.startsWith(".") ||
    specifier.includes("\\") ||
    specifier.includes("://") ||
    specifier.startsWith("//") ||
    specifier.includes("?") ||
    specifier.includes("#")
  ) {
    throw new Error(`Worker graph has a non-local import in ${path.relative(distDir, importer)}: ${specifier}`);
  }
  return ensureInsideDist(
    distDir,
    path.resolve(path.dirname(importer), specifier),
    `Import from ${path.relative(distDir, importer)}`,
  );
}

function collectStaticImports(source) {
  const imports = [];
  for (const pattern of [STATIC_IMPORT_PATTERN, STATIC_REEXPORT_PATTERN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1] !== undefined) imports.push(match[1]);
    }
  }
  return imports;
}

export function verifyMv3WorkerImports(distPath = path.join(root, "extension", "dist")) {
  const distDir = path.resolve(distPath);
  const manifestPath = path.join(distDir, "manifest.json");
  const manifest = readJson(manifestPath, "Built manifest");

  if (manifest?.manifest_version !== 3) {
    throw new Error("Built manifest must declare manifest_version 3.");
  }
  if (manifest?.background?.type !== "module") {
    throw new Error('Built manifest background.type must be "module".');
  }

  const entry = resolveManifestEntry(distDir, manifest?.background?.service_worker);
  const pending = [entry];
  const visited = new Set();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    if (!fs.statSync(current, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Worker graph import is missing: ${path.relative(distDir, current)}`);
    }

    const source = fs.readFileSync(current, "utf8");
    const relative = path.relative(distDir, current).replaceAll(path.sep, "/");
    if (DYNAMIC_IMPORT_PATTERN.test(source)) {
      throw new Error(`Worker graph contains unsupported dynamic import() in ${relative}.`);
    }
    if (PRELOAD_PATTERN.test(source)) {
      throw new Error(`Worker graph contains a browser preload helper in ${relative}.`);
    }

    visited.add(current);
    for (const specifier of collectStaticImports(source)) {
      pending.push(resolveStaticImport(distDir, current, specifier));
    }
  }

  const files = [...visited].map((file) => path.relative(distDir, file).replaceAll(path.sep, "/")).sort();
  if (!files.some((file) => path.basename(file).includes("pending-decision-runtime"))) {
    throw new Error("Pending-decision runtime is not reachable from the emitted service worker.");
  }

  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    const files = verifyMv3WorkerImports(process.argv[2]);
    console.log(`[check:mv3-worker] PASS: ${files.length} statically linked worker modules.`);
    for (const file of files) console.log(`  ${file}`);
  } catch (error) {
    console.error(`[check:mv3-worker] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
