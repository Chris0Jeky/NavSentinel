/**
 * #865/#688 authority-binding regressions for the legacy child-form replay.
 *
 * The page gets one legitimate `formdata` phase so it can mutate payload
 * entries. It must not be able to replace any part of the navigation authority
 * that NavSentinel decided to replay: child identity, target name, action,
 * method, encoding, or accepted character set. A trusted-click allowance must
 * not bypass the same binding from a nested frame.
 */
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getGymBaseUrl,
  readBuiltUiGuardRevision,
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
const ALLOWANCE_FIXTURE = "form-submit-child-allowance.html";
const LANDING = "/form-submit-landing.html";
const BLOCKED = "Blocked form submit";

test.setTimeout(180_000);

async function withExtension(run: (context: BrowserContext, baseUrl: string) => Promise<void>): Promise<void> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-child-authority-"));
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

async function childAuthorityFrame(page: Page): Promise<Frame> {
  await expect
    .poll(
      () =>
        page.frames().some((frame) => {
          const url = new URL(frame.url());
          return (
            url.pathname.endsWith(`/${FIXTURE}`) &&
            url.searchParams.get("mode") === "allowance-retarget-top"
          );
        }),
      { timeout: 10_000 },
    )
    .toBe(true);

  const frame = page.frames().find((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname.endsWith(`/${FIXTURE}`) &&
      url.searchParams.get("mode") === "allowance-retarget-top"
    );
  });
  if (!frame) throw new Error("Child-form allowance fixture did not load");

  await frame.waitForFunction(
    (expectedGuard) =>
      document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
      document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
      document.documentElement.getAttribute("data-navsentinel-ui-guard") === expectedGuard,
    readBuiltUiGuardRevision(),
    { timeout: 10_000 },
  );
  return frame;
}

async function waitForFrameToast(frame: Frame, text: string): Promise<void> {
  await frame.waitForFunction(
    (expected) => {
      const host = document.querySelector("#__navsentinel_toast_host");
      const body = host?.shadowRoot?.querySelector(".body");
      return !!body?.textContent?.includes(expected);
    },
    text,
    { timeout: 4_000 },
  );
}

function childUrls(page: Page): string[] {
  return page
    .frames()
    .filter((frame) => frame !== page.mainFrame())
    .map((frame) => frame.url());
}

async function runCase(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Window & { __nsRunFormCase(): void }).__nsRunFormCase();
  });
}

test("formdata cannot replace any component of a child replay authority (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    for (const mode of [
      "retarget-same-child-alias",
      "retarget-action",
      "retarget-method",
      "retarget-enctype",
      "retarget-accept-charset",
    ]) {
      await test.step(mode, async () => {
        const page = await openFixture(context, baseUrl, mode);
        const pagesBefore = context.pages().length;

        await runCase(page);
        await waitForToastText(page, BLOCKED, 3_000);

        expect(new URL(page.url()).pathname).toBe(`/${FIXTURE}`);
        expect(childUrls(page).every((url) => !url.includes(LANDING))).toBe(true);
        expect(context.pages().length, "authority mutation opened no top-level context").toBe(
          pagesBefore,
        );
        expect(
          await page.evaluate(() => Number(document.documentElement.dataset.formdataCount ?? "0")),
          "the page received only its one legitimate payload-mutation phase",
        ).toBe(1);
        await page.close();
      });
    }
  });
});

test("trusted-click child allowance cannot be retargeted to the top page during formdata (#688) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/${ALLOWANCE_FIXTURE}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);
    const source = await childAuthorityFrame(page);
    const pagesBefore = context.pages().length;

    await source.locator("#allowance-button").click();
    await waitForFrameToast(source, BLOCKED);

    expect(new URL(page.url()).pathname).toBe(`/${ALLOWANCE_FIXTURE}`);
    expect(new URL(source.url()).pathname).toBe(`/${FIXTURE}`);
    expect(source.childFrames().every((frame) => !frame.url().includes(LANDING))).toBe(true);
    expect(context.pages().length, "retargeting opened no new top-level context").toBe(pagesBefore);
    expect(
      await source.evaluate(() => Number(document.documentElement.dataset.formdataCount ?? "0")),
      "the trusted click exposed exactly one page-owned formdata phase",
    ).toBe(1);
  });
});
