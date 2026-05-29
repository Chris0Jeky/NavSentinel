import { expect, test, chromium } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertNoToastFor,
  getGymBaseUrl,
  getServiceWorker,
  waitForNavSentinelBridge
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

async function launchExtensionContext(): Promise<{ context: BrowserContext; userDataDir: string }> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-vsim-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    timeout: 60_000,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  return { context, userDataDir };
}

/**
 * The shipped brand templates are deterministic placeholders (see
 * scripts/build-brand-templates.mjs), so a captured gym page never MATCHES a
 * brand. These E2E tests therefore verify the two browser-level guarantees that
 * unit tests (which mock chrome.runtime) cannot: (1) the capture -> SW round
 * trip actually fires when a password field appears, including the delayed /
 * multi-step path; and (2) a benign brand-style login page produces no
 * visual-sim error and no spurious intervention. A true-positive ("spoof page
 * scores -> blocks") E2E requires real perceptual brand templates and is
 * tracked as the P4-01c follow-up.
 */

test("visual-sim capture pipeline fires when a delayed password field appears @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const { context, userDataDir } = await launchExtensionContext();

  try {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/visual-sim-02-delayed-password.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    // No password field exists yet, so the load-time visual-sim check arms the
    // delayed-password observer instead of capturing. Install the capture spy
    // BEFORE injecting the field so the resulting capture is observed without a
    // load-time race. The flag is mirrored to storage.session so it survives a
    // service-worker eviction between the capture and the assertion poll.
    const sw = await getServiceWorker(context);
    await sw.evaluate(async () => {
      await chrome.storage.session.set({ __nsCaptureSeen: false });
      const tabsApi = chrome.tabs as unknown as {
        captureVisibleTab: (...args: unknown[]) => unknown;
      };
      const orig = tabsApi.captureVisibleTab.bind(chrome.tabs);
      tabsApi.captureVisibleTab = (...args: unknown[]) => {
        void chrome.storage.session.set({ __nsCaptureSeen: true });
        return orig(...args);
      };
    });

    // Inject the password step. This fires the content script's
    // waitForPasswordFieldThenRun observer -> runVisualSimCheck -> viewport
    // capture via the service worker.
    await page.click("#nextBtn");
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 4000 });

    await expect
      .poll(
        async () => {
          const stored = await sw.evaluate(async () => {
            const r = await chrome.storage.session.get("__nsCaptureSeen");
            return r.__nsCaptureSeen === true;
          });
          return stored;
        },
        { timeout: 10_000, message: "visual-sim viewport capture was never requested" }
      )
      .toBe(true);

    // The placeholder templates cannot match, so no visual-sim intervention.
    await assertNoToastFor(page);
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("visual-sim does not error or false-positive on a benign brand-style login page @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const { context, userDataDir } = await launchExtensionContext();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  try {
    const page = await context.newPage();
    page.on("console", (msg) => {
      const text = msg.text();
      // The only visual-sim failure path logs this prefix; treat it as a defect.
      if (text.includes("Visual similarity check failed")) {
        consoleErrors.push(text);
      }
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`${baseUrl}/visual-sim-01-brand-login.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    // Give the load-time visual-sim check time to run end to end: template load
    // + stability wait (500ms) + capture + hash + compare.
    await assertNoToastFor(page, 2500);

    expect(consoleErrors, "visual-sim logged a failure on a benign login page").toEqual([]);
    expect(pageErrors, "page threw while visual-sim ran").toEqual([]);
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
