import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "**/navsentinel.stress.spec.ts",
    "**/state-authority-sink.spec.ts"
  ],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: "list",
  use: {
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "stress",
      grep: /@stress/
    }
  ]
});
