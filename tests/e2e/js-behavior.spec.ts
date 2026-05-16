/**
 * JS Behavior Analysis E2E Tests (P4-02)
 *
 * Verifies the full signal pipeline:
 * main-world monitor → bridge → isolated-world state → NRS scoring
 *
 * Verification strategy: since JS behavior signals accumulate in-memory
 * (no event_log entry until navigation), we verify:
 * 1. The bridge is active (data-navsentinel-bridge-ready)
 * 2. The monitor is loaded (prototype patches exist in main world)
 * 3. After signals fire, page APIs still work correctly (try-catch safety)
 * 4. For the legit form, no toast appears (false-positive check)
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertNoToastFor,
  getGymBaseUrl,
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

async function setupFixtureTest(fixtureName: string) {
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
 * Verify the JS behavior monitor is loaded by checking for patched prototypes.
 * Returns an object indicating which patches are active.
 */
async function verifyMonitorLoaded(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const origSubmit = HTMLFormElement.prototype.submit.toString();
    const formPatched = !origSubmit.includes("[native code]");

    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const getterPatched = desc?.get?.toString().includes("password") === false
      && desc?.get?.toString() !== undefined
      && !desc?.get?.toString().includes("[native code]");

    return { formPatched, getterPatched };
  });
}

/**
 * Verify page APIs still work after signal execution (try-catch safety).
 */
async function verifyPageApisIntact(page: import("@playwright/test").Page) {
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

// ==========================================================================
// JS Behavior - Monitor Loading Verification
// ==========================================================================

test.describe("JS Behavior Analysis", () => {
  test("monitor prototype patches are active on pages with forms @p4", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-01-credential-exfil.html");

    try {
      const patches = await verifyMonitorLoaded(page);
      expect(patches.formPatched).toBe(true);
    } finally {
      await cleanup();
    }
  });

  // ==========================================================================
  // True Positive Tests — verify signals fire without breaking page
  // ==========================================================================

  test("js-behavior-01 cross-origin credential form: signal fires, page intact @p4", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-01-credential-exfil.html");

    try {
      const submitBtn = page.locator("#submit-btn");
      await expect(submitBtn).toBeVisible();
      await submitBtn.click();
      await page.waitForTimeout(500);

      const apis = await verifyPageApisIntact(page);
      expect(apis.formSubmitWorks).toBe(true);
      expect(apis.valueGetterWorks).toBe(true);

      const statusText = await page.locator("#status").textContent();
      expect(statusText).toContain("Form submitted");
    } finally {
      await cleanup();
    }
  });

  test("js-behavior-02 dynamic action change: signal fires, page intact @p4", async () => {
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

  test("js-behavior-03 fetch exfil: monitor intercepts without breaking fetch @p4", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-03-fetch-exfil.html");

    try {
      const submitBtn = page.locator("#submit-btn");
      await expect(submitBtn).toBeVisible();
      await submitBtn.click();
      await page.waitForTimeout(1000);

      // Verify fetch still works (the fixture catches the CORS error gracefully)
      const logText = await page.locator("#log").textContent();
      expect(logText).toContain("fetch");

      // Verify the page's fetch wasn't broken by the monitor
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

  test("js-behavior-04 beacon exfil: sendBeacon fires, monitor detects @p4", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-04-beacon-exfil.html");

    try {
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("sendBeacon fired"),
        null,
        { timeout: 6000 }
      );

      // Verify sendBeacon still works after monitor patch
      const beaconWorks = await page.evaluate(() => {
        try {
          return navigator.sendBeacon("data:text/plain,test", "ok");
        } catch {
          return false;
        }
      });
      expect(beaconWorks).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("js-behavior-05 credential value read: getter patched, page intact @p4", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-05-credential-read.html");

    try {
      await page.waitForFunction(
        () => document.getElementById("status")?.className === "triggered",
        null,
        { timeout: 5000 }
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

  test("js-behavior-06 legitimate form: no toast, no page breakage @p4", async () => {
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

  test("js-behavior-07 multi-signal attack: all APIs survive combined signals @p4", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("js-behavior-07-multi-signal.html");

    try {
      // Wait for phases 1+2 (credential read + action change)
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("Phase 2"),
        null,
        { timeout: 5000 }
      );

      // Phase 3: submit triggers fetch exfil
      const submitBtn = page.locator("#submit-btn");
      await submitBtn.click();
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
    } finally {
      await cleanup();
    }
  });
});
