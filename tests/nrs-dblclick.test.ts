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

describe("NRS double-click hijack factor", () => {
  it("adds +40 when doubleClickHijackActive is true", () => {
    const result = computeNRS(baseCds(0), baseNav({ doubleClickHijackActive: true }));
    expect(result.nrs).toBe(40);
    expect(result.nrsFactors).toContain("nrs_double_click_hijack");
    expect(result.reasonCodes).toContain("nrs_double_click_hijack");
  });

  it("does not add factor when doubleClickHijackActive is false", () => {
    const result = computeNRS(baseCds(0), baseNav({ doubleClickHijackActive: false }));
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).not.toContain("nrs_double_click_hijack");
  });

  it("does not add factor when doubleClickHijackActive is undefined", () => {
    const result = computeNRS(baseCds(0), baseNav());
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).not.toContain("nrs_double_click_hijack");
  });

  it("double-click hijack alone puts NRS at prompt threshold (40)", () => {
    const result = computeNRS(baseCds(0), baseNav({ doubleClickHijackActive: true }));
    expect(result.nrs).toBe(40);
    expect(result.nrs).toBeGreaterThanOrEqual(40);
    expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
  });

  it("double-click hijack reaches strict block threshold with minimal CDS", () => {
    const result = computeNRS(baseCds(10), baseNav({ doubleClickHijackActive: true }));
    expect(result.nrs).toBe(50);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
  });

  it("double-click hijack + new tab reaches block threshold", () => {
    const result = computeNRS(
      baseCds(10),
      baseNav({ doubleClickHijackActive: true, isNewTabOrWindow: true })
    );
    // 10 + 40 + 20 = 70
    expect(result.nrs).toBe(70);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
  });

  it("double-click hijack + cross-site reaches block threshold", () => {
    const result = computeNRS(
      baseCds(10),
      baseNav({ doubleClickHijackActive: true, isCrossSite: true })
    );
    // 10 + 40 + 20 = 70
    expect(result.nrs).toBe(70);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
  });

  it("double-click hijack combines with all other factors", () => {
    const result = computeNRS(
      baseCds(5),
      baseNav({
        doubleClickHijackActive: true,
        isNewTabOrWindow: true,
        isCrossSite: true,
        timeSincePointerdownMs: 100,
        userActivationActive: true,
        multipleAttemptsInGesture: true,
      })
    );
    // 5 + 40 + 20 + 20 + 10 + 5 + 25 = 125
    expect(result.nrs).toBe(125);
  });

  it("allowlist reduces double-click hijack score", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({ doubleClickHijackActive: true, destinationAllowlisted: true })
    );
    // 0 + 40 - 100 = -60 -> clamped to 0
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).toContain("nrs_double_click_hijack");
    expect(result.nrsFactors).toContain("nrs_allowlisted");
  });

  it("allowlist clamps hijack + additional factors to zero", () => {
    const result = computeNRS(
      baseCds(20),
      baseNav({
        doubleClickHijackActive: true,
        isNewTabOrWindow: true,
        isCrossSite: true,
        destinationAllowlisted: true,
      })
    );
    // 20 + 40 + 20 + 20 - 100 = 0 (clamped)
    expect(result.nrs).toBe(0);
  });

  it("double-click hijack factor is ordered before allowlist in factors list", () => {
    const result = computeNRS(
      baseCds(30),
      baseNav({
        doubleClickHijackActive: true,
        destinationAllowlisted: true,
      })
    );
    const hijackIndex = result.nrsFactors.indexOf("nrs_double_click_hijack");
    const allowlistIndex = result.nrsFactors.indexOf("nrs_allowlisted");
    expect(hijackIndex).toBeGreaterThanOrEqual(0);
    expect(allowlistIndex).toBeGreaterThanOrEqual(0);
    expect(hijackIndex).toBeLessThan(allowlistIndex);
  });

  it("preserves CDS reasons alongside double-click hijack NRS factor", () => {
    const cdsReasons = ["no_accessible_name", "overlay_large_interactive"];
    const result = computeNRS(
      baseCds(45, cdsReasons),
      baseNav({ doubleClickHijackActive: true })
    );
    expect(result.reasonCodes).toContain("no_accessible_name");
    expect(result.reasonCodes).toContain("overlay_large_interactive");
    expect(result.reasonCodes).toContain("nrs_double_click_hijack");
    expect(result.cds).toBe(45);
    expect(result.nrs).toBe(85);
  });
});
