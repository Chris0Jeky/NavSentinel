import { chromium, expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { clickModalButton, getServiceWorker, waitForCredentialModal, waitForNavSentinelBridge } from "./extension_test_utils";

test("named form controls cannot bypass the cross-site password prompt @regression", async () => {
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(path.join(extensionPath, "manifest.json")), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/credential-named-property-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = await getServiceWorker(context);
    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({
        [key]: {
          nav: { defaultMode: "smart", debug: false },
          credential: {
            mode: "smart", promptOnUntrustedDomain: true, promptOnMediumRisk: false,
            mediumRiskThreshold: 100, blockHttpPasswordSubmit: false, warnOnPaste: true,
            similarity: { enabled: true, maxDistance: 2 },
          },
          logLimit: 300,
        },
      });
    }, SUITE_SETTINGS_KEY);
    let posts = 0;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "chrome-extension:") {
        // Dynamic content-script imports are local packaged resources.
        await route.continue();
      } else if (url.hostname === "destination.test") {
        if (route.request().method() === "POST") posts++;
        await route.fulfill({ contentType: "text/html", body: "<p>local fixture sink</p>" });
      } else if (url.hostname === "victim.test") {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html>
          <form id="login" method="post" action="http://destination.test/sink">
            <input name="querySelectorAll" type="hidden">
            <input name="password" type="password" value="dummy-canary">
            <button id="go">Sign in</button>
          </form>` });
      } else {
        await route.abort();
      }
    });
    const page = await context.newPage();
    await page.goto("http://victim.test/login");
    await waitForNavSentinelBridge(page);
    // Confirm the browser itself implements the named-property attack.
    expect(await page.evaluate(() =>
      document.querySelector<HTMLFormElement>("#login")!.querySelectorAll instanceof HTMLInputElement,
    )).toBe(true);
    await page.waitForTimeout(300);
    await page.click("#go", { noWaitAfter: true });
    try {
      await waitForCredentialModal(page);
    } finally {
      await test.info().attach("password-post-count", {
        body: JSON.stringify({ posts }), contentType: "application/json",
      });
    }
    await page.waitForTimeout(500);
    expect(posts, "no password POST before a decision").toBe(0);
    await clickModalButton(page, "Cancel");
    await page.waitForTimeout(500);
    expect(posts, "no password POST after cancellation").toBe(0);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
