import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

const baseUrl = process.env.GYM_BASE_URL ?? "http://localhost:5173";

test("Level 1 blocks new tabs", async () => {
  test.setTimeout(120_000);
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    timeout: 60_000,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/level1-basic-opacity.html`, { waitUntil: "domcontentloaded", timeout: 10_000 });
  } catch (err) {
    throw new Error(
      `Gym server not reachable at ${baseUrl}. Start it with: cd gym && python -m http.server 5173. (${String(err)})`
    );
  }

  const popupPromise = page.waitForEvent("popup", { timeout: 1500 }).catch(() => null);
  await page.click("#play");

  const popup = await popupPromise;
  expect(popup).toBeNull();

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});
