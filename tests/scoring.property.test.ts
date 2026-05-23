import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeCDS } from "../extension/src/shared/scoring";
import type { ClickContext, ElementHint } from "../extension/src/shared/scoring";
import { computeNRS } from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

/**
 * Arbitrary generators for scoring property tests.
 *
 * We use .filter() to strip `undefined` from optional fields so that the
 * generated objects satisfy `exactOptionalPropertyTypes` — absent keys
 * are fine, but explicit `undefined` values are not.
 */

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

const arbRectHint = fc.record({
  w: fc.integer({ min: 0, max: 4000 }),
  h: fc.integer({ min: 0, max: 4000 })
});

const arbElementHint: fc.Arbitrary<ElementHint> = fc
  .record(
    {
      tag: fc.constantFrom("DIV", "A", "BUTTON", "SPAN", "INPUT", "IMG", "FORM", "P"),
      role: fc.option(fc.constantFrom("link", "button", "presentation", "none", ""), { nil: undefined }),
      hasOnClick: fc.option(fc.boolean(), { nil: undefined }),
      cursor: fc.option(fc.constantFrom("pointer", "default", "auto", "text"), { nil: undefined }),
      textLength: fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined }),
      ariaLabelLength: fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined }),
      titleLength: fc.option(fc.integer({ min: 0, max: 200 }), { nil: undefined }),
      targetBlank: fc.option(fc.boolean(), { nil: undefined }),
      rect: fc.option(arbRectHint, { nil: undefined }),
      opacity: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
      visibility: fc.option(fc.constantFrom("visible", "hidden", "collapse", ""), { nil: undefined }),
      display: fc.option(fc.constantFrom("block", "inline", "none", "flex", ""), { nil: undefined }),
      pointerEvents: fc.option(fc.constantFrom("auto", "none", ""), { nil: undefined }),
      position: fc.option(fc.constantFrom("static", "relative", "absolute", "fixed", "sticky"), { nil: undefined }),
      zIndex: fc.option(fc.integer({ min: -100, max: 100000 }), { nil: undefined })
    },
    { requiredKeys: ["tag"] }
  )
  .map(stripUndefined) as fc.Arbitrary<ElementHint>;

const arbViewport = fc.record({
  w: fc.integer({ min: 1, max: 3840 }),
  h: fc.integer({ min: 1, max: 2160 })
});

const arbClickContext: fc.Arbitrary<ClickContext> = fc
  .record(
    {
      viewport: arbViewport,
      input: fc.constantFrom("pointer" as const, "keyboard" as const),
      top: arbElementHint,
      underlying: fc.option(arbElementHint, { nil: undefined }),
      retargeted: fc.option(fc.boolean(), { nil: undefined }),
      explicitNewTabIntent: fc.option(fc.boolean(), { nil: undefined }),
      isLegitModalBackdrop: fc.option(fc.boolean(), { nil: undefined })
    },
    { requiredKeys: ["viewport", "input", "top"] }
  )
  .map(stripUndefined) as fc.Arbitrary<ClickContext>;

describe("computeCDS property tests", () => {
  it("score is always non-negative", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const result = computeCDS(ctx);
        expect(result.cds).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 }
    );
  });

  it("score has an upper bound (sum of all positive factors)", () => {
    // Positive factors:
    //   no_accessible_name: 15
    //   overlay_large_interactive: 30  (or overlay_medium_interactive: 1-20)
    //   intent_mismatch_under_interactive: 35
    //   retargeted_target_mismatch: 20
    //   overlay_high_zindex: 15  (or overlay_elevated_zindex: 1-10)
    //   cursor_pointer_no_affordance: 10
    //   invisible_but_clickable: 25  (or near_invisible_opacity: 8-15, low_opacity: 1-8)
    //   Sum: 150
    // Composite escalation (4+ factors): +15
    // Total max: 165
    const MAX_CDS = 165;
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const result = computeCDS(ctx);
        expect(result.cds).toBeLessThanOrEqual(MAX_CDS);
      }),
      { numRuns: 500 }
    );
  });

  it("reason codes array is consistent with score", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const result = computeCDS(ctx);
        // If score is 0 and no positive factors fired, reason codes may still
        // include negative factors that were clamped. But every positive factor
        // in reason codes must contribute to the score.
        const positiveReasons = result.reasonCodes.filter(
          (r) => r !== "keyboard_activation" && r !== "legit_modal_backdrop"
        );
        if (positiveReasons.length === 0) {
          // Score should be 0 (only negative factors, clamped to 0)
          expect(result.cds).toBe(0);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("reason codes contain no duplicates", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const result = computeCDS(ctx);
        const unique = new Set(result.reasonCodes);
        expect(unique.size).toBe(result.reasonCodes.length);
      }),
      { numRuns: 500 }
    );
  });

  it("keyboard input always reduces or maintains score vs pointer input", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const pointerCtx = { ...ctx, input: "pointer" as const };
        const keyboardCtx = { ...ctx, input: "keyboard" as const };
        const pointerResult = computeCDS(pointerCtx);
        const keyboardResult = computeCDS(keyboardCtx);
        expect(keyboardResult.cds).toBeLessThanOrEqual(pointerResult.cds);
      }),
      { numRuns: 500 }
    );
  });

  it("legit modal backdrop always reduces or maintains score", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const normalCtx = { ...ctx, isLegitModalBackdrop: false };
        const modalCtx = { ...ctx, isLegitModalBackdrop: true };
        const normalResult = computeCDS(normalCtx);
        const modalResult = computeCDS(modalCtx);
        expect(modalResult.cds).toBeLessThanOrEqual(normalResult.cds);
      }),
      { numRuns: 500 }
    );
  });

  it("retargeted always adds to or maintains score", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const normalCtx = { ...ctx, retargeted: false };
        const retargetedCtx = { ...ctx, retargeted: true };
        const normalResult = computeCDS(normalCtx);
        const retargetedResult = computeCDS(retargetedCtx);
        expect(retargetedResult.cds).toBeGreaterThanOrEqual(normalResult.cds);
      }),
      { numRuns: 500 }
    );
  });

  it("composite escalation bonus is always non-negative", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const result = computeCDS(ctx);
        if (result.reasonCodes.includes("composite_escalation")) {
          // Composite only fires when 3+ positive factors, so cds > 0
          expect(result.cds).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("opacity gradient is monotonic (higher opacity = lower penalty)", () => {
    // For an interactive element with no name, increasing opacity should
    // never increase the opacity-related penalty
    fc.assert(
      fc.property(
        fc.double({ min: 0.08, max: 0.3, noNaN: true }),
        fc.double({ min: 0.08, max: 0.3, noNaN: true }),
        (opA, opB) => {
          const lo = Math.min(opA, opB);
          const hi = Math.max(opA, opB);
          const base: ClickContext = {
            viewport: { w: 1920, h: 1080 },
            input: "pointer",
            top: { tag: "A", opacity: lo, cursor: "default" },
          };
          const rLo = computeCDS(base);
          const rHi = computeCDS({ ...base, top: { ...base.top, opacity: hi } });
          expect(rHi.cds).toBeLessThanOrEqual(rLo.cds);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("4+ near-threshold factors always exceed single factor CDS", () => {
    // Single factor: just no_accessible_name
    const single: ClickContext = {
      viewport: { w: 1920, h: 1080 },
      input: "pointer",
      top: { tag: "A" },  // no name -> +15
    };
    // Multi-factor: no name + near-invisible + elevated z + medium coverage
    const multi: ClickContext = {
      viewport: { w: 1920, h: 1080 },
      input: "pointer",
      top: {
        tag: "A",
        opacity: 0.09,
        position: "absolute",
        zIndex: 9998,
        rect: { w: 1120, h: 630 },  // ~34% of 1920x1080
        cursor: "pointer",
      },
    };
    const singleResult = computeCDS(single);
    const multiResult = computeCDS(multi);
    expect(multiResult.cds).toBeGreaterThan(singleResult.cds);
    expect(multiResult.reasonCodes).toContain("composite_escalation");
  });

  it("nameLength treats whitespace-only ariaLabel as absent", () => {
    // An element with ariaLabelLength=1 (e.g. " ") should be treated as no name
    const ctx: ClickContext = {
      viewport: { w: 1920, h: 1080 },
      input: "pointer",
      top: { tag: "A", ariaLabelLength: 1 },
    };
    const result = computeCDS(ctx);
    expect(result.reasonCodes).toContain("no_accessible_name");
  });

  it("score is deterministic", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const a = computeCDS(ctx);
        const b = computeCDS(ctx);
        expect(a.cds).toBe(b.cds);
        expect(a.reasonCodes).toEqual(b.reasonCodes);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// NRS property tests (diminishing returns ceiling)
// ---------------------------------------------------------------------------

/**
 * Arbitrary generator for NavigationContext.
 * Uses stripUndefined to satisfy exactOptionalPropertyTypes.
 */
const arbNavigationContext: fc.Arbitrary<NavigationContext> = fc
  .record(
    {
      isNewTabOrWindow: fc.boolean(),
      isCrossSite: fc.boolean(),
      timeSincePointerdownMs: fc.option(
        fc.integer({ min: 0, max: 2000 }),
        { nil: undefined }
      ),
      userActivationActive: fc.option(fc.boolean(), { nil: undefined }),
      multipleAttemptsInGesture: fc.option(fc.boolean(), { nil: undefined }),
      destinationAllowlisted: fc.option(fc.boolean(), { nil: undefined }),
      explicitNewTabIntent: fc.option(fc.boolean(), { nil: undefined }),
      doubleClickHijackActive: fc.option(fc.boolean(), { nil: undefined }),
      knownBadDomain: fc.option(fc.boolean(), { nil: undefined }),
      openerWindowPreviouslyAllowed: fc.option(fc.boolean(), { nil: undefined }),
      redirectChainDepth: fc.option(
        fc.integer({ min: 0, max: 10 }),
        { nil: undefined }
      ),
      redirectViaKnownRedirector: fc.option(fc.boolean(), { nil: undefined }),
      knownRedirectorHops: fc.option(
        fc.integer({ min: 1, max: 5 }),
        { nil: undefined }
      ),
      oauthRedirectMismatch: fc.option(fc.boolean(), { nil: undefined }),
      oauthOpenerManipulation: fc.option(fc.boolean(), { nil: undefined }),
      clickfixScore: fc.option(
        fc.integer({ min: 0, max: 60 }),
        { nil: undefined }
      ),
      pushStateAbuse: fc.option(fc.boolean(), { nil: undefined }),
      cspWeaknessScore: fc.option(
        fc.integer({ min: 0, max: 50 }),
        { nil: undefined }
      ),
      domainRepeatOffender: fc.option(fc.boolean(), { nil: undefined }),
      navAnomalyScore: fc.option(
        fc.integer({ min: 0, max: 30 }),
        { nil: undefined }
      ),
      jsBehaviorScore: fc.option(
        fc.integer({ min: 0, max: 60 }),
        { nil: undefined }
      ),
    },
    { requiredKeys: ["isNewTabOrWindow", "isCrossSite"] }
  )
  .map(stripUndefined) as fc.Arbitrary<NavigationContext>;

const arbScoreResult: fc.Arbitrary<ScoreResult> = fc.record({
  cds: fc.integer({ min: 0, max: 165 }),
  reasonCodes: fc.constant([] as string[]),
});

/** Compute raw NRS (no diminishing returns, no floor) mirroring computeNRS order exactly. */
function rawNrsBeforeDiminishing(cds: ScoreResult, nav: NavigationContext): number {
  let raw = cds.cds;
  if (nav.isNewTabOrWindow) raw += 20;
  if (nav.isCrossSite) raw += 20;
  if (nav.timeSincePointerdownMs !== undefined && nav.timeSincePointerdownMs <= 250) raw += 10;
  if (nav.userActivationActive) raw += 5;
  if (nav.multipleAttemptsInGesture) raw += 25;
  if (nav.doubleClickHijackActive) raw += 40;
  if (nav.destinationAllowlisted) raw -= 100;
  if (nav.explicitNewTabIntent) raw -= 30;
  if (nav.knownBadDomain) raw += 50;

  if (nav.redirectChainDepth !== undefined && nav.redirectChainDepth > 2) {
    raw += Math.min((nav.redirectChainDepth - 2) * 5, 25);
  }

  if (nav.redirectViaKnownRedirector) {
    raw += Math.min((nav.knownRedirectorHops ?? 1) * 15, 30);
  }

  if (nav.oauthRedirectMismatch) raw += 30;

  if (nav.oauthOpenerManipulation) {
    if (nav.doubleClickHijackActive) {
      const delta = 45 - 40;
      if (delta > 0) raw += delta;
    } else {
      raw += 45;
    }
  }

  if (nav.clickfixScore !== undefined && nav.clickfixScore > 0) {
    raw += Math.min(nav.clickfixScore, 40);
  }

  if (nav.openerWindowPreviouslyAllowed) raw -= 20;

  if (nav.pushStateAbuse) raw += 20;

  if (nav.cspWeaknessScore && nav.cspWeaknessScore > 0 && raw > 20) {
    raw += Math.min(nav.cspWeaknessScore, 10);
  }

  if (nav.domainRepeatOffender) raw += 10;

  if (nav.navAnomalyScore && nav.navAnomalyScore > 0 && raw > 20) {
    raw += Math.min(nav.navAnomalyScore, 15);
  }

  if (nav.jsBehaviorScore && nav.jsBehaviorScore > 0) {
    raw += Math.min(nav.jsBehaviorScore, 35);
  }

  return raw;
}

describe("computeNRS property tests", () => {
  it("NRS is always >= 0", () => {
    fc.assert(
      fc.property(arbScoreResult, arbNavigationContext, (cds, nav) => {
        const result = computeNRS(cds, nav);
        expect(result.nrs).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 }
    );
  });

  it("NRS with diminishing returns is always <= raw additive NRS (floored)", () => {
    fc.assert(
      fc.property(arbScoreResult, arbNavigationContext, (cds, nav) => {
        const result = computeNRS(cds, nav);
        const raw = Math.max(0, rawNrsBeforeDiminishing(cds, nav));
        expect(result.nrs).toBeLessThanOrEqual(raw);
      }),
      { numRuns: 500 }
    );
  });

  it("diminishing returns only affect scores > 100", () => {
    fc.assert(
      fc.property(arbScoreResult, arbNavigationContext, (cds, nav) => {
        const result = computeNRS(cds, nav);
        const raw = rawNrsBeforeDiminishing(cds, nav);
        if (raw <= 100) {
          expect(result.nrs).toBe(Math.max(0, raw));
        }
      }),
      { numRuns: 500 }
    );
  });

  it("allowlist always reduces or maintains score", () => {
    fc.assert(
      fc.property(arbScoreResult, arbNavigationContext, (cds, nav) => {
        const without = computeNRS(cds, { ...nav, destinationAllowlisted: false });
        const withAllowlist = computeNRS(cds, { ...nav, destinationAllowlisted: true });
        expect(withAllowlist.nrs).toBeLessThanOrEqual(without.nrs);
      }),
      { numRuns: 500 }
    );
  });

  it("redirect chain score is monotonic with depth (including threshold boundary)", () => {
    fc.assert(
      fc.property(
        arbScoreResult,
        arbNavigationContext,
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        (cds, nav, depthA, depthB) => {
          const lo = Math.min(depthA, depthB);
          const hi = Math.max(depthA, depthB);
          const rLo = computeNRS(cds, { ...nav, redirectChainDepth: lo });
          const rHi = computeNRS(cds, { ...nav, redirectChainDepth: hi });
          expect(rHi.nrs).toBeGreaterThanOrEqual(rLo.nrs);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("redirect chain score caps at depth 7 (5 hops over threshold)", () => {
    fc.assert(
      fc.property(
        arbScoreResult,
        fc.integer({ min: 8, max: 20 }),
        (cds, depth) => {
          const base: NavigationContext = { isNewTabOrWindow: false, isCrossSite: false };
          const at7 = computeNRS(cds, { ...base, redirectChainDepth: 7 });
          const atHigher = computeNRS(cds, { ...base, redirectChainDepth: depth });
          expect(atHigher.nrs).toBe(at7.nrs);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("CSP weakness has no effect when base NRS is <= 20 (threshold gate)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 50 }),
        (baseCdsScore, cspScore) => {
          const baseCds: ScoreResult = { cds: baseCdsScore, reasonCodes: [] };
          const nav: NavigationContext = {
            isNewTabOrWindow: false,
            isCrossSite: false,
            cspWeaknessScore: cspScore,
          };
          const withoutCsp: NavigationContext = {
            isNewTabOrWindow: false,
            isCrossSite: false,
          };
          const result = computeNRS(baseCds, nav);
          const baseline = computeNRS(baseCds, withoutCsp);
          expect(result.nrs).toBe(baseline.nrs);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("navAnomaly has no effect when base NRS is <= 20 (threshold gate)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 30 }),
        (baseCdsScore, anomalyScore) => {
          const baseCds: ScoreResult = { cds: baseCdsScore, reasonCodes: [] };
          const nav: NavigationContext = {
            isNewTabOrWindow: false,
            isCrossSite: false,
            navAnomalyScore: anomalyScore,
          };
          const withoutAnomaly: NavigationContext = {
            isNewTabOrWindow: false,
            isCrossSite: false,
          };
          const result = computeNRS(baseCds, nav);
          const baseline = computeNRS(baseCds, withoutAnomaly);
          expect(result.nrs).toBe(baseline.nrs);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("clickfix contribution is capped at 40", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 41, max: 100 }),
        (clickfixScore) => {
          const baseCds: ScoreResult = { cds: 0, reasonCodes: [] };
          const base: NavigationContext = { isNewTabOrWindow: false, isCrossSite: false };
          const at40 = computeNRS(baseCds, { ...base, clickfixScore: 40 });
          const atHigher = computeNRS(baseCds, { ...base, clickfixScore });
          expect(atHigher.nrs).toBe(at40.nrs);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("jsBehavior contribution is capped at 35", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 36, max: 100 }),
        (jsBehaviorScore) => {
          const baseCds: ScoreResult = { cds: 0, reasonCodes: [] };
          const base: NavigationContext = { isNewTabOrWindow: false, isCrossSite: false };
          const at35 = computeNRS(baseCds, { ...base, jsBehaviorScore: 35 });
          const atHigher = computeNRS(baseCds, { ...base, jsBehaviorScore });
          expect(atHigher.nrs).toBe(at35.nrs);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("pushStateAbuse always increases or maintains score", () => {
    fc.assert(
      fc.property(arbScoreResult, arbNavigationContext, (cds, nav) => {
        const without = computeNRS(cds, { ...nav, pushStateAbuse: false });
        const withPush = computeNRS(cds, { ...nav, pushStateAbuse: true });
        expect(withPush.nrs).toBeGreaterThanOrEqual(without.nrs);
      }),
      { numRuns: 500 }
    );
  });

  it("oauth opener dedup: combined with dblclick adds at most 5 over dblclick alone", () => {
    fc.assert(
      fc.property(arbScoreResult, (cds) => {
        const base: NavigationContext = { isNewTabOrWindow: false, isCrossSite: false };
        const dblclickOnly = computeNRS(cds, { ...base, doubleClickHijackActive: true });
        const combined = computeNRS(cds, {
          ...base,
          doubleClickHijackActive: true,
          oauthOpenerManipulation: true,
        });
        expect(combined.nrs).toBeLessThanOrEqual(dblclickOnly.nrs + 5);
      }),
      { numRuns: 300 }
    );
  });

  it("NRS factors array contains no duplicates", () => {
    fc.assert(
      fc.property(arbScoreResult, arbNavigationContext, (cds, nav) => {
        const result = computeNRS(cds, nav);
        const unique = new Set(result.nrsFactors);
        expect(unique.size).toBe(result.nrsFactors.length);
      }),
      { numRuns: 500 }
    );
  });

  it("NRS is deterministic", () => {
    fc.assert(
      fc.property(arbScoreResult, arbNavigationContext, (cds, nav) => {
        const a = computeNRS(cds, nav);
        const b = computeNRS(cds, nav);
        expect(a.nrs).toBe(b.nrs);
        expect(a.nrsFactors).toEqual(b.nrsFactors);
      }),
      { numRuns: 200 }
    );
  });
});
