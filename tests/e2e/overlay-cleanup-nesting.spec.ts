import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Frame,
  type Page,
  type TestInfo,
} from "@playwright/test";
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
  const button = frame.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  await button.click();
}

async function pressFrameToastButton(frame: Frame, label: string): Promise<void> {
  const button = frame.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  await button.press("Enter");
}

type AttackVisibilitySample = {
  elapsedMs: number;
  phase: string;
  total: number;
  visible: Array<{ id: string; display: string; visibility: string }>;
};

/**
 * A passing state must remain true for the whole dwell window. The previous
 * `toBeHidden` / `expect.poll` oracle stopped at the first hidden sample, which
 * let a page re-show or replace the layer immediately after a green assertion.
 */
async function expectAttacksHiddenFor(
  frame: Frame,
  testInfo: TestInfo,
  label: string,
  durationMs: number,
  triggerScrollAtMs?: number,
): Promise<void> {
  const samples = await frame.evaluate(async ({ duration, triggerAt }) => {
    const started = performance.now();
    const timeline: AttackVisibilitySample[] = [];
    // Fire page churn in its own task. MutationObserver then receives its
    // required microtask checkpoint before the next render sample, so this
    // oracle measures paint-visible exposure rather than synchronous DOM state.
    const scrollTimer = triggerAt === undefined
      ? null
      : window.setTimeout(() => window.dispatchEvent(new Event("scroll")), triggerAt);

    await new Promise<void>((resolve) => {
      let animationFrame = 0;
      let watchdog = 0;
      let sequence = 0;
      const schedule = () => {
        const current = ++sequence;
        animationFrame = requestAnimationFrame(() => sample(current));
        watchdog = window.setTimeout(() => sample(current), 100);
      };
      const sample = (current: number) => {
        if (current !== sequence) return;
        sequence += 1;
        window.cancelAnimationFrame(animationFrame);
        window.clearTimeout(watchdog);
        const elapsed = performance.now() - started;
        const attacks = Array.from(
          document.querySelectorAll<HTMLElement>("[data-attack='true']"),
        );
        const visible = attacks.flatMap((attack) => {
          const style = getComputedStyle(attack);
          const rect = attack.getBoundingClientRect();
          return style.display === "none" ||
            style.visibility === "hidden" ||
            rect.width <= 0 ||
            rect.height <= 0
            ? []
            : [{
                id: attack.id || attack.tagName.toLowerCase(),
                display: style.display,
                visibility: style.visibility,
              }];
        });
        timeline.push({
          elapsedMs: Math.round(elapsed),
          phase: document.documentElement.dataset.hostilePhase ?? "settled",
          total: attacks.length,
          visible,
        });
        if (elapsed >= duration) {
          resolve();
        } else {
          // Off-screen child frames may suspend rAF. Keep the evidence bounded
          // without weakening its visibility assertion.
          schedule();
        }
      };
      schedule();
    });
    if (scrollTimer !== null) window.clearTimeout(scrollTimer);
    return timeline;
  }, { duration: durationMs, triggerAt: triggerScrollAtMs });

  await testInfo.attach(`${label}-visibility-timeline`, {
    body: Buffer.from(JSON.stringify(samples, null, 2)),
    contentType: "application/json",
  });

  const reappearances = samples.filter((sample) => sample.visible.length > 0);
  expect(
    reappearances.slice(0, 10),
    `${label} reappeared after its first confirmed hidden state; full timeline is attached`,
  ).toEqual([]);
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

test("nested cleanup remains effective across alert floods, page rewrites, reinsertion, and scroll churn @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupNestedTest("overlay-nesting-lab.html?case=hostile");

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    const frame = await childFrame(page, "hostile");

    await expect(frame.locator("#exact-overlay-frame")).toBeHidden({ timeout: 4000 });
    await expectAttacksHiddenFor(frame, testInfo, "hostile-nested-overlay", 6500, 4200);
    await expect(frame.locator("#underlay")).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("toast mouse and keyboard controls do not leak capture-phase input into the protected page @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupNestedTest("overlay-nesting-lab.html?case=hostile");

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    let frame = await childFrame(page, "hostile");
    await waitForFrameToast(frame, /hid suspicious overlays/i);
    await expect.poll(() => frame.evaluate(() =>
      document.documentElement.dataset.controlPathRetargeted,
    )).toBe("true");

    const pageCount = context.pages().length;
    await frame.evaluate(() => {
      window.open("https://relay-target.example/blocked", "_blank");
    });
    const toastHost = frame.locator("#__navsentinel_toast_host");
    await expect(toastHost.getByRole("button", { name: "Dismiss", exact: true }))
      .toHaveCount(2);
    await toastHost.locator(".wrap[data-persistent='true']")
      .getByRole("button", { name: "Dismiss", exact: true })
      .click();
    await expect.poll(() => frame.evaluate(() =>
      Number(document.documentElement.dataset.pageControlEventCount ?? "0"),
    )).toBe(0);
    await expect.poll(() => frame.evaluate(() =>
      !document.querySelector("#__navsentinel_toast_host")?.shadowRoot
        ?.querySelector(".wrap[data-persistent='true']"),
    )).toBe(true);
    expect(context.pages()).toHaveLength(pageCount);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    frame = await childFrame(page, "hostile");
    await waitForFrameToast(frame, /hid suspicious overlays/i);
    await pressFrameToastButton(frame, "Undo");
    await expect.poll(() => frame.evaluate(() =>
      Number(document.documentElement.dataset.pageControlEventCount ?? "0"),
    )).toBe(0);
    await expect(frame.locator("#exact-overlay-frame")).toBeVisible();
  } finally {
    await cleanup();
  }
});

test("cleanup hides a compact interactive attack while preserving small benign controls @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, baseUrl, cleanup } = await setupNestedTest(
    "overlay-nesting-lab.html?case=compact-hostile",
  );

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    let frame = await childFrame(page, "compact-hostile");
    await expect(frame.locator("#compact-hostile")).toBeHidden({ timeout: 4000 });
    await expectAttacksHiddenFor(frame, testInfo, "compact-interactive-overlay", 900);

    await page.goto(`${baseUrl}/overlay-nesting-lab.html?case=benign`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);
    frame = await childFrame(page, "benign");
    await expect(frame.locator("#small-overlay")).toContainText("expected visible");
    await expect(frame.locator("#small-overlay")).toBeVisible();
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
    await expect(frame.locator("#exact-overlay-frame")).toBeVisible();

    await updateNavigationSettings(context, { autoDismissOverlays: true });
    await expect(frame.locator("#exact-overlay-frame")).toBeHidden({ timeout: 3000 });

    await updateNavigationSettings(context, { autoDismissOverlays: false });
    await expect(frame.locator("#exact-overlay-frame")).toBeVisible();
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

test("nested cleanup handles a twelve-frame mixed nesting matrix without touching benign layers @phase2", async ({}, testInfo) => {
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
      const frameElement = await frame.frameElement();
      await frameElement.scrollIntoViewIfNeeded();
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
        await expectAttacksHiddenFor(
          frame,
          testInfo,
          `stress-${index}-${fixtureCase}`,
          900,
        );
      }
    }

    await expect(page.locator("#matrix > iframe")).toHaveCount(12);
    expect(context.pages()).toHaveLength(pageCount);
  } finally {
    await cleanup();
  }
});
