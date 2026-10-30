import { test, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  assertNoToastFor,
  getServiceWorker,
  updateNavigationSettings,
  waitForNavSentinelBridge,
  waitForToastMatch,
} from "./extension_test_utils";

// Reverse tabnabbing (#1172), content delivery: the service worker's ns-tabnab-warning reaches
// the real content script, loads the lazy chunk and shows the warn-only toast; defaultMode
// "off" shows nothing. The SW decision logic is covered by tests/sw-tabnab.test.ts. The full
// child-swaps-opener flow is not driven here: Heedline's own redirect rollback also reacts to
// that swap and replaces the toast, so it cannot isolate this path.
const WARNING = /Another tab changed this page from site-a\.test while you were away/;

async function sendWarning(context: BrowserContext, page: Page) {
  const worker = await getServiceWorker(context);
  await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await chrome.tabs.sendMessage(tab!.id!, { type: "ns-tabnab-warning", from: "site-a.test" });
  }, page.url());
}

test("tabnab warning message shows a toast unless protection is off @regression", async () => {
  test.setTimeout(60_000);
  const extensionPath = path.resolve("extension/dist");
  test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
  const server = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Local page</title><body><p>Local page</p></body>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-tabnab-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: ["--disable-background-networking", "--disable-quic", "--no-first-run",
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("**/*", route => {
      const target = new URL(route.request().url());
      return ["http:", "https:"].includes(target.protocol) && target.origin !== origin
        ? route.abort("blockedbyclient") : route.continue();
    });
    await updateNavigationSettings(context, { defaultMode: "smart" });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await waitForNavSentinelBridge(page);
    await sendWarning(context, page);
    // The toast's shadow root is closed (#1202): read it through the CDP helper.
    await waitForToastMatch(page, WARNING, 10_000);

    await updateNavigationSettings(context, { defaultMode: "off" });
    await page.reload();
    await waitForNavSentinelBridge(page);
    await sendWarning(context, page);
    await assertNoToastFor(page, 1_000);
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
