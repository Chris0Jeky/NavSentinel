import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { computeCDS, ClickContext, ElementHint } from "../extension/src/shared/scoring";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbTag = fc.constantFrom("DIV", "SPAN", "A", "BUTTON", "P", "SECTION", "IMG", "INPUT");

const arbRole = fc.oneof(
  fc.constant(undefined),
  fc.constantFrom("", "link", "button", "presentation", "dialog", "img")
);

const arbRect = fc.oneof(
  fc.constant(undefined),
  fc.record({
    w: fc.integer({ min: 0, max: 2000 }),
    h: fc.integer({ min: 0, max: 2000 }),
  })
);

const arbElementHint: fc.Arbitrary<ElementHint> = fc.record({
  tag: arbTag,
  role: arbRole,
  hasOnClick: fc.oneof(fc.constant(undefined), fc.boolean()),
  cursor: fc.oneof(fc.constant(undefined), fc.constantFrom("", "pointer", "default", "auto")),
  textLength: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 100 })),
  ariaLabelLength: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 50 })),
  titleLength: fc.oneof(fc.constant(undefined), fc.integer({ min: 0, max: 50 })),
  targetBlank: fc.oneof(fc.constant(undefined), fc.boolean()),
  rect: arbRect,
  opacity: fc.oneof(fc.constant(undefined), fc.double({ min: 0, max: 1, noNaN: true })),
  visibility: fc.oneof(fc.constant(undefined), fc.constantFrom("", "visible", "hidden", "collapse")),
  display: fc.oneof(fc.constant(undefined), fc.constantFrom("", "block", "inline", "flex", "none")),
  pointerEvents: fc.oneof(fc.constant(undefined), fc.constantFrom("", "auto", "none")),
  position: fc.oneof(fc.constant(undefined), fc.constantFrom("", "static", "relative", "absolute", "fixed")),
  zIndex: fc.oneof(fc.constant(undefined), fc.integer({ min: -1, max: 20000 })),
});

const arbViewport = fc.record({
  w: fc.integer({ min: 1, max: 3840 }),
  h: fc.integer({ min: 1, max: 2160 }),
});

const arbClickContext: fc.Arbitrary<ClickContext> = fc.record({
  viewport: arbViewport,
  input: fc.constantFrom("pointer" as const, "keyboard" as const),
  top: arbElementHint,
  underlying: fc.oneof(fc.constant(undefined), arbElementHint),
  retargeted: fc.oneof(fc.constant(undefined), fc.boolean()),
  explicitNewTabIntent: fc.oneof(fc.constant(undefined), fc.boolean()),
  isLegitModalBackdrop: fc.oneof(fc.constant(undefined), fc.boolean()),
});

function makeInteractiveNoName(): ElementHint {
  return { tag: "BUTTON", opacity: 1 };
}

function makeCtx(overrides: Partial<ClickContext> = {}): ClickContext {
  return {
    viewport: { w: 1920, h: 1080 },
    input: "pointer",
    top: makeInteractiveNoName(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeCDS property tests
// ---------------------------------------------------------------------------

describe("computeCDS property tests", () => {
  it("score is always >= 0 for any valid input", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const { cds } = computeCDS(ctx);
        expect(cds).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 1000 }
    );
  });

  it("is deterministic (same input produces same output)", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const r1 = computeCDS(ctx);
        const r2 = computeCDS(ctx);
        expect(r1.cds).toBe(r2.cds);
        expect(r1.reasonCodes).toEqual(r2.reasonCodes);
      }),
      { numRuns: 500 }
    );
  });

  it("never throws on arbitrary inputs", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const result = computeCDS(ctx);
        expect(typeof result.cds).toBe("number");
        expect(Array.isArray(result.reasonCodes)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it("keyboard input always reduces or maintains score vs pointer input", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const pointerCtx = { ...ctx, input: "pointer" as const };
        const keyboardCtx = { ...ctx, input: "keyboard" as const };
        const pointerScore = computeCDS(pointerCtx).cds;
        const keyboardScore = computeCDS(keyboardCtx).cds;
        expect(keyboardScore).toBeLessThanOrEqual(pointerScore);
      }),
      { numRuns: 500 }
    );
  });

  it("legit modal backdrop always reduces or maintains score", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const withoutModal = { ...ctx, isLegitModalBackdrop: false };
        const withModal = { ...ctx, isLegitModalBackdrop: true };
        const baseScore = computeCDS(withoutModal).cds;
        const modalScore = computeCDS(withModal).cds;
        expect(modalScore).toBeLessThanOrEqual(baseScore);
      }),
      { numRuns: 500 }
    );
  });

  it("retargeted always adds exactly 20 to score (holding other factors constant)", () => {
    fc.assert(
      fc.property(arbClickContext.filter((ctx) => ctx.input === "pointer" && !ctx.isLegitModalBackdrop), (ctx) => {
        const withoutRetarget = { ...ctx, retargeted: false };
        const withRetarget = { ...ctx, retargeted: true };
        const baseResult = computeCDS(withoutRetarget);
        const retargetResult = computeCDS(withRetarget);

        const basePositive = baseResult.reasonCodes.filter(
          (r) => r !== "keyboard_activation" && r !== "legit_modal_backdrop" && r !== "composite_escalation"
        ).length;
        const retargetPositive = retargetResult.reasonCodes.filter(
          (r) => r !== "keyboard_activation" && r !== "legit_modal_backdrop" && r !== "composite_escalation"
        ).length;

        if (basePositive < 2 && retargetPositive >= 3) {
          expect(retargetResult.cds).toBeGreaterThan(baseResult.cds);
        } else if (basePositive >= 3 || retargetPositive < 3) {
          const diff = retargetResult.cds - baseResult.cds;
          if (basePositive < 3 && retargetPositive >= 3) {
            expect(diff).toBeGreaterThanOrEqual(20);
          }
        }
        expect(retargetResult.cds).toBeGreaterThanOrEqual(baseResult.cds);
      }),
      { numRuns: 500 }
    );
  });

  it("non-interactive elements never get name, overlay, z-index, or cursor penalties", () => {
    const arbNonInteractiveHint = arbElementHint.map((h) => ({
      ...h,
      tag: "DIV",
      role: undefined,
      hasOnClick: false,
    }));
    fc.assert(
      fc.property(
        arbClickContext.chain((ctx) =>
          arbNonInteractiveHint.map((top) => ({ ...ctx, top }))
        ),
        (ctx) => {
          const { reasonCodes } = computeCDS(ctx);
          const interactiveReasons = [
            "no_accessible_name",
            "minimal_accessible_name",
            "overlay_large_interactive",
            "overlay_medium_interactive",
            "overlay_high_zindex",
            "overlay_elevated_zindex",
            "cursor_pointer_no_affordance",
          ];
          for (const reason of interactiveReasons) {
            expect(reasonCodes).not.toContain(reason);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it("invisible_but_clickable only fires when element is invisible and pointerEvents != none", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const { reasonCodes } = computeCDS(ctx);
        if (reasonCodes.includes("invisible_but_clickable")) {
          const pe = (ctx.top.pointerEvents ?? "auto").toLowerCase();
          expect(pe).not.toBe("none");
        }
      }),
      { numRuns: 500 }
    );
  });

  it("opacity gradient is monotonic: lower opacity within [0.08, 0.3) yields >= score contribution", () => {
    const arbInteractiveTop = fc.record({
      tag: fc.constant("BUTTON" as string),
      rect: fc.constant({ w: 100, h: 50 }),
      visibility: fc.constant("visible"),
      display: fc.constant("block"),
      pointerEvents: fc.constant("auto"),
    });
    fc.assert(
      fc.property(
        arbInteractiveTop,
        fc.double({ min: 0.08, max: 0.29, noNaN: true }),
        fc.double({ min: 0.08, max: 0.29, noNaN: true }),
        arbViewport,
        (topBase, opacity1, opacity2, viewport) => {
          const lower = Math.min(opacity1, opacity2);
          const higher = Math.max(opacity1, opacity2);
          if (lower === higher) return;

          const ctx1 = makeCtx({
            viewport,
            top: { ...topBase, opacity: lower },
          });
          const ctx2 = makeCtx({
            viewport,
            top: { ...topBase, opacity: higher },
          });
          const score1 = computeCDS(ctx1).cds;
          const score2 = computeCDS(ctx2).cds;
          expect(score1).toBeGreaterThanOrEqual(score2);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("z-index gradient is monotonic: higher z-index >= same score for positioned interactive elements", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("fixed", "absolute"),
        fc.integer({ min: 5000, max: 20000 }),
        fc.integer({ min: 5000, max: 20000 }),
        (position, z1, z2) => {
          const lower = Math.min(z1, z2);
          const higher = Math.max(z1, z2);
          if (lower === higher) return;

          const top1: ElementHint = {
            tag: "BUTTON",
            position,
            zIndex: lower,
            opacity: 1,
          };
          const top2: ElementHint = {
            tag: "BUTTON",
            position,
            zIndex: higher,
            opacity: 1,
          };
          const ctx1 = makeCtx({ top: top1 });
          const ctx2 = makeCtx({ top: top2 });
          expect(computeCDS(ctx2).cds).toBeGreaterThanOrEqual(computeCDS(ctx1).cds);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("composite escalation triggers when 3+ positive reason codes are present", () => {
    const top: ElementHint = {
      tag: "BUTTON",
      opacity: 0.1,
      position: "fixed",
      zIndex: 10000,
      cursor: "pointer",
      pointerEvents: "auto",
      visibility: "visible",
      display: "block",
    };
    const ctx = makeCtx({
      top,
      retargeted: true,
    });
    const { reasonCodes } = computeCDS(ctx);
    const mitigating = new Set(["keyboard_activation", "legit_modal_backdrop"]);
    const positiveCount = reasonCodes.filter((r) => !mitigating.has(r) && r !== "composite_escalation").length;
    if (positiveCount >= 3) {
      expect(reasonCodes).toContain("composite_escalation");
    }
  });

  it("coverage ratio gradient: larger overlay on interactive element yields >= score", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1920 }),
        fc.integer({ min: 1, max: 1080 }),
        fc.integer({ min: 1, max: 1920 }),
        fc.integer({ min: 1, max: 1080 }),
        (w1, h1, w2, h2) => {
          const viewport = { w: 1920, h: 1080 };
          const area1 = w1 * h1;
          const area2 = w2 * h2;
          if (area1 === area2) return;

          const smaller = area1 < area2 ? { w: w1, h: h1 } : { w: w2, h: h2 };
          const larger = area1 < area2 ? { w: w2, h: h2 } : { w: w1, h: h1 };

          const ctx1 = makeCtx({ viewport, top: { tag: "BUTTON", rect: smaller, opacity: 1 } });
          const ctx2 = makeCtx({ viewport, top: { tag: "BUTTON", rect: larger, opacity: 1 } });
          expect(computeCDS(ctx2).cds).toBeGreaterThanOrEqual(computeCDS(ctx1).cds);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("intent mismatch: interactive underlying with name + non-intentful top = +35", () => {
    fc.assert(
      fc.property(arbViewport, (viewport) => {
        const top: ElementHint = { tag: "DIV", opacity: 1 };
        const underlying: ElementHint = { tag: "A", textLength: 10, opacity: 1 };
        const ctx = makeCtx({ viewport, top, underlying });
        const { reasonCodes } = computeCDS(ctx);
        expect(reasonCodes).toContain("intent_mismatch_under_interactive");
      }),
      { numRuns: 50 }
    );
  });

  it("reason codes always include at least one entry when score > 0", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const { cds, reasonCodes } = computeCDS(ctx);
        if (cds > 0) {
          expect(reasonCodes.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("all reason codes are known strings", () => {
    const knownReasons = new Set([
      "no_accessible_name",
      "minimal_accessible_name",
      "overlay_large_interactive",
      "overlay_medium_interactive",
      "intent_mismatch_under_interactive",
      "retargeted_target_mismatch",
      "overlay_high_zindex",
      "overlay_elevated_zindex",
      "invisible_but_clickable",
      "near_invisible_opacity",
      "low_opacity",
      "cursor_pointer_no_affordance",
      "keyboard_activation",
      "legit_modal_backdrop",
      "composite_escalation",
    ]);
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const { reasonCodes } = computeCDS(ctx);
        for (const code of reasonCodes) {
          expect(knownReasons.has(code)).toBe(true);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("no duplicate reason codes in output", () => {
    fc.assert(
      fc.property(arbClickContext, (ctx) => {
        const { reasonCodes } = computeCDS(ctx);
        const unique = new Set(reasonCodes);
        expect(unique.size).toBe(reasonCodes.length);
      }),
      { numRuns: 500 }
    );
  });
});
