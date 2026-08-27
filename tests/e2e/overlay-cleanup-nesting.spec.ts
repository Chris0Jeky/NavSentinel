import { test, expect, chromium, type BrowserContext, type Frame, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  getGymBaseUrl,
  updateNavigationSettings,
  waitForNavSentinelBridge,
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

async function setupNestedTest(pathname: string): Promise<{
  page: Page;
  context: BrowserContext;
  baseUrl: string;
  cleanup: () => Promise<void>;
}> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-nested-overlay-"));
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
    await page.goto(`${baseUrl}/${pathname}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);
    return {
      page,
      context,
      baseUrl,
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

async function childFrame(page: Page, fixtureCase: string, instance?: number): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => {
    const url = new URL(frame.url());
    return url.pathname.endsWith("/overlay-nesting-frame.html") &&
      url.searchParams.get("case") === fixtureCase &&
      (instance === undefined || url.searchParams.get("instance") === String(instance));
  }), { timeout: 10_000 }).toBe(true);

  const frame = page.frames().find((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname.endsWith("/overlay-nesting-frame.html") &&
      url.searchParams.get("case") === fixtureCase &&
      (instance === undefined || url.searchParams.get("instance") === String(instance));
  });
  if (!frame) throw new Error(`Nested fixture frame did not load: ${fixtureCase}/${instance ?? "single"}`);

  await frame.waitForFunction(() =>
    document.documentElement.dataset.fixtureReady === "true" &&
    document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1",
  null, { timeout: 10_000 });
  return frame;
}

async function waitForFrameToast(frame: Frame, pattern: RegExp): Promise<void> {
  await frame.waitForFunction(({ source, flags }) => {
    const host = document.querySelector("#__navsentinel_toast_host");
    const text = host?.shadowRoot?.querySelector(".body")?.textContent ?? "";
    return new RegExp(source, flags).test(text);
  }, { source: pattern.source, flags: pattern.flags }, { timeout: 5000 });
}

async function clickFrameToastButton(frame: Frame, label: string): Promise<void> {
  await frame.evaluate((expected) => {
    const host = document.querySelector("#__navsentinel_toast_host");
    const button = Array.from(host?.shadowRoot?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent?.trim() === expected);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Toast button not found: ${expected}`);
    button.click();
  }, label);
}

test("nested cleanup hides the exact cross-origin frame pattern and Undo restores it @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupNestedTest("overlay-nesting-lab.html?case=exact");

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    const pageCount = context.pages().length;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    const frame = await childFrame(page, "exact");

    await expect(page.locator("#media-frame")).toBeVisible();
    await expect(frame.locator("#exact-overlay-frame")).toBeHidden({ timeout: 4000 });
    await expect(frame.locator("#underlay")).toBeVisible();
    await waitForFrameToast(frame, /hid suspicious overlays/i);
    expect(context.pages()).toHaveLength(pageCount);

    await clickFrameToastButton(frame, "Undo");
    await expect(frame.locator("#exact-overlay-frame")).toBeVisible();
    expect(context.pages()).toHaveLength(pageCount);
  } finally {
    await cleanup();
  }
});

test("nested cleanup stays inert when disabled or Navigation is Off and preserves benign layers @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, baseUrl, cleanup } = await setupNestedTest("overlay-nesting-lab.html?case=exact");

  try {
    let frame = await childFrame(page, "exact");
    await page.waitForTimeout(1200);
    await expect(frame.locator("#exact-overlay-frame")).toBeVisible();

    await updateNavigationSettings(context, { defaultMode: "off", autoDismissOverlays: true });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    frame = await childFrame(page, "exact");
    await page.waitForTimeout(1200);
    await expect(frame.locator("#exact-overlay-frame")).toBeVisible();

    await updateNavigationSettings(context, { defaultMode: "smart", autoDismissOverlays: true });
    await page.goto(`${baseUrl}/overlay-nesting-lab.html?case=benign`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);
    frame = await childFrame(page, "benign");
    await page.waitForTimeout(1200);
    await expect(frame.locator("#benign-dialog")).toBeVisible();
    await expect(frame.locator("#low-z-overlay")).toBeVisible();
    await expect(frame.locator("#small-overlay")).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("nested cleanup releases child monitoring after the opt-in is disabled @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupNestedTest("overlay-nesting-lab.html?case=exact");

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    const frame = await childFrame(page, "exact");
    await expect(frame.locator("#exact-overlay-frame")).toBeHidden({ timeout: 4000 });

    await updateNavigationSettings(context, { autoDismissOverlays: false });
    await page.waitForTimeout(300);
    await frame.evaluate(() => {
      const overlay = document.createElement("div");
      overlay.id = "post-disable-overlay";
      overlay.dataset.attack = "true";
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:block;background:#4b145f";
      document.documentElement.appendChild(overlay);
    });
    await page.waitForTimeout(500);
    await expect(frame.locator("#post-disable-overlay")).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("nested cleanup handles a twelve-frame mixed nesting matrix without touching benign layers @phase2", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupNestedTest("overlay-nesting-stress.html");
  const cases = ["exact", "delayed", "body", "wrapper", "multiple", "benign",
    "exact", "delayed", "body", "wrapper", "multiple", "benign"];

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    const pageCount = context.pages().length;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);

    for (const [index, fixtureCase] of cases.entries()) {
      const frame = await childFrame(page, fixtureCase, index);
      if (fixtureCase === "benign") {
        await expect(frame.locator("#benign-dialog")).toBeVisible();
        await expect(frame.locator("#low-z-overlay")).toBeVisible();
        await expect(frame.locator("#small-overlay")).toBeVisible();
      } else {
        const attacks = frame.locator("[data-attack='true']");
        await expect.poll(async () => {
          const count = await attacks.count();
          const visible = await Promise.all(Array.from({ length: count }, (_, candidate) =>
            attacks.nth(candidate).isVisible(),
          ));
          return { count, visible: visible.filter(Boolean).length };
        }, {
          message: `nested stress case ${fixtureCase} at index ${index}`,
          timeout: 6000,
        }).toEqual({
          count: fixtureCase === "multiple" ? 3 : 1,
          visible: 0,
        });
      }
    }

    await expect(page.locator("#matrix > iframe")).toHaveCount(12);
    expect(context.pages()).toHaveLength(pageCount);
  } finally {
    await cleanup();
  }
});
