import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertNoToastFor,
  getGymBaseUrl,
  readToastText,
  waitForNavSentinelBridge,
  waitForToastMatch,
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

async function setupSmartPromptGate() {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-smart-gate-"));

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
  } catch (error) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }

  const page = await context.newPage();
  await page.goto(`${baseUrl}/smart-prompt-gate.html`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForNavSentinelBridge(page);

  return {
    page,
    context,
    cleanup: async () => {
      await context.close();
      if (gym) await gym.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

test.describe("Smart prompt gate", () => {
  test("allows same-site low-risk blank anchors without a prompt @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupSmartPromptGate();

    try {
      const popupPromise = context.waitForEvent("page", { timeout: 3000 }).catch(() => null);
      await page.locator("#benign-link").click();
      const popup = await popupPromise;
      const toastText = await readToastText(page);
      const pageUrls = context.pages().map((p) => p.url()).join(", ");

      if (!popup) {
        throw new Error(`Expected same-site blank anchor popup; toast=${toastText ?? "<none>"} pages=${pageUrls}`);
      }
      await popup.waitForLoadState("domcontentloaded", { timeout: 5000 });

      expect(popup.url()).toContain("opened=benign");
      await assertNoToastFor(page, 800);
      await popup.close();
    } finally {
      await cleanup();
    }
  });

  test("preserves block behavior when attack-grade NRS factors are present @regression", async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");

    const { page, context, cleanup } = await setupSmartPromptGate();

    try {
      await context.grantPermissions(["clipboard-write", "clipboard-read"]);
      await page.locator("#arm-clickfix").click();
      await page.locator("#verify-btn").click();
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent === "clickfix-armed",
        null,
        { timeout: 5000 }
      );
      await waitForToastMatch(page, /ClickFix|clipboard|fake.*verification|Do NOT paste/i, 8000);
      await page.evaluate(() => {
        const overlay = document.getElementById("fake-captcha-overlay");
        if (overlay) overlay.style.display = "none";
      });

      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.locator("#risky-link").click();
      const popup = await popupPromise;

      expect(popup, "ClickFix-backed blank anchor should be blocked").toBeNull();
      await waitForToastMatch(page, /Blocked: navigation \+ fake dialog|fake dialog/i, 5000);
    } finally {
      await cleanup();
    }
  });
});
