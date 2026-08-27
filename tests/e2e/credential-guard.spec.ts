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

      const expectedHost = new URL(baseUrl).hostname;
      await serviceWorker.evaluate((eventLogKey) => {
        type EventLogGate = {
          reached: boolean;
          released: boolean;
          release: () => void;
        };
        const testGlobal = globalThis as typeof globalThis & {
          __navsentinelE2EEventLogGate?: EventLogGate;
        };
        const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
        let releaseWrite!: () => void;
        const writeGate = new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
        const state: EventLogGate = {
          reached: false,
          released: false,
          release: () => {
            if (state.released) return;
            state.released = true;
            releaseWrite();
          }
        };
        testGlobal.__navsentinelE2EEventLogGate = state;

        chrome.storage.local.set = async (items) => {
          if (!state.released && Object.hasOwn(items, eventLogKey)) {
            state.reached = true;
            await writeGate;
          }
          return originalSet(items);
        };
      }, EVENT_LOG_KEY);

      // The guard stops the user's first submit event. Only its re-entrant
      // requestSubmit after persistence reaches this page-world listener.
      await page.evaluate(() => {
        document.documentElement.dataset.navsentinelE2eResumedSubmits = "0";
        document.querySelector("form")?.addEventListener("submit", () => {
          const current = Number(
            document.documentElement.dataset.navsentinelE2eResumedSubmits ?? "0"
          );
          document.documentElement.dataset.navsentinelE2eResumedSubmits = String(current + 1);
        });
      });

      let resolvePostGate!: () => void;
      let rejectPostGate!: (reason?: unknown) => void;
      const postGate = new Promise<void>((resolve, reject) => {
        resolvePostGate = resolve;
        rejectPostGate = reject;
      });
      // Pause the synthetic POST at the network boundary and inspect storage before
      // allowing it through; this proves ordering without clock-based inference.
      await page.route("**/api/auth/login", async (route) => {
        try {
          const persistedCount = await serviceWorker.evaluate(async (eventLogKey) => {
            const stored = await chrome.storage.local.get(eventLogKey);
            const events = Array.isArray(stored[eventLogKey]) ? stored[eventLogKey] : [];
            return events.filter(
              (entry: { kind?: unknown }) => entry?.kind === "cred_form_evaluated"
            ).length;
          }, EVENT_LOG_KEY);
          await route.continue();
          if (persistedCount !== 1) {
            rejectPostGate(
              new Error(`Expected cred_form_evaluated before POST, found ${persistedCount}`)
            );
            return;
          }
          resolvePostGate();
        } catch (error) {
          await route.continue().catch(() => {});
          rejectPostGate(error);
        }
      });
      const submitClick = page.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });

      await expect.poll(
        () => serviceWorker.evaluate(() => {
          const testGlobal = globalThis as typeof globalThis & {
            __navsentinelE2EEventLogGate?: { reached: boolean };
          };
          return testGlobal.__navsentinelE2EEventLogGate?.reached === true;
        }),
        { timeout: 1500 }
      ).toBe(true);

      // Cross one page task boundary after the service worker reports that its
      // write is blocked. A fire-and-forget caller has already queued its resume
      // continuation by then; the awaited implementation cannot queue it until
      // the gate below is released.
      await page.evaluate(() => new Promise<void>((resolve) => window.setTimeout(resolve, 0)));
      expect(
        await page.evaluate(
          () => Number(document.documentElement.dataset.navsentinelE2eResumedSubmits ?? "0")
        ),
        "The native submit must stay paused while event persistence is gated"
      ).toBe(0);

      await serviceWorker.evaluate(() => {
        const testGlobal = globalThis as typeof globalThis & {
          __navsentinelE2EEventLogGate?: { release: () => void };
        };
        testGlobal.__navsentinelE2EEventLogGate?.release();
      });

      const postWithinBudget = Promise.race([
        postGate,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error("Credential POST did not resume within 1500 ms")), 1500);
        })
      ]);
      await Promise.all([postWithinBudget, submitClick]);

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
        site: expectedHost,
        destHost: expectedHost,
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
