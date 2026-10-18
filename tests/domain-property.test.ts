import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  isIPAddress,
  levenshtein,
  normalizeHomoglyphs,
  normalizeHost,
  recalcSeverity,
  safeUrlParse,
} from "../extension/src/shared/domain";

const arbAlphaLabel = fc
  .array(fc.constantFrom(
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l",
    "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x",
    "y", "z", "-"
  ), { minLength: 2, maxLength: 10 })
  .map((chars) => chars.join(""));

const arbDomainChars = fc
  .array(fc.constantFrom("a", "b", ".", "A", "1"), { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(""));

const arbHomoglyphInput = fc
  .array(fc.constantFrom(
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l",
    "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x",
    "y", "z", "0", "1", "5", "8", "-"
  ), { minLength: 0, maxLength: 30 })
  .map((chars) => chars.join(""));

describe("normalizeHost properties", () => {
  it("is idempotent: normalizeHost(normalizeHost(h)) === normalizeHost(h)", () => {
    fc.assert(
      fc.property(fc.string(), (h) => {
        expect(normalizeHost(normalizeHost(h))).toBe(normalizeHost(h));
      })
    );
  });

  it("always returns lowercase", () => {
    fc.assert(
      fc.property(fc.string(), (h) => {
        const result = normalizeHost(h);
        expect(result).toBe(result.toLowerCase());
      })
    );
  });

  it("strips all trailing dots (idempotent)", () => {
    fc.assert(
      fc.property(arbDomainChars, (h) => {
        const lower = h.toLowerCase();
        const result = normalizeHost(h);
        expect(result).toBe(lower.replace(/\.+$/, ""));
      })
    );
  });

  it("empty input always returns empty string", () => {
    expect(normalizeHost("")).toBe("");
  });
});

describe("levenshtein properties", () => {
  const shortString = fc.string({ minLength: 0, maxLength: 30 });

  it("identity: levenshtein(a, a) === 0", () => {
    fc.assert(
      fc.property(shortString, (a) => {
        expect(levenshtein(a, a)).toBe(0);
      })
    );
  });

  it("symmetry: levenshtein(a, b) === levenshtein(b, a)", () => {
    fc.assert(
      fc.property(shortString, shortString, (a, b) => {
        expect(levenshtein(a, b)).toBe(levenshtein(b, a));
      })
    );
  });

  it("non-negative: levenshtein(a, b) >= 0", () => {
    fc.assert(
      fc.property(shortString, shortString, (a, b) => {
        expect(levenshtein(a, b)).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it("upper bound: levenshtein(a, b) <= max(|a|, |b|)", () => {
    fc.assert(
      fc.property(shortString, shortString, (a, b) => {
        expect(levenshtein(a, b)).toBeLessThanOrEqual(
          Math.max(a.length, b.length)
        );
      })
    );
  });

  it("triangle inequality: lev(a, c) <= lev(a, b) + lev(b, c)", () => {
    fc.assert(
      fc.property(shortString, shortString, shortString, (a, b, c) => {
        expect(levenshtein(a, c)).toBeLessThanOrEqual(
          levenshtein(a, b) + levenshtein(b, c)
        );
      })
    );
  });

  it("empty vs non-empty: levenshtein('', s) === code-point length of s", () => {
    fc.assert(
      fc.property(shortString, (s) => {
        // Code points, not UTF-16 units: "" vs "😀" is 1, not 2 (A4).
        expect(levenshtein("", s)).toBe(Array.from(s).length);
      })
    );
  });

  it("single char deletion: distance is exactly 1", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 29 }),
        (base, posRaw) => {
          const pos = posRaw % base.length;
          const deleted = base.slice(0, pos) + base.slice(pos + 1);
          expect(levenshtein(base, deleted)).toBe(1);
        }
      )
    );
  });

  it("long inputs above LEVENSHTEIN_MAX_LEN return max(|a|, |b|) in code points", () => {
    const longString = fc.string({ minLength: 254, maxLength: 300 });
    fc.assert(
      fc.property(longString, longString, (a, b) => {
        expect(levenshtein(a, b)).toBe(
          Math.max(Array.from(a).length, Array.from(b).length)
        );
      })
    );
  });
});

describe("normalizeHomoglyphs properties", () => {
  it("is idempotent: applying twice gives same result", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), (s) => {
        expect(normalizeHomoglyphs(normalizeHomoglyphs(s))).toBe(
          normalizeHomoglyphs(s)
        );
      })
    );
  });

  it("always returns lowercase", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), (s) => {
        const result = normalizeHomoglyphs(s);
        expect(result).toBe(result.toLowerCase());
      })
    );
  });

  it("output never contains confusable digits (0, 1, 5, 8) for ASCII input", () => {
    fc.assert(
      fc.property(arbHomoglyphInput, (s) => {
        const result = normalizeHomoglyphs(s);
        expect(result).not.toMatch(/[0158]/);
      })
    );
  });

  it("empty input returns empty string", () => {
    expect(normalizeHomoglyphs("")).toBe("");
  });

  it("output length <= input length (multi-char replacements can shrink)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), (s) => {
        expect(normalizeHomoglyphs(s).length).toBeLessThanOrEqual(s.length);
      })
    );
  });
});

describe("isIPAddress properties", () => {
  it("valid IPv4 addresses are detected", () => {
    const arbIPv4 = fc.tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 })
    ).map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

    fc.assert(
      fc.property(arbIPv4, (ip) => {
        expect(isIPAddress(ip)).toBe(true);
      })
    );
  });

  it("is case-insensitive", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 50 }), (s) => {
        expect(isIPAddress(s.toUpperCase())).toBe(isIPAddress(s.toLowerCase()));
      })
    );
  });

  it("common domain names are not detected as IPs", () => {
    fc.assert(
      fc.property(arbAlphaLabel, (label) => {
        const domain = `${label}.com`;
        expect(isIPAddress(domain)).toBe(false);
      })
    );
  });
});

describe("recalcSeverity properties", () => {
  it("is monotonically non-decreasing", () => {
    const severityRank: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 };
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (a, b) => {
          if (a <= b) {
            expect(severityRank[recalcSeverity(a)]).toBeLessThanOrEqual(
              severityRank[recalcSeverity(b)]!
            );
          }
        }
      )
    );
  });

  it("always returns one of the four valid severity levels", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 300 }), (score) => {
        expect(["none", "low", "medium", "high"]).toContain(recalcSeverity(score));
      })
    );
  });
});

describe("wave-2 slice 1 properties (A1/A2/A4)", () => {
  it("any host containing ':::' is never an IP address (A1)", () => {
    // NFKC never alters ASCII colons and IPv4 contains none, so the triple
    // colon always survives to the strict isIPv6 validator, which rejects it.
    fc.assert(
      fc.property(
        fc.string({ maxLength: 30 }),
        fc.string({ maxLength: 30 }),
        (a, b) => {
          expect(isIPAddress(`${a}:::${b}`)).toBe(false);
        }
      )
    );
  });

  it("fullwidth ASCII folds to plain lowercase ASCII (A2)", () => {
    const asciiWord = fc
      .array(
        fc.constantFrom(
          ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("")
        ),
        { minLength: 1, maxLength: 20 }
      )
      .map((chars) => chars.join(""));
    fc.assert(
      fc.property(asciiWord, (s) => {
        const fullwidth = Array.from(
          s,
          (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)
        ).join("");
        expect(normalizeHost(fullwidth)).toBe(s.toLowerCase());
      })
    );
  });

  it("astral repeat distance is |n - m| in characters, not UTF-16 units (A4)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        (n, m) => {
          expect(levenshtein("😀".repeat(n), "😀".repeat(m))).toBe(
            Math.abs(n - m)
          );
        }
      )
    );
  });
});

describe("safeUrlParse properties", () => {
  it("valid web URLs always parse successfully", () => {
    fc.assert(
      fc.property(
        fc.webUrl({ authoritySettings: { withPort: false } }),
        (url) => {
          const result = safeUrlParse(url);
          expect(result).not.toBeNull();
        }
      )
    );
    // fc.webUrl generation is slow: 100 runs took 8.7s on a loaded 4-core host
    // against the 5s default.
  }, 20_000);

  it("never throws (returns null instead)", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => safeUrlParse(s)).not.toThrow();
      })
    );
  });
});
