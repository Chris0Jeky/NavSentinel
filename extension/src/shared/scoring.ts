export interface RectHint {
  w: number;
  h: number;
}

export interface ElementHint {
  tag: string;
  role?: string;
  hasOnClick?: boolean;
  cursor?: string;
  textLength?: number;
  ariaLabelLength?: number;
  titleLength?: number;

  targetBlank?: boolean;

  rect?: RectHint;
  opacity?: number;
  visibility?: string;
  display?: string;
  pointerEvents?: string;
  position?: string;
  zIndex?: number;
}

export interface ClickContext {
  viewport: { w: number; h: number };
  input: "pointer" | "keyboard";
  top: ElementHint;
  underlying?: ElementHint;
  retargeted?: boolean;
  explicitNewTabIntent?: boolean;
  isLegitModalBackdrop?: boolean;
}

export interface ScoreResult {
  cds: number;
  reasonCodes: string[];
}

/**
 * Effective name length after trimming whitespace-only padding.
 * ariaLabelLength and titleLength < 2 are treated as no meaningful name
 * (attacker can set aria-label=" " to fake having a name).
 */
function nameLength(h: ElementHint): number {
  const text = h.textLength ?? 0;
  const aria = h.ariaLabelLength ?? 0;
  const title = h.titleLength ?? 0;
  // Treat very short aria/title (< 2 chars) as absent — likely whitespace or single-char padding
  const effectiveAria = aria >= 2 ? aria : 0;
  const effectiveTitle = title >= 2 ? title : 0;
  return text + effectiveAria + effectiveTitle;
}

/**
 * Returns true if trimmed name is 1-3 chars — present but minimal.
 * Used for the minimal_accessible_name reason code.
 */
function hasMinimalName(h: ElementHint): boolean {
  const len = nameLength(h);
  return len >= 1 && len <= 3;
}

function isInteractive(h: ElementHint): boolean {
  const tag = h.tag.toUpperCase();
  if (tag === "A" || tag === "BUTTON") return true;
  const role = (h.role ?? "").toLowerCase();
  if (role === "link" || role === "button") return true;
  if (h.hasOnClick) return true;
  return false;
}

function hasActionIntent(h: ElementHint): boolean {
  if (isInteractive(h)) return true;
  return (h.cursor ?? "").toLowerCase() === "pointer";
}

function isContainerLikeWithoutActionIntent(h: ElementHint): boolean {
  if (hasActionIntent(h)) return false;
  const tag = h.tag.toUpperCase();
  const role = (h.role ?? "").toLowerCase();
  return tag === "NAV" || role === "navigation";
}

function coverageRatio(h: ElementHint, viewport: { w: number; h: number }): number | undefined {
  const rect = h.rect;
  if (!rect) return undefined;
  if (viewport.w <= 0 || viewport.h <= 0) return undefined;
  return (rect.w * rect.h) / (viewport.w * viewport.h);
}

function isVisible(h: ElementHint): boolean {
  const rect = h.rect;
  if (rect && (rect.w <= 0 || rect.h <= 0)) return false;

  const display = (h.display ?? "").toLowerCase();
  if (display === "none") return false;

  const visibility = (h.visibility ?? "").toLowerCase();
  if (visibility === "hidden" || visibility === "collapse") return false;

  const opacity = h.opacity ?? 1;
  if (opacity < 0.08) return false;

  return true;
}

export function computeCDS(ctx: ClickContext): ScoreResult {
  const reasons: string[] = [];
  let cds = 0;

  const top = ctx.top;
  const topInteractive = isInteractive(top);
  const topHasName = nameLength(top) > 0;

  // --- Accessible name checks ---
  if (topInteractive && !topHasName) {
    cds += 15;
    reasons.push("no_accessible_name");
  } else if (topInteractive && hasMinimalName(top)) {
    cds += 8;
    reasons.push("minimal_accessible_name");
  }

  // --- Viewport coverage gradient ---
  const ratio = coverageRatio(top, ctx.viewport);
  if (topInteractive && ratio !== undefined) {
    if (ratio > 0.35) {
      cds += 30;
      reasons.push("overlay_large_interactive");
    } else if (ratio > 0.20) {
      const scaled = Math.max(1, Math.round(20 * ((ratio - 0.20) / 0.15)));
      cds += scaled;
      reasons.push("overlay_medium_interactive");
    }
  }

  // --- Intent mismatch ---
  const under = ctx.underlying;
  if (under) {
    const underInteractive = isInteractive(under);
    const underHasName = nameLength(under) > 0;
    const topIntentful = topInteractive && topHasName;
    const benignContainer = isContainerLikeWithoutActionIntent(top);
    if (underInteractive && underHasName && !topIntentful && !benignContainer) {
      cds += 35;
      reasons.push("intent_mismatch_under_interactive");
    }
  }

  // --- Retargeting ---
  if (ctx.retargeted) {
    cds += 20;
    reasons.push("retargeted_target_mismatch");
  }

  // --- z-index gradient ---
  const pos = (top.position ?? "").toLowerCase();
  const z = top.zIndex ?? 0;
  if (topInteractive && (pos === "fixed" || pos === "absolute")) {
    if (z >= 9999) {
      cds += 15;
      reasons.push("overlay_high_zindex");
    } else if (z >= 5000) {
      const scaled = Math.max(1, Math.round(10 * ((z - 5000) / 4999)));
      cds += scaled;
      reasons.push("overlay_elevated_zindex");
    }
  }

  // --- Opacity gradient ---
  const opacity = top.opacity ?? 1;
  const visible = isVisible(top);
  const pointerEvents = (top.pointerEvents ?? "auto").toLowerCase();

  if (!visible && pointerEvents !== "none") {
    // Fully invisible but clickable — keep existing score
    cds += 25;
    reasons.push("invisible_but_clickable");
  } else if (opacity >= 0.08 && opacity < 0.15) {
    // Near-invisible gradient: 15 at 0.08, tapering to 8 at 0.15
    // (continuous with the low_opacity band starting at 8)
    const t = (opacity - 0.08) / 0.07;
    const scaled = Math.round(15 - 7 * t);
    if (scaled > 0) {
      cds += scaled;
      reasons.push("near_invisible_opacity");
    }
  } else if (opacity >= 0.15 && opacity < 0.3) {
    // Low-opacity gradient: 8 at 0.15, tapering to 0 at 0.3
    const scaled = Math.round(8 * (1 - (opacity - 0.15) / 0.15));
    if (scaled > 0) {
      cds += scaled;
      reasons.push("low_opacity");
    }
  }

  // --- Cursor pointer with no affordance (uses gradient opacity threshold) ---
  const cursor = (top.cursor ?? "").toLowerCase();
  if (topInteractive && cursor === "pointer" && !topHasName && opacity < 0.3) {
    cds += 10;
    reasons.push("cursor_pointer_no_affordance");
  }

  // --- Mitigating factors ---
  if (ctx.input === "keyboard") {
    cds -= 10;
    reasons.push("keyboard_activation");
  }

  if (ctx.isLegitModalBackdrop) {
    cds -= 20;
    reasons.push("legit_modal_backdrop");
  }

  // --- Composite escalation ---
  const mitigating = new Set(["keyboard_activation", "legit_modal_backdrop"]);
  const positiveCount = reasons.filter(r => !mitigating.has(r)).length;
  if (positiveCount >= 3) {
    cds += positiveCount >= 4 ? 15 : 10;
    reasons.push("composite_escalation");
  }

  cds = Math.max(0, cds);
  return { cds, reasonCodes: reasons };
}
