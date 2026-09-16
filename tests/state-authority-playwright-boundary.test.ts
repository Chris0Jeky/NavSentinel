import { describe, expect, it } from "vitest";
import defaultPlaywrightConfig from "../playwright.config";
import livePlaywrightConfig from "../playwright.live.config";
import rollbackPlaywrightConfig from "../playwright.rollback.config";
import stressPlaywrightConfig from "../playwright.stress.config";

function patterns(value: string | RegExp | Array<string | RegExp> | undefined): Array<string | RegExp> {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

describe("state-authority Playwright collection boundary", () => {
  it.each([
    ["default", defaultPlaywrightConfig],
    ["rollback", rollbackPlaywrightConfig],
    ["live", livePlaywrightConfig],
  ])("excludes the launcher-only authority spec from %s E2E", (_name, config) => {
    expect(patterns(config.testIgnore)).toContain(
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
});
