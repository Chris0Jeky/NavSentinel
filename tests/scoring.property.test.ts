import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeCDS } from "../extension/src/shared/scoring";
import type { ClickContext, ElementHint } from "../extension/src/shared/scoring";

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
