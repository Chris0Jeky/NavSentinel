import { describe, expect, it } from "vitest";
import { buildNavOutcomeFeatures } from "../extension/src/shared/storage";
import type { ClickContext } from "../extension/src/shared/scoring";

const ctx: ClickContext = {
  viewport: { w: 1280, h: 720 },
  input: "pointer",
  top: { tag: "A", role: "link", targetBlank: true },
};

describe("buildNavOutcomeFeatures (P5-C1 / #238)", () => {
  it("always includes thresholdUsed", () => {
    const f = buildNavOutcomeFeatures({ thresholdUsed: 70 });
    expect(f.thresholdUsed).toBe(70);
  });

  it("includes all signals when present", () => {
    const f = buildNavOutcomeFeatures({
      reasonCodes: ["nrs_cross_site"],
      nrsFactors: ["nrs_cross_site", "nrs_new_tab_window"],
      cds: 30,
      navAnomalyScore: 15,
      adaptiveAdj: -5,
      thresholdUsed: 65,
      ctx,
    });
    expect(f.reasons).toEqual(["nrs_cross_site"]);
    expect(f.nrsFactors).toEqual(["nrs_cross_site", "nrs_new_tab_window"]);
    expect(f.cds).toBe(30);
    expect(f.navAnomalyScore).toBe(15);
    expect(f.adaptiveAdj).toBe(-5);
    expect(f.elementContext).toBe(ctx);
  });

  it("omits empty reason/factor arrays", () => {
    const f = buildNavOutcomeFeatures({ reasonCodes: [], nrsFactors: [], thresholdUsed: 70 });
    expect(f.reasons).toBeUndefined();
    expect(f.nrsFactors).toBeUndefined();
  });

  it("omits a zero/absent navAnomalyScore (no anomaly fired)", () => {
    expect(buildNavOutcomeFeatures({ navAnomalyScore: 0, thresholdUsed: 70 }).navAnomalyScore).toBeUndefined();
    expect(buildNavOutcomeFeatures({ thresholdUsed: 70 }).navAnomalyScore).toBeUndefined();
  });

  it("keeps adaptiveAdj of 0 (a meaningful 'no adjustment') but drops non-finite", () => {
    expect(buildNavOutcomeFeatures({ adaptiveAdj: 0, thresholdUsed: 70 }).adaptiveAdj).toBe(0);
    expect(buildNavOutcomeFeatures({ adaptiveAdj: Number.NaN, thresholdUsed: 70 }).adaptiveAdj).toBeUndefined();
  });

  it("drops a non-finite cds but keeps a finite 0", () => {
    expect(buildNavOutcomeFeatures({ cds: Number.POSITIVE_INFINITY, thresholdUsed: 70 }).cds).toBeUndefined();
    expect(buildNavOutcomeFeatures({ cds: 0, thresholdUsed: 70 }).cds).toBe(0);
  });

  it("omits elementContext when ctx is absent", () => {
    expect(buildNavOutcomeFeatures({ thresholdUsed: 70 }).elementContext).toBeUndefined();
  });
});
