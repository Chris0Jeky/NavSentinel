/**
 * #865 late-target regressions for legacy form.submit().
 *
 * A plain post into this page's own named child must not be announced as a tab
 * navigation. The decision cannot be made at call time, though: formdata runs
 * before the browser resolves the target and may retarget to the tab, a new
 * window, an unknown name, a replacement child, or a name stolen by the top
 * window.
 *
 * The safe implementation boundary exercised here is deliberately narrower
 * than requestSubmit(): collect the original form's finalized FormData without
 * navigating, re-resolve the exact child identity, then replay only a
 * still-child-bound payload through an extension-owned closed-shadow form.
 * requestSubmit() remains gated until its trusted submit-event cancellation
 * semantics can be preserved.
 */
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
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
const LANDING = "/form-submit-landing.html";
const BLOCKED = "Blocked form submit";

test.setTimeout(180_000);

interface CapturedPost {
  body: Buffer;
  contentType: string;
}

interface PostCaptureServer {
  actionUrl: string;
  captured: Promise<CapturedPost>;
  close(): Promise<void>;
}

async function startPostCaptureServer(): Promise<PostCaptureServer> {
  let resolveCaptured!: (value: CapturedPost) => void;
  let rejectCaptured!: (reason: unknown) => void;
  const captured = new Promise<CapturedPost>((resolve, reject) => {
    resolveCaptured = resolve;
    rejectCaptured = reject;
  });

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    request.on("error", rejectCaptured);
    request.on("end", () => {
      resolveCaptured({
        body: Buffer.concat(chunks),
        contentType: request.headers["content-type"] ?? "",
      });
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Captured child form POST</title>");
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind child replay POST capture server");
  }

  return {
    actionUrl: `http://127.0.0.1:${address.port}${LANDING}`,
    captured,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function captureWithin(
  captured: Promise<CapturedPost>,
  timeoutMs = 5_000,
): Promise<CapturedPost> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      captured,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out waiting for child form POST")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

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

function childUrls(page: Page): string[] {
  return page.frames().filter((frame) => frame !== page.mainFrame()).map((frame) => frame.url());
}

async function datasetNumber(page: Page, name: string): Promise<number> {
  return page.evaluate((key) => Number(document.documentElement.dataset[key] ?? "0"), name);
}

async function replayLeak(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.dataset.replayLeak === "1");
}

async function expectOriginalFormdataOnly(page: Page, expected: number): Promise<void> {
  expect(await datasetNumber(page, "formdataCount"), "the original form's formdata count").toBe(expected);
  expect(await datasetNumber(page, "documentFormdataCount"), "document-visible formdata count").toBe(expected);
  expect(await replayLeak(page), "the closed-shadow replay event stayed hidden from page code").toBe(false);
}

test("legacy GET submit replays finalized FormData only into the still-owned child (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    for (const mode of ["safe-submit", "safe-formdata"]) {
      await test.step(mode, async () => {
        const page = await openFixture(context, baseUrl, mode);
        const pagesBefore = context.pages().length;
        const child = childFrame(page);

        await runCase(page);
        await expect.poll(() => child.url(), { timeout: 5_000 }).toContain(LANDING);

        const landing = new URL(child.url());
        expect(landing.searchParams.get("case")).toBe(mode);
        expect(landing.searchParams.get("original")).toBe("kept");
        await expectOriginalFormdataOnly(page, 1);
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

test("legacy multipart POST preserves finalized file data inside the named child (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const captureServer = await startPostCaptureServer();
  try {
    await withExtension(async (context, baseUrl) => {
      const page = await openFixture(context, baseUrl, "safe-post-file");
      const pagesBefore = context.pages().length;
      const child = childFrame(page);
      await page.evaluate((actionUrl) => {
        const form = document.querySelector<HTMLFormElement>("#legacy");
        if (!form) throw new Error("legacy form is missing");
        form.action = actionUrl;
      }, captureServer.actionUrl);

      await runCase(page);
      const request = await captureWithin(captureServer.captured);
      await expect.poll(() => child.url(), { timeout: 5_000 }).toContain(LANDING);

      expect(request.contentType).toMatch(/^multipart\/form-data;\s*boundary=/i);
      const multipart = request.body.toString("utf8");
      expect(multipart).toContain('name="case"');
      expect(multipart).toContain("safe-post-file");
      expect(multipart).toContain('name="original"');
      expect(multipart).toContain("kept");
      expect(multipart).toContain('name="upload"; filename="receipt.txt"');
      expect(multipart).toContain("Content-Type: text/plain");
      expect(multipart).toContain("upload-body");

      await expectOriginalFormdataOnly(page, 1);
      expect(context.pages().length, "the child POST did not open a top-level page").toBe(pagesBefore);
      expect(new URL(page.url()).pathname).toBe(`/${FIXTURE}`);
      await assertNoToastFor(page, 500);
      await page.close();
    });
  } finally {
    await captureServer.close();
  }
});

test("formdata retargets and child replacement cannot escape the replay boundary (#865) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  await withExtension(async (context, baseUrl) => {
    for (const mode of [
      "retarget-top",
      "retarget-blank",
      "retarget-unknown",
      "steal-name",
      "replace-child",
    ]) {
      await test.step(mode, async () => {
        const page = await openFixture(context, baseUrl, mode);
        const pagesBefore = context.pages().length;

        await runCase(page);
        await waitForToastText(page, BLOCKED, 3_000);

        await expectOriginalFormdataOnly(page, 1);
        expect(new URL(page.url()).pathname).toBe(`/${FIXTURE}`);
        expect(childUrls(page).every((url) => !url.includes(LANDING))).toBe(true);
        expect(context.pages().length, "no new browsing context escaped the gate").toBe(pagesBefore);
        await page.close();
      });
    }

    await test.step("a child that already renamed itself is not mistaken for the declared target", async () => {
      const page = await openFixture(context, baseUrl, "renamed-child");
      const pagesBefore = context.pages().length;

      await runCase(page);
      await waitForToastText(page, BLOCKED, 3_000);

      await expectOriginalFormdataOnly(page, 0);
      expect(childUrls(page).every((url) => !url.includes(LANDING))).toBe(true);
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

    await runCase(page);
    await waitForToastText(page, BLOCKED, 3_000);

    await expectOriginalFormdataOnly(page, 0);
    expect(childUrls(page).every((url) => !url.includes(LANDING))).toBe(true);
    expect(context.pages().length).toBe(pagesBefore);
    await page.close();
  });
});
