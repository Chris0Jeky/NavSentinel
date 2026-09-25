/**
 * #890: an approved blocked form submit must go only to the destination that
 * was approved.
 *
 * The MAIN-world gate resolves a blocked `form.submit()` / `requestSubmit()`
 * action once, shows or checks that URL, and later runs the stored action when
 * the isolated world approves it. For an allowlisted destination that approval
 * is automatic (no click), so page script that swaps `action` or `formaction`
 * right after the blocked call used to send the approved submit to a URL nobody
 * saw or allowlisted.
 *
 * The approved destination is `localhost` (allowlisted for the 127.0.0.1 gym
 * site). The swapped destination is `127.0.0.2`, which nothing serves, so the
 * test watches outgoing requests rather than page content.
 */
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGymBaseUrl, waitForNavSentinelBridge } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");
const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";

test.setTimeout(120_000);

async function withAllowlistedPage(
  run: (page: Page, approvedBase: string) => Promise<void>,
): Promise<void> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-submit-swap-"));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");

    const site = new URL(baseUrl).hostname;
    await serviceWorker.evaluate(
      async ({ key, site }) => {
        await chrome.storage.local.set({ [key]: { [site]: ["localhost"] } });
      },
      { key: ALLOWLIST_KEY, site },
    );

    const page = await context.newPage();
    await page.goto(`${baseUrl}/level1-basic-opacity.html`, { waitUntil: "domcontentloaded" });
    await waitForNavSentinelBridge(page);
    const approvedBase = `http://localhost:${new URL(baseUrl).port}`;
    await run(page, approvedBase);
  } finally {
    await context?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

function recordNavigations(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) seen.push(request.url());
  });
  return seen;
}

test("an allowlisted blocked form.submit() still reaches its approved destination (control) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const seen = recordNavigations(page);
    const approved = `${approvedBase}/level1-basic-opacity.html?submit=approved`;
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "get";
      form.action = action;
      document.body.appendChild(form);
      form.submit();
    }, approved);

    await expect
      .poll(() => seen.some((url) => url.startsWith(`${approvedBase}/level1-basic-opacity.html`)), {
        message: "TEST_INVALID: the allowlisted submit never ran, so the swap arm below proves nothing",
        timeout: 10_000,
      })
      .toBe(true);
  });
});

test("an approved blocked form.submit() does not follow an action swapped after the block (#890) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const seen = recordNavigations(page);
    const originalUrl = page.url();
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "get";
      form.action = action;
      document.body.appendChild(form);
      form.submit(); // blocked, then auto-approved for the allowlisted host
      form.action = "http://127.0.0.2:9/swapped-after-approval";
    }, `${approvedBase}/level1-basic-opacity.html?submit=approved`);

    await page.waitForTimeout(3_000);
    expect(seen.filter((url) => url.includes("127.0.0.2"))).toEqual([]);
    expect(page.url()).toBe(originalUrl);
  });
});

test("an approved blocked requestSubmit() does not follow a formaction swapped after the block (#890) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const seen = recordNavigations(page);
    const originalUrl = page.url();
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "get";
      const submitter = document.createElement("button");
      submitter.type = "submit";
      submitter.formAction = action;
      form.appendChild(submitter);
      document.body.appendChild(form);
      form.requestSubmit(submitter); // blocked, then auto-approved
      submitter.formAction = "http://127.0.0.2:9/swapped-after-approval";
    }, `${approvedBase}/level1-basic-opacity.html?submit=approved`);

    await page.waitForTimeout(3_000);
    expect(seen.filter((url) => url.includes("127.0.0.2"))).toEqual([]);
    expect(page.url()).toBe(originalUrl);
  });
});
