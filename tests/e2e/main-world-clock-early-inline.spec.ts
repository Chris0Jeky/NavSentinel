import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGymBaseUrl, waitForNavSentinelBridge } from "./extension_test_utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(root, "extension", "dist");

test("MAIN clock survives an early inline Date.now replacement (#877) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { baseUrl, gym } = await getGymBaseUrl(path.join(root, "gym"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-main-clock-"));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/main-world-clock-early-inline.html`, { waitUntil: "domcontentloaded" });
    await waitForNavSentinelBridge(page);
    expect(await page.evaluate(() => Date.now())).toBe(7);
    expect(await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "__navsentinelMainDateNow");
      return { configurable: descriptor?.configurable, writable: descriptor?.writable };
    })).toEqual({ configurable: false, writable: false });
    const before = Date.now();
    await page.evaluate(() => window.open("", "_blank")?.close());
    await expect.poll(() => page.evaluate(() => (window as Window & {
      clockProbeMessages?: Array<{ ts: number }>;
    }).clockProbeMessages?.at(-1)?.ts)).toBeGreaterThan(before - 5_000);
    const observed = await page.evaluate(() => (window as Window & {
      clockProbeMessages?: Array<{ ts: number }>;
    }).clockProbeMessages?.at(-1)?.ts);
    expect(observed).toBeLessThan(Date.now() + 5_000);
  } finally {
    await context?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
