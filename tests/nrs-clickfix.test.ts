import { describe, expect, it } from "vitest";
import {
  computeNRS,
  NRS_BLOCK_THRESHOLD,
  NRS_STRICT_BLOCK_THRESHOLD,
} from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

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

describe("NRS ClickFix integration", () => {
  describe("clickfixScore feeds into NRS correctly", () => {
    it("adds score directly when clickfixScore > 0", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 35 })
      );
      expect(result.nrs).toBe(35);
      expect(result.nrsFactors).toContain("nrs_clickfix_active");
      expect(result.reasonCodes).toContain("nrs_clickfix_active");
    });

    it("adds low clickfixScore directly", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 10 })
      );
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).toContain("nrs_clickfix_active");
    });

    it("adds clickfixScore of 25 directly", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 25 })
      );
      expect(result.nrs).toBe(25);
    });

    it("adds to existing CDS baseline", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({ clickfixScore: 30 })
      );
      // 20 + 30 = 50
      expect(result.nrs).toBe(50);
    });
  });

  describe("cap at 40 within NRS", () => {
    it("caps contribution at 40 for clickfixScore of 60", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 60 })
      );
      expect(result.nrs).toBe(40);
    });

    it("caps contribution at 40 for clickfixScore of 100", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 100 })
      );
      expect(result.nrs).toBe(40);
    });

    it("does not cap when clickfixScore is at exactly 40", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 40 })
      );
      expect(result.nrs).toBe(40);
    });

    it("does not cap when clickfixScore is below 40", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 39 })
      );
      expect(result.nrs).toBe(39);
    });
  });

  describe("combined scenario: navigation signals + ClickFix", () => {
    it("clickfix + new tab + cross-site reaches block threshold", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({
          clickfixScore: 35,
          isNewTabOrWindow: true,
          isCrossSite: true,
        })
      );
      // 0 + 20 + 20 + 35 = 75
      expect(result.nrs).toBe(75);
      expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
      expect(result.nrsFactors).toContain("nrs_new_tab_window");
      expect(result.nrsFactors).toContain("nrs_cross_site");
      expect(result.nrsFactors).toContain("nrs_clickfix_active");
    });

    it("clickfix + CDS reaches strict block threshold", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({ clickfixScore: 35 })
      );
      // 20 + 35 = 55
      expect(result.nrs).toBe(55);
      expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
    });

    it("combines with double-click hijack", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({
          clickfixScore: 60,
          doubleClickHijackActive: true,
        })
      );
      // 0 + 40 (dblclick) + 40 (clickfix capped) = 80
      expect(result.nrs).toBe(80);
      expect(result.nrsFactors).toContain("nrs_double_click_hijack");
      expect(result.nrsFactors).toContain("nrs_clickfix_active");
    });

    it("combines with all positive factors", () => {
      const result = computeNRS(
        baseCds(5),
        baseNav({
          clickfixScore: 60,
          isNewTabOrWindow: true,
          isCrossSite: true,
          timeSincePointerdownMs: 100,
          userActivationActive: true,
          multipleAttemptsInGesture: true,
        })
      );
      // 5 + 20 + 20 + 10 + 5 + 25 + 40 (capped) = 125 raw, diminishing returns: 100 + (25)*0.5 = 112.5
      expect(result.nrs).toBe(112.5);
    });

    it("allowlist reduces clickfix-boosted score", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({
          clickfixScore: 60,
          destinationAllowlisted: true,
        })
      );
      // 0 + 40 (capped) - 100 = -60 -> clamped to 0
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).toContain("nrs_clickfix_active");
      expect(result.nrsFactors).toContain("nrs_allowlisted");
    });

    it("combines with known bad domain", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({
          clickfixScore: 35,
          knownBadDomain: true,
        })
      );
      // 0 + 50 + 35 = 85
      expect(result.nrs).toBe(85);
      expect(result.nrsFactors).toContain("nrs_known_bad_domain");
      expect(result.nrsFactors).toContain("nrs_clickfix_active");
    });
  });

  describe("ClickFix alone (no navigation signals) still works independently", () => {
    it("clickfixScore alone does not reach smart block threshold", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 35 })
      );
      expect(result.nrs).toBe(35);
      expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
    });

    it("clickfixScore alone (max capped) does not reach smart block threshold", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 60 })
      );
      expect(result.nrs).toBe(40);
      expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
    });

    it("preserves CDS reason codes alongside clickfix NRS factor", () => {
      const cdsReasons = ["no_accessible_name", "overlay_large_interactive"];
      const result = computeNRS(
        baseCds(30, cdsReasons),
        baseNav({ clickfixScore: 35 })
      );
      expect(result.reasonCodes).toContain("no_accessible_name");
      expect(result.reasonCodes).toContain("overlay_large_interactive");
      expect(result.reasonCodes).toContain("nrs_clickfix_active");
    });

    it("preserves original CDS in result", () => {
      const result = computeNRS(
        baseCds(42, ["overlay_large_interactive"]),
        baseNav({ clickfixScore: 35 })
      );
      expect(result.cds).toBe(42);
      // 42 + 35 = 77
      expect(result.nrs).toBe(77);
    });

    it("nrsFactors contains only NRS-specific reasons, not CDS reasons", () => {
      const result = computeNRS(
        baseCds(20, ["retargeted_target_mismatch"]),
        baseNav({ clickfixScore: 35 })
      );
      expect(result.nrsFactors).toContain("nrs_clickfix_active");
      expect(result.nrsFactors).not.toContain("retargeted_target_mismatch");
    });
  });

  describe("zero clickfixScore does not affect NRS", () => {
    it("does not add factor when clickfixScore is 0", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ clickfixScore: 0 })
      );
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).not.toContain("nrs_clickfix_active");
    });

    it("does not add factor when clickfixScore is undefined", () => {
      const result = computeNRS(baseCds(0), baseNav());
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).not.toContain("nrs_clickfix_active");
    });

    it("NRS equals CDS when no context factors apply (no clickfix)", () => {
      const result = computeNRS(baseCds(35), baseNav());
      expect(result.nrs).toBe(35);
      expect(result.nrsFactors).toEqual([]);
    });

    it("existing factors still work without clickfix fields", () => {
      const result = computeNRS(
        baseCds(10),
        baseNav({ isNewTabOrWindow: true, isCrossSite: true })
      );
      // 10 + 20 + 20 = 50
      expect(result.nrs).toBe(50);
      expect(result.nrsFactors).toContain("nrs_new_tab_window");
      expect(result.nrsFactors).toContain("nrs_cross_site");
      expect(result.nrsFactors).not.toContain("nrs_clickfix_active");
    });
  });
});
