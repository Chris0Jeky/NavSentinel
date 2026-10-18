import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  handlePushStateBridgeMessage,
  isPushStateAbuseActive,
  getPushStateAbuseUrl,
  _resetPushStateState,
} from "../extension/src/content/pushstate_guard";

describe("pushstate_guard", () => {
  beforeEach(() => {
    _resetPushStateState();
  });

  describe("handlePushStateBridgeMessage", () => {
    it("handles ns-pushstate-suspicious messages", () => {
      const handled = handlePushStateBridgeMessage("ns-pushstate-suspicious", {
        ts: Date.now(),
        url: "/accounts.chase.com/login",
        method: "pushState",
        reason: "domain_like_path_after_gesture",
      });
      expect(handled).toBe(true);
    });

    it("ignores unrelated message types", () => {
      const handled = handlePushStateBridgeMessage("ns-nav-blocked", {});
      expect(handled).toBe(false);
    });

    it("ignores ns-clipboard-write messages", () => {
      const handled = handlePushStateBridgeMessage("ns-clipboard-write", {});
      expect(handled).toBe(false);
    });
  });

  describe("isPushStateAbuseActive", () => {
    it("returns false when no abuse detected", () => {
      expect(isPushStateAbuseActive()).toBe(false);
    });

    it("returns true after suspicious message received", () => {
      handlePushStateBridgeMessage("ns-pushstate-suspicious", {
        ts: Date.now(),
        url: "/accounts.chase.com/login",
        reason: "domain_like_path_after_gesture",
      });
      expect(isPushStateAbuseActive()).toBe(true);
    });

    it("does not let a stale producer timestamp expire a fresh receipt", () => {
      const oldTs = Date.now() - 11_000;
      handlePushStateBridgeMessage("ns-pushstate-suspicious", {
        ts: oldTs,
        url: "/accounts.chase.com/login",
      });
      expect(isPushStateAbuseActive()).toBe(true);
    });

    it("returns false after reset", () => {
      handlePushStateBridgeMessage("ns-pushstate-suspicious", {
        ts: Date.now(),
        url: "/test",
      });
      _resetPushStateState();
      expect(isPushStateAbuseActive()).toBe(false);
    });
  });

  describe("getPushStateAbuseUrl", () => {
    it("returns empty string when no abuse detected", () => {
      expect(getPushStateAbuseUrl()).toBe("");
    });

    it("returns the URL from the suspicious pushState call", () => {
      handlePushStateBridgeMessage("ns-pushstate-suspicious", {
        ts: Date.now(),
        url: "/accounts.chase.com/secure/login",
      });
      expect(getPushStateAbuseUrl()).toBe("/accounts.chase.com/secure/login");
    });

    it("returns empty string after reset", () => {
      handlePushStateBridgeMessage("ns-pushstate-suspicious", {
        ts: Date.now(),
        url: "/test",
      });
      _resetPushStateState();
      expect(getPushStateAbuseUrl()).toBe("");
    });
  });
});

/**
 * The MAIN-world history interceptors must coerce their URL argument exactly
 * once, up front. Coercing a second time in `checkPushStateSuspicious` or the
 * telemetry post lets a stateful `toString` commit one path in the native
 * call while the detector sees another (#891).
 *
 * Source-level structural suite in the #389/#847 style: `main_guard` has
 * import-time side effects. This suite fails against the pre-fix source, where
 * the interceptors passed the raw argument to the native call and `String(url)`
 * ran again in the detector and the telemetry post.
 */
describe("main_guard pushState single coercion (#891)", () => {
  const guard = readFileSync(
    resolve("extension/src/content/main_guard.ts"),
    "utf8",
  );
  const COERCE_LINE =
    "const url = rawUrl === undefined || rawUrl === null ? rawUrl : `${rawUrl}`;";

  const regions = [
    {
      name: "patchedPushState",
      nativeCall: "nativePushState.call(this, data, unused, url)",
      checkCall: 'checkPushStateSuspicious(url, "pushState")',
      startMarker: "const patchedPushState = function (",
      endMarker: "const patchedReplaceState = function (",
    },
    {
      name: "patchedReplaceState",
      nativeCall: "nativeReplaceState.call(this, data, unused, url)",
      checkCall: 'checkPushStateSuspicious(url, "replaceState")',
      startMarker: "const patchedReplaceState = function (",
      endMarker: 'softPatchProto(History.prototype, "pushState"',
    },
  ];

  for (const { name, nativeCall, checkCall, startMarker, endMarker } of regions) {
    it(`${name} coerces its URL argument exactly once, before the native call`, () => {
      const start = guard.indexOf(startMarker);
      const end = guard.indexOf(endMarker);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const region = guard.slice(start, end);
      expect(region).toContain("rawUrl?: string | URL | null");
      const coerceAt = region.indexOf(COERCE_LINE);
      expect(coerceAt).toBeGreaterThanOrEqual(0);
      // The single coerced value feeds the native call, the detector, and the
      // telemetry post: every later use must see the same string.
      expect(coerceAt).toBeLessThan(region.indexOf(nativeCall));
      expect(coerceAt).toBeLessThan(region.indexOf(checkCall));
      const afterCoercion = region.slice(region.indexOf("\n", coerceAt));
      expect(afterCoercion).not.toMatch(/\brawUrl\b/);
      expect(afterCoercion).not.toContain("String(");
    });
  }

  it("checkPushStateSuspicious takes the already-coerced string and never re-coerces", () => {
    const start = guard.indexOf("function checkPushStateSuspicious(");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = guard.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    const region = guard.slice(start, end);
    expect(region).toContain("url: string | null | undefined");
    expect(region).not.toContain("String(");
  });
});
