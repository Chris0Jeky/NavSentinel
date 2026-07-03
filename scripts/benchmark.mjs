#!/usr/bin/env node

/**
 * benchmark.mjs — NavSentinel gym-fixture regression benchmark
 *
 * NOTE: despite the "competitive benchmark" label in the roadmap (P2-10), this is a
 * NavSentinel-ONLY regression harness — it has NO Safe-Browsing / competitor arm and
 * does NOT measure additive value over any other tool. Building the competitive
 * comparison arm is tracked by #418; see docs/Project_Roadmap.md P2-10.
 *
 * Launches Chromium with NavSentinel loaded, visits each gym fixture,
 * records whether the extension detected/missed/false-positived each
 * scenario, and outputs a JSON report plus a markdown summary table.
 *
 * First run establishes a baseline; subsequent runs diff against it.
 *
 * Usage:
 *   node scripts/benchmark.mjs [--headed] [--timeout MS] [--baseline path]
 *                               [--out path] [--update-baseline]
 *
 * Options:
 *   --headed           Run browser in headed mode (visible)
 *   --timeout MS       Per-fixture timeout in ms (default: 20000)
 *   --baseline path    Path to baseline JSON (default: scripts/benchmark-baseline.json)
 *   --out path         Output directory (default: tests/benchmark-results/)
 *   --update-baseline  Overwrite the baseline with this run's results
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";

// ── Constants ──────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXTENSION_PATH = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(ROOT, "extension", "dist");
const GYM_ROOT = path.resolve(ROOT, "gym");
const RESULTS_DIR = path.resolve(ROOT, "tests", "benchmark-results");
const DEFAULT_BASELINE = path.resolve(ROOT, "scripts", "benchmark-baseline.json");
const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";

// NavSentinel event kinds that indicate a detection
const DETECTION_EVENTS = new Set([
  "nav_blank_prompt",
  "nav_click_block",
  "nav_rollback",
  "nav_reputation_late_warn",
  "cred_submit_prompt",
  "cred_paste_warn",
  "clickfix_detected",
  "mutation_alert",
  "dblclickjack_detected",
  "pushstate_abuse",
]);

// ── Gym fixture corpus ────────────────────────────────────────────
// Each entry maps a fixture file to its category and expected outcome.
// expected: "detect" = attack fixture, "allow" = legit (FP check)

const CORPUS = [
  // Clickjacking
  { file: "level1-basic-opacity.html", category: "clickjacking", expected: "detect", interact: "click:#play" },
  { file: "level2-moving-target.html", category: "clickjacking", expected: "detect", interact: "click:#realBtn" },
  { file: "level3-instant-injection.html", category: "clickjacking", expected: "detect", interact: "click:#target" },
  { file: "level4-visual-mimicry.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },
  { file: "level5-window-open-popunder.html", category: "clickjacking", expected: "detect", interact: "click:#area" },
  { file: "level6-programmatic-click.html", category: "clickjacking", expected: "detect", interact: "click:#real" },

  // Clickjacking FP checks
  { file: "level7-legit-modal-backdrop.html", category: "clickjacking", expected: "allow", interact: "click:#open" },
  { file: "level9-legit-video-overlay.html", category: "clickjacking", expected: "allow", interact: "click:#overlayBtn" },

  // Evasion (clickjacking variants — click the trap overlay)
  { file: "evasion-01-opacity-009.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },
  { file: "evasion-02-size-34pct.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },
  { file: "evasion-03-labeled-overlay.html", category: "clickjacking", expected: "detect", interact: "click:#trap-whitespace" },
  { file: "evasion-04-zindex-9998.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },
  { file: "evasion-05-composite.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },
  { file: "evasion-06-delayed-injection.html", category: "clickjacking", expected: "detect", interact: "wait-then-click:3000:#trap" },
  { file: "evasion-07-pointer-events-none.html", category: "clickjacking", expected: "detect", interact: "click:#legit-link" },
  { file: "evasion-08-clip-path-hidden.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },
  { file: "evasion-09-filter-opacity.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },
  { file: "evasion-10-transform-scale.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },
  { file: "evasion-11-shadow-dom.html", category: "clickjacking", expected: "detect", interact: "click:#trap" },

  // ClickFix / fake CAPTCHA
  { file: "clickfix-01-basic.html", category: "clickfix", expected: "detect", interact: "click:#verify-btn", grantClipboard: true },
  { file: "clickfix-02-instructions.html", category: "clickfix", expected: "detect", interact: "click:#run-check-btn", grantClipboard: true },
  { file: "clickfix-04-winr.html", category: "clickfix", expected: "detect", interact: "click:#verify-btn", grantClipboard: true },

  // ClickFix FP check
  { file: "clickfix-03-legit-captcha.html", category: "clickfix", expected: "allow", interact: "click:#copy-otp-btn", grantClipboard: true },

  // DoubleClickjacking
  { file: "doubleclick-01-basic.html", category: "doubleclickjacking", expected: "detect", interact: "click:#trigger" },
  { file: "doubleclick-02-oauth.html", category: "doubleclickjacking", expected: "detect", interact: "click:#captcha" },
  { file: "doubleclick-04-payment.html", category: "doubleclickjacking", expected: "detect", interact: "click:#payBtn" },

  // DoubleClickjacking FP check
  { file: "doubleclick-03-legit.html", category: "doubleclickjacking", expected: "allow", interact: "dblclick:#dblBtn" },

  // DOM mutation
  { file: "mutation-01-delayed-overlay.html", category: "dom_mutation", expected: "detect", interact: "wait:8000" },
  { file: "mutation-02-form-action-change.html", category: "dom_mutation", expected: "detect", interact: "wait:8000" },
  { file: "mutation-03-password-inject.html", category: "dom_mutation", expected: "detect", interact: "wait:8000" },

  // DOM mutation FP check
  { file: "mutation-04-legit-dynamic.html", category: "dom_mutation", expected: "allow", interact: "wait:6000" },

  // Redirect chains
  { file: "chain-02-shortener.html", category: "redirect_chain", expected: "detect", interact: "click:#startChain" },
  { file: "chain-03-deep.html", category: "redirect_chain", expected: "detect", interact: "click:#startChain" },

  // Redirect chain FP checks
  { file: "chain-01-direct.html", category: "redirect_chain", expected: "allow", interact: "wait:2000" },
  { file: "chain-04-legit-redirect.html", category: "redirect_chain", expected: "allow", interact: "click:#oauthFlow" },

  // PushState abuse
  { file: "pushstate-01-suspicious.html", category: "pushstate", expected: "detect", interact: "click:#trigger" },
  { file: "pushstate-02-rapid-change.html", category: "pushstate", expected: "detect", interact: "click:#trigger" },

  // PushState FP check
  { file: "pushstate-03-legit-spa.html", category: "pushstate", expected: "allow", interact: "click:a.spa-link:nth-child(2)" },

  // Credential theft / phishing content
  { file: "content-fp-01-brand-mismatch.html", category: "credential_theft", expected: "detect", interact: "click:button[type='submit']" },
  { file: "content-fp-02-phishing-kit.html", category: "credential_theft", expected: "detect", interact: "click:button[type='submit']" },

  // Credential FP check
  { file: "content-fp-03-legit-login.html", category: "credential_theft", expected: "allow", interact: "wait:3000" },

  // OAuth flow analysis
  { file: "oauth-02-redirect-hijack.html", category: "credential_theft", expected: "detect", interact: "click:#fake-signin" },
  { file: "oauth-03-consent-opener.html", category: "credential_theft", expected: "detect", interact: "click:#fake-consent" },

  // OAuth FP check
  { file: "oauth-01-normal.html", category: "credential_theft", expected: "allow", interact: "click:#google-signin" },

  // Real-world attack scenarios
  { file: "rw01-search-result-overlay-swap.html", category: "clickjacking", expected: "detect", interact: "click:#rw01Trap" },
  { file: "rw07-fake-reauth-interstitial.html", category: "credential_theft", expected: "detect", interact: "click:#rw07Submit" },
  { file: "rw11-fake-invoice-approval.html", category: "clickjacking", expected: "detect", interact: "click:#rw11Review" },
  { file: "rw13-courier-tracking-login.html", category: "credential_theft", expected: "detect", interact: "click:#rw13Submit" },
  { file: "rw15-bank-security-alert.html", category: "credential_theft", expected: "detect", interact: "click:#rw15Verify" },
  { file: "rw16-fake-document-preview-overlay.html", category: "clickjacking", expected: "detect", interact: "click:#rw16Open" },
  { file: "rw17-media-overlay-hijack.html", category: "clickjacking", expected: "detect", interact: "click:#rw17Play" },
  { file: "rw18-browser-update-warning.html", category: "clickfix", expected: "detect", interact: "click:#rw18Install" },
  { file: "rw19-tech-support-scare.html", category: "clickfix", expected: "detect", interact: "wait:5000" },
];

// ── Argument parsing ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    headed: false,
    timeout: 20_000,
    baseline: DEFAULT_BASELINE,
    out: "",
    updateBaseline: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--headed") {
      opts.headed = true;
    } else if (arg === "--timeout" && args[i + 1]) {
      opts.timeout = parseInt(args[++i], 10);
    } else if (arg === "--baseline" && args[i + 1]) {
      opts.baseline = path.resolve(args[++i]);
    } else if (arg === "--out" && args[i + 1]) {
      opts.out = path.resolve(args[++i]);
    } else if (arg === "--update-baseline") {
      opts.updateBaseline = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/benchmark.mjs [options]

Options:
  --headed            Run browser visibly
  --timeout MS        Per-fixture timeout in ms (default: 20000)
  --baseline PATH     Baseline JSON path (default: scripts/benchmark-baseline.json)
  --out PATH          Output directory (default: tests/benchmark-results/)
  --update-baseline   Overwrite baseline with this run's results
  --help, -h          Show this help`);
      process.exit(0);
    }
  }

  if (!opts.out) {
    opts.out = RESULTS_DIR;
  }

  return opts;
}

// ── Gym server ────────────────────────────────────────────────────

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function startGymServer() {
  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(reqUrl.pathname);
      const rel = pathname === "/" ? "/index.html" : pathname;
      const resolved = path.resolve(GYM_ROOT, `.${rel}`);

      if (!isWithinRoot(GYM_ROOT, resolved)) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      if (ext === ".css") res.setHeader("content-type", "text/css; charset=utf-8");
      else if (ext === ".js") res.setHeader("content-type", "text/javascript; charset=utf-8");
      else res.setHeader("content-type", "text/html; charset=utf-8");

      const delayMs = Number(reqUrl.searchParams.get("delayMs") ?? "0");
      if (Number.isFinite(delayMs) && delayMs > 0) {
        setTimeout(() => {
          res.statusCode = 200;
          res.end(fs.readFileSync(resolved));
        }, delayMs);
        return;
      }

      res.statusCode = 200;
      res.end(fs.readFileSync(resolved));
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  const PORT_START = 47000;
  const PORT_ATTEMPTS = 25;

  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const port = PORT_START + attempt;
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => { server.off("listening", onListening); reject(err); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
      const addr = server.address();
      return {
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((resolve) => server.close(() => resolve())),
      };
    } catch {
      // Port busy, try next
    }
  }

  throw new Error("Failed to bind gym server to a local port");
}

// ── Browser helpers ───────────────────────────────────────────────

async function getServiceWorker(context, timeoutMs = 15_000) {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker", { timeout: timeoutMs });
}

async function extractEventLog(context) {
  const sw = await getServiceWorker(context);
  const log = await sw.evaluate(async (key) => {
    const res = await chrome.storage.local.get(key);
    return Array.isArray(res[key]) ? res[key] : [];
  }, EVENT_LOG_KEY);
  return log;
}

async function clearEventLog(context) {
  const sw = await getServiceWorker(context);
  await sw.evaluate(async (key) => {
    await chrome.storage.local.set({ [key]: [] });
  }, EVENT_LOG_KEY);
}

// ── Toast detection ───────────────────────────────────────────────

async function readToastText(page) {
  return page.evaluate(() => {
    const host = document.querySelector("#__navsentinel_toast_host");
    const body = host?.shadowRoot?.querySelector(".body");
    const text = body?.textContent?.trim();
    return text || null;
  });
}

// ── Fixture runner ────────────────────────────────────────────────

async function runFixture(context, baseUrl, fixture, timeoutMs) {
  const { file, interact, grantClipboard } = fixture;
  const url = `${baseUrl}/${file}`;
  let page;

  try {
    await clearEventLog(context);

    page = await context.newPage();

    // Auto-dismiss JS dialogs
    page.on("dialog", async (dialog) => {
      try { await dialog.dismiss(); } catch { /* already handled */ }
    });

    if (grantClipboard) {
      await context.grantPermissions(["clipboard-write", "clipboard-read"]);
    }

    // Navigate to fixture
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // Wait for NavSentinel bridge to initialize
    try {
      await page.waitForFunction(
        () =>
          document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
          document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1",
        null,
        { timeout: 10_000 }
      );
    } catch {
      // Bridge may not be ready on some pages, continue anyway
    }

    // Small settle delay
    await page.waitForTimeout(1000);

    // Clear event log after page load (ignore initial load events)
    await clearEventLog(context);

    // Perform interaction
    if (interact) {
      await performInteraction(page, context, interact, timeoutMs);
    }

    // Wait for detection to settle
    await page.waitForTimeout(3000);

    // Collect results
    const events = await extractEventLog(context);
    const toastText = await readToastText(page);

    const detectionEvents = events.filter((e) => DETECTION_EVENTS.has(e.kind));
    const detected = detectionEvents.length > 0 || (toastText && /block|warn|suspicious|ClickFix|DO NOT paste|credential/i.test(toastText));

    return {
      file,
      category: fixture.category,
      expected: fixture.expected,
      detected: !!detected,
      events: detectionEvents.map((e) => ({
        kind: e.kind,
        score: e.score,
        reasons: e.reasons,
      })),
      toastText,
      error: null,
    };
  } catch (err) {
    return {
      file,
      category: fixture.category,
      expected: fixture.expected,
      detected: false,
      events: [],
      toastText: null,
      error: err.message,
    };
  } finally {
    if (page) {
      try { await page.close(); } catch { /* already closed */ }
    }
  }
}

async function closeExtraPages(context) {
  const pages = context.pages();
  for (let i = 2; i < pages.length; i++) {
    try { await pages[i].close(); } catch { /* ok */ }
  }
}

async function performInteraction(page, context, interact, timeoutMs) {
  if (interact.startsWith("wait:")) {
    const ms = parseInt(interact.slice(5), 10);
    await page.waitForTimeout(ms);
    return;
  }

  if (interact.startsWith("click:")) {
    const selector = interact.slice(6);
    try {
      const el = page.locator(selector);
      const box = await el.boundingBox({ timeout: 5000 });
      if (box) {
        // Use mouse.click for real pointer events (gesture tracking)
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        // Fallback to page.click if boundingBox fails
        await page.click(selector, { timeout: 5000 });
      }
    } catch {
      // Interaction failed, but we still collect events
    }

    await closeExtraPages(context);
    return;
  }

  if (interact.startsWith("dblclick:")) {
    const selector = interact.slice(9);
    try {
      await page.dblclick(selector, { timeout: 5000 });
    } catch {
      // Interaction failed
    }

    await closeExtraPages(context);
    return;
  }

  if (interact.startsWith("wait-then-click:")) {
    // Format: wait-then-click:<ms>:<selector>
    const parts = interact.slice("wait-then-click:".length);
    const colonIdx = parts.indexOf(":");
    const ms = parseInt(parts.slice(0, colonIdx), 10);
    const selector = parts.slice(colonIdx + 1);
    await page.waitForTimeout(ms);
    try {
      const el = page.locator(selector);
      const box = await el.boundingBox({ timeout: 5000 });
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await page.click(selector, { timeout: 5000 });
      }
    } catch {
      // Element may not exist yet or interaction failed
    }

    await closeExtraPages(context);
    return;
  }
}

// ── Results analysis ──────────────────────────────────────────────

function analyzeResults(results) {
  const categories = {};

  for (const r of results) {
    if (!categories[r.category]) {
      categories[r.category] = { tp: 0, fp: 0, fn: 0, tn: 0, total: 0, errors: 0 };
    }
    const cat = categories[r.category];
    cat.total++;

    if (r.error) {
      cat.errors++;
      continue;
    }

    if (r.expected === "detect") {
      if (r.detected) cat.tp++;
      else cat.fn++;
    } else {
      // expected === "allow"
      if (r.detected) cat.fp++;
      else cat.tn++;
    }
  }

  // Compute rates
  const summary = {};
  for (const [name, cat] of Object.entries(categories)) {
    const tpRate = (cat.tp + cat.fn) > 0 ? cat.tp / (cat.tp + cat.fn) : null;
    const fpRate = (cat.fp + cat.tn) > 0 ? cat.fp / (cat.fp + cat.tn) : null;
    summary[name] = {
      ...cat,
      tpRate: tpRate !== null ? Math.round(tpRate * 10000) / 100 : null,
      fpRate: fpRate !== null ? Math.round(fpRate * 10000) / 100 : null,
    };
  }

  // Overall
  const allTP = results.filter((r) => r.expected === "detect" && r.detected && !r.error).length;
  const allFN = results.filter((r) => r.expected === "detect" && !r.detected && !r.error).length;
  const allFP = results.filter((r) => r.expected === "allow" && r.detected && !r.error).length;
  const allTN = results.filter((r) => r.expected === "allow" && !r.detected && !r.error).length;
  const allErrors = results.filter((r) => r.error).length;
  const overallTP = (allTP + allFN) > 0 ? Math.round((allTP / (allTP + allFN)) * 10000) / 100 : null;
  const overallFP = (allFP + allTN) > 0 ? Math.round((allFP / (allFP + allTN)) * 10000) / 100 : null;

  return {
    categories: summary,
    overall: { tp: allTP, fn: allFN, fp: allFP, tn: allTN, errors: allErrors, tpRate: overallTP, fpRate: overallFP },
  };
}

// ── Baseline comparison ───────────────────────────────────────────

function compareBaseline(analysis, baselinePath) {
  if (!fs.existsSync(baselinePath)) {
    return { hasBaseline: false, regressions: [], improvements: [] };
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
  const regressions = [];
  const improvements = [];
  const thresholds = baseline.thresholds ?? {};

  for (const [cat, data] of Object.entries(analysis.categories)) {
    const thresh = thresholds[cat];
    if (!thresh) continue;

    if (thresh.minTpRate !== undefined && data.tpRate !== null && data.tpRate < thresh.minTpRate) {
      regressions.push({
        category: cat,
        metric: "tpRate",
        expected: thresh.minTpRate,
        actual: data.tpRate,
      });
    }

    if (thresh.maxFpRate !== undefined && data.fpRate !== null && data.fpRate > thresh.maxFpRate) {
      regressions.push({
        category: cat,
        metric: "fpRate",
        expected: thresh.maxFpRate,
        actual: data.fpRate,
      });
    }
  }

  // Check previous results for improvements
  const prevCategories = baseline.lastRun?.categories ?? {};
  for (const [cat, data] of Object.entries(analysis.categories)) {
    const prev = prevCategories[cat];
    if (!prev) continue;

    if (prev.tpRate !== null && data.tpRate !== null && data.tpRate > prev.tpRate) {
      improvements.push({ category: cat, metric: "tpRate", previous: prev.tpRate, current: data.tpRate });
    }
    if (prev.fpRate !== null && data.fpRate !== null && data.fpRate < prev.fpRate) {
      improvements.push({ category: cat, metric: "fpRate", previous: prev.fpRate, current: data.fpRate });
    }
  }

  // Flag categories with high error rates (may mask real regressions)
  for (const [catName, cat] of Object.entries(analysis.categories)) {
    const errorRate = cat.errors / cat.total;
    if (errorRate > 0.2) {
      regressions.push({
        category: catName,
        metric: "errorRate",
        expected: "<=20%",
        actual: `${Math.round(errorRate * 100)}%`,
      });
    }
  }

  return { hasBaseline: true, regressions, improvements };
}

// ── Markdown report ───────────────────────────────────────────────

function generateMarkdown(analysis, comparison, results) {
  const lines = [];
  const stamp = new Date().toISOString();

  lines.push("# NavSentinel Gym-Regression Benchmark Report");
  lines.push("");
  lines.push(`Generated: ${stamp}`);
  lines.push("");

  // Summary table
  lines.push("## Detection Rates by Category");
  lines.push("");
  lines.push("| Category | TP | FN | FP | TN | Errors | TP Rate | FP Rate |");
  lines.push("|----------|---:|---:|---:|---:|-------:|--------:|--------:|");

  for (const [name, data] of Object.entries(analysis.categories)) {
    const tpStr = data.tpRate !== null ? `${data.tpRate}%` : "N/A";
    const fpStr = data.fpRate !== null ? `${data.fpRate}%` : "N/A";
    lines.push(`| ${name} | ${data.tp} | ${data.fn} | ${data.fp} | ${data.tn} | ${data.errors} | ${tpStr} | ${fpStr} |`);
  }

  const ov = analysis.overall;
  const ovTp = ov.tpRate !== null ? `${ov.tpRate}%` : "N/A";
  const ovFp = ov.fpRate !== null ? `${ov.fpRate}%` : "N/A";
  lines.push(`| **Overall** | **${ov.tp}** | **${ov.fn}** | **${ov.fp}** | **${ov.tn}** | **${ov.errors}** | **${ovTp}** | **${ovFp}** |`);
  lines.push("");

  // Baseline comparison
  if (comparison.hasBaseline) {
    if (comparison.regressions.length > 0) {
      lines.push("## Regressions");
      lines.push("");
      for (const r of comparison.regressions) {
        lines.push(`- **${r.category}** ${r.metric}: expected >= ${r.expected}%, got ${r.actual}%`);
      }
      lines.push("");
    }

    if (comparison.improvements.length > 0) {
      lines.push("## Improvements");
      lines.push("");
      for (const imp of comparison.improvements) {
        lines.push(`- **${imp.category}** ${imp.metric}: ${imp.previous}% -> ${imp.current}%`);
      }
      lines.push("");
    }

    if (comparison.regressions.length === 0 && comparison.improvements.length === 0) {
      lines.push("## Baseline Comparison");
      lines.push("");
      lines.push("No changes from baseline.");
      lines.push("");
    }
  } else {
    lines.push("## Baseline");
    lines.push("");
    lines.push("No baseline found. This run establishes the first baseline.");
    lines.push("");
  }

  // Missed detections
  const missed = results.filter((r) => r.expected === "detect" && !r.detected && !r.error);
  if (missed.length > 0) {
    lines.push("## Missed Detections (False Negatives)");
    lines.push("");
    for (const m of missed) {
      lines.push(`- \`${m.file}\` (${m.category})`);
    }
    lines.push("");
  }

  // False positives
  const fps = results.filter((r) => r.expected === "allow" && r.detected && !r.error);
  if (fps.length > 0) {
    lines.push("## False Positives");
    lines.push("");
    for (const fp of fps) {
      const detail = fp.toastText ? ` — "${fp.toastText}"` : "";
      lines.push(`- \`${fp.file}\` (${fp.category})${detail}`);
    }
    lines.push("");
  }

  // Errors
  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    for (const e of errors) {
      lines.push(`- \`${e.file}\`: ${e.error}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Validate extension build
  if (!fs.existsSync(EXTENSION_PATH)) {
    console.error(`Extension build not found at ${EXTENSION_PATH}`);
    console.error("Run 'npm run build' first.");
    process.exit(1);
  }

  if (!fs.existsSync(path.join(EXTENSION_PATH, "manifest.json"))) {
    console.error(`No manifest.json in ${EXTENSION_PATH} — is the extension built?`);
    process.exit(1);
  }

  // Filter corpus to only include fixtures that exist
  const corpus = CORPUS.filter((f) => {
    const exists = fs.existsSync(path.join(GYM_ROOT, f.file));
    if (!exists) {
      console.warn(`WARN: Fixture not found, skipping: ${f.file}`);
    }
    return exists;
  });

  if (corpus.length === 0) {
    console.error("No gym fixtures found. Check the gym/ directory.");
    process.exit(1);
  }

  // Ensure output directory
  fs.mkdirSync(opts.out, { recursive: true });

  // Start gym server
  const gym = await startGymServer();
  console.log(`Gym server running at ${gym.baseUrl}`);

  // Launch browser
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-bench-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
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
    await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    process.exit(1);
  }

  // Wait for service worker
  try {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15_000 });
    console.log(`NavSentinel service worker ready: ${sw.url()}`);
  } catch (err) {
    console.error(`NavSentinel service worker did not start: ${err.message}`);
    await context.close();
    await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    process.exit(1);
  }

  console.log(`\nRunning benchmark on ${corpus.length} fixtures...\n`);

  const results = [];
  const startTime = Date.now();
  let exitCode = 0;

  try {
  for (let i = 0; i < corpus.length; i++) {
    const fixture = corpus[i];
    const progress = `[${i + 1}/${corpus.length}]`;
    process.stdout.write(`${progress} ${fixture.file} (${fixture.category}, expect: ${fixture.expected})... `);

    const result = await runFixture(context, gym.baseUrl, fixture, opts.timeout);
    results.push(result);

    // Clear clipboard permissions granted for this fixture
    if (fixture.grantClipboard) {
      try { await context.clearPermissions(); } catch { /* ok */ }
    }

    if (result.error) {
      console.log(`ERROR: ${result.error.slice(0, 60)}`);
    } else if (result.expected === "detect" && result.detected) {
      console.log("TP (detected)");
    } else if (result.expected === "detect" && !result.detected) {
      console.log("FN (missed)");
    } else if (result.expected === "allow" && !result.detected) {
      console.log("TN (allowed)");
    } else {
      console.log("FP (false positive)");
    }
  }

  // Analyze
  const analysis = analyzeResults(results);
  const comparison = compareBaseline(analysis, opts.baseline);

  // Write JSON report
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(opts.out, `benchmark-${stamp}.json`);
  const report = {
    timestamp: new Date().toISOString(),
    duration: Math.round((Date.now() - startTime) / 1000),
    fixtureCount: corpus.length,
    analysis,
    comparison,
    results,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");

  // Write markdown summary
  const mdPath = path.join(opts.out, `benchmark-${stamp}.md`);
  const markdown = generateMarkdown(analysis, comparison, results);
  fs.writeFileSync(mdPath, markdown, "utf-8");

  // Update baseline if requested or if none exists (first run)
  if (opts.updateBaseline || !fs.existsSync(opts.baseline)) {
    const baselineData = {
      updatedAt: new Date().toISOString(),
      thresholds: {
        clickjacking: { minTpRate: 80, maxFpRate: 10 },
        clickfix: { minTpRate: 80, maxFpRate: 10 },
        doubleclickjacking: { minTpRate: 80, maxFpRate: 10 },
        dom_mutation: { minTpRate: 80, maxFpRate: 10 },
        redirect_chain: { minTpRate: 60, maxFpRate: 10 },
        pushstate: { minTpRate: 60, maxFpRate: 10 },
        credential_theft: { minTpRate: 50, maxFpRate: 10 },
      },
      lastRun: analysis,
    };
    fs.writeFileSync(opts.baseline, JSON.stringify(baselineData, null, 2), "utf-8");
    console.log(`\nBaseline ${opts.updateBaseline ? "updated" : "established"}: ${opts.baseline}`);
  }

  // Console summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const ov = analysis.overall;
  console.log(`
════════════════════════════════════════════════════
  NavSentinel Gym-Regression Benchmark Report
════════════════════════════════════════════════════
  Fixtures tested:   ${corpus.length}
  Duration:          ${elapsed}s
────────────────────────────────────────────────────
  True positives:    ${ov.tp}
  False negatives:   ${ov.fn}
  False positives:   ${ov.fp}
  True negatives:    ${ov.tn}
  Errors:            ${ov.errors}
────────────────────────────────────────────────────
  Overall TP rate:   ${ov.tpRate !== null ? ov.tpRate + "%" : "N/A"}
  Overall FP rate:   ${ov.fpRate !== null ? ov.fpRate + "%" : "N/A"}
════════════════════════════════════════════════════`);

  // Per-category breakdown
  console.log("\n  Category breakdown:");
  for (const [name, data] of Object.entries(analysis.categories)) {
    const tpStr = data.tpRate !== null ? `${data.tpRate}%` : "N/A";
    const fpStr = data.fpRate !== null ? `${data.fpRate}%` : "N/A";
    console.log(`    ${name.padEnd(20)} TP: ${tpStr.padStart(7)}  FP: ${fpStr.padStart(7)}  (${data.tp}/${data.tp + data.fn} detected)`);
  }

  // Regression warnings
  if (comparison.hasBaseline && comparison.regressions.length > 0) {
    console.log("\n  REGRESSIONS detected:");
    for (const r of comparison.regressions) {
      console.log(`    ${r.category} ${r.metric}: expected >= ${r.expected}%, got ${r.actual}%`);
    }
  }

  console.log(`\n  JSON report: ${jsonPath}`);
  console.log(`  Markdown:    ${mdPath}\n`);

  // Exit code: non-zero if regressions exist
  if (comparison.hasBaseline && comparison.regressions.length > 0) {
    console.log("FAIL: Regressions detected against baseline");
    exitCode = 1;
  } else {
    console.log("PASS: All thresholds met");
  }
  } finally {
    try { await context.close(); } catch { /* ok */ }
    try { await gym.close(); } catch { /* ok */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ok */ }
  }

  if (exitCode) process.exit(exitCode);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
