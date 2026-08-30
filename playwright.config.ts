import { defineConfig } from "@playwright/test";

import { resolveE2eTopology } from "./tests/e2e/playwright-topology";

// Serial by default; `NAVSENTINEL_E2E_WORKERS=<n>` opts back into parallel
// locally. CI is always serial, exactly as before (#460).
const topology = resolveE2eTopology();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: topology.fullyParallel,
  workers: topology.workers,
  retries: process.env.CI ? 1 : 0,
  // A retry remains useful diagnostic evidence, but CI must not turn a
  // first-attempt failure into a green security signal.
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI
    ? [
        ["list"],
        ["junit", { outputFile: "test-results/e2e-junit.xml" }],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : "list",
  outputDir: "test-results/artifacts",
  projects: [
    {
      name: "smoke",
      grep: /@smoke/
    },
    {
      name: "regression",
      grep: /@regression/
    },
    {
      name: "phase2",
      grep: /@phase2/
    }
  ]
});
