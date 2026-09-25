/**
 * #865 late-target regressions for legacy form.submit().
 *
 * A plain post into this page's own named child must not be announced as a tab
 * navigation. The decision cannot be made at call time, though: formdata runs
 * before the browser resolves the target and may retarget to the tab, a new
 * window, an unknown name, or a name stolen by the top window.
 *
 * The safe implementation boundary exercised here is deliberately narrower
 * than requestSubmit(): collect the original form's finalized FormData without
 * navigating, re-resolve the target, then replay only a still-child-bound
 * payload through an extension-owned form. requestSubmit() remains gated until
 * its trusted submit-event cancellation semantics can be preserved.
 */
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoToastFor,
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
const FIXTURE = "form-submit-child-replay.html";
const BLOCKED = "Blocked form submit";

test.setTimeout(180_000);

async function withExtension(run: (context: BrowserContext, baseUrl: string) => Promise<void>): Promise<void> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-child-replay-"));
  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      await run(context, baseUrl);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function openFixture(context: BrowserContext, baseUrl: string, mode: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/${FIXTURE}?mode=${mode}`, {
    waitUntil: "domcontentloaded",
    timeout: 20_000,
  });
  await waitForNavSentinelBridge(page);
  return page;
}

async function runCase(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Window & { __nsRunFormCase(): void }).__nsRunFormCase();
  });
}

function childFrame(page: Page) {
  const child = page.frames().find((frame) => frame !== page.mainFrame());
  if (!child) throw new Error("named child frame was not created");
  return child;
}

async function formdataCount(page: Page): Promise<number> {
  return page.evaluate(() => Number(document.documentElement.dataset.formdataCount ?? "0"));
}

test("legacy submit replays finalized FormData only into the still-owned child (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    for (const mode of ["safe-submit", "safe-formdata"]) {
      await test.step(mode, async () => {
        const page = await openFixture(context, baseUrl, mode);
        const pagesBefore = context.pages().length;
        const child = childFrame(page);

        await runCase(page);
        await expect.poll(() => child.url(), { timeout: 5_000 }).toContain("/form-submit-landing.html");

        const landing = new URL(child.url());
        expect(landing.searchParams.get("case")).toBe(mode);
        expect(landing.searchParams.get("original")).toBe("kept");
        expect(await formdataCount(page), "page code sees exactly the original formdata phase").toBe(1);
        expect(context.pages().length, "the child post did not open a top-level page").toBe(pagesBefore);
        expect(new URL(page.url()).pathname).toBe(`/${FIXTURE}`);
        await assertNoToastFor(page, 500);

        if (mode === "safe-formdata") {
          expect(landing.searchParams.get("mutated")).toBe("yes");
          expect(landing.searchParams.get("")).toBe("empty-name-preserved");
        }
        await page.close();
      });
    }
  });
});

test("formdata retargets cannot escape the named child replay boundary (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    for (const mode of ["retarget-top", "retarget-blank", "retarget-unknown", "steal-name"]) {
      await test.step(mode, async () => {
        const page = await openFixture(context, baseUrl, mode);
        const pagesBefore = context.pages().length;
        const child = childFrame(page);

        await runCase(page);
        await waitForToastText(page, BLOCKED, 3_000);

        expect(await formdataCount(page), "the late target mutation was observed before the decision").toBe(1);
        expect(new URL(page.url()).pathname).toBe(`/${FIXTURE}`);
        expect(child.url()).not.toContain("form-submit-landing.html");
        expect(context.pages().length, "no new browsing context escaped the gate").toBe(pagesBefore);
        await page.close();
      });
    }

    await test.step("a child that already renamed itself is not mistaken for the declared target", async () => {
      const page = await openFixture(context, baseUrl, "renamed-child");
      const pagesBefore = context.pages().length;
      const child = childFrame(page);

      await runCase(page);
      await waitForToastText(page, BLOCKED, 3_000);

      expect(await formdataCount(page), "no tentative replay starts for a missing child target").toBe(0);
      expect(child.url()).not.toContain("form-submit-landing.html");
      expect(context.pages().length).toBe(pagesBefore);
      await page.close();
    });
  });
});

test("requestSubmit to a named child remains gated pending trusted-submit preservation (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    const page = await openFixture(context, baseUrl, "request-submit-safe");
    const pagesBefore = context.pages().length;
    const child = childFrame(page);

    await runCase(page);
    await waitForToastText(page, BLOCKED, 3_000);

    expect(await formdataCount(page)).toBe(0);
    expect(child.url()).not.toContain("form-submit-landing.html");
    expect(context.pages().length).toBe(pagesBefore);
    await page.close();
  });
});
