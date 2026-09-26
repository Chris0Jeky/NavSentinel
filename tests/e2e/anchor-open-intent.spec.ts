/**
 * #943: a declared new-tab link whose click the page cancels and replaces with
 * its own window.open() (YouTube's embedded "Watch on YouTube"). A trusted
 * click on such a link lets the page open that link's own origin and path once,
 * in the top frame and in a cross-site child frame. Everything else stays gated:
 * another destination, a `_top` target from a child frame, an open after the
 * short lifetime, an untrusted click, and a trusted click on something other
 * than the link.
 *
 * Fixture: gym/anchor-open-intent.html (the same file serves the top page on
 * 127.0.0.1 and the child frame on localhost).
 */
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGymBaseUrl, waitForNavSentinelBridge } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");
const FIXTURE = "anchor-open-intent.html";

test.setTimeout(180_000);

async function withExtension(run: (context: BrowserContext, baseUrl: string) => Promise<void>): Promise<void> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-anchor-open-"));
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

async function openFixture(context: BrowserContext, baseUrl: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/${FIXTURE}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await waitForNavSentinelBridge(page);
  return page;
}

async function childFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url().includes(`${FIXTURE}?frame=1`)), { timeout: 10_000 }).toBe(true);
  const frame = page.frames().find((candidate) => candidate.url().includes(`${FIXTURE}?frame=1`))!;
  await frame.waitForFunction(() => document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1", null, { timeout: 15_000 });
  return frame;
}

async function clickLink(page: Page, scope: Page | Frame, mode: string): Promise<void> {
  const box = await scope.locator(`#link-${mode}`).boundingBox();
  if (!box) throw new Error(`#link-${mode} is not rendered`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function handlerRan(scope: Page | Frame): Promise<string | null> {
  return scope.evaluate(() => document.documentElement.dataset.fixtureHandler ?? null);
}

async function expectOpened(context: BrowserContext, action: () => Promise<void>, landing: RegExp): Promise<void> {
  const popup = context.waitForEvent("page", { timeout: 6_000 });
  await action();
  const tab = await popup;
  await tab.waitForLoadState("domcontentloaded").catch(() => undefined);
  expect(tab.url()).toMatch(landing);
  await tab.close();
}

async function expectNotOpened(context: BrowserContext, action: () => Promise<void>, waitMs = 3_000): Promise<void> {
  const before = context.pages().length;
  const popup = context.waitForEvent("page", { timeout: waitMs }).then((tab) => tab.url()).catch(() => null);
  await action();
  expect(await popup, "no tab may open").toBeNull();
  expect(context.pages().length).toBe(before);
}

test("a page-opened declared new-tab link opens its own destination once; other opens stay gated (#943) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    await test.step("top frame: the link's own destination opens", async () => {
      const page = await openFixture(context, baseUrl);
      await expectOpened(context, () => clickLink(page, page, "same"), /anchor-open-landing\.html\?case=same&where=top$/);
      expect(await handlerRan(page)).toBe("same:true");
      await page.close();
    });

    await test.step("top frame: another destination stays blocked", async () => {
      const page = await openFixture(context, baseUrl);
      await expectNotOpened(context, () => clickLink(page, page, "other-path"));
      expect(await handlerRan(page)).toBe("other-path:true");
      await page.close();
    });

    await test.step("top frame: an open after the intent lifetime stays blocked", async () => {
      const page = await openFixture(context, baseUrl);
      await expectNotOpened(context, () => clickLink(page, page, "late"), 4_000);
      expect(await handlerRan(page)).toBe("late:true");
      await page.close();
    });

    await test.step("top frame: an untrusted click opens nothing", async () => {
      const page = await openFixture(context, baseUrl);
      await expectNotOpened(context, () => page.evaluate(() => (document.getElementById("link-untrusted") as HTMLAnchorElement).click()));
      // The isolated world usually stops a synthetic new-tab link click before
      // the page handler runs; if the handler does run, the click is untrusted.
      expect([null, "untrusted:false"]).toContain(await handlerRan(page));
      await page.close();
    });

    await test.step("top frame: a trusted click elsewhere cannot open the link's destination", async () => {
      const page = await openFixture(context, baseUrl);
      const box = await page.locator("#elsewhere").boundingBox();
      await expectNotOpened(context, () => page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2));
      expect(await handlerRan(page)).toBe("elsewhere:true");
      await page.close();
    });

    await test.step("cross-site child frame: the link's own destination opens, including with a different query", async () => {
      const page = await openFixture(context, baseUrl);
      const frame = await childFrame(page);
      await expectOpened(context, () => clickLink(page, frame, "same"), /anchor-open-landing\.html\?case=same&where=child$/);
      await expectOpened(context, () => clickLink(page, frame, "same-path-query"), /anchor-open-landing\.html\?case=same-path-query&where=child&extra=1$/);
      await page.close();
    });

    for (const mode of ["other-path", "top-target"]) {
      await test.step(`cross-site child frame: ${mode} stays blocked`, async () => {
        // A fresh page each time: the previous block's notice can cover the next link.
        const page = await openFixture(context, baseUrl);
        const frame = await childFrame(page);
        const topUrl = page.url();
        await expectNotOpened(context, () => clickLink(page, frame, mode));
        expect(await handlerRan(frame)).toBe(`${mode}:true`);
        expect(page.url(), "the child frame must not navigate the top frame").toBe(topUrl);
        await page.close();
      });
    }
  });
});
