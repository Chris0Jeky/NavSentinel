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
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/level1-basic-opacity.html`);

  const popupPromise = page.waitForEvent("popup", { timeout: 1500 }).catch(() => null);
  await page.click("#play");

  const popup = await popupPromise;
  expect(popup).toBeNull();

  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});
