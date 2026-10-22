// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClickContextFromEvents,
  buildKeyboardClickContext,
} from "../extension/src/content/dom_builder";
import { computeCDS } from "../extension/src/shared/scoring";

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => vi.restoreAllMocks());

function fixture(tag: string) {
  const outer = document.createElement("div");
  outer.style.opacity = "0.01";
  const boundary = document.createElement(tag);
  const inner = document.createElement("div");
  const link = document.createElement("a");
  link.href = "#destination";
  link.textContent = "Read the article";
  vi.spyOn(link, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 120, 24));
  inner.append(link);
  boundary.append(inner);
  outer.append(boundary);
  document.body.append(outer);
  return { boundary, inner, link };
}

function pointerContext(link: Element) {
  const capture = { ts: 100, x: 10, y: 10, stack: [link], top: link };
  return buildClickContextFromEvents({
    down: { ...capture, button: 0, ctrl: false, shift: false, alt: false, meta: false, trusted: true },
    click: capture,
  });
}

describe("effective opacity stops at the actual top layer (#925)", () => {
  // happy-dom has no top-layer rendering. Model only the browser-owned selector
  // state; the real showModal()/showPopover() states are pinned in Playwright.
  for (const [tag, selector] of [["dialog", ":modal"], ["div", ":popover-open"]] as const) {
    it(`${selector} excludes the former ancestor from pointer and keyboard scoring`, () => {
      const { boundary, link } = fixture(tag);
      vi.spyOn(boundary, "matches").mockImplementation((query) => query === selector);
      const pointer = pointerContext(link);
      expect(pointer.top.opacity).toBe(1);
      expect(computeCDS(pointer)).toEqual({ cds: 0, reasonCodes: [] });
      expect(buildKeyboardClickContext(link).top.opacity).toBe(1);
    });

    it(`${selector} keeps its own opacity and descendant opacity`, () => {
      const { boundary, inner, link } = fixture(tag);
      vi.spyOn(boundary, "matches").mockImplementation((query) => query === selector);
      boundary.style.opacity = "0.2";
      inner.style.opacity = "0.25";
      link.style.opacity = "0.5";
      const ctx = pointerContext(link);
      expect(ctx.top.opacity).toBeCloseTo(0.025, 6);
      expect(computeCDS(ctx).reasonCodes).toContain("invisible_but_clickable");
      expect(pointerContext(boundary).top.opacity).toBeCloseTo(0.2, 6);
    });
  }

  it.each(["ordinary container", "non-modal open dialog", "closed popover"])(
    "%s still includes its ancestors' opacity",
    (kind) => {
      const { boundary, inner, link } = fixture(kind === "non-modal open dialog" ? "dialog" : "div");
      if (kind === "non-modal open dialog") boundary.setAttribute("open", "");
      if (kind === "closed popover") boundary.setAttribute("popover", "auto");
      boundary.style.opacity = "0.5";
      inner.style.opacity = "0.5";
      const ctx = pointerContext(link);
      expect(ctx.top.opacity).toBeCloseTo(0.0025, 6);
      expect(computeCDS(ctx).reasonCodes).toContain("invisible_but_clickable");
    },
  );

  it("still checks popover state when the modal selector is unsupported", () => {
    const { boundary, link } = fixture("div");
    vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector) {
      if (selector === ":modal") throw new DOMException("Unsupported selector", "SyntaxError");
      return this === boundary && selector === ":popover-open";
    });
    expect(pointerContext(link).top.opacity).toBe(1);
  });

  it("keeps ordinary opacity traversal when top-layer selectors are unsupported", () => {
    const { link } = fixture("div");
    vi.spyOn(Element.prototype, "matches").mockImplementation(() => {
      throw new DOMException("Unsupported selector", "SyntaxError");
    });
    expect(pointerContext(link).top.opacity).toBeCloseTo(0.01, 6);
  });

  it.each([false, true])("stops at the fullscreen element (shadow root: %s)", (inShadow) => {
    const { boundary, inner, link } = fixture("div");
    const root = inShadow ? boundary.attachShadow({ mode: "open" }) : document;
    if (inShadow) root.appendChild(inner);
    const fullscreen = inShadow ? inner : boundary;
    const descriptor = Object.getOwnPropertyDescriptor(root, "fullscreenElement");
    Object.defineProperty(root, "fullscreenElement", { configurable: true, value: fullscreen });
    fullscreen.style.opacity = "0.5";
    try {
      expect(pointerContext(link).top.opacity).toBe(0.5);
    } finally {
      if (descriptor) Object.defineProperty(root, "fullscreenElement", descriptor);
      else Reflect.deleteProperty(root, "fullscreenElement");
    }
  });
});
