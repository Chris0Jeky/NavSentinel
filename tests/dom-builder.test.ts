// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildClickContextFromEvents,
  buildKeyboardClickContext,
  type DownCapture,
  type ClickCapture,
} from "../extension/src/content/dom_builder";

function makeEl(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

function fakeDown(overrides: Partial<DownCapture> = {}): DownCapture {
  const el = overrides.top ?? document.documentElement;
  return {
    ts: 100,
    x: 50,
    y: 50,
    button: 0,
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    stack: overrides.stack ?? [el],
    top: el,
    ...overrides,
  };
}

function fakeClick(overrides: Partial<ClickCapture> = {}): ClickCapture {
  const el = overrides.top ?? document.documentElement;
  return {
    ts: 120,
    x: 50,
    y: 50,
    stack: overrides.stack ?? [el],
    top: el,
    ...overrides,
  };
}

describe("buildClickContextFromEvents", () => {
  it("returns pointer input type", () => {
    const result = buildClickContextFromEvents({
      down: fakeDown(),
      click: fakeClick(),
    });
    expect(result.input).toBe("pointer");
  });

  it("detects retargeted click when down and click targets differ", () => {
    const a = makeEl("div");
    const b = makeEl("span");
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: a }),
      click: fakeClick({ top: b }),
    });
    expect(result.retargeted).toBe(true);
  });

  it("not retargeted when same element", () => {
    const el = makeEl("button");
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el }),
      click: fakeClick({ top: el }),
    });
    expect(result.retargeted).toBe(false);
  });

  it("not retargeted when down is null", () => {
    const el = makeEl("button");
    const result = buildClickContextFromEvents({
      down: null,
      click: fakeClick({ top: el }),
    });
    expect(result.retargeted).toBe(false);
  });

  it("detects explicit new tab intent via middle button", () => {
    const el = makeEl("a", { href: "https://example.com" });
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el, button: 1 }),
      click: fakeClick({ top: el }),
    });
    expect(result.explicitNewTabIntent).toBe(true);
  });

  it("detects explicit new tab intent via ctrl key", () => {
    const el = makeEl("a", { href: "https://example.com" });
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el, ctrl: true }),
      click: fakeClick({ top: el }),
    });
    expect(result.explicitNewTabIntent).toBe(true);
  });

  it("detects explicit new tab intent via meta key", () => {
    const el = makeEl("a", { href: "https://example.com" });
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el, meta: true }),
      click: fakeClick({ top: el }),
    });
    expect(result.explicitNewTabIntent).toBe(true);
  });

  it("no new tab intent for normal left click", () => {
    const el = makeEl("a", { href: "https://example.com" });
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el }),
      click: fakeClick({ top: el }),
    });
    expect(result.explicitNewTabIntent).toBe(false);
  });

  it("captures top element hint with tag", () => {
    const el = makeEl("button");
    el.textContent = "Click me";
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el }),
      click: fakeClick({ top: el }),
    });
    expect(result.top.tag).toBe("BUTTON");
    expect(result.top.textLength).toBeGreaterThan(0);
  });

  it("captures anchor targetBlank", () => {
    const el = makeEl("a", { href: "https://example.com", target: "_blank" });
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el }),
      click: fakeClick({ top: el }),
    });
    expect(result.top.targetBlank).toBe(true);
  });

  it("captures hasOnClick for elements with onclick attr", () => {
    const el = makeEl("div", { onclick: "alert(1)" });
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el }),
      click: fakeClick({ top: el }),
    });
    expect(result.top.hasOnClick).toBe(true);
  });

  it("captures role attribute", () => {
    const el = makeEl("div", { role: "button" });
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: el }),
      click: fakeClick({ top: el }),
    });
    expect(result.top.role).toBe("button");
  });

  it("captures underlying interactive element", () => {
    const link = makeEl("a", { href: "https://example.com" });
    link.textContent = "Real link";
    const overlay = makeEl("div");
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: overlay, stack: [overlay, link] }),
      click: fakeClick({ top: overlay, stack: [overlay, link] }),
    });
    expect(result.underlying).toBeDefined();
    expect(result.underlying!.tag).toBe("A");
  });

  it("marks underlying action as contained when the top element wraps it", () => {
    const nav = makeEl("nav");
    const link = document.createElement("a");
    link.href = "https://example.com";
    link.textContent = "Real link";
    nav.appendChild(link);
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: nav, stack: [nav, link] }),
      click: fakeClick({ top: nav, stack: [nav, link] }),
    });
    expect(result.underlying?.tag).toBe("A");
    expect(result.inTop).toBe(true);
  });

  it("marks underlying action as uncontained for sibling overlays", () => {
    const link = makeEl("a", { href: "https://example.com" });
    const overlay = makeEl("nav");
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: overlay, stack: [overlay, link] }),
      click: fakeClick({ top: overlay, stack: [overlay, link] }),
    });
    expect(result.underlying?.tag).toBe("A");
    expect(result.inTop).toBe(false);
  });

  it("does not set underlying when no interactive element below", () => {
    const top = makeEl("div");
    const bottom = makeEl("div");
    const result = buildClickContextFromEvents({
      down: fakeDown({ top, stack: [top, bottom] }),
      click: fakeClick({ top, stack: [top, bottom] }),
    });
    expect(result.underlying).toBeUndefined();
  });

  it("provides viewport dimensions", () => {
    const result = buildClickContextFromEvents({
      down: fakeDown(),
      click: fakeClick(),
    });
    expect(result.viewport).toHaveProperty("w");
    expect(result.viewport).toHaveProperty("h");
  });

  it("isLegitModalBackdrop is false for small elements", () => {
    const small = makeEl("div");
    const result = buildClickContextFromEvents({
      down: fakeDown({ top: small }),
      click: fakeClick({ top: small }),
    });
    expect(result.isLegitModalBackdrop).toBe(false);
  });
});

describe("buildKeyboardClickContext", () => {
  it("returns keyboard input type", () => {
    const el = makeEl("button");
    const result = buildKeyboardClickContext(el);
    expect(result.input).toBe("keyboard");
  });

  it("is never retargeted", () => {
    const result = buildKeyboardClickContext(makeEl("a"));
    expect(result.retargeted).toBe(false);
  });

  it("never has explicit new tab intent", () => {
    const result = buildKeyboardClickContext(makeEl("a"));
    expect(result.explicitNewTabIntent).toBe(false);
  });

  it("never is legit modal backdrop", () => {
    const result = buildKeyboardClickContext(makeEl("div"));
    expect(result.isLegitModalBackdrop).toBe(false);
  });

  it("falls back to activeElement when target is null", () => {
    const result = buildKeyboardClickContext(null);
    expect(["HTML", "BODY"]).toContain(result.top.tag);
  });

  it("captures top element hint", () => {
    const el = makeEl("button", { role: "tab" });
    el.textContent = "Tab label";
    const result = buildKeyboardClickContext(el);
    expect(result.top.tag).toBe("BUTTON");
    expect(result.top.role).toBe("tab");
    expect(result.top.textLength).toBeGreaterThan(0);
  });
});
