import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getExtensionId } from "./extension_test_utils";

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension/dist");
const SETTINGS = "sentinelsuite:settings_v1";
const OUTCOMES = "sentinelsuite:prompt_outcomes_v1";
const ADAPTIVE = "sentinelsuite:adaptive_scores_v1";

type ModeCommit = { keys: string[]; mode: string; adjustment?: number };
type ProbeWindow = Window & { modeCommits?: ModeCommit[] };

test("Options mode saves update adaptive scores in the same storage event (#891) @regression", async () => {
  test.skip(!fs.existsSync(path.join(extensionPath, "manifest.json")), "Build the extension before running E2E tests.");
  test.setTimeout(120_000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-adaptive-mode-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const extensionId = await getExtensionId(context);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    // Seed through the same authenticated worker messages as the UI, not by
    // writing a hand-built cache or invoking internal implementation functions.
    expect(await options.evaluate(() => chrome.runtime.sendMessage({
      type: "ns-suite-settings-update", patch: { autoSave: false, nav: { defaultMode: "smart" } },
    }))).toMatchObject({ autoSave: false, nav: { defaultMode: "smart" } });
    await options.reload();
    await expect(options.locator("#autoSave")).not.toBeChecked();
    await expect(options.locator("#dirtyStatus")).toHaveText("All changes saved");
    const outcomes = Array.from({ length: 3 }, (_, index) => ({
      id: `mode-browser-${index}`, ts: Date.now() - 1000 + index, domain: "example.com",
      type: "nav", outcome: "allow", score: 60,
    }));
    expect(await options.evaluate((rows) => chrome.runtime.sendMessage({
      type: "ns-prompt-outcome-replace", outcomes: rows,
    }), outcomes)).toMatchObject({ ok: true });
    const snapshot = () => options.evaluate(async ({ settings, outcomes, adaptive }) => {
      const stored = await chrome.storage.local.get([settings, outcomes, adaptive]);
      return {
        mode: stored[settings]?.nav?.defaultMode,
        adjustment: stored[adaptive]?.["example.com"]?.adjustment,
        outcomes: stored[outcomes],
      };
    }, { settings: SETTINGS, outcomes: OUTCOMES, adaptive: ADAPTIVE });
    await expect.poll(snapshot).toEqual({ mode: "smart", adjustment: 15, outcomes });

    await options.evaluate(({ settings, adaptive }) => {
      const scope = window as ProbeWindow;
      scope.modeCommits = [];
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[settings]) return;
        scope.modeCommits?.push({
          keys: Object.keys(changes).sort(),
          mode: changes[settings].newValue?.nav?.defaultMode,
          adjustment: changes[adaptive]?.newValue?.["example.com"]?.adjustment,
        });
      });
    }, { settings: SETTINGS, adaptive: ADAPTIVE });

    for (const [mode, adjustment] of [["strict", 5], ["smart", 15]] as const) {
      await options.locator(`#navModeSeg [data-value="${mode}"]`).click();
      await expect(options.locator("#dirtyStatus")).toHaveText("Unsaved changes");
      await options.locator("#save").click();
      await expect.poll(snapshot).toEqual({ mode, adjustment, outcomes });
      await expect(options.locator("#dirtyStatus")).toHaveText("All changes saved");
    }
    // This observer sees actual Chrome storage notifications, independently
    // of a getter that could read a later repaired state. Outcomes stay intact.
    await expect.poll(() => options.evaluate(() => (window as ProbeWindow).modeCommits)).toEqual([
      { keys: [SETTINGS, ADAPTIVE].sort(), mode: "strict", adjustment: 5 },
      { keys: [SETTINGS, ADAPTIVE].sort(), mode: "smart", adjustment: 15 },
    ]);
  } finally {
    try { await context?.close(); }
    finally { fs.rmSync(profile, { recursive: true, force: true }); }
  }
});
