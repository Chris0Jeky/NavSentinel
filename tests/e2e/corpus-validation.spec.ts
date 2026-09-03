import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import http from "node:http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  classifyCorpusOutcome,
  tallyCorpusOutcomes,
  DETECTION_EVENT_KINDS,
  type ProtectionLevel,
} from "../corpus/corpus_scoring";
import { loadValidatedCorpusManifest } from "../../scripts/corpus-manifest.mjs";

/*
 * Corpus-v2 status (#417):
 *  - DONE (this change): protected-vs-fired scoring. Each page is classified as
 *    `protected` (a pre-harm block/prompt fired), `fired` (only a post-render
 *    `nav_rollback` fired — weaker), or `miss`, via the unit-tested
 *    `classifyCorpusOutcome` (tests/corpus/corpus_scoring.test.ts). "Protected"
 *    is the number that means the user was actually protected.
 *  - STILL PENDING (#417, needs a headed run to validate): pages are still
 *    served from 127.0.0.1 (so domain/cross-site/reputation signals are
 *    neutered) and links/forms are still exercised with synthetic
 *    `dispatchEvent` (isTrusted=false). Real-hostname routing (page.route
 *    returning snapshot bytes for the original URL) + trusted `page.click()` are
 *    the remaining methodology fixes; until they land the absolute rate here is
 *    a floor, not the honest number.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

const corpusDir = path.resolve(__dirname, "..", "corpus");
const snapshotsDir = path.resolve(corpusDir, "snapshots");
const manifestPath = path.resolve(corpusDir, "manifest.json");

const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";

// NavSentinel event kinds that count as a "detection" on a phishing page.
// DETECTION_EVENT_KINDS is imported from ../corpus/corpus_scoring (the union of
// the protected + fired-late kind sets) so the event-log filter and the
// classifier cannot drift apart (#417).

// ── Local snapshot server ──────────────────────────────────────────

interface SnapshotServer {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startSnapshotServer(): Promise<SnapshotServer> {
  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(reqUrl.pathname);
      const filename = pathname.startsWith("/") ? pathname.slice(1) : pathname;

      if (!filename || filename.includes("..") || filename.includes("/")) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      const filepath = path.resolve(snapshotsDir, filename);

      // Safety: ensure we don't escape the snapshots directory
      if (!filepath.startsWith(snapshotsDir)) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      res.setHeader("content-type", "text/html; charset=utf-8");
      // form-action 'self' (not 'none') so that native form submit can reach
      // the local server — needed if the test ever switches from synthetic
      // dispatchEvent to Playwright's page.click() on submit buttons.
      res.setHeader(
        "content-security-policy",
        "default-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'self'; frame-src 'none';"
      );
      res.statusCode = 200;
      res.end(fs.readFileSync(filepath));
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  const PORT_START = 47000;
  const PORT_ATTEMPTS = 25;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const port = PORT_START + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });

      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Failed to bind server");

      return {
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve()))
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Failed to bind snapshot server");
}

// ── Service worker helpers ─────────────────────────────────────────

async function getServiceWorker(
  context: import("@playwright/test").BrowserContext,
  timeoutMs = 15_000
) {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker", { timeout: timeoutMs });
}

async function extractEventLog(context: import("@playwright/test").BrowserContext) {
  const sw = await getServiceWorker(context);
  const log = await sw.evaluate(async (key: string) => {
    const res = await chrome.storage.local.get(key);
    return Array.isArray(res[key]) ? res[key] : [];
  }, EVENT_LOG_KEY);
  return log as Array<{
    kind?: string;
    site?: string;
    score?: number;
    reasons?: string[];
    extra?: { error?: string } | undefined;
  }>;
}

async function clearEventLog(context: import("@playwright/test").BrowserContext) {
  const sw = await getServiceWorker(context);
  await sw.evaluate(async (key: string) => {
    await chrome.storage.local.set({ [key]: [] });
  }, EVENT_LOG_KEY);
}

// ── Manifest types ─────────────────────────────────────────────────

// ── Test result types ──────────────────────────────────────────────

interface PageResult {
  filename: string;
  url: string;
  source: string;
  detected: boolean;
  /** #417: protected (pre-harm block/prompt) vs fired (post-render rollback) vs miss. */
  protection?: ProtectionLevel;
  protectedBy?: string[];
  firedBy?: string[];
  hasPasswordForm?: boolean;
  events: Array<{ kind?: string | undefined; score?: number | undefined }>;
  error?: string | undefined;
}

// ── Main test ──────────────────────────────────────────────────────

test("Phishing corpus validation @corpus", async () => {
  // The extension is an independent build prerequisite. Corpus input itself is
  // never skipped: the loader fails closed with TEST_INVALID on every invalid
  // manifest or snapshot state.
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running corpus tests.");
  const { manifest, entries: testable } = loadValidatedCorpusManifest({ manifestPath, snapshotsDir });

  // Allow plenty of time for the full corpus
  test.setTimeout(testable.length * 30_000 + 60_000);

  const server = await startSnapshotServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-corpus-"));

  const results: PageResult[] = [];

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    try {
      // Wait for service worker to be ready
      await getServiceWorker(context);

      for (const [i, entry] of testable.entries()) {
        const pageUrl = `${server.baseUrl}/${entry.filename}`;

        console.log(`  [${i + 1}/${testable.length}] ${entry.source}: ${entry.url}`);

        try {
          await clearEventLog(context);

          const page = await context.newPage();
          page.on("dialog", (d) => d.dismiss().catch(() => {}));
          try {
            await page.goto(pageUrl, {
              waitUntil: "domcontentloaded",
              timeout: 15_000
            });

            // Wait for NavSentinel to initialize and process the page
            await page.waitForFunction(
              () =>
                document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1",
              null,
              { timeout: 10_000 }
            ).catch(() => {
              // Extension may not inject on all pages; continue anyway
            });

            // Give the extension time to initialize
            await page.waitForTimeout(2000);

            // --- Simulate user interactions to trigger detection ---

            // 1. Try submitting any password form (triggers credential guard)
            // Check for password inputs both inside and outside <form> elements.
            // Many phishing kits place password fields outside forms or create
            // them dynamically, so we search the entire document.
            const hasPasswordForm = await page.evaluate(() => {
              // First check: password inputs inside forms
              const forms = Array.from(document.querySelectorAll("form"));
              const inForm = forms.some(
                (f) => f.querySelector('input[type="password"]') !== null
              );
              if (inForm) return true;
              // Second check: standalone password inputs anywhere in the page
              return document.querySelector('input[type="password"]') !== null;
            });

            if (hasPasswordForm) {
              // Fill a dummy value and attempt form submission.
              // We also dispatch input/change events so that any listeners
              // (credential guard, phishing kit validation) see realistic input.
              await page.evaluate(() => {
                function fillInput(el: HTMLInputElement, value: string): void {
                  el.value = value;
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                }

                // Try forms with password fields first
                const forms = Array.from(document.querySelectorAll("form"));
                for (const form of forms) {
                  const pw = form.querySelector('input[type="password"]') as HTMLInputElement | null;
                  if (pw) {
                    fillInput(pw, "testpassword123");
                    // Also fill any email/text inputs
                    const textInputs = form.querySelectorAll(
                      'input[type="text"], input[type="email"], input:not([type])'
                    );
                    textInputs.forEach((inp) => {
                      const el = inp as HTMLInputElement;
                      // Skip hidden/checkbox/radio inputs
                      const t = (el.type || "text").toLowerCase();
                      if (t === "hidden" || t === "checkbox" || t === "radio" || t === "submit" || t === "button") return;
                      fillInput(el, "test@example.com");
                    });
                    // Dispatch submit event to trigger credential guard
                    form.dispatchEvent(new SubmitEvent("submit", {
                      bubbles: true, cancelable: true
                    }));
                    return; // Only submit the first password form
                  }
                }
                // Fallback: password input outside a form — wrap in a
                // temporary form so the credential guard's submit listener fires.
                const standalonePw = document.querySelector('input[type="password"]') as HTMLInputElement | null;
                if (standalonePw) {
                  fillInput(standalonePw, "testpassword123");
                  let form = standalonePw.closest("form");
                  if (!form) {
                    // Create a temporary wrapper form so SubmitEvent has a
                    // form target that contains a password field, which is
                    // what the credential guard checks via isPasswordForm().
                    form = document.createElement("form");
                    standalonePw.parentElement?.insertBefore(form, standalonePw);
                    form.appendChild(standalonePw);
                  }
                  form.dispatchEvent(new SubmitEvent("submit", {
                    bubbles: true, cancelable: true
                  }));
                }
              });
              // Wait for credential guard to process and fire events
              await page.waitForTimeout(2000);
            }

            // 2. Try clicking the first visible link (triggers navigation guard)
            // Dispatch pointerdown before click so that capture_isolated.ts
            // populates lastDown / downForClick context for NRS scoring.
            const clickedLink = await page.evaluate(() => {
              const links = Array.from(document.querySelectorAll("a[href]"));
              for (const link of links) {
                const el = link as HTMLAnchorElement;
                const href = el.getAttribute("href") || "";
                // Skip anchors, javascript:, and empty hrefs
                if (!href || href === "#" || href.startsWith("javascript:") || href.startsWith("#")) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  const cx = rect.x + rect.width / 2;
                  const cy = rect.y + rect.height / 2;
                  const common = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
                  el.dispatchEvent(new PointerEvent("pointerdown", common));
                  el.dispatchEvent(new MouseEvent("click", common));
                  return true;
                }
              }
              return false;
            });

            if (clickedLink) {
              await page.waitForTimeout(1500);
            }

            // 3. Check for toast notifications (visual detections)
            const toastText = await page.evaluate(() => {
              const host = document.querySelector("#__navsentinel_toast_host");
              const body = host?.shadowRoot?.querySelector(".body");
              return body?.textContent?.trim() ?? null;
            });

            // 4. Check for credential modal
            // The credential modal uses id "__sentinelsuite_cred_modal_host__"
            // and renders an ".overlay" > ".card" structure inside its shadow root.
            const hasCredentialModal = await page.evaluate(() => {
              const host = document.querySelector("#__sentinelsuite_cred_modal_host__");
              if (!host || !host.shadowRoot) return false;
              const overlay = host.shadowRoot.querySelector(".overlay");
              return !!overlay;
            });

            // Check event log for detections
            const events = await extractEventLog(context);
            const detectionEvents = events.filter(
              (e) =>
                e.kind &&
                DETECTION_EVENT_KINDS.has(e.kind) &&
                // #417: a cred_submit_prompt carrying extra.error is the credential
                // guard's fail-open / TOCTOU-error path (credential_guard.ts) — the
                // submission may have been resumed, so it is NOT clean pre-harm
                // protection. Exclude it so it can't inflate the protected rate.
                !(e.kind === "cred_submit_prompt" && e.extra?.error)
            );

            // #417: classify protected (pre-harm block/prompt) vs fired
            // (post-render rollback — weaker) vs miss, rather than a flat boolean.
            const outcome = classifyCorpusOutcome({
              detectionKinds: detectionEvents
                .map((e) => e.kind)
                .filter((k): k is string => typeof k === "string"),
              hadCredentialModal: hasCredentialModal,
              hadToast: toastText !== null && toastText.length > 0,
            });
            const detected = outcome.level !== "miss";

            results.push({
              filename: entry.filename!,
              url: entry.url,
              source: entry.source,
              detected,
              protection: outcome.level,
              protectedBy: outcome.protectedBy,
              firedBy: outcome.firedBy,
              hasPasswordForm,
              events: detectionEvents.map((e) => ({ kind: e.kind, score: e.score }))
            });

            if (outcome.level === "protected") {
              console.log(`    -> PROTECTED (${outcome.protectedBy.join(", ")})`);
            } else if (outcome.level === "fired") {
              console.log(
                `    -> fired-late only (${outcome.firedBy.join(", ")}) — page rendered before rollback`
              );
            } else {
              console.log(`    -> not detected${hasPasswordForm ? " [has password form]" : ""}`);
            }
          } finally {
            await page.close();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.log(`    -> ERROR: ${message}`);
          results.push({
            filename: entry.filename!,
            url: entry.url,
            source: entry.source,
            detected: false,
            events: [],
            error: message
          });
        }
      }
    } finally {
      await context.close();
    }
  } finally {
    await server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  // ── Summary ────────────────────────────────────────────────────

  const tested = results.filter((r) => !r.error);
  const errored = results.filter((r) => r.error);
  const truePositives = tested.filter((r) => r.detected);
  const falseNegatives = tested.filter((r) => !r.detected);
  const detectionRate = tested.length > 0
    ? ((truePositives.length / tested.length) * 100).toFixed(1)
    : "N/A";

  // #417: protected-vs-fired split — "protected" is the number that means the
  // user was actually protected (a pre-harm block/prompt fired); "fired" is the
  // weaker post-render rollback that fired only after the page could have
  // harvested credentials. Report them separately, not as one detection rate.
  const totals = tallyCorpusOutcomes(
    tested.map((r) => ({
      level: (r.protection ?? "miss") as ProtectionLevel,
      protectedBy: r.protectedBy ?? [],
      firedBy: r.firedBy ?? [],
    }))
  );
  const protectedRate = totals.total > 0
    ? ((totals.protected / totals.total) * 100).toFixed(1)
    : "N/A";

  // Break down by pages with password forms (credential-harvesting pages)
  const withPwForm = tested.filter((r) => r.hasPasswordForm);
  const withPwFormDetected = withPwForm.filter((r) => r.detected);
  const pwFormRate = withPwForm.length > 0
    ? ((withPwFormDetected.length / withPwForm.length) * 100).toFixed(1)
    : "N/A";

  const withoutPwForm = tested.filter((r) => !r.hasPasswordForm);
  const withoutPwFormDetected = withoutPwForm.filter((r) => r.detected);
  const noPwFormRate = withoutPwForm.length > 0
    ? ((withoutPwFormDetected.length / withoutPwForm.length) * 100).toFixed(1)
    : "N/A";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`PHISHING CORPUS VALIDATION SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Total in manifest:    ${manifest.entries.length}`);
  console.log(`  Testable snapshots:   ${testable.length}`);
  console.log(`  Successfully tested:  ${tested.length}`);
  console.log(`  Errors:               ${errored.length}`);
  console.log(`  True positives (TP):  ${truePositives.length}`);
  console.log(`  False negatives (FN): ${falseNegatives.length}`);
  console.log(`  Any-signal detection: ${detectionRate}%  (protected+fired — LEGACY, not the honest rate)`);
  console.log(`${"-".repeat(60)}`);
  console.log(`  #417 protected-vs-fired (of ${totals.total} tested):`);
  console.log(`    Protected (pre-harm block/prompt): ${totals.protected} (${protectedRate}%)  <- honest TP rate`);
  console.log(`    Fired-late only (post-render rollback/toast): ${totals.fired}`);
  console.log(`    Miss (no signal): ${totals.miss}`);
  console.log(`${"-".repeat(60)}`);
  console.log(`  Pages with password forms:     ${withPwForm.length}`);
  console.log(`    Detected (credential guard): ${withPwFormDetected.length} (${pwFormRate}%)`);
  console.log(`  Pages without password forms:  ${withoutPwForm.length}`);
  console.log(`    Detected (other signals):    ${withoutPwFormDetected.length} (${noPwFormRate}%)`);
  console.log(`${"=".repeat(60)}`);

  if (falseNegatives.length > 0) {
    console.log(`\nFalse negatives (not detected):`);
    for (const fn of falseNegatives) {
      const marker = fn.hasPasswordForm ? " [password form]" : "";
      console.log(`  [${fn.source}] ${fn.url}${marker}`);
    }
  }

  if (errored.length > 0) {
    console.log(`\nErrors:`);
    for (const e of errored) {
      console.log(`  [${e.source}] ${e.url}: ${e.error}`);
    }
  }

  // Write detailed results alongside the manifest
  const resultsPath = path.resolve(corpusDir, "validation-results.json");
  fs.writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        runDate: new Date().toISOString(),
        summary: {
          totalManifest: manifest.entries.length,
          testable: testable.length,
          tested: tested.length,
          errors: errored.length,
          truePositives: truePositives.length,
          falseNegatives: falseNegatives.length,
          detectionRate: tested.length > 0 ? truePositives.length / tested.length : null,
          // #417: `detectionRate`/`truePositives` are ANY-signal (protected+fired) — the
          // legacy conflated number. The honest TP rate is `protectedRate` below.
          detectionRateBasis: "any-signal (protected+fired); LEGACY — use protectedRate for the honest #417 number",
          pagesWithPasswordForm: withPwForm.length,
          passwordFormDetected: withPwFormDetected.length,
          passwordFormDetectionRate: withPwForm.length > 0 ? withPwFormDetected.length / withPwForm.length : null,
          pagesWithoutPasswordForm: withoutPwForm.length,
          otherDetected: withoutPwFormDetected.length,
          otherDetectionRate: withoutPwForm.length > 0 ? withoutPwFormDetected.length / withoutPwForm.length : null,
          // #417: protected = pre-harm block/prompt (the number that means "user protected");
          // fired = post-render rollback only (weaker); miss = nothing fired.
          protectedVsFired: { protected: totals.protected, fired: totals.fired, miss: totals.miss },
          protectedRate: totals.total > 0 ? totals.protected / totals.total : null,
          methodology:
            "corpus-v2 (#417): protected-vs-fired scoring is live (protected = pre-harm block/prompt; fired = post-render rollback only). STILL PENDING (#417): pages are served from 127.0.0.1 (domain/cross-site/reputation signals neutered) and links/forms use synthetic dispatchEvent (isTrusted=false); real-hostname page.route + trusted page.click() are the remaining methodology fixes, so absolute rates are a floor."
        },
        results
      },
      null,
      2
    ),
    "utf-8"
  );
  console.log(`\nDetailed results written to: ${resultsPath}`);

  // The test passes — it's informational. We don't fail on low detection
  // rate because phishing snapshots served locally may not trigger all
  // NavSentinel heuristics (e.g. cross-origin checks won't fire).
  // The important thing is that the infrastructure works.
  expect(tested.length).toBeGreaterThan(0);
});
