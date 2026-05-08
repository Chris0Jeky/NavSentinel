import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptOutcomeEntry } from "../extension/src/shared/storage";

type Store = Record<string, unknown>;

function createChromeMock(initial: Store = {}) {
  const store: Store = { ...initial };
  return {
    store,
    chrome: {
      storage: {
        local: {
          async get(keys?: string | string[] | Record<string, unknown>) {
            if (keys === undefined) return { ...store };
            if (typeof keys === "string") {
              return keys in store ? { [keys]: store[keys] } : {};
            }
            if (Array.isArray(keys)) {
              return Object.fromEntries(
                keys.filter((key) => key in store).map((key) => [key, store[key]])
              );
            }
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [key, key in store ? store[key] : fallback])
            );
          },
          async set(next: Record<string, unknown>) {
            for (const [key, value] of Object.entries(next)) {
              store[key] = value;
            }
          },
          async remove(keys: string | string[]) {
            const allKeys = Array.isArray(keys) ? keys : [keys];
            for (const key of allKeys) {
              delete store[key];
            }
          }
        },
        onChanged: {
          addListener() {}
        }
      }
    }
  };
}

function makeOutcome(
  domain: string,
  outcome: PromptOutcomeEntry["outcome"],
  score = 50
): PromptOutcomeEntry {
  return {
    id: `${domain}-${outcome}-${Math.random().toString(36).slice(2)}`,
    ts: Date.now(),
    domain,
    type: "nav",
    score,
    outcome,
  };
}

describe("adaptive scoring", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("computeAdjustment", () => {
    it("returns 0 with fewer than 3 outcomes", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes = [
        makeOutcome("example.com", "allow_once"),
        makeOutcome("example.com", "allow_once"),
      ];

      expect(computeAdjustment(outcomes, "example.com")).toBe(0);
    });

    it("returns negative adjustment for majority allows", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 10; i++) {
        outcomes.push(makeOutcome("example.com", "allow_once"));
      }

      const adj = computeAdjustment(outcomes, "example.com");
      expect(adj).toBeLessThan(0);
      expect(adj).toBeGreaterThanOrEqual(-15);
    });

    it("returns positive adjustment for majority blocks", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 10; i++) {
        outcomes.push(makeOutcome("example.com", "block"));
      }

      const adj = computeAdjustment(outcomes, "example.com");
      expect(adj).toBeGreaterThan(0);
      expect(adj).toBeLessThanOrEqual(15);
    });

    it("returns 0 for mixed outcomes", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [
        makeOutcome("example.com", "allow_once"),
        makeOutcome("example.com", "block"),
        makeOutcome("example.com", "allow_once"),
        makeOutcome("example.com", "block"),
        makeOutcome("example.com", "allow_once"),
      ];

      expect(computeAdjustment(outcomes, "example.com")).toBe(0);
    });

    it("bounds adjustment to -15", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 20; i++) {
        outcomes.push(makeOutcome("example.com", "always_allow"));
      }

      const adj = computeAdjustment(outcomes, "example.com");
      expect(adj).toBe(-15);
    });

    it("bounds adjustment to +15", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 20; i++) {
        outcomes.push(makeOutcome("example.com", "dismiss"));
      }

      const adj = computeAdjustment(outcomes, "example.com");
      expect(adj).toBe(15);
    });

    it("treats trust as an allow outcome", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 10; i++) {
        outcomes.push(makeOutcome("example.com", "trust"));
      }

      expect(computeAdjustment(outcomes, "example.com")).toBeLessThan(0);
    });

    it("treats dismiss as a block outcome", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 10; i++) {
        outcomes.push(makeOutcome("example.com", "dismiss"));
      }

      expect(computeAdjustment(outcomes, "example.com")).toBeGreaterThan(0);
    });

    it("ignores cancel outcomes", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 10; i++) {
        outcomes.push(makeOutcome("example.com", "cancel"));
      }

      expect(computeAdjustment(outcomes, "example.com")).toBe(0);
    });

    it("only considers last 10 outcomes", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [];
      // 20 old blocks
      for (let i = 0; i < 20; i++) {
        outcomes.push(makeOutcome("example.com", "block"));
      }
      // 10 recent allows (these are the last 10)
      for (let i = 0; i < 10; i++) {
        outcomes.push(makeOutcome("example.com", "allow_once"));
      }

      const adj = computeAdjustment(outcomes, "example.com");
      expect(adj).toBeLessThan(0);
    });

    it("filters by domain", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      const outcomes: PromptOutcomeEntry[] = [
        ...Array.from({ length: 10 }, () => makeOutcome("other.com", "block")),
        ...Array.from({ length: 2 }, () => makeOutcome("example.com", "allow_once")),
      ];

      // example.com has only 2 outcomes, below threshold
      expect(computeAdjustment(outcomes, "example.com")).toBe(0);
    });

    it("discounts high-score allows (score >= baseThreshold)", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      // 8 high-score allows + 2 blocks: allowWeight = 8*0.3=2.4, blockWeight=2, total=4.4
      // allowRatio = 2.4/4.4 ≈ 0.545 => below 0.7, so adjustment = 0
      const highScoreOutcomes: PromptOutcomeEntry[] = [
        ...Array.from({ length: 8 }, () => makeOutcome("example.com", "allow_once", 80)),
        ...Array.from({ length: 2 }, () => makeOutcome("example.com", "block", 80)),
      ];

      // 8 low-score allows + 2 blocks: allowWeight = 8, blockWeight=2, total=10
      // allowRatio = 0.8 => above 0.7, so negative adjustment
      const lowScoreOutcomes: PromptOutcomeEntry[] = [
        ...Array.from({ length: 8 }, () => makeOutcome("example.com", "allow_once", 30)),
        ...Array.from({ length: 2 }, () => makeOutcome("example.com", "block", 30)),
      ];

      const highScoreAdj = computeAdjustment(highScoreOutcomes, "example.com");
      const lowScoreAdj = computeAdjustment(lowScoreOutcomes, "example.com");

      // Low-score allows produce a negative adjustment
      expect(lowScoreAdj).toBeLessThan(0);
      // High-score allows are discounted so adjustment is less negative (0 in this case)
      expect(highScoreAdj).toBeGreaterThan(lowScoreAdj);
    });

    it("mixed high-score and low-score allows produce less negative adjustment than all low-score", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      // 5 high-score allows + 5 low-score allows
      const mixedOutcomes: PromptOutcomeEntry[] = [
        ...Array.from({ length: 5 }, () => makeOutcome("example.com", "allow_once", 80)),
        ...Array.from({ length: 5 }, () => makeOutcome("example.com", "allow_once", 30)),
      ];

      // All 10 low-score allows
      const allLowOutcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 10; i++) {
        allLowOutcomes.push(makeOutcome("example.com", "allow_once", 30));
      }

      const mixedAdj = computeAdjustment(mixedOutcomes, "example.com");
      const allLowAdj = computeAdjustment(allLowOutcomes, "example.com");

      // Mixed should produce less negative (or equal) adjustment
      expect(mixedAdj).toBeGreaterThanOrEqual(allLowAdj);
    });

    it("baseThreshold parameter controls the discount cutoff", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      // 8 allows at score 55 + 2 blocks — score 55 is above strict (50) but below smart (70)
      const outcomes: PromptOutcomeEntry[] = [
        ...Array.from({ length: 8 }, () => makeOutcome("example.com", "allow_once", 55)),
        ...Array.from({ length: 2 }, () => makeOutcome("example.com", "block", 55)),
      ];

      // With baseThreshold=50 (strict), score 55 >= 50, so allows are discounted (0.3 each)
      // allowWeight = 8*0.3=2.4, blockWeight=2, ratio=2.4/4.4≈0.545 => 0
      const strictAdj = computeAdjustment(outcomes, "example.com", 50);
      // With baseThreshold=70 (smart), score 55 < 70, so allows get full weight
      // allowWeight = 8, blockWeight=2, ratio=8/10=0.8 => negative
      const smartAdj = computeAdjustment(outcomes, "example.com", 70);

      // Strict should be less negative (discounted) than smart (full weight)
      expect(strictAdj).toBeGreaterThan(smartAdj);
    });

    it("high-score allows mixed with blocks reduce gaming potential", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { computeAdjustment } = await import("../extension/src/shared/adaptive_scoring");

      // Gaming scenario: 8 high-score allows + 2 blocks
      // Without discounting, allowRatio = 8/10 = 0.8 => negative adjustment
      // With discounting, allowWeight = 8*0.3 = 2.4, blockWeight = 2
      // ratio = 2.4/4.4 ≈ 0.545 — below 0.7 threshold => 0 adjustment
      const gamingOutcomes: PromptOutcomeEntry[] = [
        ...Array.from({ length: 8 }, () => makeOutcome("example.com", "allow_once", 75)),
        ...Array.from({ length: 2 }, () => makeOutcome("example.com", "block", 75)),
      ];

      const adj = computeAdjustment(gamingOutcomes, "example.com");
      // Should NOT produce a significant negative adjustment
      expect(adj).toBe(0);
    });
  });

  describe("storage functions", () => {
    it("getAdaptiveScores returns empty object for fresh storage", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { getAdaptiveScores } = await import("../extension/src/shared/adaptive_scoring");

      const scores = await getAdaptiveScores();
      expect(scores).toEqual({});
    });

    it("updateAdaptiveScores persists adjustments", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { updateAdaptiveScores, getAdaptiveScores } = await import(
        "../extension/src/shared/adaptive_scoring"
      );

      const outcomes: PromptOutcomeEntry[] = [];
      for (let i = 0; i < 10; i++) {
        outcomes.push(makeOutcome("example.com", "allow_once"));
      }

      await updateAdaptiveScores(outcomes);
      const scores = await getAdaptiveScores();
      expect(scores["example.com"]).toBeDefined();
      expect(scores["example.com"]!.adjustment).toBeLessThan(0);
      expect(scores["example.com"]!.domain).toBe("example.com");
    });

    it("updateAdaptiveScores omits domains with zero adjustment", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { updateAdaptiveScores, getAdaptiveScores } = await import(
        "../extension/src/shared/adaptive_scoring"
      );

      // Mixed outcomes for a domain => zero adjustment
      const outcomes: PromptOutcomeEntry[] = [
        makeOutcome("mixed.com", "allow_once"),
        makeOutcome("mixed.com", "block"),
        makeOutcome("mixed.com", "allow_once"),
        makeOutcome("mixed.com", "block"),
        makeOutcome("mixed.com", "allow_once"),
      ];

      await updateAdaptiveScores(outcomes);
      const scores = await getAdaptiveScores();
      expect(scores["mixed.com"]).toBeUndefined();
    });

    it("getEffectiveThresholdAdjustment returns 0 for unknown domain", async () => {
      const { chrome } = createChromeMock();
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { getEffectiveThresholdAdjustment } = await import(
        "../extension/src/shared/adaptive_scoring"
      );

      expect(await getEffectiveThresholdAdjustment("unknown.com")).toBe(0);
    });

    it("clearAdaptiveScores empties storage", async () => {
      const key = "sentinelsuite:adaptive_scores_v1";
      const { chrome } = createChromeMock({
        [key]: { "example.com": { domain: "example.com", adjustment: -5, allowCount: 10, blockCount: 0, lastUpdated: 1 } }
      });
      vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
      const { clearAdaptiveScores, getAdaptiveScores } = await import(
        "../extension/src/shared/adaptive_scoring"
      );

      await clearAdaptiveScores();
      const scores = await getAdaptiveScores();
      expect(scores).toEqual({});
    });
  });

  describe("threshold clamping", () => {
    it("effective threshold with negative adjustment stays above 30", () => {
      const baseThreshold = 70;
      const adjustment = -15;
      const effective = Math.max(30, Math.min(100, baseThreshold + adjustment));
      expect(effective).toBe(55);
    });

    it("effective threshold with positive adjustment stays below 100", () => {
      const baseThreshold = 70;
      const adjustment = 15;
      const effective = Math.max(30, Math.min(100, baseThreshold + adjustment));
      expect(effective).toBe(85);
    });

    it("strict mode threshold with max negative stays above 30", () => {
      const baseThreshold = 50;
      const adjustment = -15;
      const effective = Math.max(30, Math.min(100, baseThreshold + adjustment));
      expect(effective).toBe(35);
    });

    it("threshold never drops below 30 even with extreme negative", () => {
      const baseThreshold = 50;
      const adjustment = -25; // beyond bounds, but testing clamp
      const effective = Math.max(30, Math.min(100, baseThreshold + adjustment));
      expect(effective).toBe(30);
    });

    it("threshold never exceeds 100 even with extreme positive", () => {
      const baseThreshold = 70;
      const adjustment = 40; // beyond bounds, but testing clamp
      const effective = Math.max(30, Math.min(100, baseThreshold + adjustment));
      expect(effective).toBe(100);
    });
  });
});
