import { describe, expect, it } from "vitest";
import {
  applyIsolatedRedirectAllowance, armSameTaskRedirect, consumeRedirect,
  createRedirectAllowance, exhaustRedirectAllowance,
} from "../extension/src/content/main_guard_helpers";

const limits = { ttlMs: 1500, maxPerGesture: 2, maxPendingFollowUps: 8 };
const A = "https://declared.example/a";
const B = "https://replay.example/b";
const top = { restrict: false, target: "" };
const scoped = { restrict: true, target: A };

describe("retire redirect authority before child replay (#936)", () => {
  for (const scope of [top, scoped]) {
    it(`exhausts an existing ${scope.restrict ? "URL-bound" : "unrestricted"} grant even for an unrelated replay`, () => {
      const state = createRedirectAllowance();
      applyIsolatedRedirectAllowance(state, 100, { ...scope, allowRedirect: true }, limits);
      if (scope.restrict) expect(consumeRedirect(state, 101, B, limits)).toBe(false);
      exhaustRedirectAllowance(state, limits);
      expect(consumeRedirect(state, 102, A, limits)).toBe(false);
      expect(consumeRedirect(state, 102, B, limits)).toBe(false);
    });
  }

  it("does not let an armed click's deferred follow-up renew the exhausted budget", () => {
    const state = createRedirectAllowance();
    armSameTaskRedirect(state, 100, 23, top, limits);
    exhaustRedirectAllowance(state, limits);
    expect(consumeRedirect(state, 101, A, limits)).toBe(false);
    applyIsolatedRedirectAllowance(state, 102, { ...top, allowRedirect: true, gestureTs: 23 }, limits);
    expect(consumeRedirect(state, 103, A, limits)).toBe(false);
  });

  it("allows a genuinely fresh click after the replay to start a new budget", () => {
    const state = createRedirectAllowance();
    armSameTaskRedirect(state, 100, 23, top, limits);
    exhaustRedirectAllowance(state, limits);
    applyIsolatedRedirectAllowance(state, 102, { ...top, allowRedirect: true, gestureTs: 23 }, limits);
    armSameTaskRedirect(state, 200, 24, top, limits);
    expect(consumeRedirect(state, 201, A, limits)).toBe(true);
    applyIsolatedRedirectAllowance(state, 202, { ...top, allowRedirect: true, gestureTs: 24 }, limits);
    expect(consumeRedirect(state, 203, A, limits)).toBe(true);
    expect(consumeRedirect(state, 203, A, limits)).toBe(false);
  });

  it("is idempotent without a grant and does not create navigation authority", () => {
    const state = createRedirectAllowance();
    exhaustRedirectAllowance(state, limits);
    exhaustRedirectAllowance(state, limits);
    expect(consumeRedirect(state, 1, A, limits)).toBe(false);
    expect(state.until).toBe(0);
    expect(state.pendingFollowUps).toEqual([]);
  });
});
