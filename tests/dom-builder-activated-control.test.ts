// @vitest-environment happy-dom
/**
 * #863: a pointer click that lands on a non-interactive child of a named
 * control (link text in a <span>, an <h3> title, an icon <svg>, a Material
 * state layer) is scored as a click on that control. Overlays layered above a
 * target as siblings or unrelated elements, and descendants that escape their
 * link to sit over other content, keep their leaf-based attack signals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClickContextFromEvents,
  type ClickCapture,
  type DownCapture,
} from "../extension/src/content/dom_builder";
import { computeCDS, hasAccessibleName } from "../extension/src/shared/scoring";

beforeEach(() => {
  document.body.innerHTML = "";
  // happy-dom has no text layout. Model a visible direct-text glyph at the
  // shared click point, while zero-width format characters paint no width.
  vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
    const width = /[^\s\u200b-\u200d\ufeff]/u.test(this.toString()) ? 120 : 0;
    return [new DOMRect(0, 0, width, 24)] as unknown as DOMRectList;
  });
});

afterEach(() => vi.restoreAllMocks());

/** happy-dom lays nothing out; give an element a real-looking box. */
function withRect<T extends Element>(el: T, w: number, h: number): T {
  (el as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) }) as DOMRect;
  return el;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  parent: Element = document.body,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return withRect(node, 120, 24);
}

/** One trusted pointer gesture whose down and click both hit `stack[0]`. */
function click(stack: Element[]): ReturnType<typeof buildClickContextFromEvents> {
  const top = stack[0] ?? null;
  const down: DownCapture = {
    ts: 100, x: 10, y: 10, button: 0, ctrl: false, shift: false, alt: false, meta: false,
    trusted: true, stack, top,
  };
  const up: ClickCapture = { ts: 180, x: 10, y: 10, stack, top };
  return buildClickContextFromEvents({ down, click: up });
}

function linkWithSpan(attrs: Record<string, string> = {}): { link: HTMLAnchorElement; span: HTMLSpanElement } {
  const link = el("a", { href: "https://other.example/article", ...attrs });
  const span = el("span", {}, link);
  span.textContent = "Read the full article";
  return { link, span };
}

describe("#863 — clicks on a named control's own child score as clicks on the control", () => {
  it("text in a <span> inside a cross-site link: the link is scored, no intent mismatch", () => {
    const { link, span } = linkWithSpan();
    const ctx = click([span, link, document.body, document.documentElement]);
    expect(ctx.top.tag).toBe("A");
    expect(ctx.underlying).toBeUndefined();
    expect(computeCDS(ctx)).toEqual({ cds: 0, reasonCodes: [] });
  });

  it("an <h3> title inside a result link (DuckDuckGo shape) is scored as the link", () => {
    const link = el("a", { href: "https://en.wikipedia.org/wiki/Example" });
    const h3 = el("h3", {}, link);
    const span = el("span", {}, h3);
    span.textContent = "Example - Wikipedia";
    const ctx = click([span, h3, link, document.body]);
    expect(ctx.top.tag).toBe("A");
    expect(computeCDS(ctx).reasonCodes).not.toContain("intent_mismatch_under_interactive");
    expect(computeCDS(ctx).cds).toBe(0);
  });

  it("an icon <svg> inside an aria-labelled link is scored as the link", () => {
    const link = el("a", { href: "https://other.example/", "aria-label": "Open the full article" });
    const svg = withRect(document.createElementNS("http://www.w3.org/2000/svg", "svg"), 28, 28);
    const rect = withRect(document.createElementNS("http://www.w3.org/2000/svg", "rect"), 28, 28);
    svg.appendChild(rect);
    link.appendChild(svg);
    const ctx = click([rect, svg, link, document.body]);
    expect(ctx.top.tag).toBe("A");
    expect(computeCDS(ctx)).toEqual({ cds: 0, reasonCodes: [] });
  });

  it("a translucent Material state layer inside a labelled _blank link reads the link's opacity", () => {
    const link = el("a", { href: "https://other.example/watch", target: "_blank" });
    link.textContent = "Watch on VideoSite";
    const layer = el("span", { style: "position:absolute;inset:0;opacity:0.08" }, link);
    const ctx = click([layer, link, document.body]);
    expect(ctx.top.tag).toBe("A");
    expect(ctx.top.targetBlank).toBe(true);
    expect(ctx.top.opacity).toBe(1);
    const { cds, reasonCodes } = computeCDS(ctx);
    expect(reasonCodes).not.toContain("near_invisible_opacity");
    expect(reasonCodes).not.toContain("intent_mismatch_under_interactive");
    expect(cds).toBe(0);
  });

  it("siblings inside the same control painted between the leaf and the control still qualify", () => {
    const link = el("a", { href: "https://other.example/" });
    const label = el("span", {}, link);
    label.textContent = "Pull requests";
    const layer = el("span", { style: "position:absolute;inset:0;opacity:0.1" }, link);
    const ctx = click([layer, label, link, document.body]);
    expect(ctx.top.tag).toBe("A");
    expect(computeCDS(ctx).cds).toBe(0);
  });

  it("looks past the activated control for the underlying candidate", () => {
    const card = el("div", { onclick: "void 0" });
    card.textContent = "Card title";
    const link = el("a", { href: "https://other.example/" }, card);
    const span = el("span", {}, link);
    span.textContent = "Open";
    const ctx = click([span, link, card, document.body]);
    expect(ctx.top.tag).toBe("A");
    expect(ctx.underlying?.tag).toBe("DIV");
    expect(ctx.inTop).toBe(false);
    expect(computeCDS(ctx).reasonCodes).not.toContain("intent_mismatch_under_interactive");
  });

  it("scores the activated control's own concealment: a translucent full-viewport named link", () => {
    const link = el("a", { href: "https://evil.example/", style: "position:fixed;z-index:99999;opacity:0.05" });
    withRect(link, window.innerWidth, window.innerHeight);
    const child = el("div", {}, link);
    child.textContent = "Continue";
    withRect(child, window.innerWidth, window.innerHeight);
    const ctx = click([child, link, document.body]);
    expect(ctx.top.tag).toBe("A");
    const { cds, reasonCodes } = computeCDS(ctx);
    expect(reasonCodes).toEqual(expect.arrayContaining([
      "overlay_large_interactive",
      "overlay_high_zindex",
      "invisible_but_clickable",
      "composite_escalation",
    ]));
    // 30 + 15 + 25 + 10: stronger than the accidental +35 the leaf used to score.
    expect(cds).toBeGreaterThanOrEqual(70);
  });
});

describe("#863 — attack shapes keep their leaf-based signals", () => {
  it("a sibling overlay layered above a named link keeps intent_mismatch_under_interactive", () => {
    const { link } = linkWithSpan();
    const overlay = el("div", { style: "position:absolute;inset:0" });
    const ctx = click([overlay, link, document.body]);
    expect(ctx.top.tag).toBe("DIV");
    expect(ctx.underlying?.tag).toBe("A");
    expect(ctx.inTop).toBe(false);
    expect(computeCDS(ctx).reasonCodes).toContain("intent_mismatch_under_interactive");
  });

  it("a link's descendant that escapes its box over an unrelated control keeps the mismatch", () => {
    // The attacker link's own box is not hit at the point, so it is absent
    // from the stack; the first interactive candidate is the victim control.
    const attacker = el("a", { href: "https://evil.example/" });
    attacker.textContent = "tiny";
    const escaped = el("span", { style: "position:fixed;inset:0;opacity:0.1" }, attacker);
    const victim = el("button");
    victim.textContent = "Delete account";
    const ctx = click([escaped, victim, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    expect(ctx.underlying?.tag).toBe("BUTTON");
    const { reasonCodes } = computeCDS(ctx);
    expect(reasonCodes).toContain("intent_mismatch_under_interactive");
    expect(reasonCodes).toContain("near_invisible_opacity");
  });

  it("an unrelated layer painted between the leaf and its link blocks the re-root", () => {
    const attacker = el("a", { href: "https://evil.example/" });
    attacker.textContent = "Free prize";
    const leaf = el("span", { style: "position:absolute;z-index:10;opacity:0.01" }, attacker);
    const decoy = el("div", { style: "position:absolute;z-index:5" });
    decoy.textContent = "Play video";
    const ctx = click([leaf, decoy, attacker, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    expect(ctx.underlying?.tag).toBe("A");
    const { reasonCodes } = computeCDS(ctx);
    expect(reasonCodes).toContain("intent_mismatch_under_interactive");
    expect(reasonCodes).toContain("invisible_but_clickable");
  });

  it("an invisible child that carries a link's only content keeps its concealment signals (Codex review on #882)", () => {
    const link = el("a", { href: "https://evil.example/" });
    const leaf = el("span", { style: "opacity:0.01" }, link);
    leaf.textContent = "Continue";
    const ctx = click([leaf, link, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    expect(ctx.underlying?.tag).toBe("A");
    const { cds, reasonCodes } = computeCDS(ctx);
    expect(reasonCodes).toEqual(["intent_mismatch_under_interactive", "invisible_but_clickable"]);
    expect(cds).toBe(60);
  });

  it("a zero-width direct text node does not make a concealed child visibly painted (#886)", () => {
    const link = el("a", { href: "https://evil.example/" });
    link.appendChild(document.createTextNode("\u200b"));
    const leaf = el("span", { style: "opacity:0.01" }, link);
    leaf.textContent = "Continue";
    const ctx = click([leaf, link, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    expect(computeCDS(ctx).reasonCodes).toEqual(["intent_mismatch_under_interactive", "invisible_but_clickable"]);
  });

  it("direct text outside the click point does not hide a concealed child (#886)", () => {
    vi.mocked(Range.prototype.getClientRects).mockReturnValue(
      [new DOMRect(80, 80, 20, 20)] as unknown as DOMRectList,
    );
    const link = el("a", { href: "https://evil.example/" });
    link.appendChild(document.createTextNode("Visible elsewhere"));
    const leaf = el("span", { style: "opacity:0.01" }, link);
    leaf.textContent = "Continue";
    const ctx = click([leaf, link, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    expect(computeCDS(ctx).reasonCodes).toContain("invisible_but_clickable");
  });

  it("keeps effective ancestor opacity when re-rooting a clicked child (#886)", () => {
    const wrapper = el("div", { style: "opacity:0.01" });
    const link = el("a", { href: "https://evil.example/" }, wrapper);
    const leaf = el("span", {}, link);
    leaf.textContent = "Continue";
    const ctx = click([leaf, link, wrapper, document.body]);
    expect(ctx.top.opacity).toBeCloseTo(0.01);
    expect(computeCDS(ctx).reasonCodes).toContain("invisible_but_clickable");
  });

  it("counts an opaque-looking slotted child under a concealed shadow wrapper (#886)", () => {
    const link = el("a", { href: "https://evil.example/" });
    const host = withRect(document.createElement("x-surface"), 120, 24);
    link.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const wrapper = document.createElement("div");
    wrapper.style.opacity = "0.01";
    const slot = document.createElement("slot");
    wrapper.appendChild(slot);
    shadow.appendChild(wrapper);
    const leaf = el("span", {}, host);
    leaf.textContent = "Continue";
    Object.defineProperty(leaf, "assignedSlot", { value: slot });

    const ctx = click([leaf, host, link, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    expect(computeCDS(ctx).reasonCodes).toContain("invisible_but_clickable");
  });

  it("an invisible wrapper between the clicked child and its link blocks the re-root", () => {
    const link = el("a", { href: "https://evil.example/" });
    const wrapper = el("div", { style: "opacity:0.01" }, link);
    const leaf = el("span", {}, wrapper);
    leaf.textContent = "Continue";
    const ctx = click([leaf, wrapper, link, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    expect(computeCDS(ctx).reasonCodes).toContain("intent_mismatch_under_interactive");
  });

  it("a translucent layer over a hidden label in an unpainted link keeps the leaf score", () => {
    const link = el("a", { href: "https://evil.example/" });
    const label = el("span", { style: "opacity:0.01" }, link);
    label.textContent = "Pull requests";
    const layer = el("span", { style: "position:absolute;inset:0;opacity:0.1" }, link);
    const ctx = click([layer, label, link, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    const { reasonCodes } = computeCDS(ctx);
    expect(reasonCodes).toContain("near_invisible_opacity");
    expect(reasonCodes).toContain("intent_mismatch_under_interactive");
  });

  it("a concealed child over a link's own painted background re-roots onto the visible control", () => {
    const link = el("a", { href: "https://other.example/", style: "background-color: rgb(51, 51, 51)" });
    const layer = el("span", { style: "opacity:0.01" }, link);
    layer.textContent = "Watch";
    const ctx = click([layer, link, document.body]);
    expect(ctx.top.tag).toBe("A");
    expect(computeCDS(ctx).cds).toBe(0);
  });

  it("a see-through link background does not count as a visible affordance", () => {
    const link = el("a", { href: "https://evil.example/", style: "background-color: rgba(51, 51, 51, 0.05)" });
    const leaf = el("span", { style: "opacity:0.01" }, link);
    leaf.textContent = "Continue";
    const ctx = click([leaf, link, document.body]);
    expect(ctx.top.tag).toBe("SPAN");
    expect(computeCDS(ctx).reasonCodes).toContain("invisible_but_clickable");
  });

  it("an unnamed control keeps the previous leaf-based score", () => {
    const link = el("a", { href: "https://other.example/" });
    const child = el("div", {}, link);
    const ctx = click([child, link, document.body]);
    expect(ctx.top.tag).toBe("DIV");
    expect(ctx.underlying?.tag).toBe("A");
  });

  it("an interactive leaf inside a named link is scored as itself", () => {
    const link = el("a", { href: "https://other.example/" });
    link.textContent = "Open";
    const inner = el("button", {}, link);
    const ctx = click([inner, link, document.body]);
    expect(ctx.top.tag).toBe("BUTTON");
    expect(ctx.underlying?.tag).toBe("A");
    expect(computeCDS(ctx).reasonCodes).toEqual(
      expect.arrayContaining(["no_accessible_name", "intent_mismatch_under_interactive"]),
    );
  });

  it("retargeting still compares the raw pointerdown and click leaves", () => {
    const { link, span } = linkWithSpan();
    const other = el("span", {}, link);
    other.textContent = "x";
    const down: DownCapture = {
      ts: 100, x: 10, y: 10, button: 0, ctrl: false, shift: false, alt: false, meta: false,
      trusted: true, stack: [other, link], top: other,
    };
    const ctx = buildClickContextFromEvents({
      down,
      click: { ts: 180, x: 10, y: 10, stack: [span, link], top: span },
    });
    expect(ctx.top.tag).toBe("A");
    expect(ctx.retargeted).toBe(true);
    expect(computeCDS(ctx).reasonCodes).toContain("retargeted_target_mismatch");
  });
});

describe("hasAccessibleName", () => {
  it("follows the scoring name rule: text, or aria-label/title of at least two characters", () => {
    expect(hasAccessibleName({ tag: "A", textLength: 1 })).toBe(true);
    expect(hasAccessibleName({ tag: "A", ariaLabelLength: 2 })).toBe(true);
    expect(hasAccessibleName({ tag: "A", titleLength: 5 })).toBe(true);
    expect(hasAccessibleName({ tag: "A", ariaLabelLength: 1, titleLength: 1 })).toBe(false);
    expect(hasAccessibleName({ tag: "A" })).toBe(false);
  });
});
