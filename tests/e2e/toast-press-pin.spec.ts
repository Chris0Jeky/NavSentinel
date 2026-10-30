import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { TOAST_HOST_ID, toastButtonPoint, waitForNavSentinelBridge, waitForToastText } from "./extension_test_utils";

// #1203 item 1: with the toast root closed, the fence resolves a click to the control under
// the release point. A page that sees the host go :active under a press on Dismiss can shift
// the host so Allow once sits under the stationary pointer; once it has been there for the
// arming window, the release must still not approve.
// A pure CSS `:active` shift ends before Chrome dispatches the click (measured: the release
// then hit Dismiss), so the page reads :active through a custom property and keeps the shift
// with script.
test("a press on Dismiss released over a shifted Allow once does not approve (#1203) @regression", async () => {
  test.setTimeout(60_000);
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/toast-press-pin-profile-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("http://toast.test/**", (route) => route.fulfill({
      contentType: "text/html", body: "<p>Local toast press fixture</p>",
    }));
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://toast.test/start");
    await waitForNavSentinelBridge(page);
    await page.evaluate(() => { window.open("http://toast.test/approved", "_blank"); });
    // The card expires 4 s after it appears, so the whole press fits well inside that.
    await waitForToastText(page, "Blocked popup");

    const dismiss = await toastButtonPoint(page, "Dismiss");
    const allow = await toastButtonPoint(page, "Allow once");
    await page.addStyleTag({ content: `#${TOAST_HOST_ID}:active { --pressed: 1; }` });
    await page.evaluate(({ id, dx }) => {
      const host = document.getElementById(id)!;
      const right = parseFloat(host.style.right) - dx;
      const watch = () => {
        if (getComputedStyle(host).getPropertyValue("--pressed")) host.style.setProperty("right", `${right}px`, "important");
        else requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    }, { id: TOAST_HOST_ID, dx: dismiss.x - allow.x });

    const popups: string[] = [];
    context.on("page", (candidate) => { if (!candidate.url().startsWith("chrome-extension:")) popups.push(candidate.url()); });
    await page.mouse.move(dismiss.x, dismiss.y);
    await page.mouse.down();
    // The shift really happened: Allow once is now under the held pointer.
    await expect.poll(async () => Math.abs((await toastButtonPoint(page, "Allow once")).x - dismiss.x)).toBeLessThan(2);
    await page.waitForTimeout(900);
    await page.mouse.up();
    expect(await toastButtonPoint(page, "Allow once", 500), "the blocked popup stays pending").toBeTruthy();
    await page.waitForTimeout(1000);
    expect(popups, "the release over Allow once must not approve").toEqual([]);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
