import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseCSP, scoreCSPStrings } from "../extension/src/content/csp_analyzer";

// ---------------------------------------------------------------------------
// Constants matching the implementation
// ---------------------------------------------------------------------------

const SCORED_DIRECTIVES = ["default-src", "script-src"];

const UNSAFE_VALUES = ["'unsafe-inline'", "'unsafe-eval'"];

const NONCE_HASH_PREFIXES = ["'nonce-", "'sha256-", "'sha384-", "'sha512-"];

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

const arbDirective = fc.tuple(arbDirectiveName, fc.array(arbSourceValue, { minLength: 1, maxLength: 5 }))
  .map(([name, values]) => `${name} ${values.join(" ")}`);

const arbCSPString = fc.array(arbDirective, { minLength: 1, maxLength: 6 })
  .map((directives) => directives.join("; "));

const arbScoredCSPString = fc.tuple(
  arbScoredDirective,
  fc.array(arbSourceValue, { minLength: 1, maxLength: 5 }),
  fc.array(arbDirective, { minLength: 0, maxLength: 4 }),
).map(([dir, values, extras]) =>
  [dir + " " + values.join(" "), ...extras].join("; "),
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

  it("only retains scored directives (default-src, script-src)", () => {
    fc.assert(
      fc.property(arbCSPString, (raw) => {
        const result = parseCSP(raw);
        for (const key of result.keys()) {
          expect(SCORED_DIRECTIVES).toContain(key);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("directive names are always lowercased in output", () => {
    fc.assert(
      fc.property(arbCSPString, (raw) => {
        const result = parseCSP(raw);
        for (const key of result.keys()) {
          expect(key).toBe(key.toLowerCase());
        }
      }),
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

  it("source values are lowercased", () => {
    fc.assert(
      fc.property(arbCSPString, (raw) => {
        const result = parseCSP(raw);
        for (const values of result.values()) {
          for (const v of values) {
            expect(v).toBe(v.toLowerCase());
          }
        }
      }),
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
      fc.property(arbCSPString, (raw) => {
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

  it("score is always non-negative", () => {
    fc.assert(
      fc.property(fc.array(arbCSPString, { maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        expect(result.score).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it("reasons array is always non-empty", () => {
    fc.assert(
      fc.property(fc.array(arbCSPString, { maxLength: 5 }), (strs) => {
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

  it("intersection semantics: adding a policy with scored directives never increases score", () => {
    fc.assert(
      fc.property(arbScoredCSPString, arbScoredCSPString, (policyA, policyB) => {
        const scoreA = scoreCSPStrings([policyA]).score;
        const scoreBoth = scoreCSPStrings([policyA, policyB]).score;
        expect(scoreBoth).toBeLessThanOrEqual(scoreA);
      }),
      { numRuns: 300 },
    );
  });

  it("intersection semantics: min of individual scored policy scores", () => {
    fc.assert(
      fc.property(arbScoredCSPString, arbScoredCSPString, (policyA, policyB) => {
        const scoreA = scoreCSPStrings([policyA]).score;
        const scoreB = scoreCSPStrings([policyB]).score;
        const scoreBoth = scoreCSPStrings([policyA, policyB]).score;
        expect(scoreBoth).toBeLessThanOrEqual(Math.min(scoreA, scoreB));
      }),
      { numRuns: 300 },
    );
  });

  it("single policy score matches combined single-element array", () => {
    fc.assert(
      fc.property(arbCSPString, (policy) => {
        const result = scoreCSPStrings([policy]);
        expect(result.hasCSP).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("unsafe-inline in script-src yields csp_permissive and score >= 3", () => {
    fc.assert(
      fc.property(
        fc.array(arbSourceValue, { minLength: 0, maxLength: 4 }),
        (extras) => {
          const values = ["'unsafe-inline'", ...extras].join(" ");
          const result = scoreCSPStrings([`script-src ${values}`]);
          expect(result.reasons).toContain("csp_permissive");
          expect(result.score).toBeGreaterThanOrEqual(3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("unsafe-eval in script-src yields csp_permissive and score >= 3", () => {
    fc.assert(
      fc.property(
        fc.array(arbSourceValue, { minLength: 0, maxLength: 4 }),
        (extras) => {
          const values = ["'unsafe-eval'", ...extras].join(" ");
          const result = scoreCSPStrings([`script-src ${values}`]);
          expect(result.reasons).toContain("csp_permissive");
          expect(result.score).toBeGreaterThanOrEqual(3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("wildcard in script-src yields csp_wildcard and score >= 3", () => {
    fc.assert(
      fc.property(
        fc.array(arbSourceValue.filter((v) => v !== "*"), { minLength: 0, maxLength: 4 }),
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

  it("nonce in script-src sets isStrict=true", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/\s+/g, "x")),
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

  it("isStrict is monotonic: adding policies can only maintain or gain strict", () => {
    fc.assert(
      fc.property(arbCSPString, arbCSPString, (policyA, policyB) => {
        const strictA = scoreCSPStrings([policyA]).isStrict;
        const strictB = scoreCSPStrings([policyB]).isStrict;
        const strictBoth = scoreCSPStrings([policyA, policyB]).isStrict;
        if (strictA || strictB) {
          expect(strictBoth).toBe(true);
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
    const safeValues = ["'self'", "'none'", "'strict-dynamic'", "https://cdn.example.com"];
    fc.assert(
      fc.property(
        arbScoredDirective,
        fc.array(fc.constantFrom(...safeValues), { minLength: 1, maxLength: 4 }),
        (dir, values) => {
          const csp = `${dir} ${values.join(" ")}`;
          const result = scoreCSPStrings([csp]);
          expect(result.score).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reasons never contain duplicates within a single result", () => {
    fc.assert(
      fc.property(fc.array(arbCSPString, { minLength: 1, maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        const uniqueReasons = new Set(result.reasons);
        expect(uniqueReasons.size).toBe(result.reasons.length);
      }),
      { numRuns: 300 },
    );
  });

  it("score is always an integer", () => {
    fc.assert(
      fc.property(fc.array(arbCSPString, { maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        expect(Number.isInteger(result.score)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("reasons only contain known reason codes", () => {
    const KNOWN_REASONS = new Set([
      "csp_no_policy", "csp_present", "csp_permissive",
      "csp_wildcard", "csp_strict_nonces",
    ]);
    fc.assert(
      fc.property(fc.array(arbCSPString, { maxLength: 5 }), (strs) => {
        const result = scoreCSPStrings(strs);
        for (const reason of result.reasons) {
          expect(KNOWN_REASONS.has(reason)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
