import { defineConfig } from "@playwright/test";

import { resolveE2eTopology } from "./tests/e2e/playwright-topology";

// Same headed persistent-context topology as the default lane, so it takes the
// same serial-by-default rule (#460).
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
      name: "live",
      grep: /@live/
    }
  ]
});
