import type { ClickContext, ElementHint } from "../shared/scoring";

export interface DownCapture {
  ts: number;
  x: number;
  y: number;
  button: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;

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
    if (!WS_RE.test(s[i])) count++;
  }
  return count;
}

function attrLen(el: Element, name: string, cap = 80): number {
  const v = el.getAttribute(name);
  if (!v) return 0;
  return Math.min(v.length, cap);
}

function isInteractiveCheap(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "A" || tag === "BUTTON") return true;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (role === "button" || role === "link") return true;
  if (el.getAttribute("onclick")) return true;
  return false;
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
  const cs = window.getComputedStyle(el as Element);
  const z = cs.zIndex === "auto" ? 0 : Number.parseInt(cs.zIndex, 10);

  return {
    opacity: Number.parseFloat(cs.opacity),
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
  const role = el.getAttribute("role") ?? undefined;

  const hint: ElementHint = {
    tag,
    role,
    hasOnClick: !!el.getAttribute("onclick"),
    textLength: approxNonWhitespaceTextLen(el),
    ariaLabelLength: attrLen(el, "aria-label"),
    titleLength: attrLen(el, "title")
  };

  if (tag === "A") {
    const t = (el as HTMLAnchorElement).target;
    hint.targetBlank = t === "_blank";
  }

  if (opts.wantRect) hint.rect = readRect(el);
  if (opts.wantStyle) Object.assign(hint, readStyleHints(el));

  return hint;
}

function detectLegitModalBackdrop(top: Element | null, stack: Element[], viewport: { w: number; h: number }): boolean {
  if (!top) return false;

  const topRect = readRect(top);
  if (!topRect) return false;

  const ratio = (topRect.w * topRect.h) / (viewport.w * viewport.h);
  if (ratio < 0.35) return false;

  if (isInteractiveCheap(top)) return false;

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

  const explicitNewTabIntent = (params.down?.button === 1) || !!(params.down?.ctrl || params.down?.meta);

  const topEl = clickTop ?? downTop ?? params.click.stack[0] ?? document.documentElement;
  const underEl = firstUnderlyingCandidate(params.click.stack, topEl);

  const top = buildElementHint(topEl, { wantRect: true, wantStyle: true });

  const underlying = underEl
    ? buildElementHint(underEl, { wantRect: true, wantStyle: false })
    : undefined;

  const isLegitModalBackdrop = detectLegitModalBackdrop(topEl, params.click.stack, viewport);

  const ctx: ClickContext = {
    viewport,
    top,
    underlying,
    retargeted,
    input: "pointer",
    explicitNewTabIntent,
    isLegitModalBackdrop
  };

  return ctx;
}
