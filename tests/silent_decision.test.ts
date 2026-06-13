import { describe, expect, it } from "vitest";
import {
  isSilentNavCandidate,
  isDocumentNavigationHref,
  silentNavThrottleAllows,
  type SilentNavThrottleState,
} from "../extension/src/content/silent_decision";

const base = {
  mode: "smart" as const,
  isTopFrame: true,
  hasAnchor: true,
  isDocumentNavigation: true,
  isBlankAnchor: false,
  isSameTabAnchor: true,
};

describe("isSilentNavCandidate (#236)", () => {
  it("accepts a real top-frame same-tab navigation in smart mode", () => {
    expect(isSilentNavCandidate(base)).toBe(true);
  });

  it("accepts a real top-frame _blank navigation", () => {
    expect(isSilentNavCandidate({ ...base, isSameTabAnchor: false, isBlankAnchor: true })).toBe(true);
  });

  it("accepts in strict mode", () => {
    expect(isSilentNavCandidate({ ...base, mode: "strict" })).toBe(true);
  });

  it("rejects off mode (no decision was made)", () => {
    expect(isSilentNavCandidate({ ...base, mode: "off" })).toBe(false);
  });

  it("rejects non-top frames (avoids per-iframe duplication)", () => {
    expect(isSilentNavCandidate({ ...base, isTopFrame: false })).toBe(false);
  });

  it("rejects non-anchor clicks (buttons, text, arbitrary elements)", () => {
    expect(isSilentNavCandidate({ ...base, hasAnchor: false })).toBe(false);
  });

  it("rejects a non-document navigation (fragment jump / pseudo-scheme link)", () => {
    expect(isSilentNavCandidate({ ...base, isDocumentNavigation: false })).toBe(false);
  });

  it("rejects an anchor that is neither _blank nor same-tab", () => {
    expect(isSilentNavCandidate({ ...base, isBlankAnchor: false, isSameTabAnchor: false })).toBe(false);
  });
});

describe("isDocumentNavigationHref (#236)", () => {
  const here = "https://example.com/page";

  it("accepts a real cross-document navigation", () => {
    expect(isDocumentNavigationHref("https://other.com/x", "other.com", here)).toBe(true);
    expect(isDocumentNavigationHref("https://example.com/page2", "example.com", here)).toBe(true);
  });

  it("treats a query-string change on the same path as a navigation", () => {
    expect(isDocumentNavigationHref("https://example.com/page?x=1", "example.com", here)).toBe(true);
  });

  it("rejects a same-document fragment jump (#section)", () => {
    expect(isDocumentNavigationHref("https://example.com/page#section", "example.com", here)).toBe(false);
  });

  it("rejects a fragment jump when the current URL already has a hash", () => {
    expect(
      isDocumentNavigationHref("https://example.com/page#b", "example.com", "https://example.com/page#a")
    ).toBe(false);
  });

  it("rejects pseudo-scheme links with no host (javascript:/mailto:/data:)", () => {
    expect(isDocumentNavigationHref("javascript:void(0)", "", here)).toBe(false);
    expect(isDocumentNavigationHref("mailto:a@b.com", "", here)).toBe(false);
    expect(isDocumentNavigationHref("data:text/html,x", "", here)).toBe(false);
  });

  it("rejects null/empty href or host", () => {
    expect(isDocumentNavigationHref(null, "example.com", here)).toBe(false);
    expect(isDocumentNavigationHref("", "example.com", here)).toBe(false);
    expect(isDocumentNavigationHref("https://x.com/", null, here)).toBe(false);
    expect(isDocumentNavigationHref(undefined, undefined, here)).toBe(false);
  });
});

describe("silentNavThrottleAllows (#236)", () => {
  it("allows the first emission and records state", () => {
    const state: SilentNavThrottleState = { key: "", at: 0 };
    expect(silentNavThrottleAllows(state, "example.com", 1000, 10000)).toBe(true);
    expect(state).toEqual({ key: "example.com", at: 1000 });
  });

  it("suppresses an immediate repeat of the same destination within the window", () => {
    const state: SilentNavThrottleState = { key: "", at: 0 };
    silentNavThrottleAllows(state, "example.com", 1000, 10000);
    expect(silentNavThrottleAllows(state, "example.com", 5000, 10000)).toBe(false);
    // A suppressed call must NOT advance the timer, or a steady click stream
    // every 9s would never emit.
    expect(state).toEqual({ key: "example.com", at: 1000 });
  });

  it("allows the same destination again after the window elapses", () => {
    const state: SilentNavThrottleState = { key: "", at: 0 };
    silentNavThrottleAllows(state, "example.com", 1000, 10000);
    expect(silentNavThrottleAllows(state, "example.com", 11001, 10000)).toBe(true);
    expect(state.at).toBe(11001);
  });

  it("allows a different destination immediately (interleaved distinct navs are real data)", () => {
    const state: SilentNavThrottleState = { key: "", at: 0 };
    silentNavThrottleAllows(state, "a.com", 1000, 10000);
    expect(silentNavThrottleAllows(state, "b.com", 1001, 10000)).toBe(true);
    expect(state).toEqual({ key: "b.com", at: 1001 });
  });

  it("uses a half-open window boundary (exactly windowMs later is allowed)", () => {
    const state: SilentNavThrottleState = { key: "x", at: 1000 };
    // now - at === windowMs → not < windowMs → allowed.
    expect(silentNavThrottleAllows(state, "x", 11000, 10000)).toBe(true);
  });
});
