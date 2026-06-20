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

  it("optimalParams throws on a non-finite element count (NaN, ±Infinity)", () => {
    expect(() => optimalParams(NaN, 0.0001)).toThrow(/finite/i);
    expect(() => optimalParams(Infinity, 0.0001)).toThrow(/finite/i);
    expect(() => optimalParams(-Infinity, 0.0001)).toThrow(/finite/i);
  });

  it("optimalParams pins m/k to the known-good range for valid inputs (formula guard)", () => {
    // n=50,000, p=0.0001: m = ceil(-n·ln p / ln(2)^2) ≈ 958k bits, k = round(m/n·ln2) = 13.
    // Range-pinning (not just finiteness) catches a wrong formula — swapped numerator/
    // denominator, a dropped ceil, or log10 vs ln — that would still be finite & positive.
    const { m, k } = optimalParams(50_000, 0.0001);
    expect(m).toBeGreaterThan(900_000);
    expect(m).toBeLessThan(1_100_000);
    expect(k).toBeGreaterThanOrEqual(10);
    expect(k).toBeLessThanOrEqual(20);
  });

  it("optimalParams treats n<=0 (including negative finite n) as the minimal filter", () => {
    // Empty/degenerate set yields the minimal sentinel; negative finite n is finite, so it
    // passes the throw guard and intentionally falls through to this same path.
    expect(optimalParams(0, 0.0001)).toEqual({ m: 8, k: 1 });
    expect(optimalParams(-1, 0.0001)).toEqual({ m: 8, k: 1 });
    expect(optimalParams(-100, 0.0001)).toEqual({ m: 8, k: 1 });
  });

  it("a huge-but-valid n flows through to an assertWithinBudget rejection (fail-closed chain)", () => {
    // 200k domains at p=0.0001 -> ~3.8M bits -> ~468 KB, far over the 150 KB budget. The
    // p-guard accepts the valid rate; the size backstop is what rejects the oversized filter.
    const { m } = optimalParams(200_000, 0.0001);
    const filterSizeBytes = 16 + Math.ceil(m / 8); // HEADER_SIZE + bitset bytes
    expect(() => assertWithinBudget(filterSizeBytes, 150 * 1024)).toThrow(/exceeds budget/i);
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
