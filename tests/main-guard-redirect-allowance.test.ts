// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyIsolatedRedirectAllowance,
  armSameTaskRedirect,
  consumeRedirect,
  createRedirectAllowance,
  endSameTaskRedirect,
  type RedirectAllowanceLimits,
  type RedirectAllowanceState,
} from "../extension/src/content/main_guard_helpers";
import { formSubmitIntentUrl } from "../extension/src/content/nav_authority";

// #864: the MAIN world arms the form-submit allowance for a trusted click's own
// task; the isolated world's `ns-allow` grant stays the authority afterwards.
// These tests pin the invariant stated on RedirectAllowanceState: the same-task
// arm never grants more than the one-task-deferred submit already got.

const LIMITS: RedirectAllowanceLimits = { ttlMs: 1500, maxPerGesture: 2, maxPendingFollowUps: 8 };
const TOP = { restrict: false, target: "" };
const A = "https://example.test/a";
const B = "https://example.test/b";

function isolatedGrant(
  state: RedirectAllowanceState,
  now: number,
  scope = TOP,
  gestureTs?: number,
): void {
  applyIsolatedRedirectAllowance(
    state,
    now,
    { allowRedirect: true, ...scope, ...(gestureTs !== undefined ? { gestureTs } : {}) },
    LIMITS,
  );
}

/** A trusted click the isolated world allowed: this world arms it in-task. */
function click(state: RedirectAllowanceState, now: number, scope = TOP, gestureTs = now): void {
  armSameTaskRedirect(state, now, gestureTs, scope, LIMITS);
}

const NO_ACTION = Symbol("no action url");

/** Try `times` submissions to `url` (NO_ACTION = an unresolvable action). */
function spend(state: RedirectAllowanceState, now: number, target: string | typeof NO_ACTION = A, times = 1): number {
  const url = target === NO_ACTION ? undefined : target;
  let allowed = 0;
  for (let i = 0; i < times; i += 1) if (consumeRedirect(state, now, url, LIMITS)) allowed += 1;
  return allowed;
}

describe("isolated grant alone (behaviour before #864, unchanged)", () => {
  it("allows two redirects per grant inside the TTL, then refuses", () => {
    const s = createRedirectAllowance();
    expect(spend(s, 0)).toBe(0);
    isolatedGrant(s, 100);
    expect(spend(s, 200, A, 3)).toBe(2);
  });

  it("refuses after the grant expires", () => {
    const s = createRedirectAllowance();
    isolatedGrant(s, 100);
    expect(spend(s, 1600)).toBe(1);
    expect(spend(s, 1601)).toBe(0);
  });

  it("binds a restricted grant to its exact target, and an empty target to nothing", () => {
    const s = createRedirectAllowance();
    isolatedGrant(s, 0, { restrict: true, target: A });
    expect(spend(s, 1, B)).toBe(0);
    expect(spend(s, 1, NO_ACTION)).toBe(0);
    expect(spend(s, 1, A)).toBe(1);
    isolatedGrant(s, 2, { restrict: true, target: "" });
    expect(spend(s, 3, "")).toBe(0);
    expect(spend(s, 3, A)).toBe(0);
  });

  it("restarts the budget on every grant that follows no armed click", () => {
    const s = createRedirectAllowance();
    isolatedGrant(s, 0, TOP, 0);
    expect(spend(s, 1, A, 2)).toBe(2);
    isolatedGrant(s, 10); // e.g. the rollback grant, which carries no gestureTs
    expect(spend(s, 11, A, 3)).toBe(2);
  });

  it("a grant without allowRedirect closes the window", () => {
    const s = createRedirectAllowance();
    applyIsolatedRedirectAllowance(s, 0, { allowRedirect: false, ...TOP }, LIMITS);
    expect(spend(s, 1)).toBe(0);
  });
});

describe("same-task arm (#864)", () => {
  it("allows a submit inside the trusted click's own task, before the grant arrives", () => {
    const s = createRedirectAllowance();
    click(s, 0);
    expect(spend(s, 0)).toBe(1);
  });

  it("allows nothing once the task has ended if the isolated grant never arrives", () => {
    const s = createRedirectAllowance();
    click(s, 0);
    endSameTaskRedirect(s);
    expect(spend(s, 1)).toBe(0);
  });

  it("is bounded by the grant lifetime even if the end-of-task timer never ran", () => {
    const s = createRedirectAllowance();
    click(s, 0);
    expect(spend(s, 1501)).toBe(0);
  });

  it("shares one gesture budget with its follow-up grant", () => {
    const s = createRedirectAllowance();
    click(s, 0);
    expect(spend(s, 0, A, 2)).toBe(2);
    endSameTaskRedirect(s);
    isolatedGrant(s, 5, TOP, 0);
    expect(spend(s, 6)).toBe(0);
  });

  it("keeps the shared budget when the follow-up is delayed past the TTL (busy main thread)", () => {
    const s = createRedirectAllowance();
    click(s, 0);
    expect(spend(s, 0, A, 2)).toBe(2);
    endSameTaskRedirect(s);
    isolatedGrant(s, 5000, TOP, 0);
    expect(spend(s, 5001)).toBe(0);
  });

  it("spends the same total as the deferred-only path for one click", () => {
    // Deferred only (before #864): the grant arrives, then three submits.
    const deferred = createRedirectAllowance();
    isolatedGrant(deferred, 5, TOP, 0);
    const deferredTotal = spend(deferred, 6, A, 3);
    // Same-task arm: one submit in the task, two after the grant.
    const armed = createRedirectAllowance();
    click(armed, 0);
    let armedTotal = spend(armed, 0);
    endSameTaskRedirect(armed);
    isolatedGrant(armed, 5, TOP, 0);
    armedTotal += spend(armed, 6, A, 2);
    expect(armedTotal).toBe(deferredTotal);
    expect(armedTotal).toBe(2);
  });

  it("gives each of two quick clicks one budget, even when both grants arrive late", () => {
    const s = createRedirectAllowance();
    click(s, 0);
    let total = spend(s, 0, A, 3);
    endSameTaskRedirect(s);
    click(s, 10);
    total += spend(s, 10, A, 3);
    endSameTaskRedirect(s);
    isolatedGrant(s, 20, TOP, 0);
    isolatedGrant(s, 21, TOP, 10);
    total += spend(s, 22, A, 3);
    expect(total).toBe(4);
  });

  it("restarts the budget for a grant whose click this world never armed", () => {
    const s = createRedirectAllowance();
    click(s, 0);
    expect(spend(s, 0, A, 2)).toBe(2);
    endSameTaskRedirect(s);
    isolatedGrant(s, 5, TOP, 99);
    expect(spend(s, 6, A, 3)).toBe(2);
  });

  it("drops armed clicks older than the one a grant follows up (their grant never came)", () => {
    const s = createRedirectAllowance();
    click(s, 0);
    endSameTaskRedirect(s);
    click(s, 10);
    endSameTaskRedirect(s);
    isolatedGrant(s, 20, TOP, 10);
    expect(s.pendingFollowUps).toEqual([]);
  });

  it("bounds the remembered follow-ups", () => {
    const s = createRedirectAllowance();
    for (let i = 0; i < 20; i += 1) click(s, i);
    expect(s.pendingFollowUps).toHaveLength(LIMITS.maxPendingFollowUps);
  });

  it("keeps a restricted (child-frame isolated grant) scope to the declared action, and an empty target to nothing", () => {
    const declared = createRedirectAllowance();
    click(declared, 0, { restrict: true, target: A });
    expect(spend(declared, 0, B)).toBe(0);
    expect(spend(declared, 0, NO_ACTION)).toBe(0);
    expect(spend(declared, 0, A)).toBe(1);

    const bare = createRedirectAllowance();
    click(bare, 0, { restrict: true, target: "" });
    expect(spend(bare, 0, A)).toBe(0);
    expect(spend(bare, 0, "")).toBe(0);
  });

  it("never exceeds the per-click budget across interleaved clicks, grants and lost grants", () => {
    // Deterministic pseudo-random schedules. A click is either one this world
    // armed or one it never saw; its grant arrives later in click order, or is
    // lost. Whatever the interleaving, the allowed total stays within what the
    // deferred-only path grants: maxPerGesture per click.
    let seed = 864;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 300; run += 1) {
      const s = createRedirectAllowance();
      let now = 0;
      let clicks = 0;
      let allowed = 0;
      const awaitingGrant: number[] = [];
      for (let step = 0; step < 50; step += 1) {
        now += 1 + Math.floor(next() * 600);
        const roll = next();
        if (roll < 0.25) {
          clicks += 1;
          endSameTaskRedirect(s);
          if (next() < 0.8) click(s, now);
          if (next() < 0.9) awaitingGrant.push(now);
        } else if (roll < 0.45 && awaitingGrant.length > 0) {
          endSameTaskRedirect(s);
          isolatedGrant(s, now, TOP, awaitingGrant.shift());
        } else if (consumeRedirect(s, now, A, LIMITS)) {
          allowed += 1;
        }
      }
      expect(allowed).toBeLessThanOrEqual(clicks * LIMITS.maxPerGesture);
    }
  });
});

describe("formSubmitIntentUrl (the isolated world's declared-action resolver)", () => {
  const base = "https://example.test/page";
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function clickTarget(html: string, selector: string): Element {
    document.body.innerHTML = html;
    return document.querySelector(selector)!;
  }

  it("resolves the form action for a default submit button, including clicks on its content", () => {
    const target = clickTarget(`<form action="/go"><button><span id="t">Go</span></button></form>`, "#t");
    expect(formSubmitIntentUrl(target, base)).toBe("https://example.test/go");
  });

  it("prefers the submitter formaction, and treats an empty one as this document", () => {
    expect(formSubmitIntentUrl(
      clickTarget(`<form action="/go"><input type="submit" id="t" formaction="/other"></form>`, "#t"),
      base,
    )).toBe("https://example.test/other");
    expect(formSubmitIntentUrl(
      clickTarget(`<form action="/go"><button id="t" formaction="">Go</button></form>`, "#t"),
      base,
    )).toBe(base);
  });

  it("declares nothing for non-submit controls, bare elements, or controls outside a form", () => {
    expect(formSubmitIntentUrl(clickTarget(`<form action="/go"><button type="button" id="t">x</button></form>`, "#t"), base)).toBeNull();
    expect(formSubmitIntentUrl(clickTarget(`<form action="/go"><button type="reset" id="t">x</button></form>`, "#t"), base)).toBeNull();
    expect(formSubmitIntentUrl(clickTarget(`<div id="t" role="button">x</div>`, "#t"), base)).toBeNull();
    expect(formSubmitIntentUrl(clickTarget(`<button id="t">x</button>`, "#t"), base)).toBeNull();
    expect(formSubmitIntentUrl(null, base)).toBeNull();
  });
});
