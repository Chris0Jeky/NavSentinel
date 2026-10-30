import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { DBLCLICK_WINDOW_MS } from "../../extension/src/shared/doubleclick_timing";
import { evaluateInCredentialModal, evaluateInToast, focusToastButton, getServiceWorker, toastButtonPoint, waitForCredentialModal, clickModalButton, waitForNavSentinelBridge, waitForToastText } from "./extension_test_utils";

for (const activation of ["pointer", "Enter", "Space"] as const) {
test(`page CSS cannot turn an invisible credential prompt into approval; visible ${activation} works (#1139) @regression`, async () => {
  test.setTimeout(90_000);
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/credential-visible-profile-"));
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
        <input name="password" type="password" value="dummy-1139">
        <button id="go">Sign in</button>
      </form>` }));
    await context.route("http://collector.test/**", async (route) => {
      if (route.request().method() === "POST") posts++;
      await route.fulfill({ contentType: "text/html", body: "<p>Fixture received</p>" });
    });
    const page = await context.newPage();
    await page.goto("http://victim.test/login");
    await page.waitForTimeout(300);
    await page.click("#go", { noWaitAfter: true });
    await waitForCredentialModal(page);
    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 300);
    const point = await evaluateInCredentialModal(page, function (this: ShadowRoot) {
      const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once")!;
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    expect(point).not.toBeNull();
    await page.addStyleTag({ content: "#__sentinelsuite_cred_modal_host__ { opacity: 0 !important; }" });
    await page.mouse.click(point!.x, point!.y);
    await page.waitForTimeout(200);
    expect(posts, "trusted click through an opacity-zero prompt sends no POST").toBe(0);
    expect(await evaluateInCredentialModal(page, function (this: ShadowRoot) { return !!this.querySelector(".overlay"); })).toBe(true);
    await page.addStyleTag({ content: "#__sentinelsuite_cred_modal_host__ { opacity: 1 !important; }" });
    // Restoring visibility does not inherit the old exposure window.
    await page.mouse.click(point!.x, point!.y);
    expect(posts).toBe(0);
    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 300);
    if (activation === "pointer") await clickModalButton(page, "Proceed once");
    else {
      // DevTools can focus the closed-root control; the key is real browser input.
      await evaluateInCredentialModal(page, function (this: ShadowRoot) {
        const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once")!;
        button.focus();
      });
      await page.keyboard.press(activation);
    }
    await expect.poll(() => posts).toBe(1);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
}

for (const activation of ["pointer", "Enter", "Space"] as const) {
test(`built toast fence refuses immediate approval and permits armed ${activation} (#1139) @regression`, async () => {
  test.setTimeout(60_000);
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/toast-visible-profile-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("http://toast.test/**", (route) => route.fulfill({
      contentType: "text/html", body: "<p>Local toast approval fixture</p>",
    }));
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://toast.test/start");
    await waitForNavSentinelBridge(page);
    const started = await page.evaluate(() => {
      const started = performance.now();
      window.open("http://toast.test/approved", "_blank");
      return started;
    });
    await waitForToastText(page, "Blocked popup");
    // The toast root is closed (#1142): resolve the button through CDP, then
    // drive real pointer or keyboard input at it.
    const activate = async () => {
      if (activation === "pointer") {
        const point = await toastButtonPoint(page, "Allow once");
        await page.mouse.click(point.x, point.y);
      } else {
        await focusToastButton(page, "Allow once");
        await page.keyboard.press(activation);
      }
    };
    await activate();
    expect(await page.evaluate(() => performance.now()) - started, "first trusted input must precede arming").toBeLessThan(DBLCLICK_WINDOW_MS);
    expect(context.pages().filter((candidate) => candidate !== page && candidate.url() !== "about:blank")).toHaveLength(0);
    expect(await toastButtonPoint(page, "Allow once", 1000), "refused approval keeps the original action pending").toBeTruthy();

    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 300);
    const popupPromise = context.waitForEvent("page", { timeout: 5000 });
    await activate();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("http://toast.test/approved");
    await expect.poll(() => evaluateInToast(page, (roots) => roots
      .flatMap((root) => Array.from(root.querySelectorAll("button")))
      .filter((button) => button.textContent?.trim() === "Allow once").length)).toBe(0);
    expect(context.pages().filter((candidate) => candidate !== page && candidate.url() !== "about:blank")).toEqual([popup]);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
}
