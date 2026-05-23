import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { waitForNavSentinelBridge } from "./extension_test_utils";
import { demoPause, showDemoOverlay } from "./demo-showcase-helpers";
import {
  clickPopupTarget,
  getPopupSnapshot,
  openRealPopup,
  selectPopupMode
} from "./demo-showcase-popup";
import { launchDemoSession } from "./demo-showcase-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(420_000);

test("guided operator showcase with the real popup surface @demo @demo-operator", async (_fixtures, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running the demo showcase.");

  const session = await launchDemoSession({ extensionPath, gymRoot, testInfo });
  const { baseUrl, close, context } = session;

  try {
    const totalSteps = 8;
    const page = await context.newPage();

    await page.goto(`${baseUrl}/level11-credential-guard.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);
    await showDemoOverlay(page, {
      step: 1,
      total: totalSteps,
      title: "The operator cut",
      summary:
        "This variant focuses on the real browser-action popup and the state it exposes for the current tab.",
      expectation: "inspect"
    });
    await demoPause(page, 2400);

    await showDemoOverlay(page, {
      step: 2,
      total: totalSteps,
      title: "Open the real popup",
      summary:
        "The popup is opened through the extension action itself, not by navigating directly to its HTML entry point.",
      expectation: "inspect"
    });
    await demoPause(page, 1700);
    await openRealPopup(context);
    let popupSnapshot = await getPopupSnapshot(context);
    expect(popupSnapshot.site).toBe("127.0.0.1");
    expect(popupSnapshot.trustStatus).toContain("Not trusted");
    await demoPause(page, 2200);

    await showDemoOverlay(page, {
      step: 3,
      total: totalSteps,
      title: "The popup tracks the active tab",
      summary:
        "The site label and trust state come from the currently active browsing tab rather than from a standalone extension page.",
      expectation: "inspect"
    });
    await demoPause(page, 2200);

    await showDemoOverlay(page, {
      step: 4,
      total: totalSteps,
      title: "Quick controls update the suite",
      summary:
        "Mode changes made from the popup should persist immediately and show up in the popup state itself.",
      expectation: "inspect"
    });
    await demoPause(page, 1500);
    popupSnapshot = await selectPopupMode(context, "navMode", "strict");
    expect(popupSnapshot.navMode).toBe("strict");
    popupSnapshot = await selectPopupMode(context, "credMode", "strict");
    expect(popupSnapshot.credMode).toBe("strict");
    await demoPause(page, 2200);

    await showDemoOverlay(page, {
      step: 5,
      total: totalSteps,
      title: "Trust can be granted from the popup",
      summary:
        "The browser-action surface can trust the current site directly, without leaving the current tab.",
      expectation: "inspect"
    });
    await demoPause(page, 1500);
    popupSnapshot = await clickPopupTarget(context, "trustBtn");
    expect(popupSnapshot.trustStatus).toContain("Trusted");
    await demoPause(page, 2200);

    await showDemoOverlay(page, {
      step: 6,
      total: totalSteps,
      title: "Recent signals stay visible",
      summary:
        "The popup also acts as a quick-read log for the latest local events tied to that browsing session.",
      expectation: "inspect"
    });
    await demoPause(page, 1600);
    popupSnapshot = await clickPopupTarget(context, "refreshBtn");
    expect(popupSnapshot.events.join(" ")).toContain("suite config update");
    expect(popupSnapshot.events.join(" ")).toContain("cred trust domain");
    await demoPause(page, 2200);

    await showDemoOverlay(page, {
      step: 7,
      total: totalSteps,
      title: "The popup hands off to the full console",
      summary:
        "From the popup, the operator can jump into the options page for the fuller control surface and audit trail.",
      expectation: "inspect"
    });
    await demoPause(page, 1500);
    const optionsPagePromise = context.waitForEvent("page");
    await clickPopupTarget(context, "openOptions");
    const optionsPage = await optionsPagePromise;
    await optionsPage.waitForURL(/\/src\/options\/options\.html/, { timeout: 5000 });
    await optionsPage.bringToFront();
    await expect(optionsPage.locator("#trustedList")).toContainText("127.0.0.1");
    await expect(optionsPage.locator('#navModeSeg .seg-btn[data-value="strict"]')).toHaveAttribute("aria-pressed", "true");
    await expect(optionsPage.locator('#credModeSeg .seg-btn[data-value="strict"]')).toHaveAttribute("aria-pressed", "true");
    await demoPause(optionsPage, 2600);

    await page.bringToFront();
    await showDemoOverlay(page, {
      step: 8,
      total: totalSteps,
      title: "Operator showcase complete",
      summary:
        "This cut kept the focus on the real popup surface: current-tab state, quick controls, trust, recent signals, and the handoff into options.",
      expectation: "inspect"
    });
    await demoPause(page, 2400);
  } finally {
    await close();
  }
});
