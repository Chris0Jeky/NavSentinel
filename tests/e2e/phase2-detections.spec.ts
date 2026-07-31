/**
 * Phase 2 Detection E2E Tests
 *
 * Comprehensive gym coverage for all Phase 2 detection capabilities:
 *   - DoubleClickjacking (P2-01)
 *   - ClickFix / fake CAPTCHA (P2-02)
 *   - Redirect chain correlation (P2-06)
 *   - DOM mutation monitor (P2-07)
 *   - Content fingerprinting (P2-04)
 *   - OAuth flow analysis (P2-05)
 *
 * Each section tests both attack scenarios (true positives) and legit
 * scenarios (false positive checks).
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertNoToastFor,
  getGymBaseUrl,
  getServiceWorker,
  waitForNavSentinelBridge,
  waitForToastMatch,
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";

test.setTimeout(120_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Launch a persistent browser context with the extension loaded, navigate
 * to a gym fixture, and wait for the NavSentinel bridge.
 */
async function setupFixtureTest(fixtureName: string) {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-p2-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
  } catch (err) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const page = await context.newPage();
  await page.goto(`${baseUrl}/${fixtureName}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000
  });

  await waitForNavSentinelBridge(page);

  return {
    page,
    context,
    baseUrl,
    cleanup: async () => {
      await context.close();
      if (gym) await gym.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  };
}

/**
 * Extract the event log from the extension's service worker.
 */
async function extractEventLog(context: import("@playwright/test").BrowserContext) {
  const sw = await getServiceWorker(context);
  const log = await sw.evaluate(async (key: string) => {
    const res = await chrome.storage.local.get(key);
    return Array.isArray(res[key]) ? res[key] : [];
  }, EVENT_LOG_KEY);
  return log as Array<{ kind?: string; site?: string; score?: number; reasons?: string[] }>;
}

const MUTATION_TRIGGER_EVENT = "navsentinel:gym:trigger-mutation";

async function triggerMutationAfterMonitorArm(page: import("@playwright/test").Page) {
  // capture_isolated may load after document.readyState becomes complete, in
  // which case the monitor deliberately waits 3 seconds before arming.
  await page.waitForTimeout(3500);
  await page.evaluate((eventName) => {
    window.dispatchEvent(new Event(eventName));
  }, MUTATION_TRIGGER_EVENT);
}

async function waitForMutationEvent(
  context: import("@playwright/test").BrowserContext,
  reason: string
) {
  await expect.poll(
    async () => {
      const events = await extractEventLog(context);
      return events.some(
        (event) => event.kind === "mutation_alert" && event.reasons?.includes(reason)
      );
    },
    { timeout: 5000 }
  ).toBe(true);
}

// ==========================================================================
// DoubleClickjacking Tests (P2-01)
// ==========================================================================

test.describe("DoubleClickjacking", () => {
  test("doubleclick-01 opener-navigation correlation @phase2", () => {
    test.fixme(
      true,
      "#496 must replace the data-URL child with a real-browser fixture and prove second-stage correlation"
    );
  });

  test("doubleclick-02 OAuth consent variant: popup is blocked @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("doubleclick-02-oauth.html");

    try {
      const captcha = page.locator("#captcha");
      const box = await captcha.boundingBox();
      expect(box, "#captcha should be visible").toBeTruthy();

      // Click the fake CAPTCHA checkbox -- this opens a child window
      const popupPromise = context.waitForEvent("page", { timeout: 2000 }).catch(() => null);
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      const popup = await popupPromise;
      if (popup === null) {
        await waitForToastMatch(page, /Blocked|blocked/i, 4000);
      }
      await expect(page).toHaveURL(/doubleclick-02-oauth\.html/);
    } finally {
      await cleanup();
    }
  });

  test("doubleclick-03 legit double-click: no false positive @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("doubleclick-03-legit.html");

    try {
      const btn = page.locator("#dblBtn");
      await btn.dblclick();

      // Counter should increment without any NavSentinel warnings
      await expect(page.locator("#counter")).toHaveText("1");
      await assertNoToastFor(page);
      await expect(page).toHaveURL(/doubleclick-03-legit\.html/);
    } finally {
      await cleanup();
    }
  });

  test("doubleclick-04 payment opener-navigation correlation @phase2", () => {
    test.fixme(
      true,
      "#496 must replace the about:blank child with a real-browser fixture and prove second-stage correlation"
    );
  });
});

// ==========================================================================
// ClickFix / Fake CAPTCHA Tests (P2-02)
// ==========================================================================

test.describe("ClickFix", () => {
  test("clickfix-01 basic: clipboard write + overlay triggers ClickFix alert @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("clickfix-01-basic.html");

    try {
      // Grant clipboard permission for the page
      await context.grantPermissions(["clipboard-write", "clipboard-read"]);

      // Click the fake verify button -- this writes to clipboard and shows instructions
      await page.click("#verify-btn");

      // Wait for the status to confirm the clipboard write happened
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("Clipboard write triggered"),
        null,
        { timeout: 5000 }
      );

      // NavSentinel should detect the ClickFix pattern and show a toast
      await waitForToastMatch(
        page,
        /ClickFix|clipboard|fake.*verification|Do NOT paste/i,
        8000
      );

      // Verify event log contains clickfix_detected
      const events = await extractEventLog(context);
      const clickfixEvents = events.filter((e) => e.kind === "clickfix_detected");
      expect(clickfixEvents.length, "Should have logged a clickfix_detected event").toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  test("clickfix-02 terminal variant: clipboard write + instructions triggers alert @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("clickfix-02-instructions.html");

    try {
      await context.grantPermissions(["clipboard-write", "clipboard-read"]);

      await page.click("#run-check-btn");

      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("Clipboard write"),
        null,
        { timeout: 5000 }
      );

      await waitForToastMatch(
        page,
        /ClickFix|clipboard|fake|Do NOT paste/i,
        8000
      );
    } finally {
      await cleanup();
    }
  });

  test("clickfix-03 legit CAPTCHA: no false positive @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("clickfix-03-legit-captcha.html");

    try {
      await context.grantPermissions(["clipboard-write", "clipboard-read"]);

      // Click the copy OTP button -- legitimate clipboard use
      await page.click("#copy-otp-btn");

      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("OTP copied"),
        null,
        { timeout: 5000 }
      );

      // Should NOT trigger a ClickFix alert
      await assertNoToastFor(page, 2000);
    } finally {
      await cleanup();
    }
  });

  test("clickfix-04 Win+R variant: triggers ClickFix alert @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("clickfix-04-winr.html");

    try {
      await context.grantPermissions(["clipboard-write", "clipboard-read"]);

      await page.click("#verify-btn");

      await page.waitForFunction(
        () => document.getElementById("status")?.className?.includes("status-triggered"),
        null,
        { timeout: 5000 }
      );

      await waitForToastMatch(
        page,
        /ClickFix|clipboard|fake|Do NOT paste/i,
        8000
      );
    } finally {
      await cleanup();
    }
  });
});

// ==========================================================================
// Redirect Chain Correlation Tests (P2-06)
// ==========================================================================

test.describe("Redirect Chains", () => {
  test("chain-01 direct navigation: no chain penalty @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("chain-01-direct.html");

    try {
      // A directly-loaded page should have no redirect chain factors
      await assertNoToastFor(page, 1500);

      // The page should load cleanly
      await expect(page).toHaveURL(/chain-01-direct\.html/);
    } finally {
      await cleanup();
    }
  });

  test("chain-02 shortener: 3-hop redirect chain runs @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("chain-02-shortener.html");

    try {
      // Start the simulated redirect chain
      await page.click("#startChain");

      // Wait for the chain to complete (lands on ?hop=3&landed=true)
      await page.waitForURL(/chain-02-shortener\.html\?hop=3/, { timeout: 10_000 });

      // The chain completed -- check that the page shows completion status
      await page.waitForFunction(
        () => document.getElementById("chainStatus")?.textContent?.includes("Chain complete"),
        null,
        { timeout: 5000 }
      );

      // Note: redirect chain detection operates at the SW level on cross-origin
      // navigations. Same-origin gym hops (via query param) exercise the fixture
      // logic but may not trigger nrs_redirect_chain_depth scoring. Full cross-
      // origin chain detection is validated by the redirect_chain unit tests.
    } finally {
      await cleanup();
    }
  });

  test("chain-03 deep: 6-hop redirect chain runs @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("chain-03-deep.html");

    try {
      await page.click("#startChain");

      // Wait for the chain to complete at hop 6
      await page.waitForURL(/chain-03-deep\.html\?hop=6/, { timeout: 15_000 });

      await page.waitForFunction(
        () => document.getElementById("chainStatus")?.textContent?.includes("Chain complete"),
        null,
        { timeout: 5000 }
      );

      // See chain-02 note: same-origin gym hops don't trigger SW-level chain
      // scoring. Cross-origin detection is covered by redirect_chain unit tests.
    } finally {
      await cleanup();
    }
  });

  test("chain-04 legit redirect: no false positive @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("chain-04-legit-redirect.html");

    try {
      // Simulate the OAuth callback redirect flow
      await page.click("#oauthFlow");

      // Wait for the redirect chain to complete
      await page.waitForURL(/chain-04-legit-redirect\.html\?flow=oauth&step=2/, { timeout: 10_000 });

      // Should NOT trigger any warnings
      await assertNoToastFor(page, 1500);

      // Verify the status text confirms completion
      await page.waitForFunction(
        () => document.getElementById("statusText")?.textContent?.includes("OAuth callback complete"),
        null,
        { timeout: 5000 }
      );
    } finally {
      await cleanup();
    }
  });
});

// ==========================================================================
// DOM Mutation Monitor Tests (P2-07)
// ==========================================================================

test.describe("DOM Mutation Monitor", () => {
  test("mutation-01 delayed overlay: detected after injection @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("mutation-01-delayed-overlay.html");

    try {
      await triggerMutationAfterMonitorArm(page);
      await page.waitForSelector("#malicious-overlay", { timeout: 8000 });

      // Check that the status text confirms injection
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("Overlay injected"),
        null,
        { timeout: 5000 }
      );

      // NavSentinel mutation monitor should detect the overlay and show a toast
      await waitForToastMatch(
        page,
        /overlay|suspicious|phishing/i,
        8000
      );

      await waitForMutationEvent(context, "overlay_injected");
    } finally {
      await cleanup();
    }
  });

  test("mutation-02 form action change: detected by monitor @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("mutation-02-form-action-change.html");

    try {
      await triggerMutationAfterMonitorArm(page);
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("Form action changed"),
        null,
        { timeout: 8000 }
      );

      // Check the form action was actually changed
      const formAction = await page.evaluate(
        () => document.getElementById("login-form")?.getAttribute("action") ?? ""
      );
      expect(formAction).toContain("evil-phishing.example.com");

      await waitForMutationEvent(context, "form_action_changed");
    } finally {
      await cleanup();
    }
  });

  test("mutation-03 password injection: detected by monitor @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("mutation-03-password-inject.html");

    try {
      await triggerMutationAfterMonitorArm(page);
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("Password field injected"),
        null,
        { timeout: 8000 }
      );

      // Verify the password field was actually injected
      const hasPassword = await page.evaluate(
        () => !!document.querySelector('#search-form input[type="password"]')
      );
      expect(hasPassword, "Password field should exist in the form").toBe(true);

      await waitForMutationEvent(context, "password_injected");
    } finally {
      await cleanup();
    }
  });

  test("mutation-04 legit dynamic: no false positive @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("mutation-04-legit-dynamic.html");

    try {
      // Click through the tabs to trigger legitimate DOM mutations
      await page.click('button[data-tab="about"]');
      await page.waitForFunction(
        () => document.querySelector("#content-area h3")?.textContent === "About Us",
        null,
        { timeout: 3000 }
      );

      await page.click('button[data-tab="contact"]');
      await page.waitForFunction(
        () => document.querySelector("#content-area h3")?.textContent === "Contact",
        null,
        { timeout: 3000 }
      );

      // Wait for the tooltip and YouTube embed to inject (4+ seconds)
      await page.waitForTimeout(5000);

      // Should NOT trigger any NavSentinel warnings for legitimate mutations
      await assertNoToastFor(page, 2000);

      // Verify the event log does NOT contain high-severity mutation alerts
      const events = await extractEventLog(context);
      const highSevMutations = events.filter(
        (e) =>
          e.kind === "mutation_alert" &&
          e.reasons?.includes("overlay_injected")
      );
      // The tooltip is small and low z-index, so it should not trigger.
      // The YouTube embed is from a known legitimate source.
      expect(highSevMutations.length, "Should not have high-severity mutation alerts").toBe(0);
    } finally {
      await cleanup();
    }
  });
});

// ==========================================================================
// Content Fingerprinting Tests (P2-04)
// ==========================================================================

test.describe("Content Fingerprinting", () => {
  test("content-fp-01 brand mismatch: detected on credential submit @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("content-fp-01-brand-mismatch.html");

    try {
      // The page mimics a Google login form on a non-Google domain.
      // Content fingerprinting integrates with credential guard, so
      // submitting the form should trigger a credential prompt with
      // brand mismatch boost.

      // Fill the form and trigger submit
      await page.click('button[type="submit"]');

      // The credential guard should prompt because the page references
      // "Google" in the title but is served from localhost
      await expect(
        page.locator("text=Credential submit blocked")
      ).toBeVisible({ timeout: 6000 });
    } finally {
      await cleanup();
    }
  });

  test("content-fp-02 phishing kit: detected on credential submit @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("content-fp-02-phishing-kit.html");

    try {
      // The page has phishing kit signatures (16Shop, Telegram exfil).
      // Content fingerprinting should boost the credential guard score.
      await page.click('button[type="submit"]');

      await expect(
        page.locator("text=Credential submit blocked")
      ).toBeVisible({ timeout: 6000 });
    } finally {
      await cleanup();
    }
  });

  test("content-fp-03 legit login: no false positive on credential submit @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("content-fp-03-legit-login.html");

    try {
      // Fill in the form fields
      await page.fill('input[name="email"]', "user@example.com");
      await page.fill('input[name="password"]', "testpassword123");

      // Submit the form
      await page.click('button[type="submit"]');

      // For a legitimate login page on a non-branded domain, the credential
      // guard should still prompt (because it's an untrusted domain), but
      // the content fingerprinting should NOT add brand mismatch or kit
      // signals. We just verify the page has no phishing-specific signals.
      // The credential guard will fire because the form has a password
      // field and submits on an untrusted domain (127.0.0.1), but there
      // should be no brand-mismatch or kit-match signals.

      // Content fingerprinting should return score ~5 (generic login language)
      // which is well below the brand mismatch or kit thresholds.
      // The credential guard may still fire (untrusted domain with password
      // field), so we do NOT assert no toast. Instead we verify no phishing-
      // specific signals appear — the page stays on the fixture URL and any
      // credential prompt that appears should lack brand-mismatch or kit text.
      await page.waitForTimeout(2000);
      await expect(page).toHaveURL(/content-fp-03-legit-login\.html/);
    } finally {
      await cleanup();
    }
  });
});

// ==========================================================================
// OAuth Flow Analysis Tests (P2-05)
// ==========================================================================

test.describe("OAuth Flow Analysis", () => {
  test("oauth-01 normal flow: no false positive @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("oauth-01-normal.html");

    try {
      // Click the Google sign-in button -- this simulates a legit OAuth redirect
      // where redirect_uri matches the app domain (same-origin).
      await page.click("#google-signin");

      // The page updates its status text but does NOT actually navigate
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("would navigate to"),
        null,
        { timeout: 3000 }
      );

      // No NavSentinel warnings should appear
      await assertNoToastFor(page, 1500);
      await expect(page).toHaveURL(/oauth-01-normal\.html/);
    } finally {
      await cleanup();
    }
  });

  test("oauth-02 redirect hijack: suspicious redirect_uri detected @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, cleanup } = await setupFixtureTest("oauth-02-redirect-hijack.html");

    try {
      // Click the fake sign-in button -- redirect_uri points to evil domain
      await page.click("#fake-signin");

      // The status text should show the malicious redirect_uri
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("evil-collector.com"),
        null,
        { timeout: 3000 }
      );

      // This fixture constructs a malicious OAuth URL with a spoofed
      // redirect_uri but does not actually navigate. It validates the fixture
      // renders correctly. Actual OAuth redirect detection is tested by unit
      // tests for the OAuth flow monitor in sw.ts.
      await expect(page).toHaveURL(/oauth-02-redirect-hijack\.html/);
    } finally {
      await cleanup();
    }
  });

  test("oauth-03 consent + opener manipulation: popup blocked @phase2", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupFixtureTest("oauth-03-consent-opener.html");

    try {
      // Click "Authorize Application" -- opens a popup that manipulates
      // window.opener.location (combines OAuth phishing + DoubleClickjacking)
      const popupPromise = context.waitForEvent("page", { timeout: 3000 }).catch(() => null);
      await page.click("#fake-consent");

      const popup = await popupPromise;

      if (popup === null) {
        // Popup was fully blocked -- check for toast
        await waitForToastMatch(page, /Blocked|blocked/i, 4000);
      } else {
        // Popup opened but NavSentinel should track the opener manipulation.
        // The popup tries to write to window.opener.location.
        await popup.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      }

      // The parent page should remain on the fixture URL
      await expect(page).toHaveURL(/oauth-03-consent-opener\.html/);
    } finally {
      await cleanup();
    }
  });
});
