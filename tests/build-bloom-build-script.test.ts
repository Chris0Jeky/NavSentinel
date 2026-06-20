import { describe, expect, it, vi } from "vitest";
// Importing the build script must NOT trigger its threat-feed fetch — main() is
// guarded to run only when invoked directly. (#322 / disc#12, disc#13)
import {
  assertFeedsProducedDomains,
  assertWithinBudget,
  optimalParams,
} from "../scripts/build-bloom-filter.mjs";

describe("build-bloom-filter build script: fail-closed guards (#322)", () => {
  // disc#12: the production builder must never silently ship a placeholder filter.
  it("assertFeedsProducedDomains throws when no domains were fetched", () => {
    expect(() => assertFeedsProducedDomains(0)).toThrow(/no domains/i);
  });

  it("assertFeedsProducedDomains throws on negative / non-integer counts", () => {
    expect(() => assertFeedsProducedDomains(-1)).toThrow(/no domains/i);
    expect(() => assertFeedsProducedDomains(1.5)).toThrow(/no domains/i);
    expect(() => assertFeedsProducedDomains(NaN)).toThrow(/no domains/i);
  });

  it("assertFeedsProducedDomains passes for a real, non-empty feed result", () => {
    expect(() => assertFeedsProducedDomains(50_000)).not.toThrow();
  });

  // disc#13: fail closed on size-budget overflow instead of writing an oversized artifact.
  it("assertWithinBudget throws when the filter exceeds the budget", () => {
    expect(() => assertWithinBudget(200 * 1024, 150 * 1024)).toThrow(/exceeds budget/i);
  });

  it("assertWithinBudget passes at or under the budget", () => {
    expect(() => assertWithinBudget(150 * 1024, 150 * 1024)).not.toThrow();
    expect(() => assertWithinBudget(120 * 1024, 150 * 1024)).not.toThrow();
  });

  // #14: optimalParams must fail closed on a non-finite / out-of-range false-positive
  // rate (a misconfigured TARGET_FP_RATE) rather than emit Infinity/NaN/<=0 bit counts
  // that would build a corrupt or absurdly sized filter binary.
  it("optimalParams throws on a false-positive rate outside (0,1)", () => {
    expect(() => optimalParams(1000, 0)).toThrow(/false-positive rate/i);
    expect(() => optimalParams(1000, 1)).toThrow(/false-positive rate/i);
    expect(() => optimalParams(1000, -0.5)).toThrow(/false-positive rate/i);
    expect(() => optimalParams(1000, 2)).toThrow(/false-positive rate/i);
    expect(() => optimalParams(1000, NaN)).toThrow(/false-positive rate/i);
    expect(() => optimalParams(1000, Infinity)).toThrow(/false-positive rate/i);
  });

  it("optimalParams throws on a non-finite element count", () => {
    expect(() => optimalParams(NaN, 0.0001)).toThrow(/finite/i);
    expect(() => optimalParams(Infinity, 0.0001)).toThrow(/finite/i);
  });

  it("optimalParams returns finite, sane m/k for valid inputs", () => {
    const { m, k } = optimalParams(50_000, 0.0001);
    expect(Number.isFinite(m)).toBe(true);
    expect(Number.isFinite(k)).toBe(true);
    expect(m).toBeGreaterThan(0);
    expect(k).toBeGreaterThanOrEqual(1);
    // Empty set still yields the minimal filter (preserved behavior).
    expect(optimalParams(0, 0.0001)).toEqual({ m: 8, k: 1 });
  });

  // Enforce the main-guard contract: a future refactor that removed it would make
  // importing this module fire live threat-feed fetches during `npm test`.
  it("importing the module does not trigger a network fetch (main-guard)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 200 }),
    );
    vi.resetModules();
    await import("../scripts/build-bloom-filter.mjs");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
