/**
 * Regression: SPA routers that reassign history.pushState must not break.
 *
 * Background: main_guard.ts patches History.prototype.pushState/replaceState in
 * the MAIN world at document_start. It used to harden them to non-writable +
 * non-configurable, so strict-mode SPA routers (claude.ai / TanStack Router,
 * React Router, etc.) doing `history.pushState = wrapper` threw
 * "Cannot assign to read only property 'pushState'", aborting router init and
 * leaving a grey screen. They are now installed writable + configurable
 * (softPatchProto) — observational hooks only, so non-writability bought no real
 * defense while breaking legitimate pages.
 *
 * Verified on CI (the agent sandbox cannot launch Chromium).
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { getGymBaseUrl, waitForNavSentinelBridge } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

test("SPA router can wrap history.pushState without a grey screen @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-pushstate-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
  } catch (err) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const pageErrors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await page.goto(`${baseUrl}/pushstate-04-router-wrap.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    // The reassignment must not have thrown — i.e. pushState stayed writable.
    const writable = await page.evaluate(() => document.body.dataset.pushstateWritable);
    expect(writable, "history.pushState must remain writable for SPA routers").toBe("true");

    // The router module rendered the app after wrapping pushState (no grey screen).
    const booted = await page.evaluate(() => document.body.dataset.appBooted);
    expect(booted, "router module must finish after wrapping pushState").toBe("true");

    const appText = await page.locator("#app").textContent();
    expect(appText, "the app must render its routed content").toContain("Dashboard");

    // No uncaught "read only property 'pushState'" TypeError from the wrap.
    const frozenError = pageErrors.find(
      (m) => /read only/i.test(m) && /pushState|replaceState/i.test(m)
    );
    expect(frozenError, `unexpected pushState freeze error: ${frozenError ?? ""}`).toBeUndefined();
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("a page can wrap form.submit / location.assign / window.open without throwing @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-protowrap-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
  } catch (err) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const pageErrors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await page.goto(`${baseUrl}/proto-wrap-05.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    // All three enforcement methods stayed writable, so the page's wraps succeeded.
    const wrapped = await page.evaluate(() => document.body.dataset.protoWrap);
    expect(wrapped, "form.submit / location.assign / window.open must be wrappable").toBeTruthy();
    const parsed = JSON.parse(wrapped ?? "{}") as Record<string, string>;
    expect(parsed.formSubmit).toBe("ok");
    expect(parsed.locationAssign).toBe("ok");
    expect(parsed.windowOpen).toBe("ok");

    // The module finished (no uncaught throw aborted the app render).
    expect(await page.locator("#app").textContent()).toContain("Booted");

    const frozenError = pageErrors.find(
      (m) => /read only/i.test(m) && /(submit|assign|open)/i.test(m)
    );
    expect(frozenError, `unexpected freeze error: ${frozenError ?? ""}`).toBeUndefined();
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
