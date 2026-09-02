import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const gymRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "gym");

const fixtures = [
  { file: "level1-basic-opacity.html", scenarioId: "NS-ADV-UI-001", kind: "static-harm" },
  { file: "level2-moving-target.html", scenarioId: "NS-ADV-UI-002", kind: "static-harm" },
  { file: "level3-instant-injection.html", scenarioId: "NS-ADV-UI-003", kind: "dynamic-harm" },
  { file: "level4-visual-mimicry.html", scenarioId: "NS-ADV-UI-006", kind: "static-harm" },
  { file: "level5-window-open-popunder.html", scenarioId: "NS-ADV-WIN-001", kind: "dynamic-harm" },
  { file: "level6-programmatic-click.html", scenarioId: "NS-ADV-SELF-003", kind: "static-harm" },
  { file: "level9-legit-video-overlay.html", scenarioId: "NS-ADV-UI-004", kind: "static-benign" },
] as const;

const rwFixtures = [
  { file: "rw01-search-result-overlay-swap.html", scenarioId: "NS-ADV-SUPPLY-001", kind: "static-dual" },
  { file: "rw06-legit-auth-second-popup.html", scenarioId: "NS-ADV-AUTH-005", kind: "dynamic-dual" },
] as const;

describe("core Gym fixture locality contracts", () => {
  it.each(fixtures)("keeps $file on the typed local-target contract", ({ file, scenarioId, kind }) => {
    const source = fs.readFileSync(path.join(gymRoot, file), "utf8");

    expect(source).toContain('<script src="local-fixture-targets.js"></script>');
    expect(source).not.toMatch(/https?:\/\//u);

    if (kind === "dynamic-harm") {
      expect(source).toContain(`window.NavSentinelLocalTargets.url('harm', '${scenarioId}')`);
      return;
    }

    expect(source).toContain('href="local-fixture-sink.html"');
    expect(source).toContain(`data-navsentinel-scenario="${scenarioId}"`);
    expect(source).toContain(`data-navsentinel-local-target="${kind === "static-benign" ? "benign" : "harm"}"`);
  });
});

describe("RW Gym fixture locality contracts", () => {
  it.each(rwFixtures)("keeps $file on typed local benign and harm destinations", ({ file, scenarioId, kind }) => {
    const source = fs.readFileSync(path.join(gymRoot, file), "utf8");

    expect(source).toContain('<script src="local-fixture-targets.js"></script>');
    expect(source).not.toMatch(/https?:\/\//u);
    if (kind === "static-dual") {
      expect(source).toContain('href="local-fixture-sink.html"');
      expect(source).toContain('data-navsentinel-local-target="benign"');
      expect(source).toContain('data-navsentinel-local-target="harm"');
      expect(source).toContain(`data-navsentinel-scenario="${scenarioId}"`);
      return;
    }
    expect(source).toContain(`NavSentinelLocalTargets.url('benign', '${scenarioId}')`);
    expect(source).toContain(`NavSentinelLocalTargets.url('harm', '${scenarioId}')`);
  });
});
