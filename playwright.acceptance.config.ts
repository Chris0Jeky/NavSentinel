import { createRequire } from "node:module";
import { defineConfig } from "@playwright/test";

/**
 * Agent-run acceptance lane for the owner browser procedures (tests/acceptance).
 *
 * Defaults to the installed branded Chrome with Playwright's realism-distorting
 * switches removed (back/forward cache, popup blocker, background throttling,
 * sandbox). Override with NAVSENTINEL_BRANDED_CHROME=0 for bundled Chromium,
 * NAVSENTINEL_BRANDED_CHROME=<chrome path> for another Chrome build, or
 * NAVSENTINEL_REALISTIC_CHROME=0 for Playwright's usual switches. Receipts are
 * written under artifacts/acceptance/<run>/ and are automated evidence only.
 */
process.env.NAVSENTINEL_BRANDED_CHROME ??= "1";
process.env.NAVSENTINEL_REALISTIC_CHROME ??= "1";
process.env.NAVSENTINEL_ACCEPTANCE_RUN ??= new Date().toISOString().replace(/[:.]/g, "-");
if (process.env.NAVSENTINEL_BRANDED_CHROME === "0") process.env.NAVSENTINEL_BRANDED_CHROME = "";
createRequire(import.meta.url)("./tests/branded/branded-chrome-preload.cjs");

export default defineConfig({
  testDir: "./tests/acceptance",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [["list"]],
  outputDir: `artifacts/acceptance/${process.env.NAVSENTINEL_ACCEPTANCE_RUN}/playwright`,
  use: { trace: "off", screenshot: "off", video: "off" },
});
