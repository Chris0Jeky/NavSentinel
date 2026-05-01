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
      const n = parseInt(args[++i], 10);
      if (!Number.isFinite(n) || n < 1) {
        console.error(`Invalid --sites value: ${args[i]} (must be a positive integer)`);
        process.exit(1);
      }
      opts.sites = n;
    } else if (arg === "--out" && args[i + 1]) {
      opts.out = args[++i];
    } else if (arg === "--cache" && args[i + 1]) {
      opts.cache = args[++i];
    } else if (arg === "--headed") {
      opts.headed = true;
    } else if (arg === "--timeout" && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (!Number.isFinite(n) || n < 1000) {
        console.error(`Invalid --timeout value: ${args[i]} (must be >= 1000 ms)`);
        process.exit(1);
      }
      opts.timeout = n;
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
    if (opts.resume) {
      console.warn("WARN: --resume without --out generates a new filename each run.");
      console.warn("      Pass --out <path> to resume into a specific file.");
    }
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
  let str = String(value ?? "").replace(/\x1b\[[0-9;]*m/g, "");

  // Neutralize CSV formula injection: if the value starts with a character
  // that spreadsheet applications interpret as a formula (=, +, -, @, tab,
  // carriage return), prefix with a single quote. This prevents malicious
  // Tranco entries from executing formulas when the CSV is opened in Excel.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }

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
 * Get the service worker, waiting for it to appear if needed.
 * MV3 service workers are ephemeral; this handles the case where the
 * worker has been recycled during a long measurement run.
 */
async function getServiceWorker(context, timeoutMs = 15_000) {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;

  // Service worker may have been recycled; trigger it by opening a page
  // in the extension context, then wait for it to re-register.
  return context.waitForEvent("serviceworker", { timeout: timeoutMs });
}

/**
 * Extract the NavSentinel event log from chrome.storage.local
 * via the service worker.
 */
async function extractEventLog(context) {
  const sw = await getServiceWorker(context);
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
  const sw = await getServiceWorker(context);
  await sw.evaluate(async (key) => {
    await chrome.storage.local.set({ [key]: [] });
  }, EVENT_LOG_KEY);
}

/**
 * Visit a site and perform basic interactions.
 * Returns { events, error } where events is the NavSentinel event log
 * entries that occurred during the visit.
 *
 * Wraps the inner logic in an overall timeout (4x the per-navigation
 * timeout) so a single slow site cannot stall the entire run.
 *
 * Uses a shared `pageRef` so the timeout handler can close any orphaned
 * page — without this, a timed-out visitSiteInner would leave a zombie
 * page navigating in the background.
 */
async function visitSite(context, domain, timeoutMs) {
  const overallTimeout = timeoutMs * 4; // homepage + up to 3 subpages
  const url = `https://${domain}`;

  // Shared reference so the timeout handler can close orphaned pages
  const pageRef = { page: null };
  let timerId;

  const raceTimeout = new Promise((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`Overall site timeout after ${overallTimeout}ms`)),
      overallTimeout
    );
    // Allow the timer to not keep the process alive
    if (timerId.unref) timerId.unref();
  });

  try {
    return await Promise.race([visitSiteInner(context, domain, url, timeoutMs, pageRef), raceTimeout]);
  } catch (err) {
    // Close any orphaned page left by visitSiteInner when the timeout won
    if (pageRef.page) {
      try { await pageRef.page.close(); } catch { /* already closed */ }
    }
    return { url, events: [], error: err.message };
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Inner implementation for visitSite (no overall timeout guard).
 * Accepts pageRef to share the page handle with the outer timeout guard.
 */
async function visitSiteInner(context, domain, url, timeoutMs, pageRef) {
  let page;

  try {
    // Clear event log before visiting
    await clearEventLog(context);

    page = await context.newPage();
    pageRef.page = page; // expose to the outer timeout handler

    // Auto-dismiss any JavaScript dialogs (alert, confirm, beforeunload, prompt).
    // Many top-1000 sites show cookie consent or notification dialogs that would
    // otherwise block navigation and page.close().
    page.on("dialog", async (dialog) => {
      try { await dialog.dismiss(); } catch { /* already dismissed */ }
    });

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

    // Capture events from the initial page.goto() redirect chain.
    // page.goto() uses CDP Page.navigate which may not produce Chrome's
    // "typed" transitionType consistently.  When the site performs
    // cross-domain redirects (e.g. live.com → outlook.live.com →
    // microsoft.com), the rollback guard can fire because it sees an
    // un-gestured cross-domain navigation.  A real user typing the URL
    // always gets the "typed" transition and is never affected.
    // We record these as "initial_load" rather than counting them toward
    // the FP rate, and clear the log before measuring interactions.
    const initialLoadEvents = await extractEventLog(context);
    await clearEventLog(context);

    // Perform basic interactions: scroll
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
      await page.waitForTimeout(500);
    } catch {
      // Scroll may fail on some pages, that's OK
    }

    // Click up to 3 internal links by actually clicking the <a> elements.
    // Using page.click() instead of page.goto() so that the browser fires
    // real pointer/click events, which lets NavSentinel's gesture-tracking
    // recognise the navigation as user-initiated.  page.goto() bypasses
    // gesture signals and can trigger false rollbacks.
    const clickableLinks = await findClickableInternalLinks(page, domain);
    const linksToClick = clickableLinks.slice(0, 3);

    for (const linkSelector of linksToClick) {
      try {
        await page.click(linkSelector, { timeout: 5000 });
        await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
        await page.waitForTimeout(1500);

        // Scroll on subpage too
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
        await page.waitForTimeout(500);
      } catch {
        // Some links may time out or fail — continue
      }
    }

    // Extract events from user-like interactions (clicks, scrolling)
    const interactionEvents = await extractEventLog(context);

    // Combine both sets: initial_load events are tagged separately
    // so the caller can report them without counting toward FP rate.
    const events = [
      ...initialLoadEvents.map((e) => ({ ...e, _phase: "initial_load" })),
      ...interactionEvents.map((e) => ({ ...e, _phase: "interaction" })),
    ];

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
 * Returns an array of CSS selectors that can be passed to page.click(),
 * so the browser fires real pointer/click events (which NavSentinel's
 * gesture tracking requires to recognise user-initiated navigations).
 *
 * Each link also has target="_self" (or no target) so clicking opens
 * in the same tab rather than a new one.
 */
async function findClickableInternalLinks(page, domain) {
  try {
    return await page.evaluate((targetDomain) => {
      const links = Array.from(document.querySelectorAll("a[href]"));
      const results = [];
      const seen = new Set();

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        try {
          const href = link.getAttribute("href");
          if (!href) continue;
          const url = new URL(href, document.location.href);

          // Must be HTTP(S) and same domain (exact or subdomain match)
          if (url.protocol !== "http:" && url.protocol !== "https:") continue;
          if (url.hostname !== targetDomain && !url.hostname.endsWith("." + targetDomain)) continue;

          // Skip anchors, javascript, and mailto
          if (url.pathname === document.location.pathname && url.hash) continue;

          const normalized = url.origin + url.pathname;
          if (seen.has(normalized)) continue;
          seen.add(normalized);

          // Skip obviously non-page links
          const ext = url.pathname.split(".").pop()?.toLowerCase() ?? "";
          if (["pdf", "zip", "exe", "dmg", "pkg", "tar", "gz", "mp4", "mp3"].includes(ext)) continue;

          // Only follow same-tab links (no target="_blank")
          const target = (link.getAttribute("target") ?? "").toLowerCase();
          if (target === "_blank") continue;

          // Must be visible and reasonably sized
          const rect = link.getBoundingClientRect();
          if (rect.width < 5 || rect.height < 5) continue;

          // Build a unique selector.  We stamp a data attribute so the
          // selector survives DOM mutations between evaluate and click.
          const stamp = `ns-fp-link-${i}`;
          link.setAttribute("data-ns-fp", stamp);
          results.push(`a[data-ns-fp="${stamp}"]`);
        } catch {
          // Invalid URL, skip
        }
      }

      return results.slice(0, 10); // Return more than needed, we'll pick from this
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
  let content = fs.readFileSync(csvPath, "utf-8");

  // Strip UTF-8 BOM if present (written by this script for Excel compat)
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const lines = content.split("\n").slice(1); // skip header
  const domains = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    // Parse the second CSV field (domain) respecting quoted fields.
    // Format: rank,domain,url_visited,...
    // The rank field is always a plain integer, so the first comma is safe.
    const comma = line.indexOf(",");
    if (comma === -1) continue;

    const rest = line.slice(comma + 1);
    let domain;
    if (rest.startsWith('"')) {
      // Quoted field: find the closing quote (handles escaped "" inside)
      const endQuote = rest.indexOf('"', 1);
      domain = endQuote > 1 ? rest.slice(1, endQuote).replace(/""/g, '"') : "";
    } else {
      const nextComma = rest.indexOf(",");
      domain = nextComma !== -1 ? rest.slice(0, nextComma) : rest.trim();
    }

    // Strip leading single-quote from formula-injection defense
    if (domain.startsWith("'")) domain = domain.slice(1);
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
    // UTF-8 BOM for Excel compatibility, then header
    csvStream.write("\uFEFF" + CSV_HEADER + "\n");
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
  let initialLoadFpCount = 0;
  let interrupted = false;
  const startTime = Date.now();

  // Graceful SIGINT: stop the loop but still produce a partial report
  process.on("SIGINT", () => {
    if (interrupted) process.exit(2); // second Ctrl+C forces exit
    console.log("\n\nInterrupted — finishing current site and writing report...");
    interrupted = true;
  });

  console.log(`\nStarting false positive measurement...`);
  console.log(`Output: ${opts.out}\n`);

  // Process each site
  for (let i = 0; i < sites.length; i++) {
    if (interrupted) break;

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
        // NavSentinel fired events — check if any are false positives.
        // Events tagged _phase:"initial_load" came from the page.goto()
        // redirect chain.  page.goto() uses CDP Page.navigate which may
        // not consistently produce Chrome's "typed" transitionType, so
        // cross-domain redirects during initial load can trigger rollback
        // even though a real user (who types the URL or clicks a link)
        // would never see this.  We report them as "initial_load_fp" but
        // do NOT count them toward the FP rate.
        for (const event of result.events) {
          const isFP = FP_EVENT_KINDS.has(event.kind);
          const isInitialLoad = event._phase === "initial_load";

          if (isFP && !isInitialLoad) fpCount++;
          if (isFP && isInitialLoad) initialLoadFpCount++;

          const action = isFP
            ? (isInitialLoad ? "initial_load_fp" : "false_positive")
            : "expected";

          csvStream.write(
            csvRow(
              rank,
              domain,
              result.url,
              action,
              event.kind,
              event.site ?? "",
              event.score ?? "",
              event.reasons ? event.reasons.join("; ") : "",
              isFP && !isInitialLoad ? "yes" : "no",
              ""
            ) + "\n"
          );
        }

        const fpEvents = result.events.filter(
          (e) => FP_EVENT_KINDS.has(e.kind) && e._phase !== "initial_load"
        );
        const initialFpEvents = result.events.filter(
          (e) => FP_EVENT_KINDS.has(e.kind) && e._phase === "initial_load"
        );
        if (fpEvents.length > 0) {
          console.log(`FALSE POSITIVE: ${fpEvents.map((e) => e.kind).join(", ")}`);
        } else if (initialFpEvents.length > 0) {
          console.log(`OK (${initialFpEvents.length} initial-load artifact${initialFpEvents.length > 1 ? "s" : ""} excluded)`);
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
      tested++; // count harness errors in tested total so denominator stays consistent
      console.log(`HARNESS ERROR: ${err.message}`);
    }

    // Periodic progress report every 50 sites
    if (tested > 0 && tested % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (tested / ((Date.now() - startTime) / 1000)).toFixed(1);
      const initNote = initialLoadFpCount > 0 ? `, ${initialLoadFpCount} initial-load artifacts` : "";
      console.log(`\n--- Progress: ${tested} tested, ${errored} errors, ${fpCount} FPs${initNote}, ${elapsed}s elapsed, ${rate} sites/s ---\n`);
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
  const testedSuccessfully = tested - errored;
  const fpRate = testedSuccessfully > 0 ? ((fpCount / testedSuccessfully) * 100).toFixed(3) : "N/A";

  const initLoadNote = initialLoadFpCount > 0
    ? `\n  Initial-load artifacts: ${initialLoadFpCount} (not counted — see methodology)`
    : "";

  console.log(`
════════════════════════════════════════════
  NavSentinel False Positive Report
════════════════════════════════════════════
  Sites tested:      ${tested} (${testedSuccessfully} successful, ${errored} errors)
  Sites skipped:     ${skipped} (resume)
  False positives:   ${fpCount}${initLoadNote}
  FP rate:           ${fpRate}% (of ${testedSuccessfully} successful visits)
  Time elapsed:      ${elapsed}s
  Target:            < 0.1%
────────────────────────────────────────────
  Report: ${opts.out}
════════════════════════════════════════════
`);

  if (fpCount > 0) {
    console.log("False positive details:");
    const csvContent = fs.readFileSync(opts.out, "utf-8");
    const fpLines = csvContent.split("\n").filter((line) => line.includes(",false_positive,") || line.includes(",yes,"));
    for (const line of fpLines.slice(0, 20)) {
      console.log(`  ${line}`);
    }
    if (fpLines.length > 20) {
      console.log(`  ... and ${fpLines.length - 20} more`);
    }
  }

  if (initialLoadFpCount > 0) {
    console.log(`\nInitial-load artifacts (${initialLoadFpCount}) — NOT counted as false positives:`);
    console.log("  These events occurred during the page.goto() redirect chain, which uses");
    console.log("  CDP Page.navigate instead of a real address-bar typed navigation.");
    console.log("  Real users typing URLs are protected by the typed-origin exemption.");
    const csvContent = fs.readFileSync(opts.out, "utf-8");
    const initLines = csvContent.split("\n").filter((line) => line.includes("initial_load_fp"));
    for (const line of initLines.slice(0, 10)) {
      console.log(`  ${line}`);
    }
  }

  // Exit with non-zero if FP rate exceeds target
  const fpRateNum = testedSuccessfully > 0 ? (fpCount / testedSuccessfully) * 100 : 0;
  if (testedSuccessfully === 0) {
    console.log("\nWARN: No sites were successfully tested. Cannot compute FP rate.");
    process.exit(1);
  } else if (fpRateNum > 0.1) {
    console.log(`\nFAIL: FP rate ${fpRate}% exceeds 0.1% target`);
    process.exit(1);
  } else {
    console.log(`\nPASS: FP rate ${fpRate}% is within 0.1% target`);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
