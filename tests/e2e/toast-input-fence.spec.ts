/**
 * Trusted-input coverage for NavSentinel's own notice controls (#560).
 *
 * Every earlier "button works" check drove the toast with a synthetic
 * `element.click()`, which the document-start input fence ignores. These cases
 * use real mouse and keyboard input so they exercise the same path a person
 * does, and they pin two failure modes observed on real pages:
 *
 * - a maximum-z-index page layer inserted AFTER the toast host painted above
 *   it, so trusted clicks never reached the extension-owned controls; and
 * - the activation relay resolved a control token from any element that merely
 *   carried the toast host id, so a page could forge one and activate a real
 *   extension-owned control.
 */
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
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

test.setTimeout(120_000);

async function setupFenceTest(pathname: string): Promise<{
  page: Page;
  context: BrowserContext;
  cleanup: () => Promise<void>;
}> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-fence-"));
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

/** Viewport centre of an extension-owned toast button, read from its shadow root. */
async function toastButtonPoint(page: Page, label: string): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((expected) => {
    const host = document.querySelector("#__navsentinel_toast_host");
    const buttons = Array.from(host?.shadowRoot?.querySelectorAll("button") ?? []);
    const match = buttons.find((button) => button.textContent?.trim() === expected);
    if (!match) return null;
    const rect = match.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, label);
  expect(point, `toast button "${label}" should be rendered`).not.toBeNull();
  return point!;
}

/** Full (non-persistent) cards across every element carrying the host id, so a page-forged host cannot mask the real one. */
async function fullCardCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#__navsentinel_toast_host")).reduce((count, host) =>
      count + (host.shadowRoot?.querySelectorAll(".wrap:not([data-persistent='true'])").length ?? 0), 0),
  );
}

/** Click the fixture's deceptive overlay with real input and wait for the block card. */
async function blockTrapNewTab(page: Page, context: BrowserContext): Promise<void> {
  const box = await page.locator("#trap").boundingBox();
  expect(box, "#trap overlay should be in the DOM").toBeTruthy();
  const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  expect(await popupPromise, "Expected the overlay new tab to be blocked").toBeNull();
  await waitForToastText(page, "Blocked new tab", 3000);
  expect(await fullCardCount(page)).toBe(1);
}

/** Install page-realm capture listeners that count every control event they observe. */
async function countPageCaptureEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.pageControlEventCount = "0";
    for (const type of [
      "pointerdown", "pointerup", "mousedown", "mouseup", "click", "keydown", "keyup",
    ]) {
      window.addEventListener(type, () => {
        const current = Number(document.documentElement.dataset.pageControlEventCount ?? "0");
        document.documentElement.dataset.pageControlEventCount = String(current + 1);
      }, { capture: true });
    }
  });
}

async function pageCaptureEventCount(page: Page): Promise<number> {
  return page.evaluate(() => Number(document.documentElement.dataset.pageControlEventCount ?? "0"));
}

test("trusted mouse Dismiss clears a regular block card without leaking to page listeners @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupFenceTest("evasion-01-opacity-009.html");
  try {
    await blockTrapNewTab(page, context);
    await countPageCaptureEvents(page);

    const dismiss = await toastButtonPoint(page, "Dismiss");
    const popupPromise = context.waitForEvent("page", { timeout: 1000 }).catch(() => null);
    await page.mouse.click(dismiss.x, dismiss.y);

    await expect.poll(() => fullCardCount(page)).toBe(0);
    expect(await popupPromise, "Dismiss must not open the blocked tab").toBeNull();
    expect(await pageCaptureEventCount(page)).toBe(0);
    await expect(page).toHaveURL(/evasion-01-opacity-009\.html/);
  } finally {
    await cleanup();
  }
});

test("the page warning exposes Dismiss as its only control @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupFenceTest("evasion-01-opacity-009.html");
  try {
    await blockTrapNewTab(page, context);
    const before = context.pages().length;
    const labels = await page.evaluate(() => {
      const host = document.querySelector("#__navsentinel_toast_host");
      return Array.from(host?.shadowRoot?.querySelectorAll("button") ?? [], (button) =>
        button.textContent?.trim() ?? "");
    });
    expect(labels).toEqual(["Dismiss"]);
    expect(context.pages()).toHaveLength(before);
  } finally {
    await cleanup();
  }
});

test("keyboard Enter and Space activate focused toast controls @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupFenceTest("evasion-01-opacity-009.html");
  try {
    await blockTrapNewTab(page, context);
    const focusToastButton = (label: string) => page.evaluate((expected) => {
      const host = document.querySelector("#__navsentinel_toast_host");
      const buttons = Array.from(host?.shadowRoot?.querySelectorAll("button") ?? []);
      const match = buttons.find((button) => button.textContent?.trim() === expected);
      if (!match) throw new Error(`Toast button not found: ${expected}`);
      match.focus();
    }, label);

    await focusToastButton("Dismiss");
    // Count only the keyboard input; the trap click above is a page click by design.
    await countPageCaptureEvents(page);
    const popupPromise = context.waitForEvent("page", { timeout: 1000 }).catch(() => null);
    await page.keyboard.press("Enter");
    await expect.poll(() => fullCardCount(page)).toBe(0);
    expect(await popupPromise).toBeNull();
    expect(await pageCaptureEventCount(page)).toBe(0);

    await blockTrapNewTab(page, context);
    await focusToastButton("Dismiss");
    await countPageCaptureEvents(page);
    await page.keyboard.press("Space");
    await expect.poll(() => fullCardCount(page)).toBe(0);
    expect(await pageCaptureEventCount(page)).toBe(0);
  } finally {
    await cleanup();
  }
});

test("toast controls stay clickable above a maximum-z-index layer inserted after the host @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupFenceTest("evasion-01-opacity-009.html");
  try {
    await blockTrapNewTab(page, context);
    // A media page re-inserts a fixed, maximum-z-index, no-src iframe under
    // <html> after NavSentinel's host already exists. Later DOM order wins a
    // z-index tie, so without top-layer placement this layer swallows clicks.
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.id = "late-cover-frame";
      frame.style.cssText =
        "position:fixed!important;inset:0!important;width:100%!important;height:100%!important;" +
        "z-index:2147483647!important;border:0!important;margin:0!important;padding:0!important;" +
        "background:transparent!important;opacity:0.999";
      document.documentElement.appendChild(frame);
    });

    const dismiss = await toastButtonPoint(page, "Dismiss");
    const hitsToastHost = await page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.id === "__navsentinel_toast_host", dismiss);
    expect(hitsToastHost, "the late layer must not sit above the toast host").toBe(true);

    await page.mouse.click(dismiss.x, dismiss.y);
    await expect.poll(() => fullCardCount(page)).toBe(0);
  } finally {
    await cleanup();
  }
});

test("a page-forged toast host cannot activate a real warning control @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupFenceTest("evasion-01-opacity-009.html");
  try {
    await blockTrapNewTab(page, context);
    // The page can read the open shadow root, so it copies whatever marks the
    // real Dismiss control onto a full-viewport element inside a fake host
    // that carries the extension's host id, then waits for any trusted click.
    await page.evaluate(() => {
      const real = document.querySelector("#__navsentinel_toast_host");
      const dismiss = Array.from(real?.shadowRoot?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent?.trim() === "Dismiss");
      const fakeHost = document.createElement("div");
      fakeHost.id = "__navsentinel_toast_host";
      fakeHost.style.cssText = "position:fixed;inset:0;z-index:2147483646;";
      const fakeRoot = fakeHost.attachShadow({ mode: "open" });
      const bait = document.createElement("div");
      bait.style.cssText = "position:fixed;inset:0;";
      for (const attribute of Array.from(dismiss?.attributes ?? [])) {
        bait.setAttribute(attribute.name, attribute.value);
      }
      fakeRoot.appendChild(bait);
      document.body.appendChild(fakeHost);
    });

    const before = context.pages().length;
    const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    // Click the page body, far from the real card at the bottom-right corner.
    await page.mouse.click(40, 40);

    // Activation would remove the real card synchronously; check before the
    // card's own 4-second idle timeout can expire.
    await page.waitForTimeout(250);
    expect(await fullCardCount(page), "the real card must remain unactivated").toBe(1);
    expect(await popupPromise, "a forged host must not activate the real control").toBeNull();
    expect(context.pages().length).toBe(before);
  } finally {
    await cleanup();
  }
});
