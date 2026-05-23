import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
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

test.setTimeout(240_000);

test("guided recovery showcase for redirects and one-time recovery @demo @demo-recovery", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running the demo showcase.");

  const session = await launchDemoSession({ extensionPath, gymRoot, testInfo });
  const { baseUrl, close, context } = session;

  try {
    const totalSteps = 5;

    const page1 = await context.newPage();
    await page1.goto(`${baseUrl}/level10-redirects-and-forms.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page1);
    await showDemoOverlay(page1, {
      step: 1,
      total: totalSteps,
      title: "The recovery cut",
      summary:
        "This variant isolates the flows where NavSentinel interrupts a navigation and then offers a narrow way forward.",
      expectation: "inspect"
    });
    await demoPause(page1, 2400);

    await showDemoOverlay(page1, {
      step: 2,
      total: totalSteps,
      title: "A delayed redirect still becomes visible",
      summary:
        "This flow starts as a normal click, then changes destination later. Keeping it in its own cut makes the redirect behavior obvious to the viewer.",
      expectation: "recover"
    });
    await demoPause(page1, 1700);
    await page1.click("#delayed");
    await waitForToastText(page1, "NavSentinel rolled back a redirect", 10_000);
    const rollbackReturnedToOrigin = /level10-redirects-and-forms\.html/.test(page1.url());
    await showDemoOverlay(page1, {
      step: 2,
      total: totalSteps,
      title: "What just happened",
      summary:
        rollbackReturnedToOrigin
          ? "NavSentinel rolled the delayed redirect back to the original page and required an explicit proceed decision before continuing."
          : "NavSentinel surfaced a rollback-style recovery prompt on the delayed redirect instead of letting the later navigation blend into the original click.",
      expectation: "inspect"
    });
    await demoPause(page1, 2200);
    if (rollbackReturnedToOrigin) {
      await clickToastButton(page1, "Proceed");
      await page1.waitForURL(/level4-visual-mimicry\.html/, { timeout: 7000 });
      await page1.waitForLoadState("domcontentloaded");
    } else {
      await expect(page1).toHaveURL(/level4-visual-mimicry\.html/);
    }
    await page1.close();

    const page2 = await context.newPage();
    await page2.goto(`${baseUrl}/rw04-open-redirect-landing.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page2);
    await showDemoOverlay(page2, {
      step: 3,
      total: totalSteps,
      title: "A laundering intermediary gets stopped",
      summary:
        "This path first looks local and harmless, then a redirector page tries to launder the final destination into a new tab.",
      expectation: "recover"
    });
    await demoPause(page2, 1700);
    await page2.click("#rw04Invoice");
    await page2.waitForURL(/rw04-local-redirector\.html/, { timeout: 5000 });
    const blockedPopup = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await waitForToastText(page2, "Blocked popup", 5000);
    expect(await blockedPopup).toBeNull();
    const allowPopup = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await clickToastButton(page2, "Allow once");
    const finalPopup = await allowPopup;
    expect(finalPopup, "Expected the laundering popup to open after allow-once").not.toBeNull();
    if (!finalPopup) {
      throw new Error("Expected the laundering popup to open after allow-once");
    }
    await finalPopup.waitForLoadState("domcontentloaded", { timeout: 5000 });
    expect(finalPopup.url()).toContain("rw04-final-offer.html?from=redirector");
    await showDemoOverlay(page2, {
      step: 3,
      total: totalSteps,
      title: "What just happened",
      summary:
        "The intermediary did not get blanket trust. NavSentinel only replayed the single blocked action after an explicit allow-once decision.",
      expectation: "inspect"
    });
    await demoPause(page2, 2200);
    await finalPopup.close();

    await page2.goto(`${baseUrl}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await showDemoOverlay(page2, {
      step: 4,
      total: totalSteps,
      title: "Recovery stays narrow",
      summary:
        "Across these flows, the product is doing the same thing: surface the risky transition, keep the recovery path narrow, and avoid turning one decision into blanket trust.",
      expectation: "inspect"
    });
    await demoPause(page2, 2200);

    await showDemoOverlay(page2, {
      step: 5,
      total: totalSteps,
      title: "Recovery showcase complete",
      summary:
        "This cut focused on delayed redirects, laundering intermediaries, and recovery prompts instead of the broader day-to-day browsing story.",
      expectation: "inspect"
    });
    await demoPause(page2, 2400);
    await page2.close();
  } finally {
    await close();
  }
});
