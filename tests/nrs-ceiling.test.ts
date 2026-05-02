import { describe, expect, it } from "vitest";
import {
  computeNRS,
  NRS_BLOCK_THRESHOLD,
  NRS_STRICT_BLOCK_THRESHOLD,
} from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

function baseCds(cds = 0, reasonCodes: string[] = []): ScoreResult {
  return { cds, reasonCodes };
}

function baseNav(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return {
    isNewTabOrWindow: false,
    isCrossSite: false,
    ...overrides,
  };
}

describe("NRS diminishing returns ceiling", () => {
  it("raw score of 130 becomes 115 after diminishing returns", () => {
    const result = computeNRS(baseCds(130), baseNav());
    // 100 + (130 - 100) * 0.5 = 115
    expect(result.nrs).toBe(115);
  });

  it("raw score of 200 becomes 150 after diminishing returns", () => {
    const result = computeNRS(baseCds(200), baseNav());
    // 100 + (200 - 100) * 0.5 = 150
    expect(result.nrs).toBe(150);
  });

  it("score at exactly 100 stays at 100", () => {
    const result = computeNRS(baseCds(100), baseNav());
    expect(result.nrs).toBe(100);
  });

  it("score below 100 is unaffected", () => {
    const result = computeNRS(baseCds(80), baseNav());
    expect(result.nrs).toBe(80);
  });

  it("score of 0 is unaffected", () => {
    const result = computeNRS(baseCds(0), baseNav());
    expect(result.nrs).toBe(0);
  });

  it("compound scenario: known_bad + dblclick + cross_site + new_tab = 130 raw -> 115", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({
        knownBadDomain: true,          // +50
        doubleClickHijackActive: true, // +40
        isCrossSite: true,             // +20
        isNewTabOrWindow: true,        // +20
      })
    );
    // Raw: 0 + 50 + 40 + 20 + 20 = 130
    // Diminishing returns: 100 + (130 - 100) * 0.5 = 115
    expect(result.nrs).toBe(115);
  });

  it("compound scenario with openerAllowed: 130 - 20 = 110 raw -> 105", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({
        knownBadDomain: true,                // +50
        doubleClickHijackActive: true,       // +40
        isCrossSite: true,                   // +20
        isNewTabOrWindow: true,              // +20
        openerWindowPreviouslyAllowed: true, // -20
      })
    );
    // Raw: 0 + 50 + 40 + 20 + 20 - 20 = 110
    // Diminishing returns: 100 + (110 - 100) * 0.5 = 105
    expect(result.nrs).toBe(105);
  });

  it("allowlist still dominates: compound positives + allowlist brings score down", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({
        knownBadDomain: true,          // +50
        doubleClickHijackActive: true, // +40
        isCrossSite: true,             // +20
        isNewTabOrWindow: true,        // +20
        destinationAllowlisted: true,  // -100
      })
    );
    // Raw: 0 + 50 + 40 + 20 + 20 - 100 = 30
    // Below 100, no diminishing returns
    expect(result.nrs).toBe(30);
    expect(result.nrs).toBeLessThan(NRS_STRICT_BLOCK_THRESHOLD);
  });

  it("floor at 0 still works after diminishing returns", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({ destinationAllowlisted: true })
    );
    // Raw: 0 - 100 = -100, clamped to 0
    expect(result.nrs).toBe(0);
  });

  it("existing thresholds (70, 50) still make sense with the new math", () => {
    // A score of 70 (block threshold) is below 100, so unaffected
    const blockResult = computeNRS(
      baseCds(30),
      baseNav({ isNewTabOrWindow: true, isCrossSite: true })
    );
    expect(blockResult.nrs).toBe(70);
    expect(blockResult.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);

    // A score of 50 (strict block threshold) is below 100, so unaffected
    const strictResult = computeNRS(
      baseCds(10),
      baseNav({ isNewTabOrWindow: true, isCrossSite: true })
    );
    expect(strictResult.nrs).toBe(50);
    expect(strictResult.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
    expect(strictResult.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
  });
});

describe("NRS openerWindowPreviouslyAllowed factor", () => {
  it("reduces score by 20 when openerWindowPreviouslyAllowed is true", () => {
    const result = computeNRS(
      baseCds(60),
      baseNav({ openerWindowPreviouslyAllowed: true })
    );
    // 60 - 20 = 40
    expect(result.nrs).toBe(40);
    expect(result.nrsFactors).toContain("nrs_opener_previously_allowed");
    expect(result.reasonCodes).toContain("nrs_opener_previously_allowed");
  });

  it("does not apply when openerWindowPreviouslyAllowed is false", () => {
    const result = computeNRS(
      baseCds(60),
      baseNav({ openerWindowPreviouslyAllowed: false })
    );
    expect(result.nrs).toBe(60);
    expect(result.nrsFactors).not.toContain("nrs_opener_previously_allowed");
  });

  it("does not apply when openerWindowPreviouslyAllowed is undefined", () => {
    const result = computeNRS(baseCds(60), baseNav());
    expect(result.nrs).toBe(60);
    expect(result.nrsFactors).not.toContain("nrs_opener_previously_allowed");
  });

  it("combined with other mitigations, clamps to 0", () => {
    const result = computeNRS(
      baseCds(10),
      baseNav({
        openerWindowPreviouslyAllowed: true, // -20
        explicitNewTabIntent: true,          // -30
      })
    );
    // 10 - 20 - 30 = -40 -> clamped to 0
    expect(result.nrs).toBe(0);
  });

  it("can push score below block threshold", () => {
    const result = computeNRS(
      baseCds(30),
      baseNav({
        isNewTabOrWindow: true,              // +20
        isCrossSite: true,                   // +20
        openerWindowPreviouslyAllowed: true, // -20
      })
    );
    // 30 + 20 + 20 - 20 = 50
    expect(result.nrs).toBe(50);
    expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
  });
});
