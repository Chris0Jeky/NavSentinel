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

    it("adds +40 for double-click hijack", () => {
      const result = computeNRS(baseCds(0), baseNav({ doubleClickHijackActive: true }));
      expect(result.nrs).toBe(40);
      expect(result.nrsFactors).toContain("nrs_double_click_hijack");
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
      expect(result.nrs).toBeLessThan(40);
    });

    it("NRS = 40 is at prompt threshold", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({ isNewTabOrWindow: true })
      );
      expect(result.nrs).toBe(40);
      expect(result.nrs).toBeGreaterThanOrEqual(40);
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
      expect(result.nrs).toBeGreaterThanOrEqual(40);
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
      expect(result.nrs).toBeLessThan(40);
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

  describe("knownBadDomain", () => {
    it("adds +50 for known bad domain", () => {
      const result = computeNRS(baseCds(0), baseNav({ knownBadDomain: true }));
      expect(result.nrs).toBe(50);
      expect(result.nrsFactors).toContain("nrs_known_bad_domain");
    });

    it("does not add when knownBadDomain is false", () => {
      const result = computeNRS(baseCds(0), baseNav({ knownBadDomain: false }));
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).not.toContain("nrs_known_bad_domain");
    });

    it("does not add when knownBadDomain is undefined", () => {
      const result = computeNRS(baseCds(0), baseNav());
      expect(result.nrsFactors).not.toContain("nrs_known_bad_domain");
    });

    it("known bad domain alone exceeds strict block threshold", () => {
      const result = computeNRS(baseCds(0), baseNav({ knownBadDomain: true }));
      expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
    });
  });

  describe("redirectChainDepth", () => {
    it("does not add score for depth at threshold (2)", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 2 }));
      expect(result.nrs).toBe(0);
      expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    });

    it("adds +5 per hop over threshold", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 3 }));
      expect(result.nrs).toBe(5);
      expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
    });

    it("adds +10 for 2 hops over threshold", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 4 }));
      expect(result.nrs).toBe(10);
    });

    it("caps at 25 for many hops", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 10 }));
      expect(result.nrs).toBe(25);
    });

    it("caps at exactly 25 for 7 hops over threshold", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 9 }));
      expect(result.nrs).toBe(25);
    });

    it("does not add when redirectChainDepth is undefined", () => {
      const result = computeNRS(baseCds(0), baseNav());
      expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    });

    it("does not add for depth 0", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 0 }));
      expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    });

    it("does not add for depth 1 (below threshold)", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 1 }));
      expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    });
  });

  describe("redirectViaKnownRedirector", () => {
    it("adds +15 for single known redirector hop", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectViaKnownRedirector: true }));
      expect(result.nrs).toBe(15);
      expect(result.nrsFactors).toContain("nrs_redirect_via_known_redirector");
    });

    it("adds +15 per hop with explicit knownRedirectorHops", () => {
      const result = computeNRS(baseCds(0), baseNav({
        redirectViaKnownRedirector: true,
        knownRedirectorHops: 2,
      }));
      expect(result.nrs).toBe(30);
    });

    it("caps at 30 for many redirector hops", () => {
      const result = computeNRS(baseCds(0), baseNav({
        redirectViaKnownRedirector: true,
        knownRedirectorHops: 5,
      }));
      expect(result.nrs).toBe(30);
    });

    it("defaults to 1 hop when knownRedirectorHops is undefined", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectViaKnownRedirector: true }));
      expect(result.nrs).toBe(15);
    });

    it("does not add when redirectViaKnownRedirector is false", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectViaKnownRedirector: false }));
      expect(result.nrsFactors).not.toContain("nrs_redirect_via_known_redirector");
    });

    it("combines with redirectChainDepth independently", () => {
      const result = computeNRS(baseCds(0), baseNav({
        redirectChainDepth: 5,
        redirectViaKnownRedirector: true,
        knownRedirectorHops: 1,
      }));
      // chain: (5-2)*5=15, redirector: 1*15=15, total=30
      expect(result.nrs).toBe(30);
      expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
      expect(result.nrsFactors).toContain("nrs_redirect_via_known_redirector");
    });
  });

  describe("oauthRedirectMismatch", () => {
    it("adds +30 for OAuth redirect mismatch", () => {
      const result = computeNRS(baseCds(0), baseNav({ oauthRedirectMismatch: true }));
      expect(result.nrs).toBe(30);
      expect(result.nrsFactors).toContain("nrs_oauth_redirect_mismatch");
    });

    it("does not add when oauthRedirectMismatch is false", () => {
      const result = computeNRS(baseCds(0), baseNav({ oauthRedirectMismatch: false }));
      expect(result.nrsFactors).not.toContain("nrs_oauth_redirect_mismatch");
    });
  });

  describe("oauthOpenerManipulation", () => {
    it("adds +45 when doubleClickHijack is not active", () => {
      const result = computeNRS(baseCds(0), baseNav({ oauthOpenerManipulation: true }));
      expect(result.nrs).toBe(45);
      expect(result.nrsFactors).toContain("nrs_oauth_opener_manipulation");
    });

    it("deduplicates with doubleClickHijack — adds only delta (+5)", () => {
      const result = computeNRS(baseCds(0), baseNav({
        oauthOpenerManipulation: true,
        doubleClickHijackActive: true,
      }));
      // doubleClickHijack: +40, oauthOpener dedup: +45-40 = +5, total = 45
      expect(result.nrs).toBe(45);
      expect(result.nrsFactors).toContain("nrs_double_click_hijack");
      expect(result.nrsFactors).toContain("nrs_oauth_opener_manipulation");
    });

    it("does not double-count when both OAuth opener and dblclick fire", () => {
      const bothResult = computeNRS(baseCds(0), baseNav({
        oauthOpenerManipulation: true,
        doubleClickHijackActive: true,
      }));
      const openerOnlyResult = computeNRS(baseCds(0), baseNav({
        oauthOpenerManipulation: true,
      }));
      // Both should yield the same NRS (45) since opener > dblclick
      expect(bothResult.nrs).toBe(openerOnlyResult.nrs);
    });

    it("does not add when oauthOpenerManipulation is false", () => {
      const result = computeNRS(baseCds(0), baseNav({ oauthOpenerManipulation: false }));
      expect(result.nrsFactors).not.toContain("nrs_oauth_opener_manipulation");
    });
  });

  describe("pushStateAbuse", () => {
    it("adds +20 for pushState abuse", () => {
      const result = computeNRS(baseCds(0), baseNav({ pushStateAbuse: true }));
      expect(result.nrs).toBe(20);
      expect(result.nrsFactors).toContain("nrs_pushstate_abuse");
    });

    it("does not add when pushStateAbuse is false", () => {
      const result = computeNRS(baseCds(0), baseNav({ pushStateAbuse: false }));
      expect(result.nrsFactors).not.toContain("nrs_pushstate_abuse");
    });
  });

  describe("cspWeaknessScore", () => {
    it("adds CSP weakness when base NRS > 20", () => {
      const result = computeNRS(baseCds(21), baseNav({ cspWeaknessScore: 5 }));
      expect(result.nrs).toBe(26);
      expect(result.nrsFactors).toContain("nrs_csp_weakness");
    });

    it("does not add CSP weakness when base NRS <= 20", () => {
      const result = computeNRS(baseCds(10), baseNav({ cspWeaknessScore: 5 }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
    });

    it("caps CSP weakness at 10", () => {
      const result = computeNRS(baseCds(30), baseNav({ cspWeaknessScore: 20 }));
      expect(result.nrs).toBe(40);
    });

    it("does not add when cspWeaknessScore is 0", () => {
      const result = computeNRS(baseCds(30), baseNav({ cspWeaknessScore: 0 }));
      expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
    });

    it("threshold gate checks accumulated NRS, not just CDS", () => {
      // CDS=10, but +20 from new tab = 30 > 20 threshold
      const result = computeNRS(baseCds(10), baseNav({
        isNewTabOrWindow: true,
        cspWeaknessScore: 5,
      }));
      expect(result.nrs).toBe(35);
      expect(result.nrsFactors).toContain("nrs_csp_weakness");
    });

    it("boundary: does not add CSP weakness when NRS is exactly 20", () => {
      const result = computeNRS(baseCds(20), baseNav({ cspWeaknessScore: 5 }));
      expect(result.nrs).toBe(20);
      expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
    });
  });

  describe("domainRepeatOffender", () => {
    it("adds +10 for repeat offender domain", () => {
      const result = computeNRS(baseCds(0), baseNav({ domainRepeatOffender: true }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).toContain("nrs_domain_repeat_offender");
    });

    it("does not add when domainRepeatOffender is false", () => {
      const result = computeNRS(baseCds(0), baseNav({ domainRepeatOffender: false }));
      expect(result.nrsFactors).not.toContain("nrs_domain_repeat_offender");
    });
  });

  describe("navAnomalyScore", () => {
    it("adds nav anomaly when base NRS > 20", () => {
      const result = computeNRS(baseCds(21), baseNav({ navAnomalyScore: 10 }));
      expect(result.nrs).toBe(31);
      expect(result.nrsFactors).toContain("nrs_nav_anomaly");
    });

    it("does not add nav anomaly when base NRS <= 20", () => {
      const result = computeNRS(baseCds(10), baseNav({ navAnomalyScore: 10 }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).not.toContain("nrs_nav_anomaly");
    });

    it("caps nav anomaly at 15", () => {
      const result = computeNRS(baseCds(30), baseNav({ navAnomalyScore: 25 }));
      expect(result.nrs).toBe(45);
    });

    it("does not add when navAnomalyScore is 0", () => {
      const result = computeNRS(baseCds(30), baseNav({ navAnomalyScore: 0 }));
      expect(result.nrsFactors).not.toContain("nrs_nav_anomaly");
    });

    it("boundary: does not add nav anomaly when NRS is exactly 20", () => {
      const result = computeNRS(baseCds(20), baseNav({ navAnomalyScore: 10 }));
      expect(result.nrs).toBe(20);
      expect(result.nrsFactors).not.toContain("nrs_nav_anomaly");
    });
  });

  describe("openerWindowPreviouslyAllowed", () => {
    it("reduces score by 20", () => {
      const result = computeNRS(baseCds(30), baseNav({ openerWindowPreviouslyAllowed: true }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).toContain("nrs_opener_previously_allowed");
    });

    it("does not apply when false", () => {
      const result = computeNRS(baseCds(30), baseNav({ openerWindowPreviouslyAllowed: false }));
      expect(result.nrsFactors).not.toContain("nrs_opener_previously_allowed");
    });

    it("clamps to 0 when reduction would go negative", () => {
      const result = computeNRS(baseCds(10), baseNav({ openerWindowPreviouslyAllowed: true }));
      expect(result.nrs).toBe(0);
    });
  });

  describe("diminishing returns", () => {
    it("applies 50% weight to points above 100", () => {
      // CDS=80 + newTab(20) + crossSite(20) = 120 raw
      // 100 + (120-100)*0.5 = 110
      const result = computeNRS(baseCds(80), baseNav({
        isNewTabOrWindow: true,
        isCrossSite: true,
      }));
      expect(result.nrs).toBe(110);
    });

    it("does not apply at exactly 100", () => {
      const result = computeNRS(baseCds(60), baseNav({
        isNewTabOrWindow: true,
        isCrossSite: true,
      }));
      expect(result.nrs).toBe(100);
    });

    it("does not apply below 100", () => {
      const result = computeNRS(baseCds(50), baseNav({
        isNewTabOrWindow: true,
        isCrossSite: true,
      }));
      expect(result.nrs).toBe(90);
    });

    it("heavy compound scenario with diminishing returns", () => {
      // CDS=50 + newTab(20) + crossSite(20) + knownBad(50) = 140
      // 100 + (140-100)*0.5 = 120
      const result = computeNRS(baseCds(50), baseNav({
        isNewTabOrWindow: true,
        isCrossSite: true,
        knownBadDomain: true,
      }));
      expect(result.nrs).toBe(120);
    });
  });

  describe("clickfixScore", () => {
    it("adds clickfix score directly", () => {
      const result = computeNRS(baseCds(0), baseNav({ clickfixScore: 20 }));
      expect(result.nrs).toBe(20);
      expect(result.nrsFactors).toContain("nrs_clickfix_active");
    });

    it("caps clickfix at 40", () => {
      const result = computeNRS(baseCds(0), baseNav({ clickfixScore: 60 }));
      expect(result.nrs).toBe(40);
    });

    it("does not add when clickfixScore is 0", () => {
      const result = computeNRS(baseCds(0), baseNav({ clickfixScore: 0 }));
      expect(result.nrsFactors).not.toContain("nrs_clickfix_active");
    });

    it("does not add when clickfixScore is undefined", () => {
      const result = computeNRS(baseCds(0), baseNav());
      expect(result.nrsFactors).not.toContain("nrs_clickfix_active");
    });
  });

  describe("jsBehaviorScore", () => {
    it("adds JS behavior score capped at 35", () => {
      const result = computeNRS(baseCds(0), baseNav({ jsBehaviorScore: 25 }));
      expect(result.nrs).toBe(25);
      expect(result.nrsFactors).toContain("nrs_js_behavior_suspicious");
    });

    it("caps JS behavior score at 35 even if input is higher", () => {
      const result = computeNRS(baseCds(0), baseNav({ jsBehaviorScore: 50 }));
      expect(result.nrs).toBe(35);
    });

    it("does not add score when jsBehaviorScore is 0", () => {
      const result = computeNRS(baseCds(10), baseNav({ jsBehaviorScore: 0 }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).not.toContain("nrs_js_behavior_suspicious");
    });

    it("does not add score when jsBehaviorScore is undefined", () => {
      const result = computeNRS(baseCds(10), baseNav());
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).not.toContain("nrs_js_behavior_suspicious");
    });

    it("fires unconditionally (no NRS threshold gate)", () => {
      const result = computeNRS(baseCds(0), baseNav({ jsBehaviorScore: 20 }));
      expect(result.nrs).toBe(20);
      expect(result.nrsFactors).toContain("nrs_js_behavior_suspicious");
    });
  });
});
