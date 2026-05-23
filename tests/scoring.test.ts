import { describe, it, expect } from "vitest";
import { computeCDS } from "../extension/src/shared/scoring";
import type { ClickContext, ElementHint } from "../extension/src/shared/scoring";

function baseCtx(topOverrides: Partial<ElementHint> = {}): ClickContext {
  return {
    viewport: { w: 1920, h: 1080 },
    input: "pointer",
    top: { tag: "DIV", ...topOverrides },
  };
}

function interactiveCtx(topOverrides: Partial<ElementHint> = {}): ClickContext {
  return baseCtx({ tag: "BUTTON", textLength: 10, ...topOverrides });
}

describe("computeCDS — accessible name checks", () => {
  it("adds no_accessible_name (+15) for interactive element with no name", () => {
    const result = computeCDS(baseCtx({ tag: "A" }));
    expect(result.cds).toBe(15);
    expect(result.reasonCodes).toContain("no_accessible_name");
  });

  it("adds minimal_accessible_name (+8) for name length 1-3", () => {
    const result = computeCDS(baseCtx({ tag: "BUTTON", textLength: 2 }));
    expect(result.cds).toBe(8);
    expect(result.reasonCodes).toContain("minimal_accessible_name");
  });

  it("no name penalty for non-interactive elements", () => {
    const result = computeCDS(baseCtx({ tag: "DIV" }));
    expect(result.cds).toBe(0);
    expect(result.reasonCodes).not.toContain("no_accessible_name");
  });

  it("no name penalty for interactive element with adequate name", () => {
    const result = computeCDS(baseCtx({ tag: "A", textLength: 10 }));
    expect(result.cds).toBe(0);
    expect(result.reasonCodes).not.toContain("no_accessible_name");
    expect(result.reasonCodes).not.toContain("minimal_accessible_name");
  });

  it("treats ariaLabelLength < 2 as absent", () => {
    const result = computeCDS(baseCtx({ tag: "A", ariaLabelLength: 1 }));
    expect(result.reasonCodes).toContain("no_accessible_name");
  });

  it("treats ariaLabelLength >= 2 as present", () => {
    const result = computeCDS(baseCtx({ tag: "A", ariaLabelLength: 5 }));
    expect(result.reasonCodes).not.toContain("no_accessible_name");
  });

  it("recognizes role=button as interactive", () => {
    const result = computeCDS(baseCtx({ tag: "DIV", role: "button" }));
    expect(result.reasonCodes).toContain("no_accessible_name");
  });

  it("recognizes hasOnClick as interactive", () => {
    const result = computeCDS(baseCtx({ tag: "SPAN", hasOnClick: true }));
    expect(result.reasonCodes).toContain("no_accessible_name");
  });
});

describe("computeCDS — viewport coverage gradient", () => {
  it("adds overlay_large_interactive (+30) for coverage > 35%", () => {
    const result = computeCDS(interactiveCtx({
      rect: { w: 1200, h: 700 },
    }));
    expect(result.reasonCodes).toContain("overlay_large_interactive");
  });

  it("adds overlay_medium_interactive for coverage 20-35%", () => {
    const result = computeCDS(interactiveCtx({
      rect: { w: 960, h: 500 },
    }));
    expect(result.reasonCodes).toContain("overlay_medium_interactive");
  });

  it("no coverage penalty below 20%", () => {
    const result = computeCDS(interactiveCtx({
      rect: { w: 300, h: 200 },
    }));
    expect(result.reasonCodes).not.toContain("overlay_large_interactive");
    expect(result.reasonCodes).not.toContain("overlay_medium_interactive");
  });

  it("no coverage penalty for non-interactive elements", () => {
    const result = computeCDS(baseCtx({
      tag: "DIV", textLength: 10,
      rect: { w: 1920, h: 1080 },
    }));
    expect(result.reasonCodes).not.toContain("overlay_large_interactive");
  });

  it("handles zero viewport gracefully", () => {
    const ctx: ClickContext = {
      viewport: { w: 0, h: 0 },
      input: "pointer",
      top: { tag: "BUTTON", textLength: 10, rect: { w: 100, h: 100 } },
    };
    const result = computeCDS(ctx);
    expect(result.reasonCodes).not.toContain("overlay_large_interactive");
  });
});

describe("computeCDS — intent mismatch", () => {
  it("adds intent_mismatch_under_interactive (+35) when top lacks name and underlying is interactive", () => {
    const ctx: ClickContext = {
      viewport: { w: 1920, h: 1080 },
      input: "pointer",
      top: { tag: "DIV", hasOnClick: true },
      underlying: { tag: "A", textLength: 10 },
    };
    const result = computeCDS(ctx);
    expect(result.reasonCodes).toContain("intent_mismatch_under_interactive");
    expect(result.cds).toBeGreaterThanOrEqual(35);
  });

  it("no mismatch when top has name and is interactive", () => {
    const ctx: ClickContext = {
      viewport: { w: 1920, h: 1080 },
      input: "pointer",
      top: { tag: "BUTTON", textLength: 10 },
      underlying: { tag: "A", textLength: 10 },
    };
    const result = computeCDS(ctx);
    expect(result.reasonCodes).not.toContain("intent_mismatch_under_interactive");
  });

  it("no mismatch when underlying has no name", () => {
    const ctx: ClickContext = {
      viewport: { w: 1920, h: 1080 },
      input: "pointer",
      top: { tag: "DIV", hasOnClick: true },
      underlying: { tag: "A" },
    };
    const result = computeCDS(ctx);
    expect(result.reasonCodes).not.toContain("intent_mismatch_under_interactive");
  });
});

describe("computeCDS — retargeting", () => {
  it("adds retargeted_target_mismatch (+20) when retargeted", () => {
    const ctx: ClickContext = {
      ...baseCtx(),
      retargeted: true,
    };
    const result = computeCDS(ctx);
    expect(result.cds).toBe(20);
    expect(result.reasonCodes).toContain("retargeted_target_mismatch");
  });

  it("no retargeting penalty when not retargeted", () => {
    const ctx: ClickContext = {
      ...baseCtx(),
      retargeted: false,
    };
    const result = computeCDS(ctx);
    expect(result.reasonCodes).not.toContain("retargeted_target_mismatch");
  });
});

describe("computeCDS — z-index gradient", () => {
  it("adds overlay_high_zindex (+15) for z >= 9999 with fixed position", () => {
    const result = computeCDS(interactiveCtx({
      position: "fixed",
      zIndex: 10000,
    }));
    expect(result.reasonCodes).toContain("overlay_high_zindex");
  });

  it("adds overlay_elevated_zindex for z 5000-9998 with absolute position", () => {
    const result = computeCDS(interactiveCtx({
      position: "absolute",
      zIndex: 7500,
    }));
    expect(result.reasonCodes).toContain("overlay_elevated_zindex");
  });

  it("no z-index penalty below 5000", () => {
    const result = computeCDS(interactiveCtx({
      position: "fixed",
      zIndex: 4999,
    }));
    expect(result.reasonCodes).not.toContain("overlay_high_zindex");
    expect(result.reasonCodes).not.toContain("overlay_elevated_zindex");
  });

  it("no z-index penalty for static position even with high z", () => {
    const result = computeCDS(interactiveCtx({
      position: "static",
      zIndex: 10000,
    }));
    expect(result.reasonCodes).not.toContain("overlay_high_zindex");
  });

  it("boundary: z-index exactly 9999 triggers high", () => {
    const result = computeCDS(interactiveCtx({
      position: "fixed",
      zIndex: 9999,
    }));
    expect(result.reasonCodes).toContain("overlay_high_zindex");
  });

  it("boundary: z-index exactly 5000 triggers elevated", () => {
    const result = computeCDS(interactiveCtx({
      position: "absolute",
      zIndex: 5000,
    }));
    expect(result.reasonCodes).toContain("overlay_elevated_zindex");
  });
});

describe("computeCDS — opacity gradient", () => {
  it("adds invisible_but_clickable (+25) for fully invisible but clickable element", () => {
    const result = computeCDS(baseCtx({
      opacity: 0,
      display: "block",
      visibility: "visible",
      pointerEvents: "auto",
    }));
    expect(result.cds).toBe(25);
    expect(result.reasonCodes).toContain("invisible_but_clickable");
  });

  it("adds near_invisible_opacity for opacity 0.08-0.15", () => {
    const result = computeCDS(baseCtx({ opacity: 0.10 }));
    expect(result.reasonCodes).toContain("near_invisible_opacity");
  });

  it("adds low_opacity for opacity 0.15-0.3", () => {
    const result = computeCDS(baseCtx({ opacity: 0.20 }));
    expect(result.reasonCodes).toContain("low_opacity");
  });

  it("no opacity penalty at 0.3 or above", () => {
    const result = computeCDS(baseCtx({ opacity: 0.30 }));
    expect(result.reasonCodes).not.toContain("near_invisible_opacity");
    expect(result.reasonCodes).not.toContain("low_opacity");
  });

  it("no opacity penalty at default (1.0)", () => {
    const result = computeCDS(baseCtx());
    expect(result.reasonCodes).not.toContain("near_invisible_opacity");
    expect(result.reasonCodes).not.toContain("low_opacity");
    expect(result.reasonCodes).not.toContain("invisible_but_clickable");
  });

  it("invisible_but_clickable does not fire when pointerEvents=none", () => {
    const result = computeCDS(baseCtx({
      opacity: 0,
      pointerEvents: "none",
    }));
    expect(result.reasonCodes).not.toContain("invisible_but_clickable");
  });

  it("display:none counts as invisible", () => {
    const result = computeCDS(baseCtx({
      display: "none",
      pointerEvents: "auto",
    }));
    expect(result.reasonCodes).toContain("invisible_but_clickable");
  });

  it("visibility:hidden counts as invisible", () => {
    const result = computeCDS(baseCtx({
      visibility: "hidden",
      pointerEvents: "auto",
    }));
    expect(result.reasonCodes).toContain("invisible_but_clickable");
  });
});

describe("computeCDS — cursor pointer no affordance", () => {
  it("adds cursor_pointer_no_affordance (+10) for pointer cursor with no name and low opacity", () => {
    const result = computeCDS(baseCtx({
      tag: "A",
      cursor: "pointer",
      opacity: 0.20,
    }));
    expect(result.reasonCodes).toContain("cursor_pointer_no_affordance");
  });

  it("no penalty when opacity >= 0.3", () => {
    const result = computeCDS(baseCtx({
      tag: "A",
      cursor: "pointer",
      opacity: 0.5,
    }));
    expect(result.reasonCodes).not.toContain("cursor_pointer_no_affordance");
  });

  it("no penalty when element has a name", () => {
    const result = computeCDS(baseCtx({
      tag: "A",
      cursor: "pointer",
      textLength: 10,
      opacity: 0.20,
    }));
    expect(result.reasonCodes).not.toContain("cursor_pointer_no_affordance");
  });
});

describe("computeCDS — mitigating factors", () => {
  it("keyboard activation reduces score by 10", () => {
    const pointer = computeCDS(baseCtx({ tag: "A" }));
    const keyboard = computeCDS({ ...baseCtx({ tag: "A" }), input: "keyboard" });
    expect(keyboard.cds).toBe(pointer.cds - 10);
    expect(keyboard.reasonCodes).toContain("keyboard_activation");
  });

  it("legit modal backdrop reduces score by 20", () => {
    const normal = computeCDS({ ...baseCtx({ tag: "A" }), isLegitModalBackdrop: false });
    const modal = computeCDS({ ...baseCtx({ tag: "A" }), isLegitModalBackdrop: true });
    expect(modal.cds).toBe(Math.max(0, normal.cds - 20));
    expect(modal.reasonCodes).toContain("legit_modal_backdrop");
  });

  it("score floors at 0 with multiple mitigating factors", () => {
    const result = computeCDS({
      viewport: { w: 1920, h: 1080 },
      input: "keyboard",
      top: { tag: "DIV" },
      isLegitModalBackdrop: true,
    });
    expect(result.cds).toBe(0);
  });
});

describe("computeCDS — composite escalation", () => {
  it("adds +10 for 3 positive factors", () => {
    const result = computeCDS({
      viewport: { w: 1920, h: 1080 },
      input: "pointer",
      top: { tag: "A", opacity: 0.10, position: "fixed", zIndex: 10000 },
    });
    const positiveReasons = result.reasonCodes.filter(
      r => r !== "keyboard_activation" && r !== "legit_modal_backdrop"
    );
    expect(positiveReasons.length).toBeGreaterThanOrEqual(3);
    expect(result.reasonCodes).toContain("composite_escalation");
  });

  it("adds +15 for 4+ positive factors", () => {
    const result = computeCDS({
      viewport: { w: 1920, h: 1080 },
      input: "pointer",
      top: {
        tag: "A",
        opacity: 0.10,
        position: "fixed",
        zIndex: 10000,
        cursor: "pointer",
      },
      retargeted: true,
    });
    const positiveReasons = result.reasonCodes.filter(
      r => r !== "keyboard_activation" && r !== "legit_modal_backdrop" && r !== "composite_escalation"
    );
    expect(positiveReasons.length).toBeGreaterThanOrEqual(4);
    expect(result.reasonCodes).toContain("composite_escalation");
  });

  it("no escalation for fewer than 3 positive factors", () => {
    const result = computeCDS(baseCtx({ tag: "A" }));
    expect(result.reasonCodes).not.toContain("composite_escalation");
  });
});

describe("computeCDS — edge cases", () => {
  it("clean element with no risk factors scores 0", () => {
    const result = computeCDS(interactiveCtx());
    expect(result.cds).toBe(0);
    expect(result.reasonCodes).toHaveLength(0);
  });

  it("handles missing rect gracefully", () => {
    const result = computeCDS(interactiveCtx());
    expect(result.reasonCodes).not.toContain("overlay_large_interactive");
  });

  it("handles missing underlying element", () => {
    const result = computeCDS(baseCtx());
    expect(result.reasonCodes).not.toContain("intent_mismatch_under_interactive");
  });

  it("zero-size rect makes element invisible", () => {
    const result = computeCDS(baseCtx({
      rect: { w: 0, h: 100 },
      pointerEvents: "auto",
    }));
    expect(result.reasonCodes).toContain("invisible_but_clickable");
  });
});
