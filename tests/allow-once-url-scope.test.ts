import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The MAIN-world one-shot open allowance must be bound to the authorized URL.
 * Unbound (count + TTL only), the first `window.open` inside the 1200 ms
 * window consumes it regardless of destination, so a page racing opens can
 * ride a user's Allow-once click for a different URL — and the SW rollback
 * path never sees fresh-tab commits (`!prevUrl` early return), leaving the
 * MAIN prompt as the only gate. (#851)
 *
 * Source-level structural suite in the #389/#847 style: `main_guard` has
 * import-time side effects and is never imported by unit tests (see the
 * bridge-race model note). Fails against the pre-fix source, where
 * `setAllowOnce()`/`consumeOpenAllowance()` took no URL and both call sites
 * were bare.
 */
describe("allow-once open allowance is URL-bound (#851)", () => {
  const guard = readFileSync(
    resolve("extension/src/content/main_guard.ts"),
    "utf8",
  );
  const isolated = readFileSync(
    resolve("extension/src/content/capture_isolated.ts"),
    "utf8",
  );

  it("stores the authorized URL when the allowance is granted", () => {
    expect(guard).toContain("function setAllowOnce(url?: string)");
    expect(guard).toContain("let allowOnceUrl = ");
    const setStart = guard.indexOf("function setAllowOnce(");
    const setRegion = guard.slice(setStart, setStart + 400);
    expect(setRegion).toContain("allowOnceUrl = ");
  });

  it("consumes the allowance only on an exact URL match", () => {
    const start = guard.indexOf("function consumeOpenAllowance(");
    const end = guard.indexOf("function consumePopupIntentAllowance(");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const region = guard.slice(start, end);
    expect(region).toContain("url?: string | URL");
    expect(region).toContain("String(url) === allowOnceUrl");
    // The decrement must be gated by the match: a mismatched open neither
    // consumes nor burns the allowance.
    expect(region.indexOf("allowOnceUrl")).toBeLessThan(
      region.indexOf("allowOnceRemaining -= 1"),
    );
  });

  it("passes the attempted URL from the open interceptor", () => {
    expect(guard).toContain("const allowance = consumeOpenAllowance(url);");
  });

  it("coerces url, target and features once, before any check or the native open", () => {
    // An object argument whose toString() (or toLowerCase()) answers one way
    // for the checks and another way for the native call must not pass the
    // allow-once or subframe self-target checks and then open elsewhere: every
    // later use must see the single coerced string.
    const start = guard.indexOf("function patchedOpen(");
    const end = guard.indexOf("function resolveFormAction(");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const region = guard.slice(start, end);
    const urlAt = region.indexOf("const url = rawUrl === undefined ? undefined : `${rawUrl}`;");
    const targetAt = region.indexOf("const target = rawTarget === undefined ? undefined : `${rawTarget}`;");
    const featuresAt = region.indexOf("const features = rawFeatures === undefined ? undefined : `${rawFeatures}`;");
    expect(urlAt).toBeGreaterThanOrEqual(0);
    expect(targetAt).toBeGreaterThan(urlAt);
    expect(featuresAt).toBeGreaterThan(targetAt);
    expect(featuresAt).toBeLessThan(region.indexOf("isSubframeSelfTarget(target)"));
    expect(featuresAt).toBeLessThan(region.indexOf("consumeOpenAllowance(url)"));
    const afterCoercion = region.slice(region.indexOf("\n", featuresAt));
    expect(afterCoercion).not.toMatch(/\braw(Url|Target|Features)\b/);
  });

  it("passes the authorized URL from the bridge handler", () => {
    const handlerAt = guard.indexOf('if (data.type === "ns-allow-once")');
    expect(handlerAt).toBeGreaterThanOrEqual(0);
    const region = guard.slice(handlerAt, handlerAt + 300);
    expect(region).toContain("setAllowOnce(");
    expect(region).toContain("data.url");
  });

  it("sends the authorized URL from the isolated allow path", () => {
    expect(isolated).toContain('postToMain("ns-allow-once", { url });');
  });
});
