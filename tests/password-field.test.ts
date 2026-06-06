// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  hasVisiblePasswordField,
  isVisiblePasswordField,
} from "../extension/src/content/password_field";

function pwInput(attrs: string): HTMLInputElement {
  document.body.innerHTML = `<input type="password" ${attrs}>`;
  return document.querySelector('input[type="password"]') as HTMLInputElement;
}

describe("isVisiblePasswordField", () => {
  it("is visible for a plain password input", () => {
    expect(isVisiblePasswordField(pwInput(""))).toBe(true);
  });

  it("is not visible when disabled", () => {
    expect(isVisiblePasswordField(pwInput("disabled"))).toBe(false);
  });

  it.each([
    "display:none",
    "display: none",
    "display: none !important",
    "visibility:hidden",
    "visibility: hidden",
    "color:red;display:none",
    "display:block;display:none", // cascade: last valid declaration wins -> none
  ])("is not visible when inline-hidden via style=%j", (style) => {
    expect(isVisiblePasswordField(pwInput(`style="${style}"`))).toBe(false);
  });

  // `visibility:collapse` and `opacity:0` render the field invisible in Chrome
  // but are intentionally out of the inline-`display`/`visibility` scope, so the
  // helper reports them visible. These are residual-scope markers (broadening is
  // tracked in #199), not correctness claims.
  it.each([
    "display:block",
    "visibility:visible",
    "visibility:collapse",
    "opacity:0",
    "color:red",
  ])("is visible with non-hiding (or out-of-scope) style=%j", (style) => {
    expect(isVisiblePasswordField(pwInput(`style="${style}"`))).toBe(true);
  });

  // #196: decoys that merely *contain* a hiding substring inside an unrelated
  // property must NOT hide the field. The CSS engine attributes the keyword to
  // its real property, so these stay visible.
  it.each([
    "content:'display:none'",
    "background:url(/x?display:none)",
    "font-family:'visibility:hidden'",
  ])("stays visible for decoy style=%j (#196)", (style) => {
    expect(isVisiblePasswordField(pwInput(`style="${style}"`))).toBe(true);
  });

  // #196 R1: CSS-invalid multi-token values are dropped by the engine, so the
  // field renders (visible). The earlier hand-parser wrongly took the first
  // token and treated these as hidden, suppressing the gate on a real field.
  it.each([
    "display:none none",
    "display:none x",
    "visibility:hidden foo",
  ])("stays visible for CSS-invalid value style=%j (#196 R1)", (style) => {
    expect(isVisiblePasswordField(pwInput(`style="${style}"`))).toBe(true);
  });

  // Inline-only scope: hiding via the `hidden` attribute or a class is
  // intentionally NOT consulted — element.style reflects inline styles only.
  // Residual-scope marker (broadening tracked in #199); a future change that
  // honored getComputedStyle/`hidden` would flip this and fail here, flagging
  // the scope change.
  it("treats a `hidden`-attribute field as visible (inline-only scope)", () => {
    expect(isVisiblePasswordField(pwInput("hidden"))).toBe(true);
  });

  // R2 regression guard: a password input matched in a non-HTML document is a
  // plain Element with no `.style`. The helper must stay total (not throw) the
  // way the old getAttribute path was, and classify such an element not-visible.
  it("returns false (no throw) for an element lacking inline style (non-HTML)", () => {
    const nonHtml = { disabled: false } as unknown as HTMLInputElement;
    expect(() => isVisiblePasswordField(nonHtml)).not.toThrow();
    expect(isVisiblePasswordField(nonHtml)).toBe(false);
  });
});

describe("hasVisiblePasswordField", () => {
  function docWithBody(html: string): Document {
    document.documentElement.innerHTML = `<head></head><body>${html}</body>`;
    return document;
  }

  it("is false with no password field", () => {
    expect(hasVisiblePasswordField(docWithBody("<input type='text'>"))).toBe(false);
  });

  it("is true with one visible password field", () => {
    expect(hasVisiblePasswordField(docWithBody('<input type="password">'))).toBe(true);
  });

  it("is false when the only password field is inline-hidden", () => {
    expect(
      hasVisiblePasswordField(docWithBody('<input type="password" style="display:none">')),
    ).toBe(false);
  });

  it("is true when a visible password field coexists with a hidden decoy", () => {
    expect(
      hasVisiblePasswordField(
        docWithBody(
          '<input type="password" name="hidden" style="display:none">' +
            '<input type="password" name="real">',
        ),
      ),
    ).toBe(true);
  });

  it("is true for a visible field carrying a decoy hiding substring (#196)", () => {
    expect(
      hasVisiblePasswordField(
        docWithBody("<input type=\"password\" style=\"content:'display:none'\">"),
      ),
    ).toBe(true);
  });
});
