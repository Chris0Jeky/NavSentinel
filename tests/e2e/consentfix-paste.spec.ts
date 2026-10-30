import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { assertNoToastFor, clickToastButton, waitForNavSentinelBridge, waitForToastMatch } from "./extension_test_utils";

// ConsentFix: a page asks the user to paste the localhost URL a real sign-in redirected to.
// The guard must stop the paste before the page's own capture listener reads the code.
const PAGE = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Verify</title><body>
<p>Paste the address from the sign-in tab to finish verification.</p>
<input id="src" aria-label="source"> <input id="box" aria-label="address">
<script>
  // The kit reads what lands in its box (paste and input listeners on the field itself).
  // A page listener added on window capture before the guard's loader finishes would still
  // see the clipboard data; the guard cannot run ahead of that (async content loader).
  window.__seen = [];
  const box = document.getElementById("box");
  box.addEventListener("paste", (e) => window.__seen.push(e.clipboardData.getData("text/plain")));
  box.addEventListener("input", () => window.__seen.push(box.value));
</script></body></html>`;

// A trusted Ctrl+C from another field fills the system clipboard without a permission grant.
async function pasteText(page: Page, text: string) {
  await page.fill("#src", text);
  await page.click("#src");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+C");
  await page.click("#box");
  await page.keyboard.press("Control+V");
}

test("ConsentFix: a pasted localhost sign-in URL with a code is stopped @regression", async () => {
  test.setTimeout(60_000);
  const extensionPath = path.resolve("extension/dist");
  test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP fixture address");
  // A non-loopback page host: the guard leaves pages that are themselves on localhost alone.
  const pageUrl = `http://consent-lure.test:${address.port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-consentfix-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: ["--disable-background-networking", "--disable-quic", "--no-first-run",
        "--host-resolver-rules=MAP consent-lure.test 127.0.0.1",
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      return ["http:", "https:"].includes(target.protocol) && target.hostname !== "consent-lure.test"
        ? route.abort("blockedbyclient") : route.continue();
    });
    const page = await context.newPage();
    await page.goto(pageUrl);
    await waitForNavSentinelBridge(page);

    await pasteText(page, "http://localhost:8400/?code=0.AXoA_example&state=abc");
    await waitForToastMatch(page, /stopped this: a sign-in address/i, 6000);
    expect(await page.inputValue("#box")).toBe("");
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual([]);
    // A plain retry (what a coached victim does) is still stopped.
    await page.click("#box");
    await page.keyboard.press("Control+V");
    await page.waitForTimeout(300);
    expect(await page.inputValue("#box")).toBe("");
    // The toast's own button lets a developer paste their callback URL once.
    await clickToastButton(page, "Allow once (my own app)");
    await page.click("#box");
    await page.keyboard.press("Control+V");
    await expect.poll(() => page.inputValue("#box")).toContain("localhost:8400");

    await page.reload();
    await waitForNavSentinelBridge(page);
    await pasteText(page, "hello world");
    await expect.poll(() => page.inputValue("#box")).toBe("hello world");
    expect(await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toContain("hello world");
    await assertNoToastFor(page, 1000);
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
