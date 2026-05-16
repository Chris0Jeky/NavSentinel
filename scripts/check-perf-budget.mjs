#!/usr/bin/env node

/**
 * Performance budget check for NavSentinel extension builds.
 * Run after `npm run build` to verify bundle sizes stay within budget.
 *
 * Exit code 0 = all budgets pass, 1 = at least one budget exceeded.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "extension", "dist");

const KB = 1024;

const budgets = [
  {
    label: "capture_isolated (content script)",
    glob: "assets/capture_isolated.ts-*.js",
    maxKB: 60,
  },
  {
    label: "main_guard (MAIN world)",
    glob: "assets/main_guard.ts-*.js",
    maxKB: 20,
  },
  {
    label: "credential_guard (content script)",
    glob: "assets/credential_guard.ts-*.js",
    maxKB: 30,
  },
  {
    label: "service worker",
    glob: "assets/sw.ts-*.js",
    maxKB: 25,
  },
  {
    label: "storage module",
    glob: "assets/storage-*.js",
    maxKB: 200,
  },
  {
    label: "popup JS",
    glob: "assets/popup.html-*.js",
    maxKB: 10,
  },
  {
    label: "options JS",
    glob: "assets/options.html-*.js",
    maxKB: 15,
  },
  {
    label: "total dist",
    path: ".",
    maxKB: 500,
    recursive: true,
  },
];

function findFiles(dir, pattern) {
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
  );
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => regex.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function dirSizeRecursive(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeRecursive(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

if (!fs.existsSync(distDir)) {
  console.error("dist/ not found. Run `npm run build` first.");
  process.exit(1);
}

let failures = 0;
const results = [];

for (const budget of budgets) {
  let sizeBytes;
  let matchInfo;

  if (budget.recursive) {
    const target = path.join(distDir, budget.path);
    sizeBytes = dirSizeRecursive(target);
    matchInfo = target;
  } else {
    const dir = path.dirname(path.join(distDir, budget.glob));
    const pattern = path.basename(budget.glob);
    const files = findFiles(dir, pattern);

    if (files.length === 0) {
      console.error(`  MISS  ${budget.label} — no files matching ${budget.glob}`);
      failures++;
      continue;
    }

    sizeBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
    matchInfo = files.map((f) => path.relative(distDir, f)).join(", ");
  }

  const sizeKB = sizeBytes / KB;
  const pct = ((sizeKB / budget.maxKB) * 100).toFixed(0);
  const pass = sizeKB <= budget.maxKB;

  if (!pass) failures++;

  results.push({
    label: budget.label,
    sizeKB: sizeKB.toFixed(1),
    maxKB: budget.maxKB,
    pct,
    pass,
    file: matchInfo,
  });
}

console.log("\nNavSentinel Performance Budget Report");
console.log("=".repeat(60));
console.log(
  `${"Asset".padEnd(32)} ${"Size".padStart(8)} ${"Budget".padStart(8)} ${"Used".padStart(6)}  Status`
);
console.log("-".repeat(60));

for (const r of results) {
  const status = r.pass ? " PASS" : " FAIL";
  console.log(
    `${r.label.padEnd(32)} ${(r.sizeKB + "KB").padStart(8)} ${(r.maxKB + "KB").padStart(8)} ${(r.pct + "%").padStart(6)}  ${status}`
  );
}

console.log("-".repeat(60));
console.log(
  failures === 0
    ? `All ${results.length} budgets pass.`
    : `${failures} budget(s) EXCEEDED.`
);
console.log();

process.exit(failures > 0 ? 1 : 0);
