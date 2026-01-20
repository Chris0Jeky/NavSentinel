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

test("Level 10 delayed redirect prompts", async () => {
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

      await page.click("#delayed");
      await expect(page.locator("text=Blocked redirect")).toBeVisible({ timeout: 4000 });
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
