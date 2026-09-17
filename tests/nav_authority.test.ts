import { describe, expect, it } from "vitest";

import { grantsTabNavigationAuthority } from "../extension/src/content/nav_authority";

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
