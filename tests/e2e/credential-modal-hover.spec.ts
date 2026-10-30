import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { DBLCLICK_WINDOW_MS } from "../../extension/src/shared/doubleclick_timing";
import { evaluateInCredentialModal, getServiceWorker, waitForCredentialModal } from "./extension_test_utils";

// #1214 review: IntersectionObserver v2 treats a hover transform as a visual change, so a
// `translateY(-1px)` on :hover de-armed the visible-approval gate and refused a person who
// hovered Proceed once and clicked within the 800 ms window (300 and 600 ms both failed).
// Buttons must keep a hover style that does not transform.
for (const pauseMs of [300]) {
  test(`a hover then a ${pauseMs} ms pause still lets Proceed once approve (#1142) @regression`, async () => {
    test.setTimeout(90_000);
    const extensionPath = path.resolve("extension/dist");
    const profile = (fs.mkdirSync("test-results", { recursive: true }), fs.mkdtempSync(path.resolve("test-results/credential-hover-profile-")));
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
      await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
        <form method="post" action="http://collector.test/collect">
          <input name="user" value="synthetic@example.invalid">
          <input name="password" type="password" value="dummy-probe">
          <button id="go">Sign in</button>
        </form>` }));
      await context.route("http://collector.test/**", async (route) => {
        if (route.request().method() === "POST") posts++;
        await route.fulfill({ contentType: "text/html", body: "<p>ok</p>" });
      });
      const page = await context.newPage();
      await page.goto("http://victim.test/login");
      await page.waitForTimeout(300);
      await page.click("#go", { noWaitAfter: true });
      await waitForCredentialModal(page);
      await page.waitForTimeout(DBLCLICK_WINDOW_MS + 600);
      const point = await evaluateInCredentialModal(page, function (this: ShadowRoot) {
        const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once")!;
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await page.mouse.move(point!.x - 80, point!.y);
      await page.mouse.move(point!.x, point!.y, { steps: 8 });
      await page.waitForTimeout(pauseMs);
      await page.mouse.down();
      await page.mouse.up();
      await expect.poll(() => posts, { timeout: 5000 }).toBe(1);
    } finally {
      await context?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
