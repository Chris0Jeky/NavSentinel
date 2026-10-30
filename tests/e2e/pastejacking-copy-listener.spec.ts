import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { assertNoToastFor, waitForNavSentinelBridge, waitForToastMatch } from "./extension_test_utils";

// #1168: the isolated-world copy listener must see text a page put into the
// clipboard with setData + preventDefault during a real (trusted) Ctrl+C.
// Inert payload: "base64" only trips the command classifier; nothing runs.
const ATTACK = `<!doctype html><html lang=en><title>Pastejacking fixture</title><body>
<h1>Verify you are human</h1><p>Press Win + R, then paste the code below and press Enter.</p>
<p id=code>Verification ID: 482-917</p>
<script>
document.addEventListener("copy", (e) => {
  e.clipboardData.setData("text/plain", "NS_INERT base64 sentinel");
  e.preventDefault();
});
</script></body></html>`;
// Benign contrast: same instructions, the page leaves the copy alone.
const BENIGN = ATTACK.replace(/<script>[\s\S]*<\/script>/, "");

async function run(html: string, check: (page: import("@playwright/test").Page) => Promise<void>) {
  const extensionPath = path.resolve(process.env.EXTENSION_PATH ?? "extension/dist");
  test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-pastejacking-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: ["--no-first-run", `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      // Block only foreign web requests; extension module loads must pass.
      return ["http:", "https:"].includes(target.protocol) && target.origin !== origin
        ? route.abort("blockedbyclient") : route.continue();
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    const page = await context.newPage();
    await page.goto(origin);
    await waitForNavSentinelBridge(page);
    await page.bringToFront();
    await page.locator("#code").selectText();
    await page.keyboard.press("Control+C");
    await check(page);
  } finally {
    await context?.close();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

test("a page-rewritten Ctrl+C next to Run-box steps raises the ClickFix warning (#1168) @regression", async () => {
  test.setTimeout(60_000);
  await run(ATTACK, async (page) => {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("NS_INERT base64 sentinel");
    await waitForToastMatch(page, /Do NOT paste/i, 8000);
  });
});

test("an ordinary Ctrl+C beside the same instructions stays quiet (#1168) @regression", async () => {
  test.setTimeout(60_000);
  await run(BENIGN, async (page) => {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Verification ID: 482-917");
    await assertNoToastFor(page, 2000);
  });
});
