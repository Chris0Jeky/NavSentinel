import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { murmurhash3_32 } from "../extension/src/shared/reputation";
import { computeAdjustment } from "../extension/src/shared/adaptive_scoring";
import type { PromptOutcomeEntry } from "../extension/src/shared/storage";

describe("murmurhash3_32 properties", () => {
  it("is deterministic: same key + seed produces same hash", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer(), (key, seed) => {
        expect(murmurhash3_32(key, seed)).toBe(murmurhash3_32(key, seed));
      })
    );
  });

  it("returns a 32-bit unsigned integer (0 to 2^32-1)", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer(), (key, seed) => {
        const h = murmurhash3_32(key, seed);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
        expect(Number.isInteger(h)).toBe(true);
      })
    );
  });

  it("different seeds usually produce different hashes for the same key", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 10001, max: 20000 }),
        (key, seed1, seed2) => {
          const h1 = murmurhash3_32(key, seed1);
          const h2 = murmurhash3_32(key, seed2);
          expect(h1 !== h2 || seed1 === seed2).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("empty string returns a valid hash for any seed", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const h = murmurhash3_32("", seed);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
      })
    );
  });

  it("hash changes when key is modified (avalanche)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 0, max: 49 }),
        fc.integer(),
        (key, posRaw, seed) => {
          const pos = posRaw % key.length;
          const charCode = key.charCodeAt(pos);
          const flipped = String.fromCharCode(charCode ^ 1);
          const modified = key.slice(0, pos) + flipped + key.slice(pos + 1);
          if (modified !== key) {
            expect(murmurhash3_32(key, seed)).not.toBe(murmurhash3_32(modified, seed));
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

const arbOutcome = fc.constantFrom(
  "allow", "allow_once", "always_allow", "block", "trust", "dismiss", "cancel"
) as fc.Arbitrary<PromptOutcomeEntry["outcome"]>;

function makeOutcome(outcome: PromptOutcomeEntry["outcome"], score = 30): PromptOutcomeEntry {
  return {
    id: "test",
    ts: Date.now(),
    domain: "example.com",
    type: "nav",
    score,
    outcome,
  };
}

const arbOutcomeList = fc
  .array(
    fc.record({
      outcome: arbOutcome,
      score: fc.integer({ min: 0, max: 100 }),
    }),
    { minLength: 0, maxLength: 20 }
  )
  .map((entries) =>
    entries.map((e) => makeOutcome(e.outcome, e.score))
  );

describe("computeAdjustment properties", () => {
  it("adjustment is always bounded to [-15, 15]", () => {
    fc.assert(
      fc.property(arbOutcomeList, fc.integer({ min: 0, max: 100 }), (outcomes, threshold) => {
        const result = computeAdjustment(outcomes, threshold);
        expect(result.adjustment).toBeGreaterThanOrEqual(-15);
        expect(result.adjustment).toBeLessThanOrEqual(15);
      })
    );
  });

  it("returns zero adjustment for fewer than 3 outcomes", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            outcome: arbOutcome,
            score: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 0, maxLength: 2 }
        ),
        (entries) => {
          const outcomes = entries.map((e) => makeOutcome(e.outcome, e.score));
          const result = computeAdjustment(outcomes);
          expect(result.adjustment).toBe(0);
        }
      )
    );
  });

  it("allowCount + blockCount <= outcomes.length", () => {
    fc.assert(
      fc.property(arbOutcomeList, (outcomes) => {
        const result = computeAdjustment(outcomes);
        expect(result.allowCount + result.blockCount).toBeLessThanOrEqual(outcomes.length);
      })
    );
  });

  it("adjustment is an integer", () => {
    fc.assert(
      fc.property(arbOutcomeList, (outcomes) => {
        expect(Number.isInteger(computeAdjustment(outcomes).adjustment)).toBe(true);
      })
    );
  });

  it("all-allow outcomes produce non-negative adjustment", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 15 }),
        fc.integer({ min: 0, max: 50 }),
        (count, score) => {
          const outcomes = Array.from({ length: count }, () => makeOutcome("allow", score));
          const result = computeAdjustment(outcomes);
          expect(result.adjustment).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });

  it("all-block outcomes produce non-positive adjustment", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 15 }), (count) => {
        const outcomes = Array.from({ length: count }, () => makeOutcome("block"));
        const result = computeAdjustment(outcomes);
        expect(result.adjustment).toBeLessThanOrEqual(0);
      })
    );
  });

  it("cancel outcomes do not affect adjustment", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 15 }), (count) => {
        const outcomes = Array.from({ length: count }, () => makeOutcome("cancel"));
        const result = computeAdjustment(outcomes);
        expect(result.adjustment).toBe(0);
        expect(result.allowCount).toBe(0);
        expect(result.blockCount).toBe(0);
      })
    );
  });
});
