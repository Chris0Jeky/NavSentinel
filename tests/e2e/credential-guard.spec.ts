import { expect, test, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  EVENT_LOG_KEY,
  SUITE_SETTINGS_KEY,
  TRUSTED_DOMAINS_KEY,
  type EventLogEntry
} from "../../extension/src/shared/storage";
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

test("credential guard records a silently allowed submit before continuing @regression", async () => {
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
      const serviceWorker = await getServiceWorker(context);
      await serviceWorker.evaluate(
        async ({ eventLogKey, settingsKey }) => {
          await chrome.storage.local.set({
            [eventLogKey]: [],
            [settingsKey]: {
              nav: { defaultMode: "smart", debug: false },
              credential: {
                mode: "smart",
                promptOnUntrustedDomain: false,
                promptOnMediumRisk: false,
                mediumRiskThreshold: 100,
                blockHttpPasswordSubmit: false,
                warnOnPaste: true,
                similarity: { enabled: true, maxDistance: 2 }
              },
              logLimit: 300
            }
          });
        },
        { eventLogKey: EVENT_LOG_KEY, settingsKey: SUITE_SETTINGS_KEY }
      );

      const page = await context.newPage();
      const sourceUrl = `${baseUrl}/content-fp-03-legit-login.html?session=fixture-query-token#fixture-fragment-token`;
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await waitForNavSentinelBridge(page);

      const syntheticEmail = "synthetic@example.invalid";
      const syntheticPassword = "fixture-password-not-private";
      await page.locator("#email").fill(syntheticEmail);
      await page.locator("#password").fill(syntheticPassword);

      // Delegated event persistence retries for at most 600 ms. Allow browser
      // and storage overhead, but fail if instrumentation turns a silent allow
      // into a multi-second delay before the request starts (#252).
      const submitRequest = page.waitForRequest(
        (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/auth/login",
        { timeout: 1500 }
      );
      await Promise.all([submitRequest, page.getByRole("button", { name: "Sign in" }).click()]);

      await expect.poll(
        () => serviceWorker.evaluate(async (eventLogKey) => {
          const stored = await chrome.storage.local.get(eventLogKey);
          const events = Array.isArray(stored[eventLogKey]) ? stored[eventLogKey] : [];
          return events.filter((entry: { kind?: unknown }) => entry?.kind === "cred_form_evaluated").length;
        }, EVENT_LOG_KEY),
        { timeout: 5000 }
      ).toBe(1);

      const credentialEvents = await serviceWorker.evaluate(async (eventLogKey) => {
        const stored = await chrome.storage.local.get(eventLogKey);
        const events = Array.isArray(stored[eventLogKey]) ? stored[eventLogKey] : [];
        return events.filter(
          (entry: { kind?: unknown }) => entry?.kind === "cred_form_evaluated"
        ) as EventLogEntry[];
      }, EVENT_LOG_KEY);
      const credentialEvent = credentialEvents[0];
      expect(credentialEvent).toEqual(expect.objectContaining({
        id: expect.any(String),
        ts: expect.any(Number),
        kind: "cred_form_evaluated",
        site: "127.0.0.1",
        destHost: "127.0.0.1",
        score: expect.any(Number),
        reasons: expect.any(Array),
        extra: expect.objectContaining({
          severity: expect.any(String),
          crossSite: false,
          threshold: 100
        })
      }));

      const storedUrl = new URL(credentialEvent!.url!);
      expect(storedUrl.pathname).toBe("/content-fp-03-legit-login.html");
      expect(storedUrl.search).toBe("");
      expect(storedUrl.hash).toBe("");
      const serializedEvent = JSON.stringify(credentialEvent);
      expect(serializedEvent).not.toContain(syntheticEmail);
      expect(serializedEvent).not.toContain(syntheticPassword);
      expect(serializedEvent).not.toContain("fixture-query-token");
      expect(serializedEvent).not.toContain("fixture-fragment-token");
      expect(serializedEvent).not.toContain("/api/auth/login");
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

test("RW-13 courier tracking login lure prompts before risky credential submit @regression", async () => {
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
      await page.goto(`${baseUrl}/rw13-courier-tracking-login.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await waitForNavSentinelBridge(page);

      await page.click("#rw13Submit");

      await expect(page.locator("text=Credential submit blocked")).toBeVisible({ timeout: 4000 });
      await expect(page).toHaveURL(/rw13-courier-tracking-login\.html/);
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
