import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getExtensionId } from "./extension_test_utils";

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extension/dist");

test("corrupt prompt-history imports preserve Chrome storage and report failure @regression", async () => {
  test.skip(!fs.existsSync(path.join(extensionPath, "manifest.json")), "Build the extension before running E2E tests.");
  test.setTimeout(120_000);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-history-import-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const extensionId = await getExtensionId(context);
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    const valid = { id: "saved", ts: Date.now(), domain: "saved.example", type: "nav", score: 60, outcome: "block" };
    expect(await options.evaluate((entry) => chrome.runtime.sendMessage({
      type: "ns-suite-import", payload: {
        settings: { autoSave: false, nav: { defaultMode: "strict" } },
        allowlist: { "saved.example": ["dest.example"] }, trustedDomains: ["saved.example"],
        eventLog: [{ id: "saved-event", ts: 1, kind: "nav_click_block" }], promptOutcomes: [entry],
      },
    }), valid)).toMatchObject({ ok: true });
    await options.reload();
    await expect(options.locator("#autoSave")).not.toBeChecked();
    await expect(options.locator("#dirtyStatus")).toHaveText("All changes saved");
    const snapshot = () => options.evaluate(async () => ({
      local: await chrome.storage.local.get([
        "sentinelsuite:settings_v1", "sentinelsuite:nav_allowlist_v1", "sentinelsuite:trusted_domains_v1",
        "sentinelsuite:event_log_v1", "sentinelsuite:prompt_outcomes_v1", "sentinelsuite:adaptive_scores_v1",
      ]),
      session: await chrome.storage.session.get("ns_sw:promptOutcomeResetTs"),
    }));
    const before = await snapshot();
    await options.locator("#importFile").setInputFiles({
      name: "corrupt-history.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        settings: { nav: { defaultMode: "off" } }, allowlist: {}, trustedDomains: [], eventLog: [],
        promptOutcomes: [null, { ...valid, domain: "not a hostname" }],
      })),
    });
    await expect(options.locator("#status")).toHaveText(/^(Imported\.|Import failed\.)$/);
    expect(await snapshot()).toEqual(before);
    await expect(options.locator("#status")).toHaveText("Import failed.");

    expect(await options.evaluate(() => chrome.runtime.sendMessage({
      type: "ns-prompt-outcome-replace", outcomes: [{}],
    }))).toMatchObject({ ok: false, error: expect.stringContaining("no valid prompt outcomes") });
    expect(await snapshot()).toEqual(before);

    // An intentional empty backup still clears history through the same file UI.
    await options.locator("#importFile").setInputFiles({
      name: "empty-history.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ promptOutcomes: [] })),
    });
    await expect(options.locator("#status")).toHaveText("Imported.");
    const after = (await snapshot()).local;
    expect(after["sentinelsuite:prompt_outcomes_v1"]).toEqual([]);
    expect(after["sentinelsuite:adaptive_scores_v1"]).toEqual({});
    expect(after["sentinelsuite:settings_v1"]).toEqual(before.local["sentinelsuite:settings_v1"]);
  } finally {
    try { await context?.close(); }
    finally { fs.rmSync(profile, { recursive: true, force: true }); }
  }
});
