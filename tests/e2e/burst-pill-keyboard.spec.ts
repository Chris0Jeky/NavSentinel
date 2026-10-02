/**
 * Trusted keyboard coverage for the burst count pill.
 *
 * `tests/ui-toast-coalesce.test.ts` drives pill expansion through
 * `activateOwnedToastControl` directly, and RW-19 browser coverage observes the
 * pill without activating it. These cases use real keyboard input on the real
 * `.pill` element so they exercise the same trusted path a person does: focus
 * the pill, then press Enter or Space via `page.keyboard`.
 */
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  dismissOnboarding,
  getGymBaseUrl,
  waitForNavSentinelBridge,
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

async function setupBurstPillTest(): Promise<{
  page: Page;
  context: BrowserContext;
  beforePages: number;
  cleanup: () => Promise<void>;
}> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-burst-pill-"));
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
    await dismissOnboarding(context);
    const page = await context.newPage();
    const beforePages = context.pages().length;
    await page.goto(`${baseUrl}/rw19-tech-support-scare.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);
    return {
      page,
      context,
      beforePages,
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

/** Full (non-persistent) cards across every element carrying the host id. */
async function fullCardCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#__navsentinel_toast_host")).reduce((count, host) =>
      count + (host.shadowRoot?.querySelectorAll(".wrap:not([data-persistent='true'])").length ?? 0), 0),
  );
}

async function fullCardBody(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector("#__navsentinel_toast_host");
    return host?.shadowRoot?.querySelector(".wrap:not([data-persistent='true']) .body")
      ?.textContent?.trim() ?? "";
  });
}

async function fullCardButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector("#__navsentinel_toast_host");
    return Array.from(
      host?.shadowRoot?.querySelectorAll(".wrap:not([data-persistent='true']) button") ?? [],
      (button) => button.textContent?.trim() ?? "",
    );
  });
}

/**
 * Install page-realm capture listeners for the control-input events a keyboard
 * activation could leak, following the toast-input-fence pattern. The
 * extension-owned shadow root isolates its own input, so page listeners must
 * observe none of it.
 */
async function countPageControlInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.pageControlEventCount = "0";
    for (const type of ["keydown", "keyup", "click"]) {
      window.addEventListener(type, () => {
        const current = Number(document.documentElement.dataset.pageControlEventCount ?? "0");
        document.documentElement.dataset.pageControlEventCount = String(current + 1);
      }, { capture: true });
    }
  });
}

async function pageControlInputCount(page: Page): Promise<number> {
  return page.evaluate(() => Number(document.documentElement.dataset.pageControlEventCount ?? "0"));
}

/** Wait for the fixture burst to finish and the real count pill to render. */
async function waitForBurstPill(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.getElementById("attempts")?.textContent?.includes("4"),
    null,
    { timeout: 5000 },
  );
  // Require the real toast .pill: a full-card fallback does not satisfy this.
  await page.waitForFunction(
    () => {
      const pill = document.querySelector("#__navsentinel_toast_host")?.shadowRoot
        ?.querySelector(".pill");
      return pill?.querySelector(".pill-count")?.textContent?.includes("4 navigations") ?? false;
    },
    null,
    { timeout: 4000 },
  );
}

async function readPillAttributes(page: Page): Promise<{
  role: string | null;
  tabIndex: number | null;
  ariaLive: string | null;
  ariaLabel: string | null;
  countText: string | null;
}> {
  return page.evaluate(() => {
    const pill = document.querySelector("#__navsentinel_toast_host")?.shadowRoot
      ?.querySelector(".pill") as HTMLElement | null;
    if (!pill) return { role: null, tabIndex: null, ariaLive: null, ariaLabel: null, countText: null };
    return {
      role: pill.getAttribute("role"),
      tabIndex: pill.tabIndex,
      ariaLive: pill.getAttribute("aria-live"),
      ariaLabel: pill.getAttribute("aria-label"),
      countText: pill.querySelector(".pill-count")?.textContent?.trim() ?? null,
    };
  });
}

async function pillPresent(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    !!document.querySelector("#__navsentinel_toast_host")?.shadowRoot?.querySelector(".pill"),
  );
}

async function activateBurstPillWithKey(page: Page, context: BrowserContext, key: string, beforePages: number): Promise<void> {
  expect(context.pages(), "the entire fixture burst stays blocked").toHaveLength(beforePages);
  const beforeUrl = page.url();
  const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);

  await countPageControlInput(page);
  // Focus the real pill through the open shadow root, then send real keyboard
  // input: no synthetic dispatch, no direct action callback.
  await page.locator("#__navsentinel_toast_host .pill").focus();
  await page.keyboard.press(key);

  await expect.poll(() => pillPresent(page), { timeout: 3000 }).toBe(false);
  expect(await fullCardCount(page), "expanding the pill must render exactly one full card").toBe(1);

  const body = await fullCardBody(page);
  expect(body, "expanded card keeps the latest Blocked popup message").toContain("Blocked popup");
  expect(body, "expanded card notes the earlier blocked burst").toContain("+3 more blocked");
  // The popup-burst class retains the latest prompt's current controls.
  expect(await fullCardButtons(page)).toEqual(["Allow once", "Always allow", "Dismiss"]);

  // Trusted expansion must not open any blocked popup or navigate away.
  expect(await popupPromise, "expanding the pill must not open the blocked popup").toBeNull();
  expect(context.pages()).toHaveLength(beforePages);
  await expect(page).toHaveURL(beforeUrl);
  expect(await pageControlInputCount(page), "no control input must leak to page listeners").toBe(0);
}

test("burst pill keyboard Enter expands to the latest blocked popup card @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, beforePages, cleanup } = await setupBurstPillTest();
  try {
    await waitForBurstPill(page);

    const pill = await readPillAttributes(page);
    expect(pill.countText).toContain("4 navigations");
    expect(pill.role).toBe("status");
    expect(pill.tabIndex).toBe(0);
    expect(pill.ariaLive).toBe("polite");
    expect(pill.ariaLabel).toContain("4 navigations");
    expect(pill.ariaLabel).toContain("Activate for details");

    await activateBurstPillWithKey(page, context, "Enter", beforePages);
  } finally {
    await cleanup();
  }
});

test("burst pill keyboard Space expands to the latest blocked popup card @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, beforePages, cleanup } = await setupBurstPillTest();
  try {
    await waitForBurstPill(page);

    const pill = await readPillAttributes(page);
    expect(pill.countText).toContain("4 navigations");
    expect(pill.role).toBe("status");
    expect(pill.tabIndex).toBe(0);
    expect(pill.ariaLive).toBe("polite");
    expect(pill.ariaLabel).toContain("4 navigations");
    expect(pill.ariaLabel).toContain("Activate for details");

    await activateBurstPillWithKey(page, context, "Space", beforePages);
  } finally {
    await cleanup();
  }
});
