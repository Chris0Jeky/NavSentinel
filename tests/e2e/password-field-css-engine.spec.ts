import { expect, test, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { EVENT_LOG_KEY } from "../../extension/src/shared/storage";
import { getGymBaseUrl, getServiceWorker, waitForNavSentinelBridge } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

const CSS_ENGINE_CASES = [
  {
    name: "keeps a quoted content decoy visible",
    style: "content:'a;display:none;b'",
    hasSriSignal: true
  },
  {
    name: "normalizes an uppercase display property to hidden",
    style: "DISPLAY:none",
    hasSriSignal: false
  },
  {
    name: "strips a comment from a display-none declaration",
    style: "display:/*x*/none",
    hasSriSignal: false
  }
] as const;

test.describe("password-field CSS engine parsing", () => {
  for (const cssCase of CSS_ENGINE_CASES) {
    test(`${cssCase.name} @regression`, async () => {
      test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

      const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-password-css-e2e-"));

      try {
        const context = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
          timeout: 60_000,
          args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
        });

        try {
          const page = await context.newPage();
          await page.goto(
            `${baseUrl}/password-field-css-engine.html?style=${encodeURIComponent(cssCase.style)}`,
            { waitUntil: "domcontentloaded", timeout: 20_000 }
          );
          await waitForNavSentinelBridge(page);

          await page.click('button[type="submit"]');

          const serviceWorker = await getServiceWorker(context);
          await expect.poll(async () => {
            return serviceWorker.evaluate(async (eventLogKey) => {
              const stored = await chrome.storage.local.get(eventLogKey);
              const entries = Array.isArray(stored[eventLogKey])
                ? (stored[eventLogKey] as Array<{ kind?: unknown; reasons?: unknown }>)
                : [];
              const prompt = entries.find((entry) => entry.kind === "cred_submit_prompt");
              if (!prompt) return "not-recorded";
              const reasons = Array.isArray(prompt.reasons) ? prompt.reasons : [];
              return reasons.includes("SRI_MISSING_ON_CREDENTIAL_PAGE") ? "present" : "absent";
            }, EVENT_LOG_KEY);
          }).toBe(cssCase.hasSriSignal ? "present" : "absent");
        } finally {
          await context.close();
        }
      } finally {
        if (gym) await gym.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    });
  }
});
