import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertNoToastFor,
  clickToastButton,
  waitForNavSentinelBridge,
  waitForToastText
} from "./extension_test_utils";
import { demoPause, showDemoOverlay } from "./demo-showcase-helpers";
import { launchDemoSession } from "./demo-showcase-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(420_000);

test("guided core showcase of merged NavSentinel capabilities @demo @demo-core", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running the demo showcase.");

  const session = await launchDemoSession({ extensionPath, gymRoot, testInfo });
  const { baseUrl, close, context, extensionId } = session;

  try {
    const totalSteps = 10;
    const page = await context.newPage();

    await page.goto(`${baseUrl}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await showDemoOverlay(page, {
      step: 1,
      total: totalSteps,
      title: "A browser safety tour",
      summary:
        "This run uses only local fixtures to show what NavSentinel blocks, what it still allows, and how it keeps evidence local.",
      expectation: "inspect"
    });
    await demoPause(page, 2600);

    await page.goto(`${baseUrl}/level2-moving-target.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);
    await showDemoOverlay(page, {
      step: 2,
      total: totalSteps,
      title: "A stolen click gets stopped",
      summary:
        "The visible button is harmless, but a moving hidden target tries to open a different destination in a new tab.",
      expectation: "block"
    });
    await demoPause(page, 1800);
    const realBtn = page.locator("#realBtn");
    const level2Box = await realBtn.boundingBox();
    expect(level2Box, "Expected the visible button in Level 2").toBeTruthy();
    const blockedNewTab = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.move(level2Box!.x + level2Box!.width / 2, level2Box!.y + level2Box!.height / 2);
    await page.waitForTimeout(100);
    await page.mouse.click(level2Box!.x + level2Box!.width / 2, level2Box!.y + level2Box!.height / 2);
    expect(await blockedNewTab).toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await demoPause(page, 1800);

    await page.goto(`${baseUrl}/level5-window-open-popunder.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);
    await showDemoOverlay(page, {
      step: 3,
      total: totalSteps,
      title: "Popunder abuse gets cut off",
      summary:
        "This click zone tries to turn a harmless interaction into a popup side effect. The extension should stop it immediately.",
      expectation: "block"
    });
    await demoPause(page, 1700);
    await page.click("#area");
    await waitForToastText(page, "Blocked popup", 3000);
    await demoPause(page, 1800);

    await page.goto(`${baseUrl}/level12-slow-same-tab-link.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);
    await showDemoOverlay(page, {
      step: 4,
      total: totalSteps,
      title: "A legitimate delay still works",
      summary:
        "This same-tab destination responds slowly, but the navigation still matches a clear click and should be preserved.",
      expectation: "allow"
    });
    await demoPause(page, 1700);
    await page.click("#slowLink");
    await page.waitForURL(/level4-visual-mimicry\.html\?delayMs=2500/, { timeout: 10_000 });
    await assertNoToastFor(page, 1200);
    await demoPause(page, 1700);

    await page.goto(`${baseUrl}/level9-legit-video-overlay.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);
    await showDemoOverlay(page, {
      step: 5,
      total: totalSteps,
      title: "Not every overlay is suspicious",
      summary:
        "Visible media controls should still behave normally. This chapter shows a legitimate overlay staying usable.",
      expectation: "allow"
    });
    await demoPause(page, 1600);
    await page.click("#overlayBtn");
    await expect(page.locator("#status")).toHaveText("Status: playing");
    await assertNoToastFor(page, 800);
    await demoPause(page, 1500);

    await page.goto(`${baseUrl}/level8-legit-oauth-popup.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);
    await showDemoOverlay(page, {
      step: 6,
      total: totalSteps,
      title: "Explicit sign-in intent is preserved",
      summary:
        "A user-driven OAuth popup should open cleanly. This is the false-positive side of the story.",
      expectation: "allow"
    });
    await demoPause(page, 1700);
    const allowedPopupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await page.click("#signin");
    const allowedPopup = await allowedPopupPromise;
    expect(allowedPopup, "Expected the legitimate OAuth popup to open").not.toBeNull();
    await allowedPopup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    expect(allowedPopup?.url()).toContain("level8-oauth-consent.html?oauth=1");
    await demoPause(page, 1600);
    await allowedPopup?.close().catch(() => {});

    await page.goto(`${baseUrl}/level11-credential-guard.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);
    await showDemoOverlay(page, {
      step: 7,
      total: totalSteps,
      title: "A risky credential submit is interrupted",
      summary:
        "The page looks like a login flow, but the destination pattern is unsafe enough that NavSentinel should hold the submit.",
      expectation: "prompt"
    });
    await demoPause(page, 1700);
    await page.click("#submitBtn");
    await expect(page.locator("text=Credential submit blocked")).toBeVisible({ timeout: 4000 });
    await showDemoOverlay(page, {
      step: 7,
      total: totalSteps,
      title: "What just happened",
      summary:
        "The extension intercepted the password submit locally, surfaced the guard modal, and kept the user on the original page.",
      expectation: "inspect"
    });
    await demoPause(page, 2200);

    await page.goto(`${baseUrl}/level11-credential-guard.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);
    await showDemoOverlay(page, {
      step: 8,
      total: totalSteps,
      title: "Trust stays local and deliberate",
      summary:
        "Pasting into a password field on an untrusted domain triggers a warning. The trust action should persist only inside the extension.",
      expectation: "inspect"
    });
    await demoPause(page, 1700);
    await page.focus("#password");
    await page.evaluate(() => {
      const input = document.getElementById("password");
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Missing #password input");
      }
      input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, composed: true }));
    });
    await waitForToastText(page, "You pasted into a password field on an untrusted domain", 4000);
    await demoPause(page, 1700);
    await clickToastButton(page, "Trust 127.0.0.1");
    await showDemoOverlay(page, {
      step: 8,
      total: totalSteps,
      title: "What changed",
      summary:
        "The domain is now trusted locally, and the extension has recorded both the warning and the trust action in its event log.",
      expectation: "inspect"
    });
    await demoPause(page, 2200);

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/src/options/options.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await optionsPage.bringToFront();
    await showDemoOverlay(optionsPage, {
      step: 9,
      total: totalSteps,
      title: "The operator view stays local",
      summary:
        "The options page shows the trusted-domain state and the event log that explain exactly what the extension did during the run.",
      expectation: "inspect"
    });
    await expect(optionsPage.locator("#trustedList")).toContainText("127.0.0.1");
    await expect(optionsPage.locator("#eventLog")).toContainText("cred_paste_warn");
    await expect(optionsPage.locator("#eventLog")).toContainText("cred_trust_domain");
    await demoPause(optionsPage, 3000);

    await page.bringToFront();
    await page.goto(`${baseUrl}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await showDemoOverlay(page, {
      step: 10,
      total: totalSteps,
      title: "Core showcase complete",
      summary:
        "This cut covered blocked navigation, preserved intent, credential protection, and the local evidence surface that ties those decisions together.",
      expectation: "inspect"
    });
    await demoPause(page, 2500);
  } finally {
    await close();
  }
});
