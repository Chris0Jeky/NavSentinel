// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  hasVisiblePasswordField,
  isInlineHidden,
  isVisiblePasswordField,
} from "../extension/src/content/password_field";

describe("isInlineHidden (CSS declaration parsing)", () => {
  it("returns false for empty/whitespace style", () => {
    expect(isInlineHidden("")).toBe(false);
    expect(isInlineHidden("   ")).toBe(false);
  });

  it.each([
    "display:none",
    "display: none",
    "display:none;",
    "DISPLAY:NONE",
    "Display: None",
    "display :none",
    "display:none !important",
    "display:none!important",
    "color:red; display:none",
    "visibility:hidden",
    "visibility: hidden",
    "VISIBILITY:HIDDEN",
    "visibility:hidden !important",
    "color:red;visibility:hidden;",
  ])("treats %j as hidden", (style) => {
    expect(isInlineHidden(style)).toBe(true);
  });

  it.each([
    "display:block",
    "display:flex",
    "visibility:visible",
    "visibility:collapse", // not 'hidden' — out of scope, mirrors prior behavior
    "color:red",
    "opacity:0", // opacity hiding is not a display/visibility declaration
    "width:0;height:0",
  ])("treats %j as visible", (style) => {
    expect(isInlineHidden(style)).toBe(false);
  });

  it("does not fire on a decoy value that merely contains the hiding substring (#196)", () => {
    // The pre-#196 substring check wrongly flagged these as hidden.
    expect(isInlineHidden("content:'display:none'")).toBe(false);
    expect(isInlineHidden('content:"visibility:hidden"')).toBe(false);
    expect(isInlineHidden("background:url(/x?display:none)")).toBe(false);
    expect(isInlineHidden("font-family:'display:none'")).toBe(false);
  });

  it("honors the CSS cascade (last declaration of a property wins)", () => {
    // display resolves to block -> visible, even though 'none' appears first.
    expect(isInlineHidden("display:none;display:block")).toBe(false);
    // display resolves to none -> hidden.
    expect(isInlineHidden("display:block;display:none")).toBe(true);
    // visibility resolves to visible -> not hidden.
    expect(isInlineHidden("visibility:hidden;visibility:visible")).toBe(false);
  });
});

describe("isVisiblePasswordField", () => {
  function pwInput(attrs: string): HTMLInputElement {
    document.body.innerHTML = `<input type="password" ${attrs}>`;
    return document.querySelector('input[type="password"]') as HTMLInputElement;
  }

  it("is visible for a plain password input", () => {
    expect(isVisiblePasswordField(pwInput(""))).toBe(true);
  });

  it("is not visible when disabled", () => {
    expect(isVisiblePasswordField(pwInput("disabled"))).toBe(false);
  });

  it("is not visible when inline display:none / visibility:hidden", () => {
    expect(isVisiblePasswordField(pwInput('style="display:none"'))).toBe(false);
    expect(isVisiblePasswordField(pwInput('style="visibility:hidden"'))).toBe(false);
  });

  it("stays visible despite a decoy hiding substring in a non-hiding property (#196)", () => {
    expect(isVisiblePasswordField(pwInput("style=\"content:'display:none'\""))).toBe(true);
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
