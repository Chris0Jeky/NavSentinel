import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { DBLCLICK_WINDOW_MS } from "../../extension/src/shared/doubleclick_timing";
import { evaluateInCredentialModal, frameViewportOffset, getServiceWorker } from "./extension_test_utils";

// #1214 review: Chrome judges a cross-site iframe's IntersectionObserver v2 occlusion for
// the whole frame box, so a parent element over one corner (a sticky header, a cookie bar)
// kept an embedded login's Proceed once from ever arming. Subframes use the explicit checks.
test("a cross-site iframe login still approves with a parent element over one iframe corner (#1142) @regression", async () => {
  test.setTimeout(90_000);
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/credential-iframe-profile-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = await getServiceWorker(context);
    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({ [key]: {
        credential: { mode: "smart", promptOnUntrustedDomain: true, blockHttpPasswordSubmit: false },
        nav: { defaultMode: "smart", debug: false },
      } });
    }, SUITE_SETTINGS_KEY);
    let posts = 0;
    // All fixture requests are intercepted locally; credentials are dummy data.
    await context.route("http://parent.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <body style="margin:0"><div style="position:fixed;left:0;top:0;width:120px;height:40px;background:#c00;z-index:5"></div>
      <iframe src="http://victim.test/login" style="position:absolute;left:20px;top:20px;width:900px;height:640px;border:0"></iframe></body>` }));
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <form method="post" action="http://collector.test/collect">
        <input name="user" value="synthetic@example.invalid">
        <input name="password" type="password" value="dummy-iframe">
        <button id="go">Sign in</button>
      </form>` }));
    await context.route("http://collector.test/**", async (route) => {
      if (route.request().method() === "POST") posts++;
      await route.fulfill({ contentType: "text/html", body: "<p>Fixture received</p>" });
    });
    const page = await context.newPage();
    await page.goto("http://parent.test/");
    const frame = page.frames().find((candidate) => candidate.url().startsWith("http://victim.test"))!;
    await frame.waitForSelector("#go");
    await page.waitForTimeout(500);
    await frame.click("#go", { noWaitAfter: true });
    await expect.poll(() => evaluateInCredentialModal(frame, function (this: ShadowRoot) {
      return !!this.querySelector(".overlay");
    }), { timeout: 5000 }).toBe(true);
    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 700);
    const point = await evaluateInCredentialModal(frame, function (this: ShadowRoot) {
      const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once")!;
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    const offset = await frameViewportOffset(frame);
    await page.mouse.click(point!.x + offset.x, point!.y + offset.y);
    await expect.poll(() => posts, { timeout: 5000 }).toBe(1);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
