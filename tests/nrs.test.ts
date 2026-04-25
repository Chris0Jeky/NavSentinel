import { describe, expect, it } from "vitest";
import {
  computeNRS,
  NRS_ALLOW_THRESHOLD,
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

describe("computeNRS", () => {
  describe("individual factors", () => {
    it("adds +20 for new tab/window", () => {
      const result = computeNRS(baseCds(0), baseNav({ isNewTabOrWindow: true }));
      expect(result.nrs).toBe(20);
      expect(result.nrsFactors).toContain("nrs_new_tab_window");
    });

    it("adds +20 for cross-site destination", () => {
      const result = computeNRS(baseCds(0), baseNav({ isCrossSite: true }));
      expect(result.nrs).toBe(20);
      expect(result.nrsFactors).toContain("nrs_cross_site");
    });

    it("adds +10 for attempt within 250ms of pointerdown", () => {
      const result = computeNRS(baseCds(0), baseNav({ timeSincePointerdownMs: 100 }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).toContain("nrs_fast_attempt");
    });

    it("adds +10 for attempt at exactly 250ms", () => {
      const result = computeNRS(baseCds(0), baseNav({ timeSincePointerdownMs: 250 }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).toContain("nrs_fast_attempt");
    });

    it("does not add fast attempt for >250ms", () => {
      const result = computeNRS(baseCds(0), baseNav({ timeSincePointerdownMs: 251 }));
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).not.toContain("nrs_fast_attempt");
    });

    it("does not add fast attempt when timeSincePointerdownMs is undefined", () => {
      const result = computeNRS(baseCds(0), baseNav());
      expect(result.nrsFactors).not.toContain("nrs_fast_attempt");
    });

    it("adds +5 for userActivation.isActive", () => {
      const result = computeNRS(baseCds(0), baseNav({ userActivationActive: true }));
      expect(result.nrs).toBe(5);
      expect(result.nrsFactors).toContain("nrs_user_activation_active");
    });

    it("adds +25 for multiple attempts in gesture", () => {
      const result = computeNRS(baseCds(0), baseNav({ multipleAttemptsInGesture: true }));
      expect(result.nrs).toBe(25);
      expect(result.nrsFactors).toContain("nrs_multiple_attempts");
    });

    it("adds -100 for allowlisted destination", () => {
      const result = computeNRS(baseCds(50), baseNav({ destinationAllowlisted: true }));
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).toContain("nrs_allowlisted");
    });

    it("adds -30 for explicit new-tab intent", () => {
      const result = computeNRS(baseCds(30), baseNav({ explicitNewTabIntent: true }));
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).toContain("nrs_explicit_new_tab_intent");
    });
  });

  describe("factor combinations", () => {
    it("combines new tab + cross-site", () => {
      const result = computeNRS(
        baseCds(10),
        baseNav({ isNewTabOrWindow: true, isCrossSite: true })
      );
      expect(result.nrs).toBe(10 + 20 + 20);
    });

    it("combines all positive factors", () => {
      const result = computeNRS(
        baseCds(15),
        baseNav({
          isNewTabOrWindow: true,
          isCrossSite: true,
          timeSincePointerdownMs: 50,
          userActivationActive: true,
          multipleAttemptsInGesture: true,
        })
      );
      expect(result.nrs).toBe(15 + 20 + 20 + 10 + 5 + 25);
    });

    it("explicit new-tab intent reduces score from new-tab factor", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ isNewTabOrWindow: true, explicitNewTabIntent: true })
      );
      // +20 - 30 = -10 -> clamped to 0
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).toContain("nrs_new_tab_window");
      expect(result.nrsFactors).toContain("nrs_explicit_new_tab_intent");
    });

    it("allowlist dominates even with high CDS and many factors", () => {
      const result = computeNRS(
        baseCds(80, ["no_accessible_name", "overlay_large_interactive"]),
        baseNav({
          isNewTabOrWindow: true,
          isCrossSite: true,
          multipleAttemptsInGesture: true,
          destinationAllowlisted: true,
        })
      );
      // 80 + 20 + 20 + 25 - 100 = 45
      expect(result.nrs).toBe(45);
    });
  });

  describe("clamping", () => {
    it("clamps to 0 when score would be negative", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ destinationAllowlisted: true })
      );
      expect(result.nrs).toBe(0);
    });

    it("clamps to 0 with explicit new tab + allowlist on zero CDS", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ destinationAllowlisted: true, explicitNewTabIntent: true })
      );
      expect(result.nrs).toBe(0);
    });
  });

  describe("CDS preservation", () => {
    it("preserves original CDS score in result", () => {
      const result = computeNRS(
        baseCds(42, ["retargeted_target_mismatch"]),
        baseNav({ isNewTabOrWindow: true })
      );
      expect(result.cds).toBe(42);
      expect(result.nrs).toBe(62);
    });

    it("preserves CDS reason codes alongside NRS reasons", () => {
      const cdsReasons = ["no_accessible_name", "overlay_large_interactive"];
      const result = computeNRS(
        baseCds(45, cdsReasons),
        baseNav({ isNewTabOrWindow: true, isCrossSite: true })
      );
      expect(result.reasonCodes).toContain("no_accessible_name");
      expect(result.reasonCodes).toContain("overlay_large_interactive");
      expect(result.reasonCodes).toContain("nrs_new_tab_window");
      expect(result.reasonCodes).toContain("nrs_cross_site");
    });

    it("nrsFactors contains only NRS-specific reasons", () => {
      const result = computeNRS(
        baseCds(20, ["retargeted_target_mismatch"]),
        baseNav({ isNewTabOrWindow: true })
      );
      expect(result.nrsFactors).toEqual(["nrs_new_tab_window"]);
      expect(result.nrsFactors).not.toContain("retargeted_target_mismatch");
    });
  });

  describe("threshold boundaries", () => {
    it("NRS < 40 is in allow range", () => {
      const result = computeNRS(baseCds(39), baseNav());
      expect(result.nrs).toBeLessThan(NRS_ALLOW_THRESHOLD);
    });

    it("NRS = 40 is at prompt threshold", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({ isNewTabOrWindow: true })
      );
      expect(result.nrs).toBe(40);
      expect(result.nrs).toBeGreaterThanOrEqual(NRS_ALLOW_THRESHOLD);
      expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
    });

    it("NRS = 70 is at block threshold", () => {
      const result = computeNRS(
        baseCds(30),
        baseNav({ isNewTabOrWindow: true, isCrossSite: true })
      );
      expect(result.nrs).toBe(70);
      expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
    });

    it("NRS = 50 hits strict block threshold", () => {
      const result = computeNRS(
        baseCds(10),
        baseNav({ isNewTabOrWindow: true, isCrossSite: true })
      );
      expect(result.nrs).toBe(50);
      expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
      expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
    });

    it("NRS = 69 is in prompt range (not yet block)", () => {
      const result = computeNRS(baseCds(69), baseNav());
      expect(result.nrs).toBe(69);
      expect(result.nrs).toBeGreaterThanOrEqual(NRS_ALLOW_THRESHOLD);
      expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
    });
  });

  describe("allowlist dominance", () => {
    it("allowlist drives NRS to 0 from moderate CDS", () => {
      const result = computeNRS(
        baseCds(30),
        baseNav({ destinationAllowlisted: true })
      );
      expect(result.nrs).toBe(0);
    });

    it("allowlist reduces high CDS+factors below block threshold", () => {
      const result = computeNRS(
        baseCds(60, ["intent_mismatch_under_interactive"]),
        baseNav({
          isNewTabOrWindow: true,
          isCrossSite: true,
          destinationAllowlisted: true,
        })
      );
      // 60 + 20 + 20 - 100 = 0
      expect(result.nrs).toBe(0);
      expect(result.nrs).toBeLessThan(NRS_ALLOW_THRESHOLD);
    });

    it("allowlist alone cannot reduce very high combined score below block", () => {
      const result = computeNRS(
        baseCds(120, ["many_reasons"]),
        baseNav({
          isNewTabOrWindow: true,
          isCrossSite: true,
          multipleAttemptsInGesture: true,
          destinationAllowlisted: true,
        })
      );
      // 120 + 20 + 20 + 25 - 100 = 85
      expect(result.nrs).toBe(85);
      expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
    });
  });

  describe("no-context baseline", () => {
    it("NRS equals CDS when no navigation context factors apply", () => {
      const result = computeNRS(baseCds(35), baseNav());
      expect(result.nrs).toBe(35);
      expect(result.cds).toBe(35);
      expect(result.nrsFactors).toEqual([]);
    });
  });
});
