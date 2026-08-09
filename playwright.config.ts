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
  reporter: "list",
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
