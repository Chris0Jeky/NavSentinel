import { describe, expect, it } from "vitest";
import {
  computeNRS,
  nrsDecision,
  NRS_ALLOW_THRESHOLD,
  NRS_PROMPT_THRESHOLD,
  NRS_STRICT_BLOCK_THRESHOLD,
  type NavContext,
  type NrsResult,
} from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

function makeCds(cds: number, reasonCodes: string[] = []): ScoreResult {
  return { cds, reasonCodes };
}

function makeCtx(overrides: Partial<NavContext> = {}): NavContext {
  return {
    cds: makeCds(0),
    isNewTab: false,
    pageHost: "example.com",
    attemptsInGesture: 1,
    explicitNewTabIntent: false,
    allowlistedHosts: [],
    ...overrides,
  };
}

describe("computeNRS", () => {
  describe("baseline: NRS starts with CDS", () => {
    it("returns CDS value when no navigation factors apply", () => {
      const result = computeNRS(makeCtx({ cds: makeCds(42, ["retargeted_target_mismatch"]) }));
      expect(result.nrs).toBe(42);
      expect(result.cds).toBe(42);
      expect(result.reasonCodes).toContain("retargeted_target_mismatch");
    });

    it("preserves all CDS reason codes", () => {
      const cdsReasons = ["no_accessible_name", "overlay_large_interactive"];
      const result = computeNRS(makeCtx({ cds: makeCds(45, cdsReasons) }));
      for (const reason of cdsReasons) {
        expect(result.reasonCodes).toContain(reason);
      }
    });

    it("returns 0 for zero CDS with no factors", () => {
      const result = computeNRS(makeCtx());
      expect(result.nrs).toBe(0);
      expect(result.cds).toBe(0);
    });
  });

  describe("new tab factor (+20)", () => {
    it("adds 20 for new tab navigation", () => {
      const result = computeNRS(makeCtx({ isNewTab: true }));
      expect(result.nrs).toBe(20);
      expect(result.reasonCodes).toContain("nrs_new_tab");
    });

    it("does not add for same-tab navigation", () => {
      const result = computeNRS(makeCtx({ isNewTab: false }));
      expect(result.reasonCodes).not.toContain("nrs_new_tab");
    });
  });

  describe("cross-site factor (+20)", () => {
    it("adds 20 for cross-site destination", () => {
      const result = computeNRS(makeCtx({
        pageHost: "example.com",
        destinationUrl: "https://evil.com/phish",
      }));
      expect(result.nrs).toBe(20);
      expect(result.reasonCodes).toContain("nrs_cross_site");
    });

    it("does not add for same-site destination", () => {
      const result = computeNRS(makeCtx({
        pageHost: "example.com",
        destinationUrl: "https://www.example.com/page",
      }));
      expect(result.reasonCodes).not.toContain("nrs_cross_site");
    });

    it("does not add when destination is absent", () => {
      const result = computeNRS(makeCtx({ pageHost: "example.com" }));
      expect(result.reasonCodes).not.toContain("nrs_cross_site");
    });

    it("handles subdomain comparison correctly", () => {
      const result = computeNRS(makeCtx({
        pageHost: "sub.example.com",
        destinationUrl: "https://other.example.com/page",
      }));
      expect(result.reasonCodes).not.toContain("nrs_cross_site");
    });
  });

  describe("fast timing factor (+10)", () => {
    it("adds 10 for 0ms delta", () => {
      const result = computeNRS(makeCtx({ pointerdownDeltaMs: 0 }));
      expect(result.nrs).toBe(10);
      expect(result.reasonCodes).toContain("nrs_fast_timing");
    });

    it("adds 10 for 250ms delta", () => {
      const result = computeNRS(makeCtx({ pointerdownDeltaMs: 250 }));
      expect(result.nrs).toBe(10);
      expect(result.reasonCodes).toContain("nrs_fast_timing");
    });

    it("does not add for 251ms delta", () => {
      const result = computeNRS(makeCtx({ pointerdownDeltaMs: 251 }));
      expect(result.reasonCodes).not.toContain("nrs_fast_timing");
    });

    it("does not add when delta is undefined", () => {
      const result = computeNRS(makeCtx());
      expect(result.reasonCodes).not.toContain("nrs_fast_timing");
    });

    it("does not add for negative delta (stale)", () => {
      const result = computeNRS(makeCtx({ pointerdownDeltaMs: -1 }));
      expect(result.reasonCodes).not.toContain("nrs_fast_timing");
    });
  });

  describe("user activation factor (+5)", () => {
    it("adds 5 when user activation is active", () => {
      const result = computeNRS(makeCtx({ userActivationActive: true }));
      expect(result.nrs).toBe(5);
      expect(result.reasonCodes).toContain("nrs_user_activation");
    });

    it("does not add when user activation is false", () => {
      const result = computeNRS(makeCtx({ userActivationActive: false }));
      expect(result.reasonCodes).not.toContain("nrs_user_activation");
    });

    it("does not add when user activation is undefined", () => {
      const result = computeNRS(makeCtx());
      expect(result.reasonCodes).not.toContain("nrs_user_activation");
    });
  });

  describe("multi-attempt factor (+25)", () => {
    it("adds 25 for 2 attempts", () => {
      const result = computeNRS(makeCtx({ attemptsInGesture: 2 }));
      expect(result.nrs).toBe(25);
      expect(result.reasonCodes).toContain("nrs_multi_attempt");
    });

    it("adds 25 for 5 attempts", () => {
      const result = computeNRS(makeCtx({ attemptsInGesture: 5 }));
      expect(result.nrs).toBe(25);
      expect(result.reasonCodes).toContain("nrs_multi_attempt");
    });

    it("does not add for 1 attempt", () => {
      const result = computeNRS(makeCtx({ attemptsInGesture: 1 }));
      expect(result.reasonCodes).not.toContain("nrs_multi_attempt");
    });

    it("does not add for 0 attempts", () => {
      const result = computeNRS(makeCtx({ attemptsInGesture: 0 }));
      expect(result.reasonCodes).not.toContain("nrs_multi_attempt");
    });
  });

  describe("allowlist factor (-100)", () => {
    it("subtracts 100 when destination is allowlisted", () => {
      const result = computeNRS(makeCtx({
        cds: makeCds(60),
        isNewTab: true,
        destinationUrl: "https://trusted.com/page",
        allowlistedHosts: ["trusted.com"],
      }));
      // 60 + 20 (new tab) - 100 (allowlist) = 0 (clamped)
      expect(result.nrs).toBe(0);
      expect(result.reasonCodes).toContain("nrs_allowlisted");
    });

    it("does not subtract when destination is not allowlisted", () => {
      const result = computeNRS(makeCtx({
        destinationUrl: "https://evil.com/page",
        allowlistedHosts: ["trusted.com"],
      }));
      expect(result.reasonCodes).not.toContain("nrs_allowlisted");
    });

    it("matches by registrable domain, not exact host", () => {
      const result = computeNRS(makeCtx({
        destinationUrl: "https://sub.trusted.com/page",
        allowlistedHosts: ["trusted.com"],
      }));
      expect(result.reasonCodes).toContain("nrs_allowlisted");
    });

    it("does not apply when allowlist is empty", () => {
      const result = computeNRS(makeCtx({
        destinationUrl: "https://any.com/page",
        allowlistedHosts: [],
      }));
      expect(result.reasonCodes).not.toContain("nrs_allowlisted");
    });
  });

  describe("explicit new-tab intent factor (-30)", () => {
    it("subtracts 30 for explicit new-tab intent", () => {
      const result = computeNRS(makeCtx({
        isNewTab: true,
        explicitNewTabIntent: true,
      }));
      // 20 (new tab) - 30 (explicit) = 0 (clamped)
      expect(result.nrs).toBe(0);
      expect(result.reasonCodes).toContain("nrs_explicit_new_tab");
    });

    it("does not subtract when intent is not explicit", () => {
      const result = computeNRS(makeCtx({ explicitNewTabIntent: false }));
      expect(result.reasonCodes).not.toContain("nrs_explicit_new_tab");
    });
  });

  describe("floor clamping", () => {
    it("clamps NRS to 0 when factors go negative", () => {
      const result = computeNRS(makeCtx({
        cds: makeCds(0),
        explicitNewTabIntent: true,
      }));
      // 0 - 30 = -30, clamped to 0
      expect(result.nrs).toBe(0);
    });

    it("clamps when allowlist dominates", () => {
      const result = computeNRS(makeCtx({
        cds: makeCds(30),
        destinationUrl: "https://trusted.com/page",
        allowlistedHosts: ["trusted.com"],
      }));
      // 30 - 100 = -70, clamped to 0
      expect(result.nrs).toBe(0);
    });
  });

  describe("combined factors", () => {
    it("stacks all positive factors correctly", () => {
      const result = computeNRS(makeCtx({
        cds: makeCds(50),
        isNewTab: true,
        destinationUrl: "https://evil.com/phish",
        pageHost: "example.com",
        pointerdownDeltaMs: 100,
        userActivationActive: true,
        attemptsInGesture: 3,
      }));
      // 50 + 20 + 20 + 10 + 5 + 25 = 130
      expect(result.nrs).toBe(130);
    });

    it("positive and negative factors combine correctly", () => {
      const result = computeNRS(makeCtx({
        cds: makeCds(30),
        isNewTab: true,           // +20
        explicitNewTabIntent: true, // -30
        destinationUrl: "https://evil.com/phish",
        pageHost: "example.com",   // cross-site: +20
        pointerdownDeltaMs: 100,   // +10
      }));
      // 30 + 20 + 20 + 10 - 30 = 50
      expect(result.nrs).toBe(50);
    });

    it("allowlist overrides high-risk scenario", () => {
      const result = computeNRS(makeCtx({
        cds: makeCds(60),
        isNewTab: true,             // +20
        destinationUrl: "https://trusted.com/oauth",
        pageHost: "example.com",    // cross-site but allowlisted
        pointerdownDeltaMs: 50,     // +10
        userActivationActive: true, // +5
        allowlistedHosts: ["trusted.com"],
      }));
      // 60 + 20 + 20 + 10 + 5 - 100 = 15
      expect(result.nrs).toBe(15);
      expect(result.reasonCodes).toContain("nrs_allowlisted");
    });
  });

  describe("does not mutate input CDS reason codes", () => {
    it("original CDS reasons array is unchanged", () => {
      const originalReasons = ["no_accessible_name"];
      const cds = makeCds(15, originalReasons);
      computeNRS(makeCtx({ cds, isNewTab: true }));
      expect(originalReasons).toEqual(["no_accessible_name"]);
    });
  });
});

describe("nrsDecision", () => {
  describe("off mode", () => {
    it("always returns allow", () => {
      expect(nrsDecision(0, "off")).toBe("allow");
      expect(nrsDecision(100, "off")).toBe("allow");
      expect(nrsDecision(999, "off")).toBe("allow");
    });
  });

  describe("smart mode", () => {
    it("allows below 40", () => {
      expect(nrsDecision(0, "smart")).toBe("allow");
      expect(nrsDecision(39, "smart")).toBe("allow");
    });

    it("prompts at 40-69", () => {
      expect(nrsDecision(40, "smart")).toBe("prompt");
      expect(nrsDecision(55, "smart")).toBe("prompt");
      expect(nrsDecision(69, "smart")).toBe("prompt");
    });

    it("blocks at 70+", () => {
      expect(nrsDecision(70, "smart")).toBe("block");
      expect(nrsDecision(100, "smart")).toBe("block");
    });
  });

  describe("strict mode", () => {
    it("allows below 40", () => {
      expect(nrsDecision(0, "strict")).toBe("allow");
      expect(nrsDecision(39, "strict")).toBe("allow");
    });

    it("prompts at 40-49", () => {
      expect(nrsDecision(40, "strict")).toBe("prompt");
      expect(nrsDecision(49, "strict")).toBe("prompt");
    });

    it("blocks at 50+", () => {
      expect(nrsDecision(50, "strict")).toBe("block");
      expect(nrsDecision(69, "strict")).toBe("block");
      expect(nrsDecision(100, "strict")).toBe("block");
    });
  });

  describe("threshold constants match spec", () => {
    it("allow threshold is 40", () => {
      expect(NRS_ALLOW_THRESHOLD).toBe(40);
    });

    it("prompt/block threshold (smart) is 70", () => {
      expect(NRS_PROMPT_THRESHOLD).toBe(70);
    });

    it("strict block threshold is 50", () => {
      expect(NRS_STRICT_BLOCK_THRESHOLD).toBe(50);
    });
  });
});
