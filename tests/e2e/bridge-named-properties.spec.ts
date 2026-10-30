import fs from "node:fs";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { getGymBaseUrl, updateNavigationSettings, waitForNavSentinelBridge } from "./extension_test_utils";
import { startProvingGroundEgressFence } from "./proving_ground_fake_sink";

test.setTimeout(60_000);

for (const fixture of ["normal", "form", "iframe"] as const) {
  test(`initial ${fixture} markup preserves config and cross-site navigation blocking @regression`, async () => {
    const extensionPath = path.resolve("extension/dist");
    expect(fs.existsSync(extensionPath), "Build the extension first").toBe(true);
    const { baseUrl, gym } = await getGymBaseUrl(path.resolve("gym"));
    const alternate = new URL(baseUrl);
    expect(["localhost", "127.0.0.1"]).toContain(alternate.hostname);
    alternate.hostname = alternate.hostname === "localhost" ? "127.0.0.1" : "localhost";
    const allowedOrigins = new Set([new URL(baseUrl).origin, alternate.origin]);
    const fence = await startProvingGroundEgressFence([], allowedOrigins);
    const profiles = path.resolve("test-results/bridge-profiles");
    fs.mkdirSync(profiles, { recursive: true });
    const profile = fs.mkdtempSync(path.join(profiles, "named-properties-"));
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
    let sinkRequests = 0;
    let releaseModule!: () => void;
    const markupReady = new Promise<void>((resolve) => { releaseModule = resolve; });
    let releaseMain!: () => void;
    const configQueued = new Promise<void>((resolve) => { releaseMain = resolve; });
    let delayedModules = 0;
    let delayedMainModules = 0;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: false,
        timeout: 30_000,
        proxy: { server: fence.proxyServer },
        args: [
          "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
          "--disable-sync", "--no-first-run", "--no-default-browser-check",
          `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
        ],
      });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.includes("/assets/capture_isolated.ts-") && !url.pathname.includes("loader")) {
          delayedModules++;
          await markupReady;
          await route.continue();
        } else if (url.pathname.includes("/assets/main_guard.ts-") && !url.pathname.includes("loader")) {
          delayedMainModules++;
          await configQueued;
          await route.continue();
        } else if ((url.protocol === "http:" || url.protocol === "https:") && !allowedOrigins.has(url.origin)) {
          await route.abort("blockedbyclient");
        } else if (url.pathname === "/named-properties.html") {
          // These are the first parser-created elements, before the async
          // isolated module runs. No page script assigns the named property.
          const markup = fixture === "form"
            ? '<form id="__navsentinelMainNatives"><input name="push"></form>'
            : fixture === "iframe"
              ? `<iframe name="__navsentinelMainNatives" src="${alternate.origin}/named-frame.html"></iframe>`
              : "";
          await route.fulfill({ contentType: "text/html", body: `<!doctype html>${markup}<p>Local named-property fixture</p>` });
        } else if (url.pathname === "/named-frame.html") {
          await route.fulfill({ contentType: "text/html", body: "Cross-origin loopback frame" });
        } else if (url.pathname === "/named-sink.html") {
          sinkRequests++;
          await route.fulfill({ contentType: "text/html", body: "Unexpected local navigation sink" });
        } else {
          await route.continue();
        }
      });
      await updateNavigationSettings(context, { defaultMode: "strict" });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/named-properties.html`, { waitUntil: "domcontentloaded" });
      if (fixture === "iframe") await page.waitForEvent("framenavigated", {
        predicate: (frame) => frame.url().includes("/named-frame.html"), timeout: 5000,
      }).catch(() => {
        expect(page.frames().some((frame) => frame.url().includes("/named-frame.html"))).toBe(true);
      });
      releaseModule();
      expect(delayedModules, "isolated import is delayed until the initial named markup exists").toBeGreaterThan(0);
      // Exercise the genuine pre-handshake config queue, rather than relying
      // on a lucky import/settings race that bypasses the buffer altogether.
      await page.waitForFunction(() => document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1",
        undefined, { timeout: 3000 }).catch(() => {});
      expect(delayedMainModules, "MAIN waits for the isolated config enqueue").toBeGreaterThan(0);
      releaseMain();
      if (fixture !== "normal") {
        expect(await page.evaluate(() => {
          const named = window as unknown as Record<string, unknown>;
          // MAIN owns an immutable record; the isolated world must not consult
          // the separate Window named-property fallback at all.
          return Object.getOwnPropertyDescriptor(named, "__navsentinelMainNatives")?.writable;
        })).toBe(false);
      }
      await waitForNavSentinelBridge(page);
      // A ready bridge alone is insufficient: strict-mode blocking proves that
      // ns-config reached MAIN, whose initial mode is off.
      await page.evaluate((sink) => { window.open(sink, "_blank"); }, `${alternate.origin}/named-sink.html`);
      await expect(page.locator("#__navsentinel_toast_host")).toBeAttached();
      await page.waitForTimeout(200);
      expect(sinkRequests).toBe(0);
      expect(context.pages().filter((candidate) => candidate.url().includes("/named-sink.html"))).toHaveLength(0);
    } finally {
      releaseModule();
      releaseMain();
      await context?.close();
      await fence.close();
      if (gym) await gym.close();
      fs.rmSync(profile, { recursive: true });
    }
  });
}
