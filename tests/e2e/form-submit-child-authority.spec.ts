/**
 * #865 authority-binding regressions for the legacy child-form replay.
 *
 * The page gets one legitimate `formdata` phase so it can mutate payload
 * entries. It must not be able to replace any part of the navigation authority
 * that NavSentinel decided to replay: child identity, target name, action,
 * method, encoding, or accepted character set.
 */
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getGymBaseUrl,
  waitForNavSentinelBridge,
  waitForToastText,
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");
const FIXTURE = "form-submit-child-replay.html";
const LANDING = "/form-submit-landing.html";
const BLOCKED = "Blocked form submit";

test.setTimeout(180_000);

async function withExtension(run: (context: BrowserContext, baseUrl: string) => Promise<void>): Promise<void> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-child-authority-"));
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      await run(context, baseUrl);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function openFixture(context: BrowserContext, baseUrl: string, mode: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/${FIXTURE}?mode=${mode}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForNavSentinelBridge(page);
  return page;
}

function childUrls(page: Page): string[] {
  return page.frames().filter((frame) => frame !== page.mainFrame()).map((frame) => frame.url());
}

async function runCase(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Window & { __nsRunFormCase(): void }).__nsRunFormCase();
  });
}

test("formdata cannot replace any component of a child replay authority (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    for (const mode of [
      "retarget-same-child-alias",
      "retarget-action",
      "retarget-method",
      "retarget-enctype",
      "retarget-accept-charset",
    ]) {
      await test.step(mode, async () => {
        const page = await openFixture(context, baseUrl, mode);
        const pagesBefore = context.pages().length;

        await runCase(page);
        await waitForToastText(page, BLOCKED, 3_000);

        expect(new URL(page.url()).pathname).toBe(`/${FIXTURE}`);
        expect(childUrls(page).every((url) => !url.includes(LANDING))).toBe(true);
        expect(context.pages().length, "authority mutation opened no top-level context").toBe(pagesBefore);
        expect(
          await page.evaluate(() => Number(document.documentElement.dataset.formdataCount ?? "0")),
          "the page received only its one legitimate payload-mutation phase",
        ).toBe(1);
        await page.close();
      });
    }
  });
});
