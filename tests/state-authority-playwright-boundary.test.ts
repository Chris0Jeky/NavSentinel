import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import defaultPlaywrightConfig from "../playwright.config";
import livePlaywrightConfig from "../playwright.live.config";
import rollbackPlaywrightConfig from "../playwright.rollback.config";
import stressPlaywrightConfig from "../playwright.stress.config";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

  it("keeps the scheduled stress lane outside the launcher-only authority spec", () => {
    const packageJson = JSON.parse(fs.readFileSync(
      path.join(repositoryRoot, "package.json"),
      "utf8",
    )) as { scripts?: Record<string, string> };
    const workflow = fs.readFileSync(
      path.join(repositoryRoot, ".github", "workflows", "stress.yml"),
      "utf8",
    );

    expect(packageJson.scripts?.["test:e2e:stress"]).toContain(
      "tests/e2e/navsentinel.stress.spec.ts",
    );
    expect(workflow).toContain(
      "npm run test:e2e:stress",
    );
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("npm run test:e2e:state-authority");
  });
});
