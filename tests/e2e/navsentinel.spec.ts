import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import * as http from "node:http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

async function startGymServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const gymRoot = path.resolve(__dirname, "..", "..", "gym");

  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(reqUrl.pathname);
      const rel = pathname === "/" ? "/index.html" : pathname;

      const resolved = path.resolve(gymRoot, `.${rel}`);
      if (!resolved.startsWith(gymRoot)) {
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

      res.statusCode = 200;
      res.end(fs.readFileSync(resolved));
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind Gym server");

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

test.setTimeout(120_000);

test("Level 1 blocks new tabs", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer();
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
      await page.goto(`${baseUrl}/level1-basic-opacity.html`, { waitUntil: "domcontentloaded", timeout: 20_000 });

      await expect(
        page.evaluate(() => (window as any).__navsentinelMainGuard === true)
      ).resolves.toBe(true);

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

test("Level 10 delayed form submit prompts", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer();
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

      await expect(
        page.evaluate(() => (window as any).__navsentinelMainGuard === true)
      ).resolves.toBe(true);

      const patchInfo = await page.evaluate(() => (window as any).__navsentinelLocationPatch);
      expect(patchInfo, "Expected location patch info").toBeTruthy();
      expect(patchInfo.protoAssign, "Expected Location.prototype.assign to be patched").toBe(true);

      await page.click("#submitDelayed");
      await page.waitForTimeout(2600);
      await expect(page.locator("text=Blocked form submit")).toBeVisible({ timeout: 4000 });
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 10 delayed redirect auto-rolls back and offers proceed", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer();
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

      await page.click("#delayed");
      await page.waitForURL(/level4-visual-mimicry\.html/, { timeout: 7000 });
      await page.waitForURL(/level10-redirects-and-forms\.html/, { timeout: 7000 });
      await page.waitForFunction(() => (window as any).__navsentinelRollbackPrompt, null, {
        timeout: 7000
      });
      await expect(page.locator("text=NavSentinel rolled back a redirect")).toBeVisible({
        timeout: 4000
      });
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Live: Google first result opens with no prompt", async () => {
  test.skip(!process.env.LIVE_E2E, "Set LIVE_E2E=1 to run live web tests.");
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

test("Level 5 blocks window.open popunder", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer();
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

      await page.click("#area");
      await expect(page.locator("text=Blocked popup")).toBeVisible({ timeout: 3000 });
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 6 blocks programmatic click new tab", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gymOverride = process.env.GYM_BASE_URL;
  const gym = gymOverride ? null : await startGymServer();
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

      await page.click("#real");
      await expect(page.locator("text=Blocked new tab")).toBeVisible({ timeout: 3000 });
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
