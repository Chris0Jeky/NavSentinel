/**
 * Regressions for the MAIN-world form.submit()/requestSubmit() gate.
 *
 * #864: a page that submits its own form synchronously or in a microtask from
 * its handler for a trusted click was blocked, while the same submit one task
 * later passed, because the isolated world's allowance crosses the bridge
 * MessagePort a task late. The MAIN world now arms that allowance for the
 * click's own task. The negative controls pin what must NOT arm it: an
 * untrusted click, and the `change`/`submit` events page script can make
 * trusted (`checkbox.click()`, a script `button.click()` on a submit button).
 * The budget pair shows one click still buys at most two submissions whether
 * they run in the click's task or one task later.
 *
 * #865: a post into the page's own named iframe never navigates the tab and
 * passes silently; names that would navigate the tab or open a new window
 * (submitter `_top`, an unknown name, a child that renamed itself, a name the
 * top window itself carries) keep the gate.
 *
 * Fixture: gym/form-submit-gesture-task.html. Child-frame (#593/#637) behaviour
 * for same-task submits is covered by the `-sync` arms of
 * issue593-hidden-media-layer.spec.ts.
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
const FIXTURE = "form-submit-gesture-task.html";
const BLOCKED = "Blocked form submit";

test.setTimeout(180_000);

async function withExtension(run: (context: BrowserContext, baseUrl: string) => Promise<void>): Promise<void> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-form-submit-"));
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
  await page.goto(`${baseUrl}/${FIXTURE}?mode=${mode}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await waitForNavSentinelBridge(page);
  return page;
}

function landed(mode: string): RegExp {
  return new RegExp(`/form-submit-landing\\.html\\?case=${mode}$`);
}

async function handlerRan(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.dataset.fixtureHandler ?? null);
}

async function expectBlocked(page: Page, handler: string): Promise<void> {
  // The toast auto-hides after ~5 s, so read it right after the action.
  await waitForToastText(page, BLOCKED, 3_000);
  expect(await handlerRan(page), "the page handler ran and attempted the submit").toBe(handler);
  expect(new URL(page.url()).pathname).toBe(`/${FIXTURE}`);
}

test("same-task form submits after a trusted click pass; forged triggers do not (#864) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    for (const mode of ["sync", "microtask", "request-submit"]) {
      await test.step(`trusted click, ${mode} submit navigates`, async () => {
        const page = await openFixture(context, baseUrl, mode);
        await page.click("#trigger");
        await page.waitForURL(landed(mode), { timeout: 5_000 });
        await page.close();
      });
    }

    await test.step("trusted submit click, validation handler submits synchronously", async () => {
      const page = await openFixture(context, baseUrl, "validate-sync");
      await page.click("#validated-submit");
      await page.waitForURL(landed("validate-sync"), { timeout: 5_000 });
      await page.close();
    });

    await test.step("an untrusted click arms nothing, even in its own task (RI-01)", async () => {
      const page = await openFixture(context, baseUrl, "sync");
      await page.evaluate(() => {
        document.getElementById("trigger")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await expectBlocked(page, "trigger:sync:false");
      await page.close();
    });

    await test.step("a script-made trusted change event arms nothing", async () => {
      const page = await openFixture(context, baseUrl, "change");
      await page.evaluate(() => (document.getElementById("toggle") as HTMLInputElement).click());
      await expectBlocked(page, "change:change:true");
      await page.close();
    });

    await test.step("a script-made trusted submit event arms nothing", async () => {
      const page = await openFixture(context, baseUrl, "submit-event");
      await page.evaluate(() => (document.getElementById("decoy-submit") as HTMLButtonElement).click());
      await expectBlocked(page, "decoy:submit-event:true");
      await page.close();
    });

    for (const mode of ["budget-sync", "budget-deferred"]) {
      await test.step(`one trusted click buys two submissions, not three (${mode})`, async () => {
        const page = await openFixture(context, baseUrl, mode);
        const opened: Page[] = [];
        const onPage = (candidate: Page) => opened.push(candidate);
        context.on("page", onPage);
        try {
          await page.click("#trigger");
          await waitForToastText(page, BLOCKED, 3_000);
          await expect.poll(() => opened.length, { timeout: 5_000 }).toBe(2);
          // Give a wrongly-allowed third submission time to open its tab.
          await page.waitForTimeout(1_500);
          expect(opened, "exactly two of the three new-tab submissions ran").toHaveLength(2);
          const names = await Promise.all(opened.map(async (tab) => {
            await tab.waitForURL(/form-submit-landing\.html\?n=/, { timeout: 5_000 });
            return new URL(tab.url()).searchParams.get("n");
          }));
          expect(names.sort()).toEqual(["a", "b"]);
        } finally {
          context.off("page", onPage);
          for (const tab of opened) await tab.close().catch(() => undefined);
          await page.close();
        }
      });
    }
  });
});

test("a post into the page's own named iframe passes silently; other names keep the gate (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    const sinkPath = (page: Page) => {
      const url = page.frames().find((frame) => frame.name() === "sink")?.url() ?? "";
      return url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
    };

    for (const mode of ["frame-post", "frame-request-submit", "base-target"]) {
      await test.step(`${mode}: reaches the child frame with no notice`, async () => {
        const page = await openFixture(context, baseUrl, mode);
        await page.evaluate(() => (window as unknown as { __nsRunNamedFrameCase(): void }).__nsRunNamedFrameCase());
        await expect.poll(() => sinkPath(page), { timeout: 5_000 }).toBe(`/form-submit-landing.html?case=${mode}`);
        await assertNoToastFor(page, 1_500);
        expect(new URL(page.url()).pathname).toBe(`/${FIXTURE}`);
        await page.close();
      });
    }

    for (const mode of ["frame-formtarget-top", "unknown-name", "renamed-child", "self-name"]) {
      await test.step(`${mode}: would leave the page, so it stays gated`, async () => {
        const page = await openFixture(context, baseUrl, mode);
        const pagesBefore = context.pages().length;
        await page.evaluate(() => (window as unknown as { __nsRunNamedFrameCase(): void }).__nsRunNamedFrameCase());
        await expectBlocked(page, `frame:${mode}`);
        expect(sinkPath(page), "the child frame was not navigated either").not.toContain("form-submit-landing");
        expect(context.pages().length, "no new window opened").toBe(pagesBefore);
        await page.close();
      });
    }
  });
});
