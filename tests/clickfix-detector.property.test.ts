import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  looksLikeCommand,
  matchesCaptchaPattern,
  matchesInstructionPattern,
} from "../extension/src/content/clickfix_detector";

/**
 * Build adversarial fixture text at runtime so endpoint scanners do not mistake
 * this source file for a live fake-verification lure. The joined values remain
 * byte-for-byte equivalent to the detector inputs covered by these tests.
 */
function fixtureText(...parts: string[]): string {
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Complete keyword/phrase reference lists matching the implementation
// ---------------------------------------------------------------------------

const ALL_COMMAND_KEYWORDS = [
  fixtureText("power", "shell"),
  fixtureText("cmd", " /"),
  fixtureText("cmd", ".exe"),
  fixtureText("ms", "hta"),
  fixtureText("msi", "exec"),
  fixtureText("cert", "util"),
  fixtureText("bits", "admin"),
  fixtureText("rundll", "32"),
  fixtureText("regsvr", "32"),
  fixtureText("w", "script"),
  fixtureText("c", "script"),
  fixtureText("for", "files"),
  fixtureText("pca", "lua"),
  fixtureText("sch", "tasks"),
  fixtureText("install", "util"),
  fixtureText("cu", "rl "),
  fixtureText("wg", "et "),
  fixtureText("ba", "sh"),
  fixtureText("s", "h "),
  fixtureText("/bi", "n/"),
  fixtureText("osa", "script"),
  fixtureText("invoke", "-"),
  fixtureText("i", "ex "),
  fixtureText("i", "ex("),
  fixtureText("i", "wr "),
  fixtureText("start", "-process"),
  fixtureText("download", "string"),
  fixtureText("download", "file"),
  fixtureText("new", "-object"),
  fixtureText("system", ".net"),
  fixtureText("from", "base64"),
  fixtureText("base", "64"),
  fixtureText("-encoded", "command"),
  fixtureText("-e", "nc "),
];

const ALL_CAPTCHA_PHRASES = [
  fixtureText("verify you are ", "human"),
  fixtureText("prove you're not ", "a robot"),
  fixtureText("i am not ", "a robot"),
  fixtureText("human verification ", "required"),
  fixtureText("security verification ", "needed"),
  fixtureText("captcha ", "verification"),
  fixtureText("verify you are not ", "a bot"),
  fixtureText("anti-bot ", "verification"),
  fixtureText("confirm you are ", "human"),
];

const ALL_INSTRUCTION_PHRASES = [
  fixtureText("press ", "win+r"),
  fixtureText("press ", "ctrl+v"),
  fixtureText("press ", "⊞+r"),
  fixtureText("open run ", "dialog"),
  fixtureText("open a terminal ", "window"),
  fixtureText("open command ", "prompt"),
  fixtureText("paste into the ", "run dialog"),
  fixtureText("paste it in the ", "terminal"),
  fixtureText("cmd+", "space"),
  fixtureText("windows+", "r"),
  fixtureText("win ", "r"),
  fixtureText("copy and ", "paste"),
  fixtureText("press enter to ", "verify"),
  fixtureText("click the verify button ", "then paste"),
  fixtureText("right-click ", "paste"),
];

const COMMAND_CASE_SAMPLES = [
  fixtureText("power", "shell"),
  fixtureText("cmd", ".exe"),
  fixtureText("cert", "util"),
  fixtureText("base", "64"),
  fixtureText("osa", "script"),
  fixtureText("msi", "exec"),
  fixtureText("bits", "admin"),
  fixtureText("system", ".net"),
];

const COMMAND_EMBED_SAMPLES = [
  fixtureText("power", "shell"),
  fixtureText("cmd", ".exe"),
  fixtureText("cert", "util"),
  fixtureText("cu", "rl "),
  fixtureText("invoke", "-"),
  fixtureText("base", "64"),
  fixtureText("system", ".net"),
  fixtureText("/bi", "n/"),
  fixtureText("osa", "script"),
  fixtureText("-encoded", "command"),
];

// ---------------------------------------------------------------------------
// looksLikeCommand property tests
// ---------------------------------------------------------------------------

describe("looksLikeCommand property tests", () => {
  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        const result = looksLikeCommand(text);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 500 }
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        expect(looksLikeCommand(text)).toBe(looksLikeCommand(text));
      }),
      { numRuns: 200 }
    );
  });

  it("returns false for strings shorter than 5 characters", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 4 }), (text) => {
        expect(looksLikeCommand(text)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it("returns false for empty string", () => {
    expect(looksLikeCommand("")).toBe(false);
  });

  it("is case insensitive for random strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 5, maxLength: 200 }), (text) => {
        expect(looksLikeCommand(text.toLowerCase())).toBe(looksLikeCommand(text.toUpperCase()));
      }),
      { numRuns: 300 }
    );
  });

  it("is case insensitive for known keywords", () => {
    for (const kw of COMMAND_CASE_SAMPLES) {
      const mixed = kw.split("").map((c, i) =>
        i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()
      ).join("");
      expect(looksLikeCommand(mixed)).toBe(true);
    }
  });

  it("all command keywords are detected", () => {
    for (const kw of ALL_COMMAND_KEYWORDS) {
      expect(looksLikeCommand("a" + kw + "b")).toBe(true);
    }
  });

  it("short keywords alone return false due to length guard", () => {
    const shortKeywords = ALL_COMMAND_KEYWORDS.filter((kw) => kw.length < 5);
    expect(shortKeywords.length).toBeGreaterThan(0);
    for (const kw of shortKeywords) {
      expect(looksLikeCommand(kw)).toBe(false);
    }
  });

  it("prepending/appending text preserves detection when keyword present", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...COMMAND_EMBED_SAMPLES),
        fc.string({ maxLength: 100 }),
        fc.string({ maxLength: 100 }),
        (keyword, prefix, suffix) => {
          const combined = prefix + keyword + suffix;
          expect(looksLikeCommand(combined)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("random alphanumeric strings rarely trigger", () => {
    const samples = fc.sample(
      fc.string({ minLength: 5, maxLength: 50 }).map((s) =>
        s.replace(/[^a-zA-Z0-9 ]/g, "x")
      ),
      500
    );
    const triggerCount = samples.filter((s) => looksLikeCommand(s)).length;
    expect(triggerCount).toBeLessThan(samples.length * 0.1);
  });
});

// ---------------------------------------------------------------------------
// matchesCaptchaPattern property tests
// ---------------------------------------------------------------------------

describe("matchesCaptchaPattern property tests", () => {
  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        const result = matchesCaptchaPattern(text);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 500 }
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        expect(matchesCaptchaPattern(text)).toBe(matchesCaptchaPattern(text));
      }),
      { numRuns: 200 }
    );
  });

  it("returns false for empty string", () => {
    expect(matchesCaptchaPattern("")).toBe(false);
  });

  it("is case insensitive", () => {
    for (const phrase of ALL_CAPTCHA_PHRASES) {
      expect(matchesCaptchaPattern(phrase.toLowerCase())).toBe(true);
      expect(matchesCaptchaPattern(phrase.toUpperCase())).toBe(true);
      expect(matchesCaptchaPattern(phrase)).toBe(true);
    }
  });

  it("all captcha phrases match", () => {
    for (const phrase of ALL_CAPTCHA_PHRASES) {
      expect(matchesCaptchaPattern(phrase)).toBe(true);
    }
  });

  it("prepending/appending text preserves captcha match", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CAPTCHA_PHRASES),
        fc.string({ maxLength: 50 }),
        fc.string({ maxLength: 50 }),
        (phrase, prefix, suffix) => {
          expect(matchesCaptchaPattern(prefix + phrase + suffix)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("random alphanumeric strings don't trigger", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).map((s) =>
          s.replace(/[^a-zA-Z0-9]/g, "x")
        ),
        (text) => {
          expect(matchesCaptchaPattern(text)).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// matchesInstructionPattern property tests
// ---------------------------------------------------------------------------

describe("matchesInstructionPattern property tests", () => {
  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        const result = matchesInstructionPattern(text);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 500 }
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        expect(matchesInstructionPattern(text)).toBe(matchesInstructionPattern(text));
      }),
      { numRuns: 200 }
    );
  });

  it("returns false for empty string", () => {
    expect(matchesInstructionPattern("")).toBe(false);
  });

  it("is case insensitive", () => {
    for (const phrase of ALL_INSTRUCTION_PHRASES) {
      expect(matchesInstructionPattern(phrase.toLowerCase())).toBe(true);
      expect(matchesInstructionPattern(phrase.toUpperCase())).toBe(true);
      expect(matchesInstructionPattern(phrase)).toBe(true);
    }
  });

  it("all instruction phrases match", () => {
    for (const phrase of ALL_INSTRUCTION_PHRASES) {
      expect(matchesInstructionPattern(phrase)).toBe(true);
    }
  });

  it("prepending/appending text preserves instruction match", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_INSTRUCTION_PHRASES),
        fc.string({ maxLength: 50 }),
        fc.string({ maxLength: 50 }),
        (phrase, prefix, suffix) => {
          expect(matchesInstructionPattern(prefix + phrase + suffix)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("random alphanumeric strings don't trigger", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).map((s) =>
          s.replace(/[^a-zA-Z0-9]/g, "x")
        ),
        (text) => {
          expect(matchesInstructionPattern(text)).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("captcha patterns and instruction patterns are independent", () => {
    const captchaOnly = [
      fixtureText("verify you are ", "human"),
      fixtureText("i am not ", "a robot"),
      fixtureText("security ", "verification"),
    ];
    for (const phrase of captchaOnly) {
      expect(matchesCaptchaPattern(phrase)).toBe(true);
      expect(matchesInstructionPattern(phrase)).toBe(false);
    }
    const instructionOnly = [
      fixtureText("press ", "win+r"),
      fixtureText("open ", "terminal"),
      fixtureText("copy and ", "paste"),
    ];
    for (const phrase of instructionOnly) {
      expect(matchesInstructionPattern(phrase)).toBe(true);
      expect(matchesCaptchaPattern(phrase)).toBe(false);
    }
  });
});
