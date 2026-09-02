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

describe("core Gym fixture locality contracts", () => {
  it.each(fixtures)("keeps $file on the typed local-target contract", ({ file, scenarioId, kind }) => {
    const source = fs.readFileSync(path.join(gymRoot, file), "utf8");

    expect(source).toContain('<script src="local-fixture-targets.js"></script>');
    expect(source).not.toMatch(/https?:\/\//u);

    if (kind === "dynamic-harm") {
      expect(source).toContain(`window.NavSentinelLocalTargets.url('harm', '${scenarioId}')`);
      return;
    }

    expect(source).not.toMatch(/<a\b[^>]*\bhref\s*=/iu);
    expect(source).toContain(`data-navsentinel-scenario="${scenarioId}"`);
    expect(source).toContain(`data-navsentinel-local-target="${kind === "static-benign" ? "benign" : "harm"}"`);
  });

  it("keeps every static helper consumer inert until target validation succeeds", () => {
    const consumers = fs.readdirSync(gymRoot)
      .filter((file) => file.endsWith(".html"))
      .filter((file) => /data-navsentinel-local-target=/u.test(fs.readFileSync(path.join(gymRoot, file), "utf8")));

    expect(consumers).toHaveLength(17);
    for (const file of consumers) {
      const source = fs.readFileSync(path.join(gymRoot, file), "utf8");
      const targetAnchors = [...source.matchAll(/<a\b[^>]*data-navsentinel-local-target=[^>]*>/giu)];
      expect(targetAnchors, `${file} must contain typed target anchors`).not.toHaveLength(0);
      for (const anchor of targetAnchors) {
        expect(anchor[0], `${file} target anchor must not expose an initial href`).not.toMatch(/\bhref\s*=/iu);
      }
    }
  });
});
