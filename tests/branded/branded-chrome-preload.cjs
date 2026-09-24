/**
 * Branded-Chrome engine shim for the existing Playwright lanes.
 *
 * Branded Google Chrome ignores `--load-extension` since Chrome 137, so the
 * E2E specs (which pass that flag to `chromium.launchPersistentContext`) can
 * only exercise Playwright's bundled Chromium. This preload rewrites those
 * launches to use an installed branded Chrome with a fresh profile and loads
 * the same unpacked build through the DevTools `Extensions.loadUnpacked`
 * command, which Chrome accepts when started with
 * `--enable-unsafe-extension-debugging` over the pipe transport Playwright
 * already uses.
 *
 * It is inert unless `NAVSENTINEL_BRANDED_CHROME` is set:
 *   NAVSENTINEL_BRANDED_CHROME=1                 -> default install path
 *   NAVSENTINEL_BRANDED_CHROME=<path to chrome>  -> that executable
 * Load it with `NODE_OPTIONS=--require=./tests/branded/branded-chrome-preload.cjs`
 * (see scripts/run-branded-lane.mjs).
 *
 * This is automated evidence from a real Chrome build; it is not an owner
 * Gate-3 result and does not touch the owner's profile or chrome://extensions.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const rawSelector = (process.env.NAVSENTINEL_BRANDED_CHROME || "").trim();
const selector = rawSelector === "0" ? "" : rawSelector;

function resolveExecutable() {
  if (selector && selector !== "1") return path.resolve(selector);
  const candidates = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/opt/google/chrome/chrome",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("NAVSENTINEL_BRANDED_CHROME is set but no branded Chrome executable was found");
  return found;
}

/**
 * Playwright's default Chromium switches that make automation diverge from an
 * ordinary user's Chrome. `NAVSENTINEL_REALISTIC_CHROME=1` removes them so a
 * run sees the back/forward cache, Chrome's own popup blocker, background-tab
 * timer throttling, render-document swaps, the renderer sandbox and third-party
 * storage partitioning exactly as a user does.
 */
const REALISM_DISTORTING_SWITCHES = [
  "--disable-back-forward-cache",
  "--disable-popup-blocking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-ipc-flooding-protection",
  "--allow-pre-commit-input",
  "--disable-hang-monitor",
  "--disable-prompt-on-repost",
  "--disable-field-trial-config",
];

function playwrightDisableFeaturesSwitch(channel) {
  const corePackage = require.resolve("playwright-core/package.json");
  const switchesPath = path.join(path.dirname(corePackage), "lib", "server", "chromium", "chromiumSwitches.js");
  const { chromiumSwitches } = require(switchesPath);
  return chromiumSwitches(false, channel).find((arg) => arg.startsWith("--disable-features="));
}

function splitExtensionArgs(args) {
  const extensions = [];
  const kept = [];
  for (const arg of args || []) {
    if (typeof arg === "string" && arg.startsWith("--load-extension=")) {
      for (const entry of arg.slice("--load-extension=".length).split(",")) {
        if (entry) extensions.push(path.resolve(entry));
      }
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--disable-extensions-except=")) continue;
    kept.push(arg);
  }
  return { extensions, kept };
}

/**
 * Playwright 1.57 targets Chromium 143. With Chrome 153 a `target=_blank`
 * anchor popup reports its initial empty document as loaded, so
 * `popup.waitForLoadState()` resolves while `popup.url()` is still "" — with
 * or without the extension (measured 2026-09-24). For popups only, wait
 * (bounded) for the real first navigation before honouring the load state.
 */
function patchPopupLoadState(context) {
  const first = context.pages()[0];
  if (!first) return;
  const pageProto = Object.getPrototypeOf(first);
  if (pageProto.__navsentinelPopupSettle) return;
  const original = pageProto.waitForLoadState;
  pageProto.waitForLoadState = async function settledWaitForLoadState(state, options) {
    const opener = await this.opener().catch(() => null);
    if (opener && (this.url() === "" || this.url() === "about:blank")) {
      const deadline = Date.now() + Math.min(options?.timeout ?? 5000, 5000);
      while (Date.now() < deadline && (this.url() === "" || this.url() === "about:blank") && !this.isClosed()) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    return original.call(this, state, options);
  };
  pageProto.__navsentinelPopupSettle = true;
}

if (selector) {
  const executablePath = resolveExecutable();
  const { chromium } = require("playwright-core");
  const proto = Object.getPrototypeOf(chromium);
  if (!proto.__navsentinelBrandedPatched) {
    const original = proto.launchPersistentContext;
    proto.launchPersistentContext = async function brandedLaunchPersistentContext(userDataDir, options = {}) {
      const { extensions, kept } = splitExtensionArgs(options.args);
      if (extensions.length === 0 || this.name() !== "chromium") {
        return original.call(this, userDataDir, options);
      }
      const realistic = process.env.NAVSENTINEL_REALISTIC_CHROME === "1";
      const extraIgnored = ["--disable-extensions"];
      if (realistic) {
        extraIgnored.push(...REALISM_DISTORTING_SWITCHES);
        const features = playwrightDisableFeaturesSwitch(undefined);
        if (features) extraIgnored.push(features);
      }
      const ignore = options.ignoreDefaultArgs === true
        ? true
        : Array.from(new Set([...(Array.isArray(options.ignoreDefaultArgs) ? options.ignoreDefaultArgs : []), ...extraIgnored]));
      const context = await original.call(this, userDataDir, {
        ...options,
        channel: undefined,
        executablePath,
        ignoreDefaultArgs: ignore,
        ...(realistic ? { chromiumSandbox: true } : {}),
        args: [...kept, "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check"],
      });
      try {
        const browser = context.browser();
        if (!browser) throw new Error("branded Chrome context has no browser handle for Extensions.loadUnpacked");
        const session = await browser.newBrowserCDPSession();
        for (const extension of extensions) {
          await session.send("Extensions.loadUnpacked", { path: extension });
        }
        await session.detach().catch(() => undefined);
        if (process.env.NAVSENTINEL_BRANDED_RECORD) {
          fs.appendFileSync(process.env.NAVSENTINEL_BRANDED_RECORD, `${JSON.stringify({ version: browser.version(), executablePath, realistic, extensions, at: new Date().toISOString() })}\n`);
        }
      } catch (error) {
        await context.close().catch(() => undefined);
        throw error;
      }
      patchPopupLoadState(context);
      return context;
    };
    proto.__navsentinelBrandedPatched = true;
  }
}
