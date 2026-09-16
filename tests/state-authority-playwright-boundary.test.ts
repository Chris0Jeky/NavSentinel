import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import defaultPlaywrightConfig from "../playwright.config";
import stressPlaywrightConfig from "../playwright.stress.config";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function patterns(value: string | RegExp | Array<string | RegExp> | undefined): Array<string | RegExp> {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

describe("state-authority Playwright collection boundary", () => {
  it("excludes the launcher-only authority spec from ordinary E2E", () => {
    expect(patterns(defaultPlaywrightConfig.testIgnore)).toContain(
      "**/state-authority-sink.spec.ts",
    );
  });

  it("keeps the authority spec in the serial stress configuration", () => {
    expect(patterns(stressPlaywrightConfig.testMatch)).toContain(
      "**/state-authority-sink.spec.ts",
    );
    expect(stressPlaywrightConfig.workers).toBe(1);
    expect(stressPlaywrightConfig.fullyParallel).toBe(false);
  });

  it("keeps the scheduled stress lane outside the launcher-only authority spec", () => {
    const workflow = fs.readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "stress.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "npm run test:e2e:stress -- tests/e2e/navsentinel.stress.spec.ts",
    );
  });
});
