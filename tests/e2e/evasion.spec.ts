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
 * - evasion-03 (label): FIXED -- whitespace aria-labels are now trimmed in
 *     elementNameLength, and no_accessible_name is in RISKY_BLANK_REASONS.
 * - evasion-04 (z-index): Blocked by blank-anchor check (no name)
 * - evasion-05 (composite): MUST be caught -- blocked via blank-anchor + high CDS
 * - evasion-06 (delayed): Same as 05 after injection delay; tests click-time eval
 * - evasion-09 (filter opacity): Blocked by blank-anchor; documents that CDS
 *     opacity gradient is evaded by CSS filter: opacity()
 * - evasion-10 (transform scale): Blocked; verifies CSS transforms don't evade
 *     size detection (getBoundingClientRect returns transformed box)
 * - evasion-11 (shadow DOM): Blocked by blank-anchor via composedPath();
 *     documents that CDS overlay scoring misses shadow content
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  getGymBaseUrl,
  readToastText,
  waitForNavSentinelBridge,
  waitForToastMatch,
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

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
  } catch (err) {
    // Clean up resources if browser launch fails
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

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
// FIXED: aria-label=" " and aria-label="x" no longer evade detection.
// - Whitespace-only labels are trimmed to empty by both dom_builder.ts
//   attrLen() and capture_isolated.ts elementNameLength(), so the
//   blank-anchor gate catches them (name length 0).
// - Single-char labels pass elementNameLength but score as
//   no_accessible_name (CDS treats aria < 2 as absent), and
//   no_accessible_name is in RISKY_BLANK_REASONS, so
//   isLegitBlankAnchor() returns false.
// ---------------------------------------------------------------------------
test("Evasion 03: whitespace aria-label is now blocked @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-03-labeled-overlay.html");

  try {
    const trap = page.locator("#trap-whitespace");
    const box = await trap.boundingBox();
    expect(box, "#trap-whitespace should be in the DOM").toBeTruthy();

    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Whitespace aria-label overlay should be blocked").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await expect(page).toHaveURL(/evasion-03-labeled-overlay\.html/);
  } finally {
    await cleanup();
  }
});

test("Evasion 03: single-char aria-label is now blocked @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-03-labeled-overlay.html");

  try {
    const trap = page.locator("#trap-singlechar");
    const box = await trap.boundingBox();
    expect(box, "#trap-singlechar should be in the DOM").toBeTruthy();

    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Single-char aria-label overlay should be blocked").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await expect(page).toHaveURL(/evasion-03-labeled-overlay\.html/);
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
    const trap = page.locator("#trap");
    const box = await trap.boundingBox();
    expect(box, "#trap composite overlay should be in the DOM").toBeTruthy();

    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Composite evasion overlay MUST be blocked").toBeNull();

    await waitForToastMatch(page, /Blocked new tab|blocked deceptive click/, 3000);
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
    await waitForToastMatch(page, /Blocked new tab|blocked deceptive click/, 3000);
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

    // main_guard.ts should intercept the window.open call from the capturing
    // click listener. Assert the popup is blocked.
    expect(popup, "Expected main_guard to block the pointer-events:none bypass window.open").toBeNull();
    const toastText = await readToastText(page);
    console.log(`[evasion-07] Toast: ${toastText ?? "none"}`);
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

// ---------------------------------------------------------------------------
// Evasion 09: filter: opacity() bypass
//
// DOCUMENTED EVASION GAP: CSS filter: opacity(9%) makes the element visually
// near-invisible but getComputedStyle().opacity still returns "1". This
// completely bypasses the CDS opacity gradient. The overlay is still caught
// by the blank-anchor gate (no name + target=_blank).
//
// This test verifies the blank-anchor fallback and documents the opacity gap.
// ---------------------------------------------------------------------------
test("Evasion 09: filter:opacity() bypasses CDS opacity but blank-anchor gate catches it @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-09-filter-opacity.html");

  try {
    const trap = page.locator("#trap");
    const box = await trap.boundingBox();
    expect(box, "#trap overlay should be in the DOM").toBeTruthy();

    // Verify the evasion: computed opacity should be 1 (not 0.09)
    const computedOpacity = await page.evaluate(() => {
      const el = document.getElementById("trap");
      if (!el) return null;
      return window.getComputedStyle(el).opacity;
    });
    expect(computedOpacity, "filter:opacity should not affect computed opacity property").toBe("1");

    // Despite the opacity bypass, the blank-anchor gate should still block
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Overlay should be blocked by blank-anchor gate despite opacity bypass").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await expect(page).toHaveURL(/evasion-09-filter-opacity\.html/);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 10: CSS transform: scale() overlay
//
// Verifies that CSS transforms do NOT evade size detection. In Chrome,
// getBoundingClientRect() returns the transformed bounding box, so the
// coverage ratio calculation should correctly see the large dimensions.
// ---------------------------------------------------------------------------
test("Evasion 10: CSS transform:scale() overlay is blocked @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-10-transform-scale.html");

  try {
    const trap = page.locator("#trap");
    const box = await trap.boundingBox();
    expect(box, "#trap overlay should be in the DOM").toBeTruthy();

    // Verify the transform is applied: bounding box should be much larger than 10x10
    expect(box!.width, "Transformed width should exceed original 10px").toBeGreaterThan(100);
    expect(box!.height, "Transformed height should exceed original 10px").toBeGreaterThan(100);

    // The overlay is a blank anchor with no name -- blank-anchor gate blocks it.
    // The large transformed size also contributes to a high CDS score.
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;
    expect(popup, "Transform-scaled overlay should be blocked").toBeNull();
    await waitForToastText(page, "Blocked new tab", 3000);
    await expect(page).toHaveURL(/evasion-10-transform-scale\.html/);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// Evasion 11: Shadow DOM overlay hiding
//
// Tests that composedPath() from click events traverses into shadow DOM,
// allowing the blank-anchor gate to find the inner deceptive <a> element.
// Documents that CDS overlay scoring only sees the shadow host (a plain div).
// ---------------------------------------------------------------------------
test("Evasion 11: shadow DOM overlay is caught via composedPath @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { page, context, cleanup } = await setupEvasionTest("evasion-11-shadow-dom.html");

  try {
    // Wait for shadow DOM setup to complete
    await page.waitForFunction(
      () => document.getElementById("shadow-host")?.getAttribute("data-shadow-ready") === "1",
      null,
      { timeout: 5000 }
    );

    const host = page.locator("#shadow-host");
    const box = await host.boundingBox();
    expect(box, "#shadow-host should be in the DOM with dimensions").toBeTruthy();

    // Click in the center of the shadow host area. The click event's
    // composedPath() should include the inner <a> from the shadow root.
    const popupPromise = context.waitForEvent("page", { timeout: 2500 }).catch(() => null);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    const popup = await popupPromise;

    // composedPath() should find the inner <a target="_blank"> inside the
    // shadow root, allowing the blank-anchor gate to catch it.
    expect(popup, "Expected composedPath to find shadow DOM anchor and block it").toBeNull();
    await waitForToastText(page, "Blocked", 5000);
    await expect(page).toHaveURL(/evasion-11-shadow-dom\.html/);
  } finally {
    await cleanup();
  }
});
