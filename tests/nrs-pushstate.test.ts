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

describe("NRS pushState abuse factor", () => {
  it("adds +20 when pushStateAbuse is true", () => {
    const result = computeNRS(baseCds(0), baseNav({ pushStateAbuse: true }));
    expect(result.nrs).toBe(20);
    expect(result.nrsFactors).toContain("nrs_pushstate_abuse");
    expect(result.reasonCodes).toContain("nrs_pushstate_abuse");
  });

  it("does not add factor when pushStateAbuse is false", () => {
    const result = computeNRS(baseCds(0), baseNav({ pushStateAbuse: false }));
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).not.toContain("nrs_pushstate_abuse");
  });

  it("does not add factor when pushStateAbuse is undefined", () => {
    const result = computeNRS(baseCds(0), baseNav());
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).not.toContain("nrs_pushstate_abuse");
  });

  it("pushState abuse alone is below block threshold", () => {
    const result = computeNRS(baseCds(0), baseNav({ pushStateAbuse: true }));
    expect(result.nrs).toBe(20);
    expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
  });

  it("pushState abuse reaches strict block threshold with moderate CDS", () => {
    const result = computeNRS(baseCds(30), baseNav({ pushStateAbuse: true }));
    expect(result.nrs).toBe(50);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
  });

  it("pushState abuse + cross-site + new tab reaches block threshold", () => {
    const result = computeNRS(
      baseCds(10),
      baseNav({
        pushStateAbuse: true,
        isCrossSite: true,
        isNewTabOrWindow: true,
      })
    );
    // 10 + 20 + 20 + 20 = 70
    expect(result.nrs).toBe(70);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
  });

  it("pushState abuse combines with double-click hijack", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({
        pushStateAbuse: true,
        doubleClickHijackActive: true,
      })
    );
    // 0 + 20 + 40 = 60
    expect(result.nrs).toBe(60);
    expect(result.nrsFactors).toContain("nrs_pushstate_abuse");
    expect(result.nrsFactors).toContain("nrs_double_click_hijack");
  });

  it("allowlist reduces pushState abuse score", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({ pushStateAbuse: true, destinationAllowlisted: true })
    );
    // 0 + 20 - 100 = -80 -> clamped to 0
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).toContain("nrs_pushstate_abuse");
    expect(result.nrsFactors).toContain("nrs_allowlisted");
  });

  it("pushState abuse combines with all other factors and applies diminishing returns", () => {
    const result = computeNRS(
      baseCds(5),
      baseNav({
        pushStateAbuse: true,
        isNewTabOrWindow: true,
        isCrossSite: true,
        timeSincePointerdownMs: 100,
        userActivationActive: true,
        multipleAttemptsInGesture: true,
      })
    );
    // Raw: 5 + 20 + 20 + 20 + 10 + 5 + 25 = 105
    // Diminishing returns: 100 + (105 - 100) * 0.5 = 102.5
    expect(result.nrs).toBe(102.5);
  });

  it("preserves CDS reasons alongside pushState abuse NRS factor", () => {
    const cdsReasons = ["no_accessible_name", "overlay_large_interactive"];
    const result = computeNRS(
      baseCds(30, cdsReasons),
      baseNav({ pushStateAbuse: true })
    );
    expect(result.reasonCodes).toContain("no_accessible_name");
    expect(result.reasonCodes).toContain("overlay_large_interactive");
    expect(result.reasonCodes).toContain("nrs_pushstate_abuse");
    expect(result.cds).toBe(30);
    expect(result.nrs).toBe(50);
  });
});
