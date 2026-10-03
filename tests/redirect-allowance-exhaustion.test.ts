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

describe("child replay retires gestures whose bridge grants have not arrived (#936)", () => {
  it("rejects an unobserved child click's late grant and its duplicate", () => {
    const state = createRedirectAllowance();
    exhaustRedirectAllowance(state, limits, 30);
    for (let delivery = 0; delivery < 2; delivery += 1) {
      applyIsolatedRedirectAllowance(state, 100 + delivery, { ...scoped, allowRedirect: true, gestureTs: 23 }, limits);
      expect(consumeRedirect(state, 102, A, limits)).toBe(false);
    }
  });

  it("does not rearm a top click when the document listener is reached after replay", () => {
    const state = createRedirectAllowance();
    exhaustRedirectAllowance(state, limits, 30);
    armSameTaskRedirect(state, 101, 23, top, limits);
    expect(consumeRedirect(state, 102, A, limits)).toBe(false);
    applyIsolatedRedirectAllowance(state, 103, { ...top, allowRedirect: true, gestureTs: 23 }, limits);
    expect(consumeRedirect(state, 104, A, limits)).toBe(false);
  });

  it("fails closed when timestamp precision cannot distinguish a retired click", () => {
    const state = createRedirectAllowance();
    exhaustRedirectAllowance(state, limits, 23);
    armSameTaskRedirect(state, 101, 23, top, limits);
    applyIsolatedRedirectAllowance(state, 102, { ...top, allowRedirect: true, gestureTs: 23 }, limits);
    expect(consumeRedirect(state, 103, A, limits)).toBe(false);
  });

  it("permits a fresh child click but ignores an older delayed grant without resetting its budget", () => {
    const state = createRedirectAllowance();
    exhaustRedirectAllowance(state, limits, 30);
    applyIsolatedRedirectAllowance(state, 200, { ...scoped, allowRedirect: true, gestureTs: 31 }, limits);
    expect(consumeRedirect(state, 201, A, limits)).toBe(true);
    applyIsolatedRedirectAllowance(state, 202, { ...top, allowRedirect: true, gestureTs: 23 }, limits);
    expect(consumeRedirect(state, 203, B, limits)).toBe(false);
    expect(consumeRedirect(state, 203, A, limits)).toBe(true);
    expect(consumeRedirect(state, 204, A, limits)).toBe(false);
  });

  it("keeps a monotonic retirement boundary across repeated replays", () => {
    const state = createRedirectAllowance();
    exhaustRedirectAllowance(state, limits, 30);
    exhaustRedirectAllowance(state, limits, 20);
    applyIsolatedRedirectAllowance(state, 200, { ...scoped, allowRedirect: true, gestureTs: 25 }, limits);
    expect(consumeRedirect(state, 201, A, limits)).toBe(false);
  });

  it("keeps explicit independent grants and genuinely later top clicks usable", () => {
    const state = createRedirectAllowance();
    exhaustRedirectAllowance(state, limits, 30);
    applyIsolatedRedirectAllowance(state, 200, { ...scoped, allowRedirect: true }, limits);
    expect(consumeRedirect(state, 201, A, limits)).toBe(true);
    exhaustRedirectAllowance(state, limits, 35);
    armSameTaskRedirect(state, 300, 36, top, limits);
    expect(consumeRedirect(state, 301, B, limits)).toBe(true);
    applyIsolatedRedirectAllowance(state, 302, { ...top, allowRedirect: true, gestureTs: 36 }, limits);
    expect(consumeRedirect(state, 303, B, limits)).toBe(true);
    expect(consumeRedirect(state, 304, B, limits)).toBe(false);
  });
});
