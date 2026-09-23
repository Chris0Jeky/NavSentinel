// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  findSubmitControl,
  grantsTabNavigationAuthority,
} from "../extension/src/content/nav_authority";

const base = {
  isTopFrame: true,
  isTrustedInput: true,
  mode: "smart" as const,
  hasInFrameNavigationIntent: false,
};

describe("grantsTabNavigationAuthority (#593)", () => {
  it("keeps top-frame trusted clicks unchanged, with or without a declared destination", () => {
    expect(grantsTabNavigationAuthority(base)).toBe(true);
    expect(grantsTabNavigationAuthority({ ...base, hasInFrameNavigationIntent: true })).toBe(true);
  });

  it("denies a child-frame trusted click that declares no in-frame destination", () => {
    expect(grantsTabNavigationAuthority({ ...base, isTopFrame: false })).toBe(false);
  });

  it("grants a child-frame trusted click that declares an in-frame destination", () => {
    expect(
      grantsTabNavigationAuthority({
        ...base,
        isTopFrame: false,
        hasInFrameNavigationIntent: true,
      }),
    ).toBe(true);
  });

  it("never grants authority to synthetic input in an enforcing mode", () => {
    for (const mode of ["smart", "strict"] as const) {
      for (const isTopFrame of [true, false]) {
        for (const hasInFrameNavigationIntent of [true, false]) {
          expect(
            grantsTabNavigationAuthority({
              mode,
              isTopFrame,
              isTrustedInput: false,
              hasInFrameNavigationIntent,
            }),
          ).toBe(false);
        }
      }
    }
  });

  it("preserves the off-mode no-intervention contract in every frame", () => {
    for (const isTopFrame of [true, false]) {
      for (const isTrustedInput of [true, false]) {
        expect(
          grantsTabNavigationAuthority({
            mode: "off",
            isTopFrame,
            isTrustedInput,
            hasInFrameNavigationIntent: false,
          }),
        ).toBe(true);
      }
    }
  });

  it("applies the same rule in strict mode as in smart mode", () => {
    expect(
      grantsTabNavigationAuthority({ ...base, mode: "strict", isTopFrame: false }),
    ).toBe(false);
    expect(
      grantsTabNavigationAuthority({
        ...base,
        mode: "strict",
        isTopFrame: false,
        hasInFrameNavigationIntent: true,
      }),
    ).toBe(true);
  });
});

describe("findSubmitControl (#820)", () => {
  function target(html: string, selector: string): Element | null {
    document.body.innerHTML = html;
    return document.querySelector(selector);
  }

  it("finds a button with missing, empty, or submit type", () => {
    expect(findSubmitControl(target("<button>x</button>", "button"))).not.toBe(null);
    expect(findSubmitControl(target('<button type="submit">x</button>', "button"))).not.toBe(null);
    expect(findSubmitControl(target('<button type="">x</button>', "button"))).not.toBe(null);
    // Invalid enumerated values default to submit, in the browser and here.
    expect(findSubmitControl(target('<button type="button ">x</button>', "button"))).not.toBe(null);
  });

  it("finds submit/image inputs, matching the keyword case-insensitively", () => {
    expect(findSubmitControl(target('<input type="submit">', "input"))).not.toBe(null);
    expect(findSubmitControl(target('<input type="SUBMIT">', "input"))).not.toBe(null);
    expect(findSubmitControl(target('<input type="image">', "input"))).not.toBe(null);
    expect(findSubmitControl(target('<input type="IMAGE">', "input"))).not.toBe(null);
  });

  it("rejects button/reset buttons in any letter case", () => {
    expect(findSubmitControl(target('<button type="button">x</button>', "button"))).toBe(null);
    expect(findSubmitControl(target('<button type="BUTTON">x</button>', "button"))).toBe(null);
    expect(findSubmitControl(target('<button type="Reset">x</button>', "button"))).toBe(null);
  });

  it("rejects non-submit inputs and bare elements", () => {
    expect(findSubmitControl(target('<input type="text">', "input"))).toBe(null);
    expect(findSubmitControl(target('<input type="button">', "input"))).toBe(null);
    expect(findSubmitControl(target("<input>", "input"))).toBe(null);
    expect(findSubmitControl(target("<div>x</div>", "div"))).toBe(null);
    expect(findSubmitControl(null)).toBe(null);
  });

  it("resolves through descendants of a submit control", () => {
    const inner = target('<button type="submit"><span>x</span></button>', "span")!;
    expect(findSubmitControl(inner)?.tagName).toBe("BUTTON");
  });

  it("stops at the innermost control instead of continuing outward", () => {
    // Activation behavior targets the innermost control: a click on the text
    // field never submits via the outer button, so no intent is granted.
    document.body.innerHTML =
      '<button type="submit">outer<input type="text" id="inner"></button>';
    const inner = document.querySelector("#inner")!;
    expect(findSubmitControl(inner)).toBe(null);
  });
});
