#!/usr/bin/env node

/**
 * fetch-phishing-corpus.mjs — Download phishing page snapshots
 *
 * Fetches phishing URLs from public feeds (OpenPhish, PhishTank),
 * downloads HTML snapshots, and writes a manifest for corpus validation.
 *
 * Usage:
 *   node scripts/fetch-phishing-corpus.mjs [--limit N] [--dry-run]
 *                                           [--timeout MS] [--source SOURCE]
 *   node scripts/fetch-phishing-corpus.mjs --from-manifest PATH --output-dir DIR
 *
 * Options:
 *   --limit N       Max snapshots to download per run (default: 50)
 *   --dry-run       Fetch URLs but skip downloading pages
 *   --timeout MS    Per-page download timeout in ms (default: 10000)
 *   --source SOURCE Feed source: "openphish", "phishtank", or "all" (default: "all")
 *   --help, -h      Show this help
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import {
  createCorpusManifest,
  normalizeCorpusCandidates,
  rehydrateCorpusSnapshots,
  sha256,
  snapshotFilename,
} from "./corpus-manifest.mjs";

// ── Constants ──────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, "..");
const CORPUS_DIR = path.resolve(ROOT, "tests", "corpus");
const SNAPSHOTS_DIR = path.resolve(CORPUS_DIR, "snapshots");
const MANIFEST_PATH = path.resolve(CORPUS_DIR, "manifest.json");

const OPENPHISH_FEED_URL = "https://openphish.com/feed.txt";
const PHISHTANK_FEED_URL =
  "https://data.phishtank.com/data/online-valid.json";

// ── Argument parsing ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: 50,
    dryRun: false,
    timeout: 10_000,
    source: "all",
    fromManifest: null,
    outputDir: null,
    provided: { limit: false, dryRun: false, source: false, fromManifest: false, outputDir: false },
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const requiredValue = (flag) => {
      const value = args[++i];
      if (!value || value.startsWith("--")) {
        console.error(`Invalid ${flag} value`);
        process.exit(1);
      }
      return value;
    };
    if (arg === "--limit") {
      opts.provided.limit = true;
      const n = parseInt(requiredValue("--limit"), 10);
      if (!Number.isFinite(n) || n < 1) {
        console.error("Invalid --limit value (must be a positive integer)");
        process.exit(1);
      }
      opts.limit = n;
    } else if (arg === "--timeout") {
      const n = parseInt(requiredValue("--timeout"), 10);
      if (!Number.isFinite(n) || n < 1000) {
        console.error("Invalid --timeout value (must be >= 1000 ms)");
        process.exit(1);
      }
      opts.timeout = n;
    } else if (arg === "--source") {
      opts.provided.source = true;
      const s = requiredValue("--source").toLowerCase();
      if (!["openphish", "phishtank", "all"].includes(s)) {
        console.error(`Invalid --source value: ${s} (must be openphish, phishtank, or all)`);
        process.exit(1);
      }
      opts.source = s;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
      opts.provided.dryRun = true;
    } else if (arg === "--from-manifest") {
      opts.fromManifest = requiredValue("--from-manifest");
      opts.provided.fromManifest = true;
    } else if (arg === "--output-dir") {
      opts.outputDir = requiredValue("--output-dir");
      opts.provided.outputDir = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/fetch-phishing-corpus.mjs [options]

Options:
  --limit N       Max snapshots to download (default: 50)
  --dry-run       Fetch URLs but skip page downloads
  --timeout MS    Per-page download timeout in ms (default: 10000)
  --source SRC    Feed source: openphish, phishtank, or all (default: all)
  --from-manifest PATH  Rehydrate an existing manifest without feed access
  --output-dir DIR      Required absent directory for --from-manifest output
  --help, -h      Show this help`);
      process.exit(0);
    } else {
      console.error("Unknown option");
      process.exit(1);
    }
  }

  return opts;
}

// ── HTTP helpers ───────────────────────────────────────────────────

const USER_AGENT = "NavSentinel-CorpusFetcher/1.0 (security-research; https://github.com/Chris0Jeky/NavSentinel)";

/**
 * Fetch a URL via HTTP or HTTPS, following up to maxRedirects redirects.
 * Returns the final response body as a Buffer.
 */
function fetchUrl(url, timeoutMs = 15_000, maxRedirects = 5, maxBytes = Number.POSITIVE_INFINITY) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, remaining) => {
      const mod = currentUrl.startsWith("https:") ? https : http;
      const reqOpts = { timeout: timeoutMs, headers: { "user-agent": USER_AGENT } };

      const req = mod.get(currentUrl, reqOpts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (remaining <= 0) {
            reject(new Error(`Too many redirects fetching ${url}`));
            return;
          }
          const next = new URL(res.headers.location, currentUrl).toString();
          attempt(next, remaining - 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} fetching ${currentUrl}`));
          return;
        }

        const chunks = [];
        let receivedBytes = 0;
        res.on("data", (chunk) => {
          receivedBytes += chunk.length;
          if (receivedBytes > maxBytes) {
            reject(new Error("Response exceeded configured byte limit"));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Timeout fetching ${currentUrl}`));
      });
    };
    attempt(url, maxRedirects);
  });
}

/**
 * Download the raw HTML of a URL as a Buffer. Returns null on any error.
 * Preserving the original encoding avoids mangling non-UTF-8 phishing pages.
 */
async function downloadPage(url, timeoutMs) {
  try {
    const buf = await fetchUrl(url, timeoutMs, 3);
    if (!buf || buf.length < 20) return null;
    return buf;
  } catch {
    return null;
  }
}

// ── Feed fetching ──────────────────────────────────────────────────

/**
 * Fetch URLs from the OpenPhish free feed (plain-text, one URL per line).
 */
async function fetchOpenPhishUrls() {
  console.log("Fetching OpenPhish feed...");
  try {
    const buf = await fetchUrl(OPENPHISH_FEED_URL, 30_000);
    const urls = buf.toString("utf-8")
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
    console.log(`  OpenPhish: ${urls.length} URLs`);
    return urls.map((url) => ({ url, source: "openphish" }));
  } catch {
    console.warn("  OpenPhish feed unavailable");
    return [];
  }
}

/**
 * Fetch URLs from the PhishTank free feed (JSON array).
 *
 * PhishTank's JSON feed can be large; we parse incrementally-ish
 * but since it's JSON we still need the full body.
 */
async function fetchPhishTankUrls() {
  console.log("Fetching PhishTank feed...");
  try {
    const buf = await fetchUrl(PHISHTANK_FEED_URL, 60_000);
    let entries;
    try {
      entries = JSON.parse(buf.toString("utf-8"));
    } catch {
      console.warn("  PhishTank: failed to parse JSON response");
      return [];
    }
    if (!Array.isArray(entries)) {
      console.warn("  PhishTank: unexpected response format");
      return [];
    }
    const urls = entries
      .filter((entry) => entry !== null && typeof entry === "object" && entry.verified === "yes")
      .map((entry) => ({ url: entry.url, source: "phishtank" }));
    console.log(`  PhishTank: ${urls.length} verified URLs`);
    return urls;
  } catch {
    console.warn("  PhishTank feed unavailable");
    return [];
  }
}

// ── Snapshot naming ────────────────────────────────────────────────

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.provided.fromManifest || opts.provided.outputDir) {
    if (!opts.provided.fromManifest || !opts.provided.outputDir) {
      console.error("Rehydration requires both --from-manifest and --output-dir");
      process.exit(1);
    }
    if (opts.provided.limit || opts.provided.dryRun || opts.provided.source) {
      console.error("Rehydration forbids --limit, --dry-run, and --source");
      process.exit(1);
    }

    console.log("\nNavSentinel Phishing Corpus Rehydration");
    console.log(`  Timeout: ${opts.timeout} ms`);
    const result = await rehydrateCorpusSnapshots({
      manifestPath: opts.fromManifest,
      outputDir: opts.outputDir,
      fetchSnapshot: (entry) => fetchUrl(new URL(entry.url).href, opts.timeout, 0, entry.sizeBytes),
    });
    console.log(`  Rehydrated: ${result.rehydrated}`);
    console.log(`  Failed records retained: ${result.failed}`);
    return;
  }

  console.log(`\nNavSentinel Phishing Corpus Fetcher`);
  console.log(`===================================`);
  console.log(`  Limit:   ${opts.limit}`);
  console.log(`  Source:  ${opts.source}`);
  console.log(`  Timeout: ${opts.timeout} ms`);
  console.log(`  Dry run: ${opts.dryRun}`);
  console.log();

  // Collect URLs from selected feeds
  let feedEntries = [];

  if (opts.source === "all" || opts.source === "openphish") {
    const entries = await fetchOpenPhishUrls();
    feedEntries.push(...entries);
  }

  if (opts.source === "all" || opts.source === "phishtank") {
    const entries = await fetchPhishTankUrls();
    feedEntries.push(...entries);
  }

  if (feedEntries.length === 0) {
    console.error("\nNo URLs fetched from any feed. Check network connectivity.");
    process.exit(1);
  }

  const normalized = normalizeCorpusCandidates(feedEntries);
  feedEntries = normalized.entries;
  console.log(`\nFeed candidates: ${normalized.entries.length + normalized.invalidCount + normalized.duplicateCount}`);
  console.log(`Safe candidates: ${feedEntries.length}`);
  console.log(`Quarantined candidates: ${normalized.invalidCount}`);
  console.log(`Duplicate candidates: ${normalized.duplicateCount}`);

  if (feedEntries.length === 0) {
    console.error("\nNo safe feed candidates remain after preflight.");
    process.exit(1);
  }

  // Shuffle for variety, then cap at limit
  shuffle(feedEntries);
  const selected = feedEntries.slice(0, opts.limit);
  console.log(`Selected for download: ${selected.length}\n`);

  if (opts.dryRun) {
    console.log(`DRY RUN: ${selected.length} safe candidates would be downloaded.`);
    process.exit(0);
  }

  // Ensure directories exist
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  // Download snapshots
  const manifest = [];
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < selected.length; i++) {
    const entry = selected[i];
    const filename = snapshotFilename(entry.source, entry.url);
    const filepath = path.join(SNAPSHOTS_DIR, filename);

    process.stdout.write(`  [${i + 1}/${selected.length}] ${entry.source} ... `);

    const buf = await downloadPage(entry.url, opts.timeout);

    if (buf) {
      fs.writeFileSync(filepath, buf);
      downloaded++;
      console.log(`OK (${(buf.length / 1024).toFixed(1)} KB)`);

      manifest.push({
        filename,
        url: entry.url,
        source: entry.source,
        fetchDate: new Date().toISOString(),
        sizeBytes: buf.length,
        sha256: sha256(buf),
      });
    } else {
      failed++;
      console.log("FAILED");

      manifest.push({
        filename: null,
        url: entry.url,
        source: entry.source,
        fetchDate: new Date().toISOString(),
        sizeBytes: 0,
        sha256: null,
        error: "download_failed",
      });
    }
  }

  // Write manifest
  const manifestData = createCorpusManifest({
    generatedAt: new Date().toISOString(),
    feedSources: opts.source === "all" ? ["openphish", "phishtank"] : [opts.source],
    entries: manifest,
  });

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestData, null, 2), "utf-8");

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Corpus fetch complete`);
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`${"=".repeat(50)}\n`);
}

// ── Utilities ──────────────────────────────────────────────────────

/** Fisher-Yates shuffle (in-place). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

main().catch((err) => {
  if (err && typeof err === "object" && err.outcome === "TEST_INVALID") {
    console.error(`\nFatal error: ${err.message}`);
  } else {
    console.error("\nFatal error: corpus operation failed");
  }
  process.exit(1);
});
