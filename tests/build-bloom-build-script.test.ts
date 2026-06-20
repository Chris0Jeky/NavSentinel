import { describe, expect, it } from "vitest";
// Importing the build script must NOT trigger its threat-feed fetch — main() is
// guarded to run only when invoked directly. (#322 / disc#12, disc#13)
import {
  assertFeedsProducedDomains,
  assertWithinBudget,
} from "../scripts/build-bloom-filter.mjs";

describe("build-bloom-filter build script: fail-closed guards (#322)", () => {
  // disc#12: the production builder must never silently ship a placeholder filter.
  it("assertFeedsProducedDomains throws when no domains were fetched", () => {
    expect(() => assertFeedsProducedDomains(0)).toThrow(/no domains/i);
  });

  it("assertFeedsProducedDomains throws on negative / non-integer counts", () => {
    expect(() => assertFeedsProducedDomains(-1)).toThrow();
    expect(() => assertFeedsProducedDomains(1.5)).toThrow();
    expect(() => assertFeedsProducedDomains(NaN)).toThrow();
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
});
