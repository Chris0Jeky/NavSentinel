import { defineConfig } from "@playwright/test";

/** This operator-prepared CDP lane is intentionally absent from normal E2E and CI. */
export default defineConfig({
  testDir: "./tests/maintainer-headed",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "artifacts/maintainer-headed/playwright",
  use: { trace: "off", screenshot: "off", video: "off" },
});
