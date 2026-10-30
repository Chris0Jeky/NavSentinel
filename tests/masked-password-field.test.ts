// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPasswordTypeInput,
  queryPasswordInputs,
  rememberPasswordInput,
} from "../extension/src/content/password_field";

function input(html: string): HTMLInputElement {
  document.body.innerHTML = html;
  return document.querySelector("input") as HTMLInputElement;
}

// happy-dom drops the non-standard `-webkit-text-security` property, so it
// cannot compute it. Stand in for Chrome's cascade: an element's
// `data-mask` attribute is its computed `-webkit-text-security` value (the
// real cascade is pinned end to end by tests/e2e/masked-password-field.spec.ts).
beforeEach(() => {
  vi.stubGlobal("getComputedStyle", (el: Element) => ({
    getPropertyValue: (name: string) =>
      name === "-webkit-text-security" ? (el.getAttribute("data-mask") ?? "none") : "",
  }));
});
afterEach(() => vi.unstubAllGlobals());

// #1220: a lookalike or type-flipped field is still a password field.
describe("masked and type-flipped password fields", () => {
  it.each(["disc", "circle", "square"])("recognizes a text input masked with %s", (mask) => {
    const el = input(`<input type="text" data-mask="${mask}">`);
    expect(isPasswordTypeInput(el)).toBe(true);
    expect(queryPasswordInputs(document)).toEqual([el]);
  });

  it("recognizes a masked input whose type attribute is missing or unknown", () => {
    expect(isPasswordTypeInput(input('<input data-mask="disc">'))).toBe(true);
    expect(isPasswordTypeInput(input('<input type="nonsense" data-mask="disc">'))).toBe(true);
  });

  it("recognizes an input that was a password and then flipped to text or hidden", () => {
    const el = input('<input type="password">');
    expect(isPasswordTypeInput(el)).toBe(true);
    el.setAttribute("type", "text");
    expect(isPasswordTypeInput(el)).toBe(true);
    el.setAttribute("type", "hidden");
    expect(isPasswordTypeInput(el)).toBe(true);
  });

  it("remembers a masked field from a focusin event after the mask is dropped", () => {
    const el = input('<input type="text" data-mask="disc">');
    el.addEventListener("focusin", rememberPasswordInput);
    el.dispatchEvent(new Event("focusin", { bubbles: true, composed: true }));
    el.setAttribute("data-mask", "none");
    expect(isPasswordTypeInput(el)).toBe(true);
    // The same state without the focus-time observation is a plain text input.
    expect(isPasswordTypeInput(input('<input type="text" data-mask="none">'))).toBe(false);
  });

  it("does not treat a plain text, search, or never-password hidden input as a password", () => {
    expect(isPasswordTypeInput(input('<input type="text">'))).toBe(false);
    expect(isPasswordTypeInput(input("<input>"))).toBe(false);
    expect(isPasswordTypeInput(input('<input type="search">'))).toBe(false);
    expect(isPasswordTypeInput(input('<input type="hidden" data-mask="disc">'))).toBe(false);
    expect(isPasswordTypeInput(input('<input type="checkbox" data-mask="disc">'))).toBe(false);
    expect(queryPasswordInputs(document)).toEqual([]);
  });

  it("does not treat a non-input element as a password field", () => {
    document.body.innerHTML = '<div data-mask="disc"></div>';
    expect(isPasswordTypeInput(document.querySelector("div") as Element)).toBe(false);
  });

  it("treats a throwing getComputedStyle as not masked", () => {
    vi.stubGlobal("getComputedStyle", () => {
      throw new Error("detached");
    });
    expect(isPasswordTypeInput(input('<input type="text">'))).toBe(false);
  });
});
