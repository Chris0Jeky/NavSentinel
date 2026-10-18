import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { describe, it } from "vitest";
import { proceedDestinationUrl, waitForProceedDestination } from "./acceptance/proceed_destination";

const expected = "http://localhost:46200/acceptance/dest/NSACCTEST/landing.html?probe=NSACCTEST#frag-NSACCTEST";
function harness(initial = "") {
  let current = initial;
  let evaluated = 0;
  let predicate: ((url: URL) => boolean) | undefined;
  let complete!: () => void;
  let fail!: (error: Error) => void;
  let openerless = true;
  let fixtureOpener: string | undefined = "false";
  const pending = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  void pending.catch(() => undefined); // A predecessor may never install the wait.
  // This page contract models the documented pre-commit/initial-blank seam.
  // Real navigation and load ordering are tested separately in Playwright.
  const page = {
    url: () => current,
    waitForLoadState: async () => undefined,
    waitForURL: (matches: (url: URL) => boolean, options: unknown) => {
      assert.deepEqual(options, { waitUntil: "domcontentloaded", timeout: 5000 });
      predicate = matches;
      return pending;
    },
    evaluate: async () => { evaluated++; return { href: current, openerless, fixtureOpener }; },
  } as unknown as Page;
  return {
    page, get evaluated() { return evaluated; }, get predicate() { return predicate; },
    commit: (url: string) => { current = url; }, complete, fail,
    unsafe: () => { openerless = false; }, noFixture: () => { fixtureOpener = undefined; },
  };
}

describe("Proceed-once destination readiness (#1028)", () => {
  it("constructs the exact other-loopback path, query and fragment", () => {
    assert.equal(proceedDestinationUrl("http://127.0.0.1:46200/acceptance/held-blank.html", "NSACCTEST"), expected);
    assert.equal(new URL(proceedDestinationUrl(expected, "NSACCNEXT")).hostname, "127.0.0.1");
    assert.throws(() => proceedDestinationUrl("https://example.invalid/", "NSACCTEST"));
    assert.throws(() => proceedDestinationUrl("http://127.0.0.1/", "NSACC/ESCAPE"));
  });

  for (const initial of ["", "about:blank"]) {
    it(`does not evaluate an initially loaded ${initial || "empty-URL"} document`, async () => {
      const h = harness(initial);
      const result = waitForProceedDestination(h.page, expected);
      // Attach before flushing microtasks so a predecessor failure is retained.
      const outcome = result.then(() => "resolved", (error: unknown) => error);
      await Promise.resolve();
      assert.equal(h.evaluated, 0);
      assert.ok(h.predicate, "must install an exact destination wait instead of accepting initial load");
      assert.equal(h.predicate(new URL(expected)), true);
      for (const wrong of ["about:blank", expected.replace("localhost", "127.0.0.1"),
        expected.replace("landing.html", "other.html"), expected.replace("probe=NSACCTEST", "probe=OTHER"),
        expected.replace("#frag-NSACCTEST", "#other"), `${expected}extra`]) {
        assert.equal(h.predicate(new URL(wrong)), false, wrong);
      }
      h.commit(expected);
      await Promise.resolve();
      assert.equal(h.evaluated, 0, "commit alone is not DOMContentLoaded");
      h.complete();
      assert.equal(await outcome, "resolved");
      assert.equal(h.evaluated, 1);
    });
  }

  it("propagates a timed-out navigation without reading the old document", async () => {
    const h = harness("about:blank");
    const failure = new Error("navigation timeout");
    const result = waitForProceedDestination(h.page, expected);
    const rejected = assert.rejects(result, (error) => error === failure);
    h.fail(failure);
    await rejected;
    assert.equal(h.evaluated, 0);
  });

  for (const fault of ["wrong-url", "opener", "uninitialized-fixture"]) {
    it(`rejects ${fault} even after the navigation wait`, async () => {
      const h = harness(expected);
      if (fault === "wrong-url") h.commit(`${expected}extra`);
      if (fault === "opener") h.unsafe();
      if (fault === "uninitialized-fixture") h.noFixture();
      const result = waitForProceedDestination(h.page, expected);
      const rejected = assert.rejects(result);
      h.complete();
      await rejected;
    });
  }
});
