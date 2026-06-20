import { describe, expect, it, vi } from "vitest";
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
