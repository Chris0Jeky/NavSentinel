#!/usr/bin/env node

/**
 * Performance budget check for NavSentinel extension builds.
 * Run after `npm run build` to verify bundle sizes stay within budget.
 *
 * Exit code 0 = all budgets pass, 1 = at least one budget exceeded.
 *
 * NOTE on "total dist": this budget intentionally measures the entire dist/
 * directory including all subdirectories (assets, rules, src, .vite).
 * Individual file/chunk budgets may overlap with the total — this is by design
 * so that the total catches aggregate growth even when individual budgets pass.
 * (I-03)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "extension", "dist");

const KB = 1024;

/**
 * Budget entries.
 *
 * For glob-based entries, Vite loader stubs (tiny re-export files with
 * "-loader-" in the filename) are automatically excluded so that only the
 * real hashed bundle is measured. (C-01)
 */
const budgets = [
  {
    label: "capture_isolated (content script)",
    glob: "assets/capture_isolated.ts-*.js",
    // Bumped 60 -> 61 (#206): capture_isolated was already sitting at ~60KB from
    // accumulated detection logic, and the ClickFix legit-CAPTCHA hardening
    // (hostname + render-state validation instead of a spoofable src substring)
    // tipped it just over.
    // P5-A4 adds one DOM containment hint to prevent structural navigation
    // containers from becoming delegated-click evasions.
    // Bumped 61 -> 62 (#236, P5-B1): silent-decision instrumentation — the
    // nav_silent_allow emission plus the scoping/throttle helpers in
    // silent_decision.ts (which inline into this chunk) — added ~0.9KB, landing
    // the chunk at ~61.2KB. The total-dist budget (500KB) remains the aggregate
    // guard with ample room (~449KB). NOTE: PR #249 (P5-C1) independently grows
    // this chunk; when both land, re-measure — together they may need a trim or a
    // further bump. The chunk is repeatedly near its cap — track its growth.
    // Bumped 62 -> 63 (#236 review fix): commit-confirmed silent-nav logging
    // carries event metadata through the MAIN/isolated/SW path; Linux CI measures
    // this chunk at ~62.6KB while total dist remains comfortably under 500KB.
    // Bumped 60 -> 61 (#206) for ClickFix legit-CAPTCHA hardening, then to 63
    // (#233 / P5-A2) for compact Smart Mode benign-context suppression.
    // Bumped 63 -> 65 after merging #233 + #236: Linux CI measured the combined
    // capture chunk at 64.4KB while total dist stayed under 500KB. Keep this
    // tight; the next capture growth slice should split capture_isolated into
    // smaller lazy chunks.
    // Bumped 65 -> 66 after the P5-A3/P5-A4 line: top-sites trust-tier lookup,
    // threshold wiring, container-intent hints, and silent-decision metadata
    // measure just over 65KB while total dist stays under 500KB. No further
    // capture growth should land before a split/trim slice.
    // #238 / P5-C1 then adds replay-grade outcome wiring at the call sites while
    // keeping the pure feature-selection builder in the storage chunk.
    maxKB: 66,
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
  // I-01: Per-chunk budgets for shared modules visible in dist/assets/
  {
    label: "oauth_monitor (shared)",
    glob: "assets/oauth_monitor-*.js",
    maxKB: 8,
  },
  {
    label: "domain_profile (shared)",
    glob: "assets/domain_profile-*.js",
    maxKB: 6,
  },
  {
    label: "ui_toast (shared)",
    glob: "assets/ui_toast-*.js",
    maxKB: 5,
  },
  // C-02: Separate budget for the reputation bloom filter (150 KB).
  // check-bloom-size.mjs enforces a coarse 2 MB absolute max on the source
  // file; this budget gates the copy in dist/ at a tighter per-build limit.
  {
    label: "reputation_data.bin",
    glob: "reputation_data.bin",
    maxKB: 150,
  },
  {
    label: "total dist",
    path: ".",
    maxKB: 500,
    recursive: true,
  },
];

/**
 * Find files in `dir` matching a glob-style `pattern`.
 * Excludes Vite loader stubs (filenames containing "-loader-") so only the
 * real hashed bundle is measured. (C-01)
 */
function findFiles(dir, pattern) {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*") +
      "$"
  );
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => regex.test(f) && !f.includes("-loader-"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Recursively compute the total size of a directory.
 * Wraps statSync in try/catch to handle files deleted between readdir and
 * stat (TOCTOU race with build watchers). (C-04)
 */
function dirSizeRecursive(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        total += dirSizeRecursive(full);
      } else {
        total += fs.statSync(full).size;
      }
    } catch {
      // File deleted between readdir and stat — skip gracefully. (C-04)
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
      // C-03: Missing chunks are a build failure — show in report table.
      failures++;
      results.push({
        label: budget.label,
        sizeKB: "0.0",
        maxKB: budget.maxKB,
        pct: "0",
        pass: false,
        status: "MISS",
        file: `no files matching ${budget.glob}`,
      });
      continue;
    }

    sizeBytes = files.reduce((sum, f) => {
      try { return sum + fs.statSync(f).size; } catch { return sum; }
    }, 0);
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
    status: pass ? "PASS" : "FAIL",
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
  const statusTag =
    r.status === "MISS" ? " MISS" : r.status === "FAIL" ? " FAIL" : " PASS";
  console.log(
    `${r.label.padEnd(32)} ${(r.sizeKB + "KB").padStart(8)} ${(r.maxKB + "KB").padStart(8)} ${(r.pct + "%").padStart(6)}  ${statusTag}`
  );
}

console.log("-".repeat(60));
console.log(
  failures === 0
    ? `All ${results.length} budgets pass.`
    : `${failures} budget(s) EXCEEDED or MISSING.`
);
console.log();

process.exit(failures > 0 ? 1 : 0);
