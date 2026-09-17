// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import {
  effectiveAnchorTarget,
  isBlankAnchorTarget,
  isImmediateWindowOpenTarget,
  isSameTabAnchorTarget,
  isTrustedModifiedAnchorGesture,
} from "../extension/src/content/modifier_navigation";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  window.name = "";
});

describe("modifier navigation target classification", () => {
  it("uses an anchor's own target, including an explicit empty target, before base", () => {
    document.head.innerHTML = '<base target="_blank">';
    const anchor = document.createElement("a");

    expect(effectiveAnchorTarget(anchor)).toBe("_blank");
    anchor.setAttribute("target", "");
    expect(effectiveAnchorTarget(anchor)).toBe("");
    anchor.setAttribute("target", "_self");
    expect(effectiveAnchorTarget(anchor)).toBe("_self");
  });

  it("distinguishes current-context targets from new or ancestor contexts", () => {
    window.name = "current-window";

    expect(isSameTabAnchorTarget("", true)).toBe(true);
    expect(isSameTabAnchorTarget("_self", true)).toBe(true);
    expect(isSameTabAnchorTarget("current-window", true)).toBe(true);
    expect(isSameTabAnchorTarget("_top", true)).toBe(true);
    expect(isSameTabAnchorTarget("_parent", true)).toBe(true);
    expect(isSameTabAnchorTarget("_top", false)).toBe(false);
    expect(isSameTabAnchorTarget("_parent", false)).toBe(false);
    expect(isSameTabAnchorTarget("_blank", true)).toBe(false);
    expect(isSameTabAnchorTarget("other-window", true)).toBe(false);
  });

  it("keeps window.open defaults separate from anchor current-context defaults", () => {
    window.name = "current-window";

    expect(isImmediateWindowOpenTarget(undefined)).toBe(true);
    expect(isImmediateWindowOpenTarget("")).toBe(true);
    expect(isImmediateWindowOpenTarget("_blank")).toBe(true);
    expect(isImmediateWindowOpenTarget("other-window")).toBe(true);
    expect(isImmediateWindowOpenTarget("_self")).toBe(false);
    expect(isImmediateWindowOpenTarget("current-window")).toBe(false);
  });

  it("treats malformed browser target text as a fresh-context anchor target", () => {
    expect(isBlankAnchorTarget("_BLANK")).toBe(true);
    expect(isBlankAnchorTarget("bad\nname")).toBe(true);
    expect(isBlankAnchorTarget("_self")).toBe(false);
  });

  it("does not accept a synthetic modifier event as trusted authority", () => {
    const event = new MouseEvent("click", { button: 0, ctrlKey: true });
    // happy-dom leaves this browser-owned property undefined. Model the real
    // synthetic-event value without manufacturing a trusted event.
    Object.defineProperty(event, "isTrusted", { value: false });
    expect(event.isTrusted).toBe(false);
    expect(isTrustedModifiedAnchorGesture(event)).toBe(false);
  });
});
