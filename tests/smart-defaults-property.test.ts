import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  pairKey,
  analyzeOutcomesForPair,
  isPairOnCooldownPure,
  SMART_DEFAULT_THRESHOLD,
  type CooldownMap,
} from "../extension/src/shared/smart_defaults";
import type { PromptOutcomeEntry } from "../extension/src/shared/storage";

const arbDomain = fc
  .array(fc.constantFrom(
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l",
    "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x",
    "y", "z", "0", "1", ".", "-"
  ), { minLength: 3, maxLength: 20 })
  .map((chars) => chars.join(""));

describe("pairKey properties", () => {
  it("is deterministic", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (src, dest) => {
        expect(pairKey(src, dest)).toBe(pairKey(src, dest));
      })
    );
  });

  it("always returns lowercase", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (src, dest) => {
        const result = pairKey(src, dest);
        expect(result).toBe(result.toLowerCase());
      })
    );
  });

  it("is case-insensitive: pairKey(A, B) === pairKey(a, b)", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (src, dest) => {
        expect(pairKey(src.toUpperCase(), dest.toUpperCase())).toBe(
          pairKey(src.toLowerCase(), dest.toLowerCase())
        );
      })
    );
  });

  it("is NOT commutative: pairKey(a, b) !== pairKey(b, a) for distinct domains", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (src, dest) => {
        if (src.toLowerCase() !== dest.toLowerCase()) {
          expect(pairKey(src, dest)).not.toBe(pairKey(dest, src));
        }
      })
    );
  });

  it("contains the pipe separator", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (src, dest) => {
        expect(pairKey(src, dest)).toContain("|");
      })
    );
  });
});

function makeNavOutcome(
  domain: string,
  destDomain: string,
  outcome: PromptOutcomeEntry["outcome"],
  ts: number
): PromptOutcomeEntry {
  return {
    id: `test-${ts}`,
    ts,
    domain,
    destDomain,
    type: "nav",
    score: 50,
    outcome,
  };
}

describe("analyzeOutcomesForPair properties", () => {
  it("returns null for fewer than SMART_DEFAULT_THRESHOLD outcomes", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbDomain,
        fc.integer({ min: 0, max: SMART_DEFAULT_THRESHOLD - 1 }),
        (src, dest, count) => {
          const outcomes = Array.from({ length: count }, (_, i) =>
            makeNavOutcome(src, dest, "allow", 1000 + i)
          );
          expect(analyzeOutcomesForPair(outcomes, src, dest)).toBeNull();
        }
      )
    );
  });

  it("returns suggestion for THRESHOLD consecutive positive outcomes (allow / allow_once / always_allow)", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbDomain,
        // Each entry is an independently-chosen positive outcome, so the
        // property exercises the full positive set -- a regressed impl that
        // dropped always_allow/allow_once would be found by shrinking. (#307)
        fc.array(fc.constantFrom("allow", "allow_once", "always_allow"), {
          minLength: SMART_DEFAULT_THRESHOLD,
          maxLength: 10,
        }),
        (src, dest, positives) => {
          const outcomes = positives.map((outcome, i) =>
            makeNavOutcome(src, dest, outcome, 1000 + i)
          );
          const result = analyzeOutcomesForPair(outcomes, src, dest);
          expect(result).not.toBeNull();
          expect(result!.allowCount).toBeGreaterThanOrEqual(SMART_DEFAULT_THRESHOLD);
        }
      )
    );
  });

  it("a block after allows resets the streak", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbDomain,
        fc.integer({ min: 1, max: SMART_DEFAULT_THRESHOLD - 1 }),
        (src, dest, allowCount) => {
          const outcomes = [
            ...Array.from({ length: SMART_DEFAULT_THRESHOLD }, (_, i) =>
              makeNavOutcome(src, dest, "allow", 1000 + i)
            ),
            makeNavOutcome(src, dest, "block", 2000),
            ...Array.from({ length: allowCount }, (_, i) =>
              makeNavOutcome(src, dest, "allow", 3000 + i)
            ),
          ];
          expect(analyzeOutcomesForPair(outcomes, src, dest)).toBeNull();
        }
      )
    );
  });

  it("is case-insensitive for domain matching", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (src, dest) => {
        const outcomes = Array.from({ length: SMART_DEFAULT_THRESHOLD }, (_, i) =>
          makeNavOutcome(src.toUpperCase(), dest.toUpperCase(), "allow", 1000 + i)
        );
        const result = analyzeOutcomesForPair(outcomes, src.toLowerCase(), dest.toLowerCase());
        expect(result).not.toBeNull();
      })
    );
  });

  it("suggestion domains are always lowercase", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (src, dest) => {
        const outcomes = Array.from({ length: SMART_DEFAULT_THRESHOLD }, (_, i) =>
          makeNavOutcome(src, dest, "allow", 1000 + i)
        );
        const result = analyzeOutcomesForPair(outcomes, src.toUpperCase(), dest.toUpperCase());
        if (result) {
          expect(result.sourceDomain).toBe(result.sourceDomain.toLowerCase());
          expect(result.destDomain).toBe(result.destDomain.toLowerCase());
        }
      })
    );
  });
});

describe("isPairOnCooldownPure properties", () => {
  it("returns false for empty cooldown map", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, fc.integer(), (src, dest, now) => {
        expect(isPairOnCooldownPure({}, src, dest, now)).toBe(false);
      })
    );
  });

  it("returns true when expiresAt > now", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbDomain,
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (src, dest, now, delta) => {
          const cooldowns: CooldownMap = { [pairKey(src, dest)]: now + delta };
          expect(isPairOnCooldownPure(cooldowns, src, dest, now)).toBe(true);
        }
      )
    );
  });

  it("returns false when expiresAt <= now", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbDomain,
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (src, dest, now, delta) => {
          const cooldowns: CooldownMap = { [pairKey(src, dest)]: now - delta };
          expect(isPairOnCooldownPure(cooldowns, src, dest, now)).toBe(false);
        }
      )
    );
  });

  it("is case-insensitive for domain lookup", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (src, dest) => {
        const now = 1000;
        const cooldowns: CooldownMap = { [pairKey(src, dest)]: 2000 };
        expect(isPairOnCooldownPure(cooldowns, src.toUpperCase(), dest.toUpperCase(), now)).toBe(true);
      })
    );
  });

  it("cooldown eventually expires as time advances", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbDomain,
        fc.integer({ min: 0, max: 1_000_000 }),
        (src, dest, expiresAt) => {
          const cooldowns: CooldownMap = { [pairKey(src, dest)]: expiresAt };
          expect(isPairOnCooldownPure(cooldowns, src, dest, expiresAt + 1)).toBe(false);
        }
      )
    );
  });
});
