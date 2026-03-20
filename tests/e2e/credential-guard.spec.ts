import { expect, test, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { EVENT_LOG_KEY, TRUSTED_DOMAINS_KEY } from "../../extension/src/shared/storage";
import {
  assertNoToastFor,
  getExtensionId,
  getGymBaseUrl,
  getServiceWorker,
  waitForNavSentinelBridge
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test("credential guard prompts before risky password submit @smoke", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-cred-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level11-credential-guard.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await waitForNavSentinelBridge(page);

      await page.click("#submitBtn");

      await expect(page.locator("text=Credential submit blocked")).toBeVisible({ timeout: 4000 });
      await expect(page).toHaveURL(/level11-credential-guard\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-07 fake re-auth interstitial prompts before risky credential submit @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-cred-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw07-fake-reauth-interstitial.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await waitForNavSentinelBridge(page);

      await page.click("#rw07Submit");

      await expect(page.locator("text=Credential submit blocked")).toBeVisible({ timeout: 4000 });
      await expect(page).toHaveURL(/rw07-fake-reauth-interstitial\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("credential guard warns on password paste and trust action persists @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-cred-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level11-credential-guard.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await waitForNavSentinelBridge(page);

      await page.focus("#password");
      await page.evaluate(() => {
        const input = document.getElementById("password");
        if (!(input instanceof HTMLInputElement)) return;
        input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, composed: true }));
      });

      const toast = page.locator("#__navsentinel_toast_host");
      await expect(toast).toContainText(
        "You pasted into a password field on an untrusted domain",
        { timeout: 4000 }
      );

      const trustButton = toast.getByRole("button", { name: "Trust 127.0.0.1" });
      await expect(trustButton).toBeVisible();
      await trustButton.click();

      const serviceWorker = await getServiceWorker(context);
      await expect
        .poll(async () => {
          return serviceWorker.evaluate(
            async ({ trustedDomainsKey, eventLogKey }) => {
              const stored = await chrome.storage.local.get([trustedDomainsKey, eventLogKey]);
              const trustedDomains = Array.isArray(stored[trustedDomainsKey])
                ? (stored[trustedDomainsKey] as string[])
                : [];
              const eventKinds = Array.isArray(stored[eventLogKey])
                ? (stored[eventLogKey] as Array<{ kind?: unknown }>)
                    .map((entry) => entry?.kind)
                    .filter((kind): kind is string => typeof kind === "string")
                : [];
              return { trustedDomains, eventKinds };
            },
            { trustedDomainsKey: TRUSTED_DOMAINS_KEY, eventLogKey: EVENT_LOG_KEY }
          );
        })
        .toEqual({
          trustedDomains: ["127.0.0.1"],
          eventKinds: expect.arrayContaining(["cred_paste_warn", "cred_trust_domain"])
        });

      const extensionId = await getExtensionId(context);
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/src/options/options.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await expect(options.locator("#trustedList")).toContainText("127.0.0.1");
      await expect(options.locator("#eventLog")).toContainText("cred_paste_warn");
      await expect(options.locator("#eventLog")).toContainText("cred_trust_domain");

      const revisited = await context.newPage();
      await revisited.goto(`${baseUrl}/level11-credential-guard.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await waitForNavSentinelBridge(revisited);
      await revisited.focus("#password");
      await revisited.evaluate(() => {
        const input = document.getElementById("password");
        if (!(input instanceof HTMLInputElement)) return;
        input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, composed: true }));
      });
      await assertNoToastFor(revisited);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
