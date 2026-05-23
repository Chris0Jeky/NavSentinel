import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { SUITE_SETTINGS_KEY, TRUSTED_DOMAINS_KEY } from "../../extension/src/shared/storage";
import { getExtensionId } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

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

test("options import and export preserve normalized trusted-domain and allowlist state @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-ui-e2e-"));
  const importPath = path.join(userDataDir, "suite-import.json");

  fs.writeFileSync(
    importPath,
    JSON.stringify(
      {
        settings: {
          nav: { defaultMode: "off", debug: true, dnrEnabled: true },
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
