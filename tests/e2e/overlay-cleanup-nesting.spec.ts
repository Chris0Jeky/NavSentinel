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
  clickToastButton,
  evaluateInToast,
  getGymBaseUrl,
  pressToastButton,
  readBuiltUiGuardRevision,
  updateNavigationSettings,
  waitForNavSentinelBridge,
  waitForToast,
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

// The 2.8 s cleanup chip must be seen leaving within 3 s. expect.poll's default
// back-off (up to 1 s between reads) can miss that window; locators retried faster.
const LOCATOR_LIKE_POLL = { timeout: 3000, intervals: [100] };

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

  await frame.waitForFunction((expectedGuard) =>
    document.documentElement.dataset.fixtureReady === "true" &&
    document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-ui-guard") === expectedGuard,
  readBuiltUiGuardRevision(), { timeout: 10_000 });
  return frame;
}

async function waitForFrameToast(frame: Frame, pattern: RegExp): Promise<void> {
  await waitForToast(frame, (roots, { source, flags }) =>
    new RegExp(source, flags).test(roots[0]?.querySelector(".body")?.textContent ?? ""),
  { source: pattern.source, flags: pattern.flags }, 5000);
}

const clickFrameToastButton = clickToastButton;
const pressFrameToastButton = (frame: Frame, label: string) => pressToastButton(frame, label);

/** Frame-viewport box of the first rendered element matching `selector` in the toast root, or null. */
async function toastBox(frame: Frame, selector: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return evaluateInToast(frame, (roots, sel) => {
    const rect = roots[0]?.querySelector(sel)?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null;
  }, selector);
}

/** Elements matching `selector` across every toast root (the real host and any forged one). */
async function toastCount(frame: Frame, selector: string): Promise<number> {
  return evaluateInToast(frame, (roots, sel) =>
    roots.reduce((count, root) => count + root.querySelectorAll(sel).length, 0), selector);
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
    await waitForFrameToast(frame, /overlay hidden/i);
    expect(context.pages().length).toBeLessThanOrEqual(pageCount);

    await clickFrameToastButton(frame, "Undo");
    await expect(frame.locator("#exact-overlay-frame")).toBeVisible();
    expect(context.pages().length).toBeLessThanOrEqual(pageCount);
  } finally {
    await cleanup();
  }
});

test("cleanup recovery notice is small and leaves after two seconds or an outside interaction @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupNestedTest("overlay-nesting-lab.html?case=exact");

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    let frame = await childFrame(page, "exact");
    await waitForFrameToast(frame, /overlay hidden/i);

    const notice = ".wrap[data-persistent='true']";
    const noticeBox = await waitForToast(frame, (roots, sel) => {
      const rect = roots[0]?.querySelector(sel)?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null;
    }, notice);
    expect(noticeBox.width).toBeLessThanOrEqual(300);
    expect(noticeBox.height).toBeLessThanOrEqual(72);
    expect(await toastBox(frame, `${notice} button`), "Undo is rendered").not.toBeNull();
    expect(await evaluateInToast(frame, (roots, sel) =>
      Array.from(roots[0]?.querySelectorAll(`${sel} button`) ?? [], (button) => button.textContent?.trim()), notice))
      .toEqual(["Undo"]);

    await frame.locator("#outside-toast-target").click();
    await expect.poll(() => frame.evaluate(() =>
      document.documentElement.dataset.outsideInteractionCount,
    )).toBe("1");
    await expect.poll(() => toastCount(frame, notice)).toBe(0);
    await expect(frame.locator("#exact-overlay-frame")).toBeHidden();

    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    frame = await childFrame(page, "exact");
    await waitForFrameToast(frame, /overlay hidden/i);
    await expect.poll(() => toastCount(frame, ".wrap[data-persistent='true']"), LOCATOR_LIKE_POLL).toBe(0);
    await expect(frame.locator("#exact-overlay-frame")).toBeHidden();
  } finally {
    await cleanup();
  }
});

test("cleanup notice briefly yields to a preserved accessible player-error dialog @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupNestedTest(
    "overlay-nesting-lab.html?case=accessible-error",
  );

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    const pageCount = context.pages().length;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    const frame = await childFrame(page, "accessible-error");
    await waitForFrameToast(frame, /overlay hidden/i);

    await expect(frame.locator("#exact-overlay-frame")).toBeHidden();
    const dialog = frame.getByRole("dialog", { name: "Synthetic player error" });
    const confirm = dialog.getByRole("button", { name: "OK", exact: true });
    const notice = ".brief-recovery";
    await expect(dialog).toBeVisible();
    await expect(confirm).toBeVisible();

    // Both boxes in the frame's own viewport coordinates.
    const noticeBox = await waitForToast(frame, (roots, sel) => {
      const rect = roots[0]?.querySelector(sel)?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null;
    }, notice);
    const confirmBox = await confirm.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(
      noticeBox.x < confirmBox.x + confirmBox.width &&
      noticeBox.x + noticeBox.width > confirmBox.x &&
      noticeBox.y < confirmBox.y + confirmBox.height &&
      noticeBox.y + noticeBox.height > confirmBox.y,
    ).toBe(true);

    // The chip's own 2.8 s timer removes it; each CDP read of the closed root can take
    // a few hundred ms on a loaded runner, so allow slack beyond the 3 s window (#1202 CI).
    await expect.poll(() => toastCount(frame, notice), { ...LOCATOR_LIKE_POLL, timeout: 4500 }).toBe(0);
    await confirm.click();
    await expect.poll(() => frame.evaluate(() =>
      document.documentElement.dataset.dialogConfirmCount,
    )).toBe("1");
    await expect(dialog).toHaveCount(0);
    // No page opened; a stray blank page closing on its own is not a failure.
    expect(context.pages().length).toBeLessThanOrEqual(pageCount);
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
    await waitForFrameToast(frame, /overlay hidden/i);
    await expect.poll(() => frame.evaluate(() =>
      document.documentElement.dataset.controlPathRetargeted,
    )).toBe("true");
    await expect.poll(() => frame.evaluate(() =>
      document.documentElement.dataset.controlFieldsPoisoned,
    )).toBe("true");

    const pageCount = context.pages().length;
    await frame.evaluate(() => {
      window.open("https://relay-target.example/blocked", "_blank");
    });
    // Only the regular block card has a Dismiss; the cleanup chip does not.
    await expect.poll(() => evaluateInToast(frame, (roots) => roots
      .flatMap((root) => Array.from(root.querySelectorAll("button")))
      .filter((button) => button.textContent?.trim() === "Dismiss").length)).toBe(1);
    await clickToastButton(frame, "Dismiss");
    await expect.poll(() => frame.evaluate(() =>
      Number(document.documentElement.dataset.pageControlEventCount ?? "0"),
    )).toBe(0);
    await expect.poll(() => toastCount(frame, ".wrap:not([data-persistent='true'])")).toBe(0);
    await expect(frame.locator("#exact-overlay-frame")).toBeHidden();
    await expect.poll(() => frame.evaluate(() =>
      Number(document.documentElement.dataset.poisonedMouseFieldReads ?? "-1"),
    )).toBe(0);
    expect(context.pages().length).toBeLessThanOrEqual(pageCount);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    frame = await childFrame(page, "hostile");
    await waitForFrameToast(frame, /overlay hidden/i);
    await pressFrameToastButton(frame, "Undo");
    await expect.poll(() => frame.evaluate(() =>
      Number(document.documentElement.dataset.pageControlEventCount ?? "0"),
    )).toBe(0);
    await expect.poll(() => frame.evaluate(() =>
      Number(document.documentElement.dataset.poisonedKeyFieldReads ?? "-1"),
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

for (const { fixtureCase, overlay } of [
  { fixtureCase: "deep-static", overlay: "#deep-static-overlay" },
  { fixtureCase: "shadow-static", overlay: "#shadow-static-overlay" },
]) {
  test(`initial cleanup hides a pre-existing ${fixtureCase} overlay, Undo restores it, and disabled stays inert @regression`, async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
    const { page, context, cleanup } = await setupNestedTest(`overlay-nesting-lab.html?case=${fixtureCase}`);

    try {
      let frame = await childFrame(page, fixtureCase);
      await page.waitForTimeout(1200);
      await expect(frame.locator(overlay)).toBeVisible();

      await updateNavigationSettings(context, { autoDismissOverlays: true });
      const pageCount = context.pages().length;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await waitForNavSentinelBridge(page);
      frame = await childFrame(page, fixtureCase);
      await expect(frame.locator(overlay)).toBeHidden({ timeout: 4000 });
      await expect(frame.locator("#underlay")).toBeVisible();
      await waitForFrameToast(frame, /overlay hidden/i);

      await clickFrameToastButton(frame, "Undo");
      await expect(frame.locator(overlay)).toBeVisible();
      // Undo must hold through the remaining settle rescans.
      await page.waitForTimeout(2500);
      await expect(frame.locator(overlay)).toBeVisible();
      // No popup opened; a transient browser page may close meanwhile.
      expect(context.pages().length).toBeLessThanOrEqual(pageCount);
    } finally {
      await cleanup();
    }
  });
}

test("initial cleanup preserves deep dialog layers and shadow-hosted chat widgets @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { page, context, cleanup } = await setupNestedTest("overlay-nesting-lab.html?case=deep-benign");

  try {
    await updateNavigationSettings(context, { autoDismissOverlays: true });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    const frame = await childFrame(page, "deep-benign");
    await page.waitForTimeout(3000);
    await expect(frame.locator("#deep-dialog-panel")).toBeVisible();
    await expect(frame.locator("#chat-panel")).toBeVisible();
    await expect(frame.locator("#slotted-dialog-panel")).toBeVisible();
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
    for (const [index, fixtureCase] of cases.entries()) {
      if (fixtureCase === "benign") continue;
      const frame = await childFrame(page, fixtureCase, index);
      await expect.poll(() => toastCount(frame, ".wrap[data-persistent='true']"), LOCATOR_LIKE_POLL).toBe(0);
    }
    expect(context.pages().length).toBeLessThanOrEqual(pageCount);
  } finally {
    await cleanup();
  }
});
