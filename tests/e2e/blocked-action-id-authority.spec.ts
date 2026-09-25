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

test.setTimeout(120_000);

test("blocked actions receive distinct authority IDs under a page-controlled clock and random source (#933) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { baseUrl, gym } = await getGymBaseUrl(path.join(root, "gym"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-action-id-"));
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/main-world-blocked-action-id-collision.html`, {
      waitUntil: "domcontentloaded",
    });
    await waitForNavSentinelBridge(page);

    expect(await page.evaluate(() => Date.now())).toBe(7);
    expect(await page.evaluate(() => Math.random())).toBe(0);

    await page.evaluate(() => {
      window.open("https://first.example.invalid/benign", "_blank");
      window.open("https://second.example.invalid/adversarial", "_blank");
    });

    await expect.poll(
      () => page.evaluate(() => (window as Window & {
        blockedActionIdProbe?: Array<{ id: string; url?: string; kind?: string }>;
      }).blockedActionIdProbe?.length ?? 0),
      { timeout: 10_000 },
    ).toBeGreaterThanOrEqual(2);

    const messages = await page.evaluate(() => (window as Window & {
      blockedActionIdProbe?: Array<{ id: string; url?: string; kind?: string }>;
    }).blockedActionIdProbe?.slice(0, 2) ?? []);

    expect(messages.map((message) => message.url)).toEqual([
      "https://first.example.invalid/benign",
      "https://second.example.invalid/adversarial",
    ]);
    expect(new Set(messages.map((message) => message.id)).size).toBe(2);
  } finally {
    await context?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
