import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    include: ["extension/src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
