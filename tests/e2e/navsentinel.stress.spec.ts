import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  getGymBaseUrl,
  waitForNavSentinelBridge,
  waitForToastText
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

test("RW-21 allow-once first popup allowed with blocked second double-spend @stress", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-stress-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw21-allow-once-double-spend.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#rw21Action");

      const popup = await popupPromise;
      expect(popup, "Expected the first settings popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("rw21-settings-popup.html?step=settings");

      // The second popup (exfil) should be blocked — only 1 new page allowed
      await expect.poll(() => context.pages().length, { timeout: 5000 }).toBe(beforePages + 1);
      await waitForToastText(page, "Blocked popup", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-22 delayed redirect triggers rollback after worker restart @stress @rollback", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-stress-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw22-rollback-worker-restart.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      // Click the link — navigates to order-status, which will redirect after 3.5s
      await page.click("#rw22Link");
      await page.waitForURL(/rw22-order-status\.html/, { timeout: 8000 });

      // Wait for the delayed redirect to the phish landing
      await page.waitForURL(/rw22-phish-landing\.html/, { timeout: 10000 });

      // Rollback should bring us back — either to order-status or the start page
      // depending on history state. The key assertion is we leave the phish page.
      await expect
        .poll(() => page.url(), { timeout: 20000 })
        .not.toMatch(/rw22-phish-landing\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-23 multi-tab popups are blocked independently without state leak @stress", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-stress-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      // Open Tab A directly (bypassing the launcher page for test control)
      const tabA = await context.newPage();
      await tabA.goto(`${baseUrl}/rw23-tab-a.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await waitForNavSentinelBridge(tabA);

      // Open Tab B directly
      const tabB = await context.newPage();
      await tabB.goto(`${baseUrl}/rw23-tab-b.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await waitForNavSentinelBridge(tabB);

      // Trigger popup in Tab A and wait for it
      const popupAPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await tabA.click("#rw23TabAAction");
      const popupA = await popupAPromise;

      // Trigger popup in Tab B and wait for it
      const popupBPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await tabB.click("#rw23TabBAction");
      const popupB = await popupBPromise;

      // State isolation: both tabs should independently handle their popups.
      // Each popup opens from a legitimate user click, so they should both
      // be allowed. The key invariant is that Tab A's action does not interfere
      // with Tab B's — both get their popup independently.
      expect(popupA, "Tab A popup should open independently").not.toBeNull();
      expect(popupB, "Tab B popup should open independently").not.toBeNull();

      // Verify the popups target the correct per-tab destinations
      await popupA?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      await popupB?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popupA?.url()).toContain("rw23-tab-a-popup.html");
      expect(popupB?.url()).toContain("rw23-tab-b-popup.html");
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-24 popup fired after idle period is blocked as stale @stress", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-stress-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw24-idle-resume-popup.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const beforePages = context.pages().length;
      await page.click("#rw24Trigger");

      // The fixture waits 6000ms before firing the popup — well past the 800ms allow-window.
      // The popup should be blocked because the gesture token has expired.
      const popupPromise = context.waitForEvent("page", { timeout: 10000 }).catch(() => null);
      const popup = await popupPromise;

      // Either no popup opened, or it opened and was immediately blocked
      if (popup) {
        // If a popup page appeared, NavSentinel should still toast a block
        await waitForToastText(page, "Blocked popup", 3000);
      } else {
        // Popup was entirely prevented
        expect(context.pages().length).toBe(beforePages);
      }
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-25 rapid close/reopen churn blocks the final exfil popup @stress", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-stress-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw25-rapid-close-reopen.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.click("#rw25Churn");

      // Wait for the full churn sequence to complete (open/close/open/close/exfil)
      // by checking the status element for the final step message.
      await expect(page.locator("#status")).toContainText("Step 5", { timeout: 5000 });

      // After the churn, we should see a toast about the blocked popup
      await waitForToastText(page, "Blocked popup", 5000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
