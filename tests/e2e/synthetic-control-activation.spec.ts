/**
 * Synthetic-activation rejection for extension-owned decision controls (#783).
 *
 * A hostile page shares the DOM with NavSentinel's content scripts and can
 * reach the open shadow roots of the credential modal and the notice toasts.
 * These cases prove that page-synthesized `.click()` input cannot activate
 * those controls (no self-approval, no self-dismiss), while real trusted
 * input still activates them (positive controls).
 */
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  attemptSyntheticModalClick,
  attemptSyntheticToastClick,
  clickModalButton,
  clickToastButton,
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

test.setTimeout(120_000);

async function setupSyntheticTest(pathname: string): Promise<{
  page: Page;
  context: BrowserContext;
  cleanup: () => Promise<void>;
}> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-synthetic-"));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/${pathname}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    return {
      page,
      context,
      cleanup: async () => {
        await context?.close();
        if (gym) await gym.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function modalVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.querySelector("#__sentinelsuite_cred_modal_host__");
    return !!host?.shadowRoot?.querySelector(".overlay");
  });
}

async function fullCardCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#__navsentinel_toast_host")).reduce((count, host) =>
      count + (host.shadowRoot?.querySelectorAll(".wrap").length ?? 0), 0),
  );
}

test("a synthesized modal approval does not resume the submit; a trusted one does @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, cleanup } = await setupSyntheticTest("level11-credential-guard.html");
  try {
    await page.click("#submitBtn");
    await expect(page.locator("text=Credential submit blocked")).toBeVisible({ timeout: 4000 });

    // Hostile-page script: find the Proceed button in the open shadow root and
    // click it without any user gesture. The prompt must not resolve.
    await attemptSyntheticModalClick(page, "Proceed once");
    await page.waitForTimeout(500);
    expect(await modalVisible(page), "synthetic approval must not dismiss the prompt").toBe(true);
    await expect(page).toHaveURL(/level11-credential-guard\.html/);

    // Positive control: the same button driven by real input resumes the submit.
    await clickModalButton(page, "Proceed once");
    await expect(page).not.toHaveURL(/level11-credential-guard\.html/, { timeout: 10_000 });
  } finally {
    await cleanup();
  }
});

// NOTE on what this case proves: a naive synthetic toast click never reaches
// the button even without the isTrusted gate, because the window-capture
// same-tab interceptor (capture_isolated) consumes high-NRS synthetic input
// first. That interception is incidental — threshold-, geometry-, and
// timing-dependent, bypassable by engineering low-NRS context (e.g. a lure
// click near the control) — so the gate in bindControl is still the real
// boundary (pinned red-green by the unit tests). This case pins the
// end-to-end property: page-synthesized toast input never activates.
test("a synthesized toast activation does not fire the action; a trusted one does @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupSyntheticTest("evasion-01-opacity-009.html");
  try {
    const box = await page.locator("#trap").boundingBox();
    expect(box, "#trap overlay should be in the DOM").toBeTruthy();
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    expect(await popupPromise, "Expected the overlay new tab to be blocked").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    expect(await fullCardCount(page), "exactly one block card is expected").toBe(1);

    // Hostile-page script: synthesize a click on Dismiss. The card must stay.
    // The wait exceeds the dismiss fade+burn animation (~420ms) so a vulnerable
    // build fails here instead of racing the animation.
    await attemptSyntheticToastClick(page, "Dismiss");
    await page.waitForTimeout(800);
    expect(await fullCardCount(page), "synthetic activation must not clear the card").toBe(1);

    // Positive control: real input on the same control clears the card.
    await clickToastButton(page, "Dismiss");
    await expect.poll(() => fullCardCount(page)).toBe(0);
  } finally {
    await cleanup();
  }
});
