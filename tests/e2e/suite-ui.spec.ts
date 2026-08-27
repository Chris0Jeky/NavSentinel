import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { EVENT_LOG_KEY, SUITE_SETTINGS_KEY, TRUSTED_DOMAINS_KEY } from "../../extension/src/shared/storage";
import { getGymBaseUrl, getExtensionId, getServiceWorker } from "./extension_test_utils";
import { getPopupSnapshot, openRealPopup, selectPopupMode } from "./demo-showcase-popup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

test("options normalizes trusted-domain input and persists mode changes @smoke", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-ui-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const extensionId = await getExtensionId(context);
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/src/options/options.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await expect(options.locator('#navModeSeg .seg-btn[data-value="smart"]')).toHaveAttribute("aria-checked", "true");
      await expect(options.locator('#credModeSeg .seg-btn[data-value="smart"]')).toHaveAttribute("aria-checked", "true");

      await options.locator('#navModeSeg .seg-btn[data-value="strict"]').click();
      await options.locator('#credModeSeg .seg-btn[data-value="strict"]').click();
      await options.locator('.nav-btn[data-section="trust"]').click();
      await options.locator("#trustedInput").fill("https://login.example.com/account");
      await options.locator("#addTrusted").click();
      await options.locator("#save").click();
      await options.waitForFunction(async ({ settingsKey, trustedDomainsKey }) => {
        const result = await chrome.storage.local.get([settingsKey, trustedDomainsKey]);
        const settings = result[settingsKey];
        const trustedDomains = Array.isArray(result[trustedDomainsKey])
          ? (result[trustedDomainsKey] as string[])
          : [];
        return (
          settings?.nav?.defaultMode === "strict" &&
          settings?.credential?.mode === "strict" &&
          trustedDomains.includes("example.com")
        );
      }, { settingsKey: SUITE_SETTINGS_KEY, trustedDomainsKey: TRUSTED_DOMAINS_KEY });

      await options.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await expect(options.locator('#navModeSeg .seg-btn[data-value="strict"]')).toHaveAttribute("aria-checked", "true");
      await expect(options.locator('#credModeSeg .seg-btn[data-value="strict"]')).toHaveAttribute("aria-checked", "true");
      await options.locator('.nav-btn[data-section="trust"]').click();
      await expect(options.locator("#trustedList")).toContainText("example.com");
    } finally {
      await context.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Options keeps popup changes while saving an unrelated dirty setting @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-options-sync-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const extensionId = await getExtensionId(context);
      const options = await context.newPage();
      await options.addInitScript((settingsKey) => {
        const originalGet = chrome.storage.local.get.bind(chrome.storage.local) as (
          keys?: string | string[] | Record<string, unknown> | null,
        ) => Promise<Record<string, unknown>>;
        let releaseInitialRead = () => {};
        const initialReadGate = new Promise<void>((resolve) => {
          releaseInitialRead = resolve;
        });
        const state = window as Window & {
          __nsInitialSettingsReadStarted?: boolean;
          __nsInitialSettingsReadReturned?: boolean;
          __nsReleaseInitialSettingsRead?: () => void;
        };
        state.__nsReleaseInitialSettingsRead = releaseInitialRead;
        chrome.storage.local.get = (async (
          keys?: string | string[] | Record<string, unknown> | null,
        ) => {
          const result = await originalGet(keys);
          if (
            !state.__nsInitialSettingsReadStarted &&
            Array.isArray(keys) &&
            keys.includes(settingsKey)
          ) {
            state.__nsInitialSettingsReadStarted = true;
            await initialReadGate;
            state.__nsInitialSettingsReadReturned = true;
          }
          return result;
        }) as typeof chrome.storage.local.get;
      }, SUITE_SETTINGS_KEY);
      await options.goto(`chrome-extension://${extensionId}/src/options/options.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await options.waitForFunction(() => {
        const state = window as Window & { __nsInitialSettingsReadStarted?: boolean };
        return state.__nsInitialSettingsReadStarted === true;
      });

      // Change both modes while Options still holds its initial storage snapshot.
      // The live listener must render the new values before that stale read returns.
      await openRealPopup(context);
      await selectPopupMode(context, "navMode", "strict");
      await selectPopupMode(context, "credMode", "off");

      await expect(options.locator('#navModeSeg .seg-btn[data-value="strict"]'))
        .toHaveAttribute("aria-checked", "true");
      await expect(options.locator('#credModeSeg .seg-btn[data-value="off"]'))
        .toHaveAttribute("aria-checked", "true");
      await expect(options.locator("#warnOnPaste")).toHaveAttribute("aria-checked", "true");

      // Keep an Options-only field dirty, then release the older snapshot. The
      // initialization continuation must not repaint either the popup values or
      // this unsaved switch.
      await options.locator("#warnOnPaste").click();
      await expect(options.locator("#warnOnPaste")).toHaveAttribute("aria-checked", "false");
      await options.evaluate(() => {
        const state = window as Window & { __nsReleaseInitialSettingsRead?: () => void };
        state.__nsReleaseInitialSettingsRead?.();
      });
      await options.waitForFunction(() => {
        const state = window as Window & { __nsInitialSettingsReadReturned?: boolean };
        return state.__nsInitialSettingsReadReturned === true;
      });
      await expect(options.locator('#navModeSeg .seg-btn[data-value="strict"]'))
        .toHaveAttribute("aria-checked", "true");
      await expect(options.locator('#credModeSeg .seg-btn[data-value="off"]'))
        .toHaveAttribute("aria-checked", "true");
      await expect(options.locator("#warnOnPaste")).toHaveAttribute("aria-checked", "false");

      await options.locator("#save").click();
      await options.waitForFunction(async (settingsKey) => {
        const result = await chrome.storage.local.get(settingsKey);
        const settings = result[settingsKey];
        return settings?.nav?.defaultMode === "strict" &&
          settings?.credential?.mode === "off" &&
          settings?.credential?.warnOnPaste === false;
      }, SUITE_SETTINGS_KEY);

      expect(await getPopupSnapshot(context)).toMatchObject({
        navMode: "strict",
        credMode: "off",
      });
    } finally {
      await context.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("popup renders only active-site risk, signal classes, and ClickFix shield icon @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-popup-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      const response = await page.goto(`${baseUrl}/clickfix-03-legit-captcha.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      expect(response?.ok(), "Expected the tracked ClickFix fixture to load successfully").toBe(true);
      await page.bringToFront();

      const worker = await getServiceWorker(context);
      await worker.evaluate(async ({ eventLogKey, events }) => {
        await chrome.storage.local.set({ [eventLogKey]: events });
      }, {
        eventLogKey: EVENT_LOG_KEY,
        events: [
          {
            id: "active-site-risk",
            ts: 1_710_000_000_000,
            kind: "nav_click_block",
            site: "127.0.0.1",
            score: 55,
            reasons: ["legit_captcha_present", "high_entropy_subdomain"]
          },
          {
            id: "other-site-high-risk",
            ts: 1_710_000_000_001,
            kind: "nav_click_block",
            site: "other-site.example",
            score: 95,
            reasons: ["high_entropy_subdomain"]
          },
          {
            id: "active-site-clickfix",
            ts: 1_710_000_000_002,
            kind: "clickfix_detected",
            site: "127.0.0.1"
          }
        ]
      });

      await openRealPopup(context);
      // `chrome.action.openPopup()` can focus the extension page in Chromium;
      // restore the fixture tab so refreshUi reads the actual active browser tab.
      await page.bringToFront();
      const snapshot = await getPopupSnapshot(context);

      expect(snapshot.site).toBe("127.0.0.1");
      // The newer 95 score belongs to a different site, so the rendered active-site
      // gauge must retain 55. Removing the domain filter would select that 95 score.
      expect(snapshot.tabRisk).toBe(55);
      expect(snapshot.signalChipClasses).toEqual([
        "signal-chip signal-chip--ok",
        "signal-chip signal-chip--warn"
      ]);

      const clickfixIndex = snapshot.events.findIndex((event) => event.includes("Clickfix Detected"));
      expect(clickfixIndex).toBeGreaterThanOrEqual(0);
      expect(snapshot.eventIconPaths[clickfixIndex]).toBe(
        "M12 3 L20 5 V11 C20 16 16 19.5 12 21 C8 19.5 4 16 4 11 V5 Z"
      );
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("options import and export preserve normalized trusted-domain and allowlist state @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-ui-e2e-"));
  const importPath = path.join(userDataDir, "suite-import.json");

  fs.writeFileSync(
    importPath,
    JSON.stringify(
      {
        settings: {
          nav: { defaultMode: "off", debug: true },
          credential: { mode: "strict", mediumRiskThreshold: 55 },
          logLimit: 120
        },
        allowlist: {
          " Example.com ": [" Login.Example.com "]
        },
        trustedDomains: ["https://Login.Example.com/account", "127.0.0.1"],
        eventLog: [
          {
            id: "evt1",
            ts: 1_710_000_000_000,
            kind: "cred_trust_domain",
            site: "example.com"
          }
        ]
      },
      null,
      2
    )
  );

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const extensionId = await getExtensionId(context);
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/src/options/options.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await options.locator("#importFile").setInputFiles(importPath);
      await expect(options.locator('#navModeSeg .seg-btn[data-value="off"]')).toHaveAttribute("aria-checked", "true");
      await expect(options.locator('#credModeSeg .seg-btn[data-value="strict"]')).toHaveAttribute("aria-checked", "true");
      await expect(options.locator("#logLimit")).toHaveValue("120");
      await expect(options.locator("#allowlist")).toContainText("example.com");
      await expect(options.locator("#allowlist")).toContainText("login.example.com");
      await expect(options.locator("#trustedList")).toContainText("example.com");
      await expect(options.locator("#trustedList")).toContainText("127.0.0.1");
      await expect(options.locator("#eventLog")).toContainText("cred_trust_domain");

      const downloadPromise = options.waitForEvent("download");
      await options.locator("#exportBtn").click();
      const download = await downloadPromise;
      const downloadPath = await download.path();
      expect(downloadPath, "Expected exported file path").toBeTruthy();

      const exported = JSON.parse(fs.readFileSync(downloadPath!, "utf8")) as {
        settings: { nav: { defaultMode: string }; credential: { mode: string }; logLimit: number };
        allowlist: Record<string, string[]>;
        trustedDomains: string[];
      };

      expect(exported.settings.nav.defaultMode).toBe("off");
      expect(exported.settings.credential.mode).toBe("strict");
      expect(exported.settings.logLimit).toBe(120);
      expect(exported.allowlist).toEqual({
        "example.com": ["login.example.com"]
      });
      expect(exported.trustedDomains).toEqual(["127.0.0.1", "example.com"]);
    } finally {
      await context.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
