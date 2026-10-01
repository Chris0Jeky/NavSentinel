import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getExtensionId, getServiceWorker } from "./extension_test_utils";

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(import.meta.dirname, "../../extension/dist");
const key = "sentinelsuite:smart_default_cooldowns_v1";
test.setTimeout(120_000);

test("two extension worlds share the worker cooldown queue, including pruning @regression", async () => {
  test.skip(!fs.existsSync(path.join(extensionPath, "manifest.json")), "Build the extension first.");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-cooldown-broker-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const id = await getExtensionId(context);
    const first = await context.newPage();
    const second = await context.newPage();
    const url = `chrome-extension://${id}/src/options/options.html`;
    await Promise.all([first.goto(url), second.goto(url)]);
    const mutate = (page: typeof first, op: string, sourceDomain?: string) => page.evaluate(async (message) =>
      chrome.runtime.sendMessage(message), { type: "ns-smart-default-cooldown", op, sourceDomain, destDomain: "destination.example" });
    const before = Date.now();
    const responses = await Promise.all([mutate(first, "set", "first.example"), mutate(second, "set", "second.example")]);
    for (const response of responses) expect(response).toMatchObject({ ok: true });
    const worker = await getServiceWorker(context);
    const read = () => worker.evaluate(async (storageKey) =>
      (await chrome.storage.local.get(storageKey))[storageKey] as Record<string, number>, key);
    let map = await read();
    expect(Object.keys(map).sort()).toEqual(["first.example|destination.example", "second.example|destination.example"]);
    for (const expiry of Object.values(map)) {
      expect(expiry).toBeGreaterThanOrEqual(before + 86_400_000);
      expect(expiry).toBeLessThanOrEqual(Date.now() + 86_400_000);
    }
    // Seed expired data before issuing concurrent requests, not during writes.
    await worker.evaluate(async ({ storageKey, current }) => {
      await chrome.storage.local.set({ [storageKey]: { ...current, expired: 1 } });
    }, { storageKey: key, current: map });
    const mixed = await Promise.all([
      mutate(first, "prune"), mutate(second, "set", "third.example"), mutate(first, "clear", "first.example"),
    ]);
    for (const response of mixed) expect(response).toMatchObject({ ok: true });
    map = await read();
    expect(Object.keys(map).sort()).toEqual(["second.example|destination.example", "third.example|destination.example"]);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
