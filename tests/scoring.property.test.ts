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
    // Positive factors: 15 + 30 + 35 + 20 + 15 + 10 + 25 = 150
    const MAX_CDS = 150;
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
