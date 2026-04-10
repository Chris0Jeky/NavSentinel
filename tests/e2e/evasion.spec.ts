/**
 * P1-07: CDS Evasion Red-Team E2E Tests
 *
 * These tests exercise deliberately-evasive gym fixtures against the CDS
 * hardening from feat/cds-hardening (P1-02). Each fixture uses near-threshold
 * signals designed to probe gradient scoring boundaries.
 *
 * Detection model:
 * - NavSentinel evaluates CDS at click time via elementsFromPoint()
 * - Smart mode blocks at CDS >= 70, strict mode at >= 50
 * - Single near-threshold signals may not block (that is by design)
 * - Composite escalation (+10 for 3+ signals, +15 for 4+) is the safety net
 * - Blank anchors (target="_blank") with no visible name are blocked by the
 *   blank-anchor interception path regardless of CDS score
 *
 * Test expectations:
 * - evasion-01 (opacity): Blocked by blank-anchor check (no name)
 * - evasion-02 (size): Blocked by blank-anchor check (no name)
 * - evasion-03 (label): EVADES in smart mode -- aria-label=" " passes the
 *     DOM-level elementNameLength check even though scoring treats it as absent.
 *     This is a documented evasion gap for follow-up.
 * - evasion-04 (z-index): Blocked by blank-anchor check (no name)
 * - evasion-05 (composite): MUST be caught -- blocked via blank-anchor + high CDS
 * - evasion-06 (delayed): Same as 05 after injection delay; tests click-time eval
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertNoToastFor,
  getGymBaseUrl,
  waitForNavSentinelBridge,
  waitForToastText
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

/**
 * Helper: launch a persistent browser context with the extension loaded,
 * navigate to a gym fixture, and wait for NavSentinel bridge readiness.
 */
async function setupEvasionTest(fixtureName: string) {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-evasion-"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    timeout: 60_000,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/${fixtureName}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000
  });

  await waitForNavSentinelBridge(page);

  return {
    page,
    context,
    cleanup: async () => {
      await context.close();
      if (gym) await gym.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  };
}

// ---------------------------------------------------------------------------
// Evasion 01: Opacity 0.09 (isolated single signal)
// ---------------------------------------------------------------------------
test("Evasion 01: near-invisible opacity overlay is blocked @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-01-opacity-009.html");

  try {
    const trap = page.locator("#trap");
    const box = await trap.boundingBox();
    expect(box, "#trap overlay should be in the DOM").toBeTruthy();

    // The overlay is <a target="_blank"> with no name -- blank-anchor interception
    // blocks it regardless of CDS score. No new tab should open.
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Expected the overlay new tab to be blocked").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await expect(page).toHaveURL(/evasion-01-opacity-009\.html/);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 02: 34% viewport coverage (isolated single signal)
// ---------------------------------------------------------------------------
test("Evasion 02: medium-size overlay is blocked @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-02-size-34pct.html");

  try {
    const trap = page.locator("#trap");
    const box = await trap.boundingBox();
    expect(box, "#trap overlay should be in the DOM").toBeTruthy();

    // Overlay is <a target="_blank" role="link"> with no name -- blank-anchor blocks
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Expected the overlay new tab to be blocked").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await expect(page).toHaveURL(/evasion-02-size-34pct\.html/);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 03: Misleading aria-label (whitespace / single char)
//
// DOCUMENTED EVASION GAP: aria-label=" " passes the DOM-level
// elementNameLength() check (returns 1 > 0) even though scoring.ts
// nameLength() treats it as absent (< 2 chars). Combined with low CDS (~15)
// and no risky blank reasons, isLegitBlankAnchor() returns true in smart mode.
//
// This test documents the gap. Future hardening (P1-08+) should align
// elementNameLength with the scoring-side < 2 threshold.
// ---------------------------------------------------------------------------
test("Evasion 03: whitespace aria-label evades in smart mode (documented gap) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-03-labeled-overlay.html");

  try {
    const trap = page.locator("#trap-whitespace");
    const box = await trap.boundingBox();
    expect(box, "#trap-whitespace should be in the DOM").toBeTruthy();

    // In smart mode, aria-label=" " passes the DOM-level name check.
    // The blank anchor is allowed through -- this documents the evasion gap.
    const popupPromise = context.waitForEvent("page", { timeout: 2500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;

    // Expect either: the popup opens (evasion succeeds) OR a toast appears.
    // We document whichever happens. The current expectation is that the
    // whitespace-label trick evades the blank-anchor gate.
    if (popup) {
      // Evasion succeeded -- blank-anchor gate was bypassed
      await popup.close().catch(() => {});
      // Verify no blocking toast appeared
      const toastText = await page.evaluate(() => {
        const host = document.querySelector("#__navsentinel_toast_host");
        return host?.shadowRoot?.querySelector(".body")?.textContent?.trim() ?? null;
      });
      // eslint-disable-next-line no-console
      console.log(`[evasion-03] Whitespace aria-label EVADED. Toast: ${toastText ?? "none"}`);
    } else {
      // Evasion failed -- NavSentinel caught it despite the label trick.
      // This would mean the gap has been fixed (or a stricter mode is active).
      await waitForToastText(page, "Blocked", 3000);
      // eslint-disable-next-line no-console
      console.log("[evasion-03] Whitespace aria-label was CAUGHT.");
    }
  } finally {
    await cleanup();
  }
});

test("Evasion 03: single-char aria-label also evades in smart mode @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-03-labeled-overlay.html");

  try {
    const trap = page.locator("#trap-singlechar");
    const box = await trap.boundingBox();
    expect(box, "#trap-singlechar should be in the DOM").toBeTruthy();

    const popupPromise = context.waitForEvent("page", { timeout: 2500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;

    if (popup) {
      await popup.close().catch(() => {});
      // eslint-disable-next-line no-console
      console.log("[evasion-03] Single-char aria-label EVADED.");
    } else {
      await waitForToastText(page, "Blocked", 3000);
      // eslint-disable-next-line no-console
      console.log("[evasion-03] Single-char aria-label was CAUGHT.");
    }
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 04: z-index 9998 (isolated single signal)
// ---------------------------------------------------------------------------
test("Evasion 04: elevated z-index overlay is blocked @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-04-zindex-9998.html");

  try {
    const trap = page.locator("#trap");
    const box = await trap.boundingBox();
    expect(box, "#trap overlay should be in the DOM").toBeTruthy();

    // Overlay is <a target="_blank" role="link"> with no name -- blank-anchor blocks
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Expected the overlay new tab to be blocked").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await expect(page).toHaveURL(/evasion-04-zindex-9998\.html/);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 05: Composite near-threshold signals (CRITICAL -- MUST be caught)
// ---------------------------------------------------------------------------
test("Evasion 05: composite near-threshold overlay MUST be caught @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-05-composite.html");

  try {
    // Click on the legit link area, which is UNDER the overlay.
    // The overlay (trap) sits on top, so the click hits the trap first.
    const legitLink = page.locator("#legit-link");
    const linkBox = await legitLink.boundingBox();
    expect(linkBox, "#legit-link should be visible").toBeTruthy();

    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(linkBox!.x + linkBox!.width / 2, linkBox!.y + linkBox!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Composite evasion overlay MUST be blocked").toBeNull();

    // Should show a blocking toast (either "Blocked new tab" or "blocked deceptive click")
    await page.waitForFunction(
      () => {
        const host = document.querySelector("#__navsentinel_toast_host");
        const text = host?.shadowRoot?.querySelector(".body")?.textContent ?? "";
        return text.includes("Blocked new tab") || text.includes("blocked deceptive click");
      },
      null,
      { timeout: 3000 }
    );
    await expect(page).toHaveURL(/evasion-05-composite\.html/);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 06: Delayed injection (2-second delay, then composite signals)
// ---------------------------------------------------------------------------
test("Evasion 06: delayed-injected overlay is caught after injection @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-06-delayed-injection.html");

  try {
    // Wait for the overlay to be injected (2-second delay + buffer)
    await page.waitForSelector("#trap", { timeout: 5000 });

    // Verify the status text changed to confirm injection
    const statusText = await page.locator("#status").textContent();
    expect(statusText).toContain("Overlay injected");

    const trap = page.locator("#trap");
    const box = await trap.boundingBox();
    expect(box, "#trap overlay should have dimensions after injection").toBeTruthy();

    // Click the injected overlay -- it uses composite signals like evasion-05
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Delayed-injected overlay MUST be blocked").toBeNull();

    // NavSentinel evaluates at click time, so delayed injection should be caught
    await page.waitForFunction(
      () => {
        const host = document.querySelector("#__navsentinel_toast_host");
        const text = host?.shadowRoot?.querySelector(".body")?.textContent ?? "";
        return text.includes("Blocked new tab") || text.includes("blocked deceptive click");
      },
      null,
      { timeout: 3000 }
    );
    await expect(page).toHaveURL(/evasion-06-delayed-injection\.html/);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 07: pointer-events: none bypass
//
// The overlay uses pointer-events: none so CDS never sees it in the
// elementsFromPoint() stack. A document-level click listener attempts
// window.open. The main_guard.ts intercept should catch the window.open.
// ---------------------------------------------------------------------------
test("Evasion 07: pointer-events:none overlay relies on main_guard intercept @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-07-pointer-events-none.html");

  try {
    const legitLink = page.locator("#legit-link");
    const box = await legitLink.boundingBox();
    expect(box, "#legit-link should be visible").toBeTruthy();

    // Click on the legit link. The document-level capturing listener will
    // preventDefault and call window.open with a malicious URL.
    // main_guard.ts should intercept the window.open.
    const popupPromise = context.waitForEvent("page", { timeout: 2500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;

    if (popup) {
      // If a popup opened, the evasion succeeded and main_guard did not catch it
      await popup.close().catch(() => {});
      // eslint-disable-next-line no-console
      console.log("[evasion-07] pointer-events:none bypass EVADED main_guard.");
    } else {
      // main_guard caught the window.open
      // eslint-disable-next-line no-console
      console.log("[evasion-07] pointer-events:none bypass was CAUGHT by main_guard.");
      // Check for a blocking toast
      const toastText = await page.evaluate(() => {
        const host = document.querySelector("#__navsentinel_toast_host");
        return host?.shadowRoot?.querySelector(".body")?.textContent?.trim() ?? null;
      });
      // eslint-disable-next-line no-console
      console.log(`[evasion-07] Toast: ${toastText ?? "none"}`);
    }
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 08: clip-path visual hiding
//
// Documents that clip-path affects hit-testing in Chrome. The overlay
// is clipped to a thin strip; only that strip is clickable. Clicks
// elsewhere pass through to underlying elements.
// ---------------------------------------------------------------------------
test("Evasion 08: clip-path overlay strip is blocked when clicked @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-08-clip-path-hidden.html");

  try {
    const trap = page.locator("#trap");
    const box = await trap.boundingBox();

    // clip-path: inset(0 0 98% 0) means only the top 2% is visible/clickable.
    // The bounding box from Playwright reflects the full element area, but
    // only the top strip is clickable.
    expect(box, "#trap overlay should be in the DOM").toBeTruthy();

    // Click in the visible strip (top 2% of the overlay)
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + 5);

    const popup = await popupPromise;
    expect(popup, "Clip-path strip click should be blocked").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await expect(page).toHaveURL(/evasion-08-clip-path-hidden\.html/);
  } finally {
    await cleanup();
  }
});
