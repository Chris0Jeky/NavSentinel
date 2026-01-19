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

function nameLength(h: ElementHint): number {
  return (h.textLength ?? 0) + (h.ariaLabelLength ?? 0) + (h.titleLength ?? 0);
}

function isInteractive(h: ElementHint): boolean {
  const tag = h.tag;
  if (tag === "A" || tag === "BUTTON") return true;
  const role = (h.role ?? "").toLowerCase();
  if (role === "link" || role === "button") return true;
  if (h.hasOnClick) return true;
  return false;
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

  if (topInteractive && !topHasName) {
    cds += 15;
    reasons.push("no_accessible_name");
  }

  const ratio = coverageRatio(top, ctx.viewport);
  if (topInteractive && ratio !== undefined && ratio > 0.35) {
    cds += 30;
    reasons.push("overlay_large_interactive");
  }

  const under = ctx.underlying;
  if (under) {
    const underInteractive = isInteractive(under);
    const underHasName = nameLength(under) > 0;
    const topIntentful = topInteractive && topHasName;
    if (underInteractive && underHasName && !topIntentful) {
      cds += 35;
      reasons.push("intent_mismatch_under_interactive");
    }
  }

  if (ctx.retargeted) {
    cds += 20;
    reasons.push("retargeted_target_mismatch");
  }

  const pos = (top.position ?? "").toLowerCase();
  const z = top.zIndex ?? 0;
  if (topInteractive && (pos === "fixed" || pos === "absolute") && z >= 9999) {
    cds += 15;
    reasons.push("overlay_high_zindex");
  }

  const cursor = (top.cursor ?? "").toLowerCase();
  const opacity = top.opacity ?? 1;
  if (topInteractive && cursor === "pointer" && !topHasName && opacity < 0.2) {
    cds += 10;
    reasons.push("cursor_pointer_no_affordance");
  }

  const visible = isVisible(top);
  const pointerEvents = (top.pointerEvents ?? "auto").toLowerCase();
  if (!visible && pointerEvents !== "none") {
    cds += 25;
    reasons.push("invisible_but_clickable");
  }

  if (ctx.input === "keyboard") {
    cds -= 10;
    reasons.push("keyboard_activation");
  }

  if (ctx.isLegitModalBackdrop) {
    cds -= 20;
    reasons.push("legit_modal_backdrop");
  }

  cds = Math.max(0, cds);
  return { cds, reasonCodes: reasons };
}
