import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const fixture = fs.readFileSync(
  path.join(root, "gym", "clickfix-06-clipboard-pressure.html"),
  "utf8",
);
const acceptance = fs.readFileSync(
  path.join(root, "tests", "acceptance", "ai47-8-clipboard-pressure.spec.ts"),
  "utf8",
);

describe("ClickFix clipboard-pressure self-check hardening (#954)", () => {
  it("measures the burst spread and the post-write bridge-marker gap", () => {
    const minimumGap = Number(fixture.match(/const MIN_READY_GAP_MS = (\d+(?:\.\d+)?);/u)?.[1]);
    expect(Number.isFinite(minimumGap)).toBe(true);
    expect(minimumGap).toBeGreaterThan(0);

    expect(fixture).toContain("firstResolvedAt");
    expect(fixture).toContain("burstSpreadMs");
    expect(fixture).toContain("readyGapMs");
    expect(fixture).toContain("data.pressureBurstSpreadMs");
    expect(fixture).toContain("data.pressureReadyGapMs");
    expect(fixture).toMatch(
      /s\.readyGapMs\s*===\s*null\s*\|\|\s*s\.readyGapMs\s*<\s*MIN_READY_GAP_MS/u,
    );
    expect(fixture).toContain("The bridge-ready marker followed the last write by only");
  });

  it("records at least ten branded-browser timing samples before claiming the proxy is bounded", () => {
    const samples = Number(
      acceptance.match(/const PRESSURE_TIMING_SAMPLES = (\d+);/u)?.[1],
    );
    expect(samples).toBeGreaterThanOrEqual(10);
    expect(acceptance).toContain("clipboard-pressure timing sample");
    expect(acceptance).toContain("readyGapMs");
    expect(acceptance).toContain("burstSpreadMs");
  });

  it("retires a discarded page and waits for event-log quiescence before the next baseline", () => {
    const start = acceptance.indexOf("async function loadValidPressureArm(");
    const end = acceptance.indexOf("\ntest(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const loader = acceptance.slice(start, end);

    expect(acceptance).toContain("async function waitForEventLogQuiescence(");
    expect(loader).toContain("await page.close()");
    expect(loader).toContain("await waitForEventLogQuiescence(session)");
    expect(loader).not.toContain("await page.waitForTimeout(1000)");
    expect(loader.indexOf("await waitForEventLogQuiescence(session)")).toBeLessThan(
      loader.lastIndexOf("logBefore = await session.eventLog()"),
    );
  });
});
