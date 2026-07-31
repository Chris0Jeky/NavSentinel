import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: !process.env.CI,
  workers: process.env.CI ? 1 : 4,
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
