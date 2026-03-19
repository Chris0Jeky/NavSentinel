import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  startGymServer,
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

test("Level 1 blocks new tabs @smoke", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer(gymRoot);
  const baseUrl = gymOverride ?? gym!.baseUrl;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level1-basic-opacity.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const play = page.locator("#play");
      const box = await play.boundingBox();
      expect(box, "#play button should be visible").toBeTruthy();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      await expect(page.locator("text=Blocked new tab")).toBeVisible({ timeout: 3000 });
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 10 delayed form submit prompts @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer(gymRoot);
  const baseUrl = gymOverride ?? gym!.baseUrl;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level10-redirects-and-forms.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const patchInfo = await page.evaluate(() => (window as any).__navsentinelLocationPatch);
      expect(patchInfo, "Expected location patch info").toBeTruthy();
      expect(patchInfo.protoAssign, "Expected Location.prototype.assign to be patched").toBe(true);

      await page.click("#submitDelayed");
      await page.waitForTimeout(2600);
      await waitForToastText(page, "Blocked form submit", 4000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 12 delayed same-tab navigation does not roll back a legitimate click @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer(gymRoot);
  const baseUrl = gymOverride ?? gym!.baseUrl;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level12-slow-same-tab-link.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.click("#slowLink");
      await page.waitForURL(/level4-visual-mimicry\.html\?delayMs=2500/, { timeout: 10_000 });
      await page.waitForTimeout(1200);
      await expect(page.locator("text=NavSentinel rolled back a redirect")).toHaveCount(0);
      await expect(page).toHaveURL(/level4-visual-mimicry\.html\?delayMs=2500/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 10 delayed redirect shows rollback proceed affordance @rollback", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer(gymRoot);
  const baseUrl = gymOverride ?? gym!.baseUrl;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level10-redirects-and-forms.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await page.click("#delayed");
      await page.waitForURL(/level4-visual-mimicry\.html/, { timeout: 7000 });
      await waitForNavSentinelBridge(page, 7000);
      await waitForToastText(page, "NavSentinel rolled back a redirect", 20000);
      await waitForToastText(page, "Proceed", 20000);
      await expect(page).toHaveURL(/level4-visual-mimicry\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Live: Google first result opens with no prompt @live", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto("https://www.google.com/search?q=google", {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      });

      if (page.url().includes("/sorry/")) {
        test.skip(true, "Google anti-bot challenge blocked the live sanity check.");
      }

      const consent = page.getByRole("button", { name: /I agree|Accept all|Accept/i });
      if (await consent.count()) {
        await consent.first().click().catch(() => {});
      }

      const firstResult = page.locator("a h3").first();
      await expect(firstResult).toBeVisible({ timeout: 10_000 });

      const popupPromise = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
      await page.keyboard.down("Control");
      await firstResult.click();
      await page.keyboard.up("Control");

      const popup = await popupPromise;
      expect(popup, "Expected a new tab from ctrl+click").not.toBeNull();
      await expect(page.locator("text=Blocked new tab")).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 5 blocks window.open popunder @smoke", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer(gymRoot);
  const baseUrl = gymOverride ?? gym!.baseUrl;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level5-window-open-popunder.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await page.click("#area");
      await waitForToastText(page, "Blocked popup", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 6 blocks programmatic click new tab @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer(gymRoot);
  const baseUrl = gymOverride ?? gym!.baseUrl;

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level6-programmatic-click.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await page.click("#real");
      await waitForToastText(page, "Blocked new tab", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
