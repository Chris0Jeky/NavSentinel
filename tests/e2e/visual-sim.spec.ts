import { expect, test, chromium } from "@playwright/test";
import type { BrowserContext, Worker } from "@playwright/test";
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

/**
 * The shipped brand templates are deterministic placeholders (see
 * scripts/build-brand-templates.mjs), so a captured gym page never MATCHES a
 * brand. These E2E tests therefore verify the two browser-level guarantees that
 * unit tests (which mock chrome.runtime) cannot: (1) the capture -> service
 * worker round trip actually fires when a password field appears, including the
 * delayed / multi-step path, and only then; and (2) the pipeline runs on a
 * benign brand-style login page without throwing and without any spurious
 * intervention. A true-positive ("spoof page scores -> blocks") E2E requires
 * real perceptual brand templates and is tracked as the P4-01c follow-up.
 */

/**
 * Patch `chrome.tabs.captureVisibleTab` in the service worker to record that a
 * capture was attempted. That API has exactly one caller (the
 * `ns-capture-viewport` handler in sw.ts), reachable only from the visual-sim
 * pipeline, so a tripped flag uniquely proves that pipeline ran end to end.
 *
 * The flag is set BEFORE delegating to the original, so it records a genuine
 * capture attempt even when the underlying capture errors (e.g. a non-focused
 * window under parallel runs). It is mirrored to storage.session so it survives
 * a possible service-worker eviction between the capture and the assertion poll.
 * Installed before the page navigates, so it is always in place before any
 * capture can occur.
 */
async function installCaptureSpy(sw: Worker): Promise<void> {
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
}

function captureSeen(sw: Worker): Promise<boolean> {
  return sw.evaluate(async () => {
    const r = await chrome.storage.session.get("__nsCaptureSeen");
    return r.__nsCaptureSeen === true;
  });
}

test("visual-sim capture fires only after a delayed password field appears @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-vsim-e2e-"));
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    // Install the spy before the page exists so it is in place before any
    // capture can occur (no load-time race, survives an early SW eviction).
    const sw = await getServiceWorker(context);
    await installCaptureSpy(sw);

    const page = await context.newPage();
    await page.goto(`${baseUrl}/visual-sim-02-delayed-password.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    // No password field exists at load, so the load-time check arms the
    // waitForPasswordFieldThenRun observer rather than capturing. Allow the
    // stability window to elapse, then confirm nothing was captured yet: this
    // proves the pipeline waits for the password field instead of firing eagerly.
    await page.waitForTimeout(800);
    expect(await captureSeen(sw), "captured before the password field appeared").toBe(false);

    // Inject the password step -> the observer fires runVisualSimCheck ->
    // waitForStability -> viewport capture via the service worker.
    await page.click("#nextBtn");
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 4000 });

    await expect
      .poll(() => captureSeen(sw), {
        timeout: 10_000,
        message: "visual-sim viewport capture was never requested after the password field appeared"
      })
      .toBe(true);

    // Placeholder templates cannot match, so no visual-sim intervention.
    await assertNoToastFor(page);
  } finally {
    if (context) await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("visual-sim runs without error or false positive on a benign brand-style login page @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-vsim-e2e-"));
  let context: BrowserContext | null = null;
  const pageErrors: string[] = [];

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    const sw = await getServiceWorker(context);
    await installCaptureSpy(sw);

    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(`${baseUrl}/visual-sim-01-brand-login.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    // The password field is present at load, so the visual-sim pipeline runs
    // immediately. Confirm it executed end to end (capture attempted) and then
    // produced no intervention and no page error on this benign login page.
    await expect
      .poll(() => captureSeen(sw), {
        timeout: 10_000,
        message: "visual-sim never ran on the benign login page"
      })
      .toBe(true);

    await assertNoToastFor(page);
    expect(pageErrors, "page threw while visual-sim ran").toEqual([]);
  } finally {
    if (context) await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
