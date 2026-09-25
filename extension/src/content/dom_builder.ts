import {
  CONCEALED_OPACITY_CEILING,
  hasAccessibleName,
  type ClickContext,
  type ElementHint
} from "../shared/scoring";

export interface DownCapture {
  ts: number;
  x: number;
  y: number;
  button: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  trusted: boolean;
  stack: Element[];
  top: Element | null;
}

export interface ClickCapture {
  ts: number;
  x: number;
  y: number;
  stack: Element[];
  top: Element | null;
}

const WS_RE = /\s/;

function approxNonWhitespaceTextLen(el: Element, cap = 80): number {
  const s = el.textContent;
  if (!s) return 0;
  let count = 0;
  for (let i = 0; i < s.length && count < cap; i++) {
    const ch = s.charAt(i);
    if (!WS_RE.test(ch)) count++;
  }
  return count;
}

function attrLen(el: Element, name: string, cap = 80): number {
  const v = el.getAttribute(name);
  if (!v) return 0;
  return Math.min(v.trim().length, cap);
}

function isInteractiveCheap(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "A" || tag === "BUTTON") return true;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (role === "button" || role === "link") return true;
  return !!el.getAttribute("onclick");
}

function firstUnderlyingCandidate(stack: Element[], top: Element | null): Element | null {
  if (!top) return null;
  for (const el of stack) {
    if (el === top) continue;
    if (isInteractiveCheap(el)) return el;
  }
  return null;
}

function readRect(el: Element): { w: number; h: number } | undefined {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r) return undefined;
  return { w: Math.max(0, r.width), h: Math.max(0, r.height) };
}

function readStyleHints(el: Element): Partial<ElementHint> {
  const cs = window.getComputedStyle(el);
  const z = cs.zIndex === "auto" ? 0 : Number.parseInt(cs.zIndex, 10);
  // Detached elements report "" for computed opacity; an unguarded parse
  // plants NaN in scoring, where every comparison fails open (#853).
  return {
    opacity: effectiveOpacity(el),
    display: cs.display,
    visibility: cs.visibility,
    pointerEvents: cs.pointerEvents,
    position: cs.position,
    zIndex: Number.isFinite(z) ? z : 0,
    cursor: cs.cursor
  };
}

function buildElementHint(el: Element, opts: { wantStyle: boolean; wantRect: boolean }): ElementHint {
  const tag = el.tagName;
  const hint: ElementHint = {
    tag,
    hasOnClick: !!el.getAttribute("onclick"),
    textLength: approxNonWhitespaceTextLen(el),
    ariaLabelLength: attrLen(el, "aria-label"),
    titleLength: attrLen(el, "title")
  };
  const role = el.getAttribute("role");
  if (role) hint.role = role;

  if (tag === "A") {
    hint.targetBlank = ((el as HTMLAnchorElement).target ?? "").toLowerCase() === "_blank";
  }

  if (opts.wantRect) {
    const rect = readRect(el);
    if (rect) hint.rect = rect;
  }
  if (opts.wantStyle) Object.assign(hint, readStyleHints(el));
  return hint;
}

function ownOpacity(el: Element): number {
  const o = Number.parseFloat(window.getComputedStyle(el).opacity);
  return Number.isFinite(o) ? o : 1;
}

function composedParentElement(el: Element): Element | null {
  if (el.assignedSlot) return el.assignedSlot;
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function effectiveOpacity(el: Element): number {
  let product = 1;
  for (let current: Element | null = el; current; current = composedParentElement(current)) {
    product *= ownOpacity(current);
  }
  return product;
}

/** Product of the own opacities from `el` up to, but excluding, `control`. */
function opacityWithin(el: Element, control: Element): number {
  let product = 1;
  for (let e: Element | null = el; e && e !== control; e = composedParentElement(e)) {
    product *= ownOpacity(e);
  }
  return product;
}

/** Alpha of a computed background colour; unknown formats count as unpainted. */
function backgroundAlpha(el: Element): number {
  const bg = window.getComputedStyle(el).backgroundColor.trim().toLowerCase();
  if (!bg || bg === "transparent") return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(bg);
  if (slash) return Number.parseFloat(slash[1]!) / (slash[2] ? 100 : 1);
  const rgba = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(bg);
  if (rgba) return Number.parseFloat(rgba[1]!);
  return bg.startsWith("rgb(") ? 1 : 0;
}

/** Direct text must paint a visible glyph at the click point to count. */
function paintsOwnContent(el: Element, x: number, y: number): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType !== Node.TEXT_NODE || !/[^\s\u200b-\u200d\ufeff]/u.test(node.textContent ?? "")) continue;
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return true;
      }
    }
  }
  return backgroundAlpha(el) >= CONCEALED_OPACITY_CEILING;
}

/**
 * The named control a pointer click activates when the hit-test leaf is a
 * non-interactive part of it: link text in a `<span>`, an `<h3>` title, an
 * icon `<svg>`, a Material state layer (#863). Returns that control when
 *   - the leaf is not itself interactive,
 *   - the first interactive element below the leaf in the hit stack contains
 *     the leaf, so it is the ancestor whose activation the click triggers and
 *     its own box is hit at the click point,
 *   - every element painted between the leaf and that control belongs to the
 *     control, so no unrelated layer sits between the two,
 *   - the control has an accessible name. That is exactly the case in which
 *     the leaf used to score `intent_mismatch_under_interactive` against its
 *     own ancestor; unnamed controls keep their previous leaf-based score, and
 *   - the clicked content is not concealed, or the control visibly paints
 *     something of its own at the click point. A leaf (or a wrapper between it
 *     and the control) below the concealment opacity can hide the only content
 *     the user would see, so re-rooting it onto an opaque link would erase
 *     `invisible_but_clickable` and friends. A translucent state layer over a
 *     painted button, or over the button's own visible label, still re-roots.
 * Otherwise returns null and the leaf keeps being scored on its own. Overlays
 * layered above a target as siblings or unrelated elements, and descendants
 * that escape their link's box to cover other content, never qualify.
 */
function activatedAncestor(stack: Element[], leaf: Element, x: number, y: number): Element | null {
  if (isInteractiveCheap(leaf)) return null;
  const between: Element[] = [];
  for (const el of stack) {
    if (el === leaf) continue;
    if (isInteractiveCheap(el)) {
      if (!el.contains(leaf)) return null;
      if (!between.every((b) => el.contains(b))) return null;
      if (!hasAccessibleName(buildElementHint(el, { wantRect: false, wantStyle: false }))) return null;
      if (opacityWithin(leaf, el) >= CONCEALED_OPACITY_CEILING) return el;
      const visibleOwnPaint = paintsOwnContent(el, x, y) || between.some((b) =>
        opacityWithin(b, el) >= CONCEALED_OPACITY_CEILING && paintsOwnContent(b, x, y));
      return visibleOwnPaint ? el : null;
    }
    between.push(el);
  }
  return null;
}

function detectLegitModalBackdrop(
  top: Element | null,
  stack: Element[],
  viewport: { w: number; h: number }
): boolean {
  if (!top) return false;
  const topRect = readRect(top);
  if (!topRect) return false;
  const ratio = (topRect.w * topRect.h) / (viewport.w * viewport.h);
  if (ratio < 0.35 || isInteractiveCheap(top)) return false;

  for (const el of stack) {
    if (el === top) continue;
    const role = (el.getAttribute("role") ?? "").toLowerCase();
    if (role === "dialog") return true;
    if ((el.getAttribute("aria-modal") ?? "").toLowerCase() === "true") return true;
  }
  return false;
}

export function capturePointerDown(e: PointerEvent): DownCapture {
  const x = e.clientX;
  const y = e.clientY;
  const stack = document.elementsFromPoint(x, y);
  return {
    ts: performance.now(),
    x,
    y,
    button: e.button,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    trusted: e.isTrusted,
    stack,
    top: stack[0] ?? null
  };
}

export function captureClick(e: MouseEvent): ClickCapture {
  const x = e.clientX;
  const y = e.clientY;
  const stack = document.elementsFromPoint(x, y);
  return {
    ts: performance.now(),
    x,
    y,
    stack,
    top: stack[0] ?? null
  };
}

export function buildClickContextFromEvents(params: {
  down: DownCapture | null;
  click: ClickCapture;
}): ClickContext {
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const downTop = params.down?.top ?? null;
  const clickTop = params.click.top ?? null;
  const retargeted = !!(downTop && clickTop && downTop !== clickTop);
  const explicitNewTabIntent =
    params.down?.button === 1 || !!(params.down?.ctrl || params.down?.meta);
  const leafEl = clickTop ?? downTop ?? params.click.stack[0] ?? document.documentElement;
  // Score the control the user activated, not the non-interactive child the
  // pointer happened to land on (#863). The retargeting check above still
  // compares the raw pointerdown and click leaves.
  const topEl = activatedAncestor(params.click.stack, leafEl, params.click.x, params.click.y) ?? leafEl;
  const underEl = firstUnderlyingCandidate(params.click.stack, topEl);
  const top = buildElementHint(topEl, { wantRect: true, wantStyle: true });
  const isLegitModalBackdrop = detectLegitModalBackdrop(topEl, params.click.stack, viewport);

  const ctx: ClickContext = {
    viewport,
    top,
    retargeted,
    input: "pointer",
    explicitNewTabIntent,
    isLegitModalBackdrop
  };
  if (underEl) {
    ctx.underlying = buildElementHint(underEl, { wantRect: true, wantStyle: false });
    ctx.inTop = topEl.contains(underEl);
  }
  return ctx;
}

export function buildKeyboardClickContext(target: Element | null): ClickContext {
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const active = document.activeElement;
  const topEl = target ?? (active instanceof Element ? active : null) ?? document.documentElement;
  const top = buildElementHint(topEl, { wantRect: true, wantStyle: true });

  return {
    viewport,
    top,
    retargeted: false,
    input: "keyboard",
    explicitNewTabIntent: false,
    isLegitModalBackdrop: false
  };
}
