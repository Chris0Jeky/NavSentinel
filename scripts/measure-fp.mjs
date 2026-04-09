#!/usr/bin/env node

/**
 * measure-fp.mjs — False positive measurement on Tranco top-1000
 *
 * Launches Chromium with NavSentinel loaded, visits each site in the
 * Tranco top-1000 list, performs basic interactions, and records any
 * NavSentinel prompts/blocks/warnings. Outputs a CSV report.
 *
 * Usage:
 *   node scripts/measure-fp.mjs [--sites N] [--out path] [--cache path]
 *                                [--headed] [--timeout MS] [--resume]
 *
 * Options:
 *   --sites N      Number of sites from the list to test (default: 1000)
 *   --out path     CSV output path (default: tests/fp-results/report-<timestamp>.csv)
 *   --cache path   Path to cache the Tranco list (default: tests/fp-results/.tranco-cache.csv)
 *   --headed       Run browser in headed mode (visible)
 *   --timeout MS   Per-site timeout in ms (default: 30000)
 *   --resume       Resume from last incomplete run (skips already-tested sites)
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import zlib from "node:zlib";
import { promisify } from "node:util";

// ── Constants ──────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, "..");
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(ROOT, "extension", "dist");
const RESULTS_DIR = path.resolve(ROOT, "tests", "fp-results");
const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";

// NavSentinel event kinds that indicate a false positive on a legitimate site
const FP_EVENT_KINDS = new Set([
  "nav_blank_prompt",
  "nav_click_block",
  "nav_rollback",
  "cred_submit_prompt",
  "cred_paste_warn",
]);

const TRANCO_API_URL = "https://tranco-list.eu/api/lists/date/latest";
const TRANCO_ZIP_URL = "https://tranco-list.eu/top-1m.csv.zip";

// ── Argument parsing ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    sites: 1000,
    out: "",
    cache: path.join(RESULTS_DIR, ".tranco-cache.csv"),
    headed: false,
    timeout: 30_000,
    resume: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sites" && args[i + 1]) {
      opts.sites = parseInt(args[++i], 10);
    } else if (arg === "--out" && args[i + 1]) {
      opts.out = args[++i];
    } else if (arg === "--cache" && args[i + 1]) {
      opts.cache = args[++i];
    } else if (arg === "--headed") {
      opts.headed = true;
    } else if (arg === "--timeout" && args[i + 1]) {
      opts.timeout = parseInt(args[++i], 10);
    } else if (arg === "--resume") {
      opts.resume = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/measure-fp.mjs [options]

Options:
  --sites N      Number of sites to test (default: 1000)
  --out PATH     CSV output path (default: auto-generated in tests/fp-results/)
  --cache PATH   Tranco list cache path (default: tests/fp-results/.tranco-cache.csv)
  --headed       Run browser visibly
  --timeout MS   Per-site timeout in ms (default: 30000)
  --resume       Resume from last incomplete run
  --help, -h     Show this help`);
      process.exit(0);
    }
  }

  if (!opts.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    opts.out = path.join(RESULTS_DIR, `report-${stamp}.csv`);
  }

  return opts;
}

// ── Tranco list fetching ───────────────────────────────────────────

/**
 * Fetch a URL via HTTPS, following up to maxRedirects redirects.
 * Returns the final response stream.
 */
function httpsGet(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const attempt = (currentUrl, remaining) => {
      https.get(currentUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (remaining <= 0) {
            reject(new Error(`Too many redirects fetching ${url}`));
            return;
          }
          res.resume(); // consume response to free socket
          const next = new URL(res.headers.location, currentUrl).toString();
          attempt(next, remaining - 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} fetching ${currentUrl}`));
          return;
        }
        resolve(res);
      }).on("error", reject);
    };
    attempt(url, maxRedirects);
  });
}

/**
 * Download and parse the Tranco top-N list.
 * Caches the result locally to avoid repeated downloads.
 *
 * Strategy:
 * 1. Use the Tranco API to get the latest list ID and its direct download URL.
 * 2. Download the CSV from that URL (plain text).
 * 3. If the API is down, fall back to the ZIP endpoint and extract the CSV.
 */
async function fetchTrancoList(count, cachePath) {
  // Use cache if fresh (less than 24 hours old)
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 24 * 60 * 60 * 1000) {
      console.log(`Using cached Tranco list from ${cachePath}`);
      return parseTrancoCSV(fs.readFileSync(cachePath, "utf-8"), count);
    }
  }

  console.log("Downloading Tranco list...");
  let csvText = "";

  // Strategy 1: Use the API to get the latest list's direct CSV download
  try {
    const apiRes = await httpsGet(TRANCO_API_URL);
    const chunks = [];
    for await (const chunk of apiRes) chunks.push(chunk);
    const meta = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

    if (meta.download) {
      console.log(`Tranco list ID: ${meta.list_id}, downloading CSV...`);
      const csvRes = await httpsGet(meta.download);
      const csvChunks = [];
      for await (const chunk of csvRes) csvChunks.push(chunk);
      csvText = Buffer.concat(csvChunks).toString("utf-8");
    }
  } catch (err) {
    console.warn(`Tranco API download failed: ${err.message}`);
  }

  // Strategy 2: Fall back to the ZIP endpoint
  if (!csvText) {
    console.log("Falling back to ZIP endpoint...");
    try {
      csvText = await fetchTrancoFromZip(TRANCO_ZIP_URL);
    } catch (err) {
      throw new Error(`All Tranco download methods failed. Last error: ${err.message}`);
    }
  }

  // Validate we got something that looks like CSV
  const firstLine = csvText.split("\n")[0] ?? "";
  if (!firstLine.includes(",")) {
    throw new Error(`Downloaded data does not look like Tranco CSV (first line: ${firstLine.slice(0, 80)})`);
  }

  // Ensure cache directory exists and write
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, csvText, "utf-8");
  console.log(`Cached Tranco list to ${cachePath}`);

  return parseTrancoCSV(csvText, count);
}

/**
 * Download the Tranco ZIP file and extract the CSV from it.
 * The ZIP contains a single file "top-1m.csv".
 *
 * We use a minimal ZIP parser since the archive has a single deflate entry.
 */
async function fetchTrancoFromZip(url) {
  const res = await httpsGet(url);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  const buf = Buffer.concat(chunks);

  // Verify ZIP magic bytes (PK\x03\x04)
  if (buf.length < 30 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error("Downloaded file is not a valid ZIP archive");
  }

  // Parse the first local file header
  const compressionMethod = buf.readUInt16LE(8);
  const compressedSize = buf.readUInt32LE(18);
  const uncompressedSize = buf.readUInt32LE(22);
  const fileNameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const dataOffset = 30 + fileNameLen + extraLen;

  const compressedData = buf.subarray(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) {
    // Stored (no compression)
    return compressedData.toString("utf-8");
  }

  if (compressionMethod === 8) {
    // Deflate — use raw inflate (no zlib/gzip header)
    const inflateRaw = promisify(zlib.inflateRaw);
    const decompressed = await inflateRaw(compressedData);
    return decompressed.toString("utf-8");
  }

  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

/**
 * Parse Tranco CSV format: "rank,domain" per line.
 */
function parseTrancoCSV(csv, count) {
  const lines = csv.split("\n").filter((l) => l.trim());
  const sites = [];
  for (const line of lines) {
    if (sites.length >= count) break;
    const comma = line.indexOf(",");
    if (comma === -1) continue;
    const domain = line.slice(comma + 1).trim();
    if (domain) sites.push(domain);
  }
  return sites;
}

// ── CSV helpers ────────────────────────────────────────────────────

/**
 * Escape a value for CSV output. Handles commas, quotes, newlines,
 * and strips ANSI escape codes.
 */
function csvEscape(value) {
  // Strip ANSI escape codes (e.g. from Playwright error messages)
  const str = String(value ?? "").replace(/\x1b\[[0-9;]*m/g, "");
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(...fields) {
  return fields.map(csvEscape).join(",");
}

const CSV_HEADER = csvRow(
  "rank",
  "domain",
  "url_visited",
  "action",
  "ns_event_kind",
  "ns_event_site",
  "ns_event_score",
  "ns_event_reasons",
  "is_false_positive",
  "error"
);

// ── Browser interaction ────────────────────────────────────────────

/**
 * Extract the NavSentinel event log from chrome.storage.local
 * via the service worker.
 */
async function extractEventLog(context) {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10_000 });
  const log = await sw.evaluate(async (key) => {
    const res = await chrome.storage.local.get(key);
    return Array.isArray(res[key]) ? res[key] : [];
  }, EVENT_LOG_KEY);
  return log;
}

/**
 * Clear the NavSentinel event log.
 */
async function clearEventLog(context) {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10_000 });
  await sw.evaluate(async (key) => {
    await chrome.storage.local.set({ [key]: [] });
  }, EVENT_LOG_KEY);
}

/**
 * Visit a site and perform basic interactions.
 * Returns { events, error } where events is the NavSentinel event log
 * entries that occurred during the visit.
 */
async function visitSite(context, domain, timeoutMs) {
  const url = `https://${domain}`;
  let page;

  try {
    // Clear event log before visiting
    await clearEventLog(context);

    page = await context.newPage();

    // Navigate to the site
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
    } catch (navErr) {
      // Try HTTP fallback if HTTPS fails
      try {
        await page.goto(`http://${domain}`, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
      } catch (httpErr) {
        return {
          url,
          events: [],
          error: `Navigation failed: ${navErr.message}`,
        };
      }
    }

    // Wait a moment for the extension to initialize on the page
    await page.waitForTimeout(2000);

    // Perform basic interactions: scroll
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.waitForTimeout(500);
    } catch {
      // Scroll may fail on some pages, that's OK
    }

    // Click up to 3 internal links
    const internalLinks = await findInternalLinks(page, domain);
    const linksToClick = internalLinks.slice(0, 3);

    for (const linkHref of linksToClick) {
      try {
        await page.goto(linkHref, {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        await page.waitForTimeout(1500);

        // Scroll on subpage too
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
        await page.waitForTimeout(500);
      } catch {
        // Some links may time out or fail — continue
      }
    }

    // Extract events that occurred during the visit
    const events = await extractEventLog(context);

    return {
      url: page.url(),
      events,
      error: null,
    };
  } catch (err) {
    return {
      url,
      events: [],
      error: err.message,
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // Page may already be closed
      }
    }
  }
}

/**
 * Find internal links on the current page that stay within the same domain.
 * Returns an array of absolute URLs.
 */
async function findInternalLinks(page, domain) {
  try {
    return await page.evaluate((targetDomain) => {
      const links = Array.from(document.querySelectorAll("a[href]"));
      const internal = [];
      const seen = new Set();

      for (const link of links) {
        try {
          const href = link.getAttribute("href");
          if (!href) continue;
          const url = new URL(href, document.location.href);

          // Must be HTTP(S) and same domain
          if (url.protocol !== "http:" && url.protocol !== "https:") continue;
          if (!url.hostname.endsWith(targetDomain) && targetDomain !== url.hostname) continue;

          // Skip anchors, javascript, and mailto
          if (url.pathname === document.location.pathname && url.hash) continue;

          const normalized = url.origin + url.pathname;
          if (seen.has(normalized)) continue;
          seen.add(normalized);

          // Skip obviously non-page links
          const ext = url.pathname.split(".").pop()?.toLowerCase() ?? "";
          if (["pdf", "zip", "exe", "dmg", "pkg", "tar", "gz", "mp4", "mp3"].includes(ext)) continue;

          internal.push(url.href);
        } catch {
          // Invalid URL, skip
        }
      }

      return internal.slice(0, 10); // Return more than needed, we'll pick from this
    }, domain);
  } catch {
    return [];
  }
}

// ── Report generation ──────────────────────────────────────────────

/**
 * Load already-tested domains from an existing CSV report (for --resume).
 */
function loadTestedDomains(csvPath) {
  if (!fs.existsSync(csvPath)) return new Set();
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.split("\n").slice(1); // skip header
  const domains = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    const comma = line.indexOf(",");
    if (comma === -1) continue;
    const secondComma = line.indexOf(",", comma + 1);
    if (secondComma === -1) continue;
    const domain = line.slice(comma + 1, secondComma).replace(/^"|"$/g, "");
    if (domain) domains.add(domain);
  }
  return domains;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Validate extension build exists
  if (!fs.existsSync(EXTENSION_PATH)) {
    console.error(`Extension build not found at ${EXTENSION_PATH}`);
    console.error("Run 'npm run build' first.");
    process.exit(1);
  }

  if (!fs.existsSync(path.join(EXTENSION_PATH, "manifest.json"))) {
    console.error(`No manifest.json in ${EXTENSION_PATH} — is the extension built?`);
    process.exit(1);
  }

  // Ensure results directory exists
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Fetch Tranco list
  let sites;
  try {
    sites = await fetchTrancoList(opts.sites, opts.cache);
  } catch (err) {
    console.error(`Failed to fetch Tranco list: ${err.message}`);
    process.exit(1);
  }

  console.log(`Loaded ${sites.length} sites from Tranco list`);

  // Handle resume
  let testedDomains = new Set();
  const appendMode = opts.resume && fs.existsSync(opts.out);
  if (appendMode) {
    testedDomains = loadTestedDomains(opts.out);
    console.log(`Resuming: ${testedDomains.size} sites already tested`);
  }

  // Open CSV output
  const csvStream = fs.createWriteStream(opts.out, {
    flags: appendMode ? "a" : "w",
    encoding: "utf-8",
  });

  if (!appendMode) {
    csvStream.write(CSV_HEADER + "\n");
  }

  // Launch browser with extension
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-fp-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Extensions require headed mode in Chromium
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        // Minimize resource usage
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        ...(opts.headed ? [] : ["--window-position=-2400,-2400"]),
      ],
      timeout: 60_000,
      viewport: { width: 1280, height: 720 },
    });
  } catch (err) {
    console.error(`Failed to launch browser: ${err.message}`);
    csvStream.end();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Wait for service worker to be ready
  try {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15_000 });
    console.log(`NavSentinel service worker ready: ${sw.url()}`);
  } catch (err) {
    console.error(`NavSentinel service worker did not start: ${err.message}`);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    csvStream.end();
    process.exit(1);
  }

  // Stats tracking
  let tested = 0;
  let skipped = 0;
  let errored = 0;
  let fpCount = 0;
  const startTime = Date.now();

  console.log(`\nStarting false positive measurement...`);
  console.log(`Output: ${opts.out}\n`);

  // Process each site
  for (let i = 0; i < sites.length; i++) {
    const domain = sites[i];
    const rank = i + 1;

    // Skip already-tested sites in resume mode
    if (testedDomains.has(domain)) {
      skipped++;
      continue;
    }

    const progress = `[${rank}/${sites.length}]`;

    try {
      process.stdout.write(`${progress} Testing ${domain}... `);
      const result = await visitSite(context, domain, opts.timeout);

      if (result.error) {
        // Site had an error (timeout, unreachable, etc.)
        csvStream.write(
          csvRow(rank, domain, result.url, "error", "", "", "", "", "", result.error) + "\n"
        );
        errored++;
        console.log(`ERROR: ${result.error.slice(0, 80)}`);
      } else if (result.events.length === 0) {
        // No NavSentinel events — this is the expected outcome for legitimate sites
        csvStream.write(
          csvRow(rank, domain, result.url, "none", "", "", "", "", "no", "") + "\n"
        );
        console.log("OK (no events)");
      } else {
        // NavSentinel fired events — check if any are false positives
        for (const event of result.events) {
          const isFP = FP_EVENT_KINDS.has(event.kind);
          if (isFP) fpCount++;

          csvStream.write(
            csvRow(
              rank,
              domain,
              result.url,
              isFP ? "false_positive" : "expected",
              event.kind,
              event.site ?? "",
              event.score ?? "",
              event.reasons ? event.reasons.join("; ") : "",
              isFP ? "yes" : "no",
              ""
            ) + "\n"
          );
        }

        const fpEvents = result.events.filter((e) => FP_EVENT_KINDS.has(e.kind));
        if (fpEvents.length > 0) {
          console.log(`FALSE POSITIVE: ${fpEvents.map((e) => e.kind).join(", ")}`);
        } else {
          console.log(`OK (${result.events.length} expected events)`);
        }
      }

      tested++;
    } catch (err) {
      // Unexpected error in the measurement harness itself
      csvStream.write(
        csvRow(rank, domain, `https://${domain}`, "harness_error", "", "", "", "", "", err.message) + "\n"
      );
      errored++;
      console.log(`HARNESS ERROR: ${err.message}`);
    }

    // Periodic progress report every 50 sites
    if (tested > 0 && tested % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (tested / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`\n--- Progress: ${tested} tested, ${errored} errors, ${fpCount} FPs, ${elapsed}s elapsed, ${rate} sites/s ---\n`);
    }
  }

  // Cleanup
  csvStream.end();
  try {
    await context.close();
  } catch {
    // Browser may already be closed
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });

  // Final report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const fpRate = tested > 0 ? ((fpCount / tested) * 100).toFixed(3) : "N/A";

  console.log(`
╔══════════════════════════════════════════╗
║   NavSentinel False Positive Report      ║
╠══════════════════════════════════════════╣
║  Sites tested:    ${String(tested).padStart(6)}                 ║
║  Sites skipped:   ${String(skipped).padStart(6)} (resume)       ║
║  Errors/timeouts: ${String(errored).padStart(6)}                 ║
║  False positives: ${String(fpCount).padStart(6)}                 ║
║  FP rate:         ${fpRate.padStart(6)}%                ║
║  Time elapsed:    ${elapsed.padStart(6)}s                ║
║  Target:          < 0.1%                 ║
╠══════════════════════════════════════════╣
║  Report: ${opts.out.padEnd(32)}║
╚══════════════════════════════════════════╝
`);

  if (fpCount > 0) {
    console.log("False positive details:");
    // Re-read the CSV to show FP lines
    const csvContent = fs.readFileSync(opts.out, "utf-8");
    const fpLines = csvContent.split("\n").filter((line) => line.includes("false_positive") || line.includes(",yes,"));
    for (const line of fpLines.slice(0, 20)) {
      console.log(`  ${line}`);
    }
    if (fpLines.length > 20) {
      console.log(`  ... and ${fpLines.length - 20} more`);
    }
  }

  // Exit with non-zero if FP rate exceeds target
  const fpRateNum = tested > 0 ? (fpCount / tested) * 100 : 0;
  if (fpRateNum > 0.1) {
    console.log(`\nFAIL: FP rate ${fpRate}% exceeds 0.1% target`);
    process.exit(1);
  } else if (tested > 0) {
    console.log(`\nPASS: FP rate ${fpRate}% is within 0.1% target`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
