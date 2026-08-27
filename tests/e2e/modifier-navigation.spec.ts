import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { getGymBaseUrl, getServiceWorker, waitForNavSentinelBridge } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");
const fixture = "issue566-modifier-retry.html";

test.setTimeout(90_000);

type Gesture = "control-click" | "middle-click";
type Scenario = {
  id: "native-control" | "assign-control" | "self-control";
  label: string;
  expectedQuery: string;
};

const scenarios: Scenario[] = [
  { id: "native-control", label: "plain native control", expectedQuery: "case=native" },
  { id: "assign-control", label: "location.assign timer", expectedQuery: "case=assign" },
  { id: "self-control", label: "window.open _self timer", expectedQuery: "case=self" }
];

async function openFreshScenario(): Promise<{
  baseUrl: string;
  context: BrowserContext;
  opener: Page;
  cleanup: () => Promise<void>;
}> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-issue566-"));
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    const opener = await context.newPage();
    await opener.goto(`${baseUrl}/${fixture}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(opener);

    return {
      baseUrl,
      context,
      opener,
      cleanup: async () => {
        await context?.close();
        if (gym) await gym.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (context) await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function runScenario(scenario: Scenario, gesture: Gesture): Promise<void> {
  const { context, opener, cleanup } = await openFreshScenario();
  try {
    const pagesBefore = context.pages().length;
    const historyBefore = await opener.evaluate(() => history.length);
    const childPromise = context.waitForEvent("page", { timeout: 6_000 });
    const control = opener.locator(`#${scenario.id}`);

    if (gesture === "control-click") {
      await control.click({ modifiers: ["Control"], button: "left" });
    } else {
      await control.click({ button: "middle" });
    }

    const child = await childPromise;
    await child.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    // The fixture's timers and the browser's tab creation must both settle
    // before the opener/page-count assertions are evaluated.
    await opener.waitForTimeout(250);

    await expect(child).toHaveURL(new RegExp(`issue566-destination\\.html\\?${scenario.expectedQuery}`));
    await expect(opener).toHaveURL(new RegExp(`issue566-modifier-retry\\.html`));
    expect(await opener.evaluate(() => history.length), "Opener history must not advance").toBe(historyBefore);
    expect(context.pages(), "Modifier gesture must create exactly one child tab").toHaveLength(pagesBefore + 1);

    const log = await opener.locator("#event-log").innerText();
    expect(log).toContain("trusted=true");
    expect(log).toContain(gesture === "control-click" ? "modifiers=Ctrl" : "button=1");
    console.log(`[issue566] ${scenario.id} / ${gesture}: child=${child.url()} opener=${opener.url()} pages=${context.pages().length}`);
  } finally {
    await cleanup();
  }
}

for (const scenario of scenarios) {
  for (const gesture of ["control-click", "middle-click"] as const) {
    test(`${scenario.label} preserves opener for ${gesture} @regression`, async () => {
      test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");
      await runScenario(scenario, gesture);
    });
  }
}

test("Navigation Off preserves the page's modified-click handler @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

  const { context, opener, cleanup } = await openFreshScenario();
  try {
    const serviceWorker = await getServiceWorker(context);
    await serviceWorker.evaluate(async () => {
      const key = "sentinelsuite:settings_v1";
      const stored = await chrome.storage.local.get(key);
      const current = (stored[key] ?? {}) as Record<string, unknown>;
      const nav = (current.nav ?? {}) as Record<string, unknown>;
      await chrome.storage.local.set({
        [key]: { ...current, nav: { ...nav, defaultMode: "off" } }
      });
    });

    await opener.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(opener);

    const childPromise = context.waitForEvent("page", { timeout: 6_000 });
    await opener.locator("#assign-control").click({ modifiers: ["Control"], button: "left" });
    const child = await childPromise;

    await child.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    await opener.waitForURL(/issue566-destination\.html\?case=assign-timer/, { timeout: 10_000 });
    await expect(child).toHaveURL(/issue566-destination\.html\?case=assign$/);
  } finally {
    await cleanup();
  }
});
