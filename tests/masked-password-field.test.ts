// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCredentialField,
  isPasswordTypeInput,
  isRememberedPasswordForm,
  isVisiblePasswordField,
  queryPasswordInputs,
  rememberFlippedPasswords,
  rememberPasswordInput,
} from "../extension/src/content/password_field";

function input(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  return document.querySelector("input") as HTMLInputElement;
}

function fire(el: Element, type: "focusin" | "input"): void {
  el.addEventListener(type, rememberPasswordInput);
  el.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
}

// happy-dom drops the non-standard `-webkit-text-security` property, so it
// cannot compute it. Stand in for Chrome's cascade: an element's
// `data-mask` attribute is its computed `-webkit-text-security` value (the
// real cascade is pinned end to end by tests/e2e/masked-password-field.spec.ts).
let styleReads = 0;
beforeEach(() => {
  styleReads = 0;
  vi.stubGlobal("getComputedStyle", (el: Element) => {
    styleReads++;
    return {
      getPropertyValue: (name: string) =>
        name === "-webkit-text-security" ? (el.getAttribute("data-mask") ?? "none") : "",
    };
  });
});
afterEach(() => vi.unstubAllGlobals());

// #1220: a lookalike or type-flipped field is still a credential field.
describe("isCredentialField", () => {
  it.each(["disc", "circle", "square"])("recognizes a text input masked with %s", (mask) => {
    expect(isCredentialField(input(`<input type="text" data-mask="${mask}">`))).toBe(true);
  });

  it("recognizes a masked input whose type attribute is missing or unknown", () => {
    expect(isCredentialField(input('<input data-mask="disc">'))).toBe(true);
    expect(isCredentialField(input('<input type="nonsense" data-mask="disc">'))).toBe(true);
  });

  it.each(["current-password", "section-a CURRENT-PASSWORD", "username  current-password"])(
    "recognizes autocomplete=%j",
    (ac) => {
      expect(isCredentialField(input(`<input type="text" autocomplete="${ac}">`))).toBe(true);
    },
  );

  it("does not treat other autocomplete tokens as credentials", () => {
    expect(isCredentialField(input('<input type="text" autocomplete="username">'))).toBe(false);
    expect(isCredentialField(input('<input type="text" autocomplete="off">'))).toBe(false);
    expect(isCredentialField(input('<input type="text" autocomplete="one-time-code">'))).toBe(false);
    // Sites set new-password on search, address or coupon boxes just to stop autofill.
    expect(isCredentialField(input('<input type="text" autocomplete="new-password">'))).toBe(false);
  });

  it("recognizes type=password, any casing", () => {
    expect(isCredentialField(input('<input type="PassWord">'))).toBe(true);
  });

  it("does not treat plain text, search, or non-text masked inputs as credentials", () => {
    expect(isCredentialField(input('<input type="text">'))).toBe(false);
    expect(isCredentialField(input("<input>"))).toBe(false);
    expect(isCredentialField(input('<input type="search">'))).toBe(false);
    expect(isCredentialField(input('<input type="hidden" data-mask="disc">'))).toBe(false);
    expect(isCredentialField(input('<input type="checkbox" data-mask="disc">'))).toBe(false);
  });

  it("treats a throwing getComputedStyle as not masked", () => {
    vi.stubGlobal("getComputedStyle", () => {
      throw new Error("detached");
    });
    expect(isCredentialField(input('<input type="text">'))).toBe(false);
  });
});

describe("remembered password fields and forms", () => {
  const FORM = '<form><input id="pw" type="password"><input id="x" type="text"></form>';

  it("keeps a field a credential field after it flips to text or hidden", () => {
    const el = input(FORM);
    fire(el, "focusin");
    el.setAttribute("type", "text");
    expect(isCredentialField(el)).toBe(true);
    el.setAttribute("type", "hidden");
    expect(isCredentialField(el)).toBe(true);
  });

  it("remembers the owning form so a replaced or hidden-copy field still counts", () => {
    const el = input(FORM);
    const form = document.querySelector("form") as HTMLFormElement;
    expect(isRememberedPasswordForm(form)).toBe(false);
    fire(el, "input");
    expect(isRememberedPasswordForm(form)).toBe(true);
    // The page swaps the field for a text clone and a hidden copy.
    const clone = el.cloneNode() as HTMLInputElement;
    clone.type = "text";
    el.replaceWith(clone);
    expect(isCredentialField(clone)).toBe(false);
    expect(isRememberedPasswordForm(form)).toBe(true);
  });

  it("remembers a masked field from focusin after the mask is dropped", () => {
    const el = input('<input type="text" data-mask="disc">');
    fire(el, "focusin");
    el.setAttribute("data-mask", "none");
    expect(isCredentialField(el)).toBe(true);
    expect(isCredentialField(input('<input type="text" data-mask="none">'))).toBe(false);
  });

  it("reads no style while typing: input events record type=password only", () => {
    const pw = input('<form><input type="password"></form>');
    fire(pw, "input");
    expect(styleReads).toBe(0);
    const masked = input('<input type="text" data-mask="disc">');
    fire(masked, "input");
    expect(styleReads).toBe(0);
    expect(isCredentialField(masked)).toBe(true); // masked at submit time is still caught by style
  });

  it("does not remember a plain text field or its form", () => {
    const el = input('<form><input type="text"></form>');
    fire(el, "focusin");
    expect(isRememberedPasswordForm(document.querySelector("form") as HTMLFormElement)).toBe(false);
  });

  it("remembers a flipped password from a type mutation record, before any focus", () => {
    const el = input('<form><input type="password"></form>');
    el.setAttribute("type", "text");
    const rec = (oldValue: string | null) => [{ target: el, oldValue }] as unknown as MutationRecord[];
    rememberFlippedPasswords(rec("text"));
    expect(isCredentialField(el)).toBe(false);
    rememberFlippedPasswords(rec("PASSWORD"));
    expect(isCredentialField(el)).toBe(true);
    expect(isRememberedPasswordForm(document.querySelector("form") as HTMLFormElement)).toBe(true);
  });
});

// The shared helpers stay exactly as cheap and as narrow as on main.
describe("isPasswordTypeInput stays type-only", () => {
  it("is false for a masked text field and reads no style", () => {
    const el = input('<input type="text" data-mask="disc" autocomplete="current-password">');
    expect(isPasswordTypeInput(el)).toBe(false);
    expect(queryPasswordInputs(document)).toEqual([]);
    expect(styleReads).toBe(0);
  });

  it("is false for a remembered field that was flipped, and visibility ignores it", () => {
    const el = input('<input type="password">');
    fire(el, "focusin");
    el.setAttribute("type", "text");
    expect(isPasswordTypeInput(el)).toBe(false);
    expect(queryPasswordInputs(document)).toEqual([]);
  });

  it("is still true for type=password", () => {
    const el = input('<input type="password">');
    expect(isPasswordTypeInput(el)).toBe(true);
    expect(isVisiblePasswordField(el)).toBe(true);
  });

  it("is false for a non-input element", () => {
    document.body.innerHTML = '<div data-mask="disc"></div>';
    expect(isPasswordTypeInput(document.querySelector("div") as Element)).toBe(false);
  });
});
