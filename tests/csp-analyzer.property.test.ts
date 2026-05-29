import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCSP, scoreCSPStrings } from "../extension/src/content/csp_analyzer";

// ---------------------------------------------------------------------------
// Constants matching the implementation
// ---------------------------------------------------------------------------

const SCORED_DIRECTIVES = ["default-src", "script-src"];

const KNOWN_REASONS = new Set([
  "csp_no_policy", "csp_present", "csp_permissive",
  "csp_wildcard", "csp_strict_nonces",
]);

const VALID_SCORES = new Set([0, 3, 5, 6]);

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbDirectiveName = fc.constantFrom(
  "default-src", "script-src", "img-src", "style-src",
  "font-src", "connect-src", "media-src", "object-src",
  "frame-src", "frame-ancestors", "form-action", "base-uri",
  "worker-src", "child-src", "manifest-src", "prefetch-src",
);

const arbScoredDirective = fc.constantFrom("default-src", "script-src");

const arbSourceValue = fc.constantFrom(
  "'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'",
  "'strict-dynamic'", "'nonce-abc123'", "'sha256-abcdef'",
  "*", "https:", "http:", "data:", "blob:",
  "https://cdn.example.com", "https://*.example.com",
);

const arbSourceValueNoWildcard = fc.constantFrom(
  "'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'",
  "'strict-dynamic'", "'nonce-abc123'", "'sha256-abcdef'",
  "https:", "http:", "data:", "blob:",
  "https://cdn.example.com", "https://*.example.com",
);

const arbSafeSourceValue = fc.constantFrom(
  "'self'", "'none'", "'strict-dynamic'",
  "https://cdn.example.com", "https://*.example.com",
  "https:", "http:", "data:", "blob:",
);

const arbDirective = fc.tuple(arbDirectiveName, fc.array(arbSourceValue, { minLength: 1, maxLength: 5 }))
  .map(([name, values]) => `${name} ${values.join(" ")}`);

const arbCSPString = fc.array(arbDirective, { minLength: 1, maxLength: 6 })
  .map((directives) => directives.join("; "));

const arbScoredCSPString = fc.tuple(
  arbScoredDirective,
  fc.array(arbSourceValue, { minLength: 1, maxLength: 5 }),
).map(([dir, values]) => `${dir} ${values.join(" ")}`);

const arbMixedCaseDirective = fc.constantFrom(...SCORED_DIRECTIVES).map((name) =>
  name.split("").map((c, i) =>
    i % 2 === 0 ? c.toUpperCase() : c.toLowerCase(),
  ).join(""),
);

// ---------------------------------------------------------------------------
// parseCSP property tests
// ---------------------------------------------------------------------------

describe("parseCSP property tests", () => {
  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (raw) => {
        const result = parseCSP(raw);
        expect(result).toBeInstanceOf(Map);
      }),
      { numRuns: 500 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (raw) => {
        const a = parseCSP(raw);
        const b = parseCSP(raw);
        expect([...a.entries()]).toEqual([...b.entries()]);
      }),
      { numRuns: 200 },
    );
  });

  it("returns empty map for empty string", () => {
    expect(parseCSP("").size).toBe(0);
  });

  it("only retains scored directives for arbitrary input strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (raw) => {
        const result = parseCSP(raw);
        for (const key of result.keys()) {
          expect(SCORED_DIRECTIVES).toContain(key);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("directive names are always lowercased even with mixed-case input", () => {
    fc.assert(
      fc.property(
        arbMixedCaseDirective,
        fc.array(arbSourceValue, { minLength: 1, maxLength: 3 }),
        (dir, values) => {
          const raw = `${dir} ${values.join(" ")}`;
          const result = parseCSP(raw);
          for (const key of result.keys()) {
            expect(key).toBe(key.toLowerCase());
          }
          expect(result.size).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is case insensitive for directive names", () => {
    for (const dir of SCORED_DIRECTIVES) {
      const upper = `${dir.toUpperCase()} 'self'`;
      const lower = `${dir.toLowerCase()} 'self'`;
      const mixed = dir.split("").map((c, i) =>
        i % 2 === 0 ? c.toUpperCase() : c.toLowerCase(),
      ).join("") + " 'self'";

      const rUpper = parseCSP(upper);
      const rLower = parseCSP(lower);
      const rMixed = parseCSP(mixed);

      expect(rUpper.get(dir)).toEqual(rLower.get(dir));
      expect(rUpper.get(dir)).toEqual(rMixed.get(dir));
    }
  });

  it("source values are lowercased even with uppercase input", () => {
    fc.assert(
      fc.property(
        arbScoredDirective,
        fc.array(
          fc.constantFrom("'SELF'", "'NONE'", "'UNSAFE-INLINE'", "'UNSAFE-EVAL'", "HTTPS:", "*"),
          { minLength: 1, maxLength: 4 },
        ),
        (dir, values) => {
          const raw = `${dir} ${values.join(" ")}`;
          const result = parseCSP(raw);
          const parsed = result.get(dir);
          expect(parsed).toBeDefined();
          for (const v of parsed!) {
            expect(v).toBe(v.toLowerCase());
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("extra whitespace and semicolons don't change parsed directives", () => {
    for (const dir of SCORED_DIRECTIVES) {
      const compact = `${dir} 'self' 'unsafe-inline'`;
      const padded = `  ${dir}   'self'   'unsafe-inline'  `;
      const trailingSemicolons = `${dir} 'self' 'unsafe-inline';;;`;

      expect(parseCSP(compact).get(dir)).toEqual(parseCSP(padded).get(dir));
      expect(parseCSP(compact).get(dir)).toEqual(parseCSP(trailingSemicolons).get(dir));
    }
  });

  it("non-scored directives are discarded entirely", () => {
    const nonScored = [
      "img-src", "style-src", "font-src", "connect-src",
      "frame-ancestors", "form-action", "base-uri",
    ];
    for (const dir of nonScored) {
      const result = parseCSP(`${dir} * 'unsafe-inline'`);
      expect(result.size).toBe(0);
    }
  });

  it("each scored directive appears at most once", () => {
    fc.assert(
      fc.property(arbCSPString, (raw) => {
        const result = parseCSP(raw);
        expect(result.size).toBeLessThanOrEqual(SCORED_DIRECTIVES.length);
      }),
      { numRuns: 200 },
    );
  });

  it("duplicate directive names: last one wins", () => {
    const raw = "script-src 'self'; script-src 'unsafe-inline'";
    const result = parseCSP(raw);
    expect(result.get("script-src")).toEqual(["'unsafe-inline'"]);
  });

  it("values array has no empty strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (raw) => {
        const result = parseCSP(raw);
        for (const values of result.values()) {
          for (const v of values) {
            expect(v.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// scoreCSPStrings property tests
// ---------------------------------------------------------------------------

describe("scoreCSPStrings property tests", () => {
  it("never throws on arbitrary string arrays", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 200 }), { maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        expect(typeof result.hasCSP).toBe("boolean");
        expect(typeof result.score).toBe("number");
        expect(Array.isArray(result.reasons)).toBe(true);
        expect(typeof result.isStrict).toBe("boolean");
      }),
      { numRuns: 500 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 200 }), { maxLength: 5 }), (strs) => {
        const a = scoreCSPStrings(strs);
        const b = scoreCSPStrings(strs);
        expect(a).toEqual(b);
      }),
      { numRuns: 200 },
    );
  });

  it("score is always non-negative for scored CSP inputs", () => {
    fc.assert(
      fc.property(fc.array(arbScoredCSPString, { minLength: 1, maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        expect(result.score).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it("score is always one of the known score values {0, 3, 5, 6}", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 200 }), { maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        expect(VALID_SCORES.has(result.score)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("score never exceeds 6", () => {
    fc.assert(
      fc.property(fc.array(arbScoredCSPString, { minLength: 1, maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        expect(result.score).toBeLessThanOrEqual(6);
      }),
      { numRuns: 300 },
    );
  });

  it("reasons array is always non-empty for scored CSP inputs", () => {
    fc.assert(
      fc.property(fc.array(arbScoredCSPString, { minLength: 1, maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        expect(result.reasons.length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it("empty array returns hasCSP=false and score=5", () => {
    const result = scoreCSPStrings([]);
    expect(result.hasCSP).toBe(false);
    expect(result.score).toBe(5);
    expect(result.reasons).toContain("csp_no_policy");
    expect(result.isStrict).toBe(false);
  });

  it("array of empty strings returns hasCSP=false and score=5", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant(""), { minLength: 1, maxLength: 5 }),
        (strs) => {
          const result = scoreCSPStrings(strs);
          expect(result.hasCSP).toBe(false);
          expect(result.score).toBe(5);
          expect(result.reasons).toContain("csp_no_policy");
        },
      ),
      { numRuns: 50 },
    );
  });

  it("empty strings among non-empty do not change the result", () => {
    fc.assert(
      fc.property(
        arbScoredCSPString,
        fc.array(fc.constant(""), { minLength: 0, maxLength: 3 }),
        (nonEmpty, empties) => {
          const pure = scoreCSPStrings([nonEmpty]);
          const mixed = scoreCSPStrings([...empties, nonEmpty, ...empties]);
          expect(mixed).toEqual(pure);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("non-scored directives only: hasCSP=true, score=0", () => {
    const nonScoredCSPs = [
      "img-src *",
      "style-src 'self'",
      "font-src https://fonts.example.com",
      "connect-src 'self'",
    ];
    for (const csp of nonScoredCSPs) {
      const result = scoreCSPStrings([csp]);
      expect(result.hasCSP).toBe(true);
      expect(result.score).toBe(0);
      expect(result.reasons).toContain("csp_present");
    }
  });

  it("score is bounded: max 6 (wildcard + unsafe in same script-src)", () => {
    const worst = "script-src * 'unsafe-inline' 'unsafe-eval'";
    const result = scoreCSPStrings([worst]);
    expect(result.score).toBe(6);
  });

  it("intersection semantics: combined score equals min of individual scored policy scores", () => {
    fc.assert(
      fc.property(arbScoredCSPString, arbScoredCSPString, (policyA, policyB) => {
        const scoreA = scoreCSPStrings([policyA]).score;
        const scoreB = scoreCSPStrings([policyB]).score;
        const scoreBoth = scoreCSPStrings([policyA, policyB]).score;
        expect(scoreBoth).toBe(Math.min(scoreA, scoreB));
      }),
      { numRuns: 300 },
    );
  });

  it("unsafe-inline in script-src yields csp_permissive and exactly score=3 when no wildcard", () => {
    fc.assert(
      fc.property(
        fc.array(arbSafeSourceValue, { minLength: 0, maxLength: 4 }),
        (extras) => {
          const values = ["'unsafe-inline'", ...extras].join(" ");
          const result = scoreCSPStrings([`script-src ${values}`]);
          expect(result.reasons).toContain("csp_permissive");
          expect(result.reasons).not.toContain("csp_wildcard");
          expect(result.score).toBe(3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("unsafe-eval in script-src yields csp_permissive and exactly score=3 when no wildcard", () => {
    fc.assert(
      fc.property(
        fc.array(arbSafeSourceValue, { minLength: 0, maxLength: 4 }),
        (extras) => {
          const values = ["'unsafe-eval'", ...extras].join(" ");
          const result = scoreCSPStrings([`script-src ${values}`]);
          expect(result.reasons).toContain("csp_permissive");
          expect(result.reasons).not.toContain("csp_wildcard");
          expect(result.score).toBe(3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("wildcard in script-src yields csp_wildcard and score >= 3", () => {
    fc.assert(
      fc.property(
        fc.array(arbSourceValueNoWildcard, { minLength: 0, maxLength: 4 }),
        (extras) => {
          const values = ["*", ...extras].join(" ");
          const result = scoreCSPStrings([`script-src ${values}`]);
          expect(result.reasons).toContain("csp_wildcard");
          expect(result.score).toBeGreaterThanOrEqual(3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("wildcard + unsafe yields both csp_wildcard and csp_permissive with score=6", () => {
    for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'"]) {
      const result = scoreCSPStrings([`script-src * ${unsafe}`]);
      expect(result.reasons).toContain("csp_wildcard");
      expect(result.reasons).toContain("csp_permissive");
      expect(result.score).toBe(6);
    }
  });

  it("nonce in script-src sets isStrict=true", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[\s;']/g, "x")),
        (nonceVal) => {
          const result = scoreCSPStrings([`script-src 'nonce-${nonceVal}'`]);
          expect(result.isStrict).toBe(true);
          expect(result.reasons).toContain("csp_strict_nonces");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("hash in script-src sets isStrict=true", () => {
    const hashPrefixes = ["sha256", "sha384", "sha512"];
    for (const prefix of hashPrefixes) {
      const result = scoreCSPStrings([`script-src '${prefix}-abcdef123456'`]);
      expect(result.isStrict).toBe(true);
      expect(result.reasons).toContain("csp_strict_nonces");
    }
  });

  it("isStrict uses OR semantics: true if any policy has nonces/hashes", () => {
    fc.assert(
      fc.property(arbScoredCSPString, arbScoredCSPString, (policyA, policyB) => {
        const strictA = scoreCSPStrings([policyA]).isStrict;
        const strictB = scoreCSPStrings([policyB]).isStrict;
        const strictBoth = scoreCSPStrings([policyA, policyB]).isStrict;
        if (strictA || strictB) {
          expect(strictBoth).toBe(true);
        }
        if (!strictA && !strictB) {
          expect(strictBoth).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("default-src acts as fallback when script-src is absent", () => {
    const withDefault = scoreCSPStrings(["default-src 'unsafe-inline'"]);
    const withScript = scoreCSPStrings(["script-src 'unsafe-inline'"]);
    expect(withDefault.score).toBe(withScript.score);
    expect(withDefault.reasons).toEqual(withScript.reasons);
  });

  it("script-src takes precedence over default-src", () => {
    const result = scoreCSPStrings(["default-src * 'unsafe-inline'; script-src 'self'"]);
    expect(result.score).toBe(0);
    expect(result.reasons).toContain("csp_present");
    expect(result.reasons).not.toContain("csp_permissive");
    expect(result.reasons).not.toContain("csp_wildcard");
  });

  it("safe CSP (self only) yields score=0 and csp_present", () => {
    const result = scoreCSPStrings(["script-src 'self'"]);
    expect(result.score).toBe(0);
    expect(result.reasons).toContain("csp_present");
    expect(result.isStrict).toBe(false);
  });

  it("no CSP penalty (5) >= safe CSP score (0), but permissive CSP can exceed it", () => {
    const noCSP = scoreCSPStrings([]);
    expect(noCSP.score).toBe(5);

    const safeCSP = scoreCSPStrings(["script-src 'self'"]);
    expect(noCSP.score).toBeGreaterThan(safeCSP.score);

    const permissiveCSP = scoreCSPStrings(["script-src * 'unsafe-inline'"]);
    expect(permissiveCSP.score).toBeGreaterThan(noCSP.score);
  });

  it("safe CSP (no weaknesses) always scores 0", () => {
    fc.assert(
      fc.property(
        arbScoredDirective,
        fc.array(arbSafeSourceValue, { minLength: 1, maxLength: 4 }),
        (dir, values) => {
          const csp = `${dir} ${values.join(" ")}`;
          const result = scoreCSPStrings([csp]);
          expect(result.score).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("csp_present is mutually exclusive with weakness reasons", () => {
    fc.assert(
      fc.property(fc.array(arbScoredCSPString, { minLength: 1, maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        const hasWeakness = result.reasons.includes("csp_permissive")
          || result.reasons.includes("csp_wildcard");
        if (result.reasons.includes("csp_present")) {
          expect(hasWeakness).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("csp_no_policy and csp_present are mutually exclusive", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 200 }), { maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        const hasNoPolicy = result.reasons.includes("csp_no_policy");
        const hasPresent = result.reasons.includes("csp_present");
        expect(hasNoPolicy && hasPresent).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("hasCSP=false implies csp_no_policy, hasCSP=true implies no csp_no_policy", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 200 }), { maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        if (!result.hasCSP) {
          expect(result.reasons).toContain("csp_no_policy");
        } else {
          expect(result.reasons).not.toContain("csp_no_policy");
        }
      }),
      { numRuns: 300 },
    );
  });

  it("reasons only contain known reason codes", () => {
    fc.assert(
      fc.property(fc.array(arbScoredCSPString, { minLength: 1, maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        for (const reason of result.reasons) {
          expect(KNOWN_REASONS.has(reason)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
