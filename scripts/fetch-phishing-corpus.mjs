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
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!Number.isFinite(n) || n < 1) {
        console.error(`Invalid --limit value: ${args[i]} (must be a positive integer)`);
        process.exit(1);
      }
      opts.limit = n;
    } else if (arg === "--timeout" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!Number.isFinite(n) || n < 1000) {
        console.error(`Invalid --timeout value: ${args[i]} (must be >= 1000 ms)`);
        process.exit(1);
      }
      opts.timeout = n;
    } else if (arg === "--source" && args[i + 1]) {
      const s = args[++i].toLowerCase();
      if (!["openphish", "phishtank", "all"].includes(s)) {
        console.error(`Invalid --source value: ${s} (must be openphish, phishtank, or all)`);
        process.exit(1);
      }
      opts.source = s;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/fetch-phishing-corpus.mjs [options]

Options:
  --limit N       Max snapshots to download (default: 50)
  --dry-run       Fetch URLs but skip page downloads
  --timeout MS    Per-page download timeout in ms (default: 10000)
  --source SRC    Feed source: openphish, phishtank, or all (default: all)
  --help, -h      Show this help`);
      process.exit(0);
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
function fetchUrl(url, timeoutMs = 15_000, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, remaining) => {
      const mod = currentUrl.startsWith("https:") ? https : http;
      const reqOpts = { timeout: timeoutMs, headers: { "user-agent": USER_AGENT } };

      const req = mod.get(currentUrl, reqOpts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (remaining <= 0) {
            reject(new Error(`Too many redirects fetching ${url}`));
            return;
          }
          res.resume();
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
        res.on("data", (chunk) => chunks.push(chunk));
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
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
    console.log(`  OpenPhish: ${urls.length} URLs`);
    return urls.map((url) => ({ url, source: "openphish" }));
  } catch (err) {
    console.warn(`  OpenPhish feed failed: ${err.message}`);
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
      .filter((e) => e.url && e.verified === "yes")
      .map((e) => ({ url: e.url, source: "phishtank" }));
    console.log(`  PhishTank: ${urls.length} verified URLs`);
    return urls;
  } catch (err) {
    console.warn(`  PhishTank feed failed: ${err.message}`);
    return [];
  }
}

// ── Snapshot naming ────────────────────────────────────────────────

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

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

  console.log(`\nTotal feed URLs: ${feedEntries.length}`);

  // Deduplicate by URL
  const seen = new Set();
  feedEntries = feedEntries.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });

  console.log(`Unique URLs: ${feedEntries.length}`);

  // Shuffle for variety, then cap at limit
  shuffle(feedEntries);
  const selected = feedEntries.slice(0, opts.limit);
  console.log(`Selected for download: ${selected.length}\n`);

  if (opts.dryRun) {
    console.log("DRY RUN — listing selected URLs:\n");
    for (const entry of selected) {
      console.log(`  [${entry.source}] ${entry.url}`);
    }
    console.log(`\n${selected.length} URLs would be downloaded.`);
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

    process.stdout.write(
      `  [${i + 1}/${selected.length}] ${entry.source}: ${truncateUrl(entry.url, 60)} ... `
    );

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
  console.log(`  Manifest:   ${MANIFEST_PATH}`);
  console.log(`  Snapshots:  ${SNAPSHOTS_DIR}`);
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

/** Truncate a URL for display. */
function truncateUrl(url, maxLen) {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 3) + "...";
}

main().catch((err) => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});
