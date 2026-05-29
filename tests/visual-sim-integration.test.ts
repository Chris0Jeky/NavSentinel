import { describe, expect, it } from "vitest";
import { computeNRS } from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";
import { NRS_WEIGHT_VISUAL_SIM_CAP } from "../extension/src/shared/visual_sim_types";

function baseCds(cds = 0, reasonCodes: string[] = []): ScoreResult {
  return { cds, reasonCodes };
}

function baseNav(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return {
    isNewTabOrWindow: false,
    isCrossSite: false,
    ...overrides,
  };
}

describe("NRS visual similarity integration", () => {
  describe("visualSimilarityScore feeds into NRS correctly", () => {
    it("does not add the factor when score is 0", () => {
      const result = computeNRS(baseCds(0), baseNav({ visualSimilarityScore: 0 }));
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).not.toContain("nrs_visual_brand_match");
      expect(result.reasonCodes).not.toContain("nrs_visual_brand_match");
    });

    it("does not add the factor when score is undefined", () => {
      const result = computeNRS(baseCds(0), baseNav());
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).not.toContain("nrs_visual_brand_match");
    });

    it("adds the aHash-only score (10) directly", () => {
      const result = computeNRS(baseCds(0), baseNav({ visualSimilarityScore: 10 }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).toContain("nrs_visual_brand_match");
      expect(result.reasonCodes).toContain("nrs_visual_brand_match");
    });

    it("adds the bHash-confirmed score (25) directly", () => {
      const result = computeNRS(baseCds(0), baseNav({ visualSimilarityScore: 25 }));
      expect(result.nrs).toBe(25);
      expect(result.nrsFactors).toContain("nrs_visual_brand_match");
    });

    it("adds the cross-origin score (30, at the cap) directly", () => {
      const result = computeNRS(baseCds(0), baseNav({ visualSimilarityScore: 30 }));
      expect(result.nrs).toBe(NRS_WEIGHT_VISUAL_SIM_CAP);
      expect(result.nrs).toBe(30);
      expect(result.nrsFactors).toContain("nrs_visual_brand_match");
    });

    it("caps contribution at 30 for an over-cap score", () => {
      const result = computeNRS(baseCds(0), baseNav({ visualSimilarityScore: 100 }));
      expect(result.nrs).toBe(NRS_WEIGHT_VISUAL_SIM_CAP);
      expect(result.nrs).toBe(30);
    });

    it("adds to an existing CDS baseline", () => {
      const result = computeNRS(baseCds(20), baseNav({ visualSimilarityScore: 25 }));
      // 20 + 25 = 45
      expect(result.nrs).toBe(45);
      expect(result.nrsFactors).toContain("nrs_visual_brand_match");
    });

    it("preserves CDS reason codes alongside the visual-sim factor", () => {
      const result = computeNRS(
        baseCds(30, ["no_accessible_name"]),
        baseNav({ visualSimilarityScore: 25 })
      );
      expect(result.reasonCodes).toContain("no_accessible_name");
      expect(result.reasonCodes).toContain("nrs_visual_brand_match");
    });
  });

  describe("combined with jsBehaviorScore", () => {
    it("stacks visual-sim and js-behavior contributions toward block", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({
          visualSimilarityScore: 30,
          jsBehaviorScore: 35,
          isCrossSite: true,
        })
      );
      // 0 + 30 (visual capped) + 35 (js behavior, cap 35) + 20 (cross-site) = 85
      expect(result.nrs).toBe(85);
      expect(result.nrsFactors).toContain("nrs_visual_brand_match");
      expect(result.nrsFactors).toContain("nrs_js_behavior_suspicious");
      expect(result.nrsFactors).toContain("nrs_cross_site");
    });
  });
});
