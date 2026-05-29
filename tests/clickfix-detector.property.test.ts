import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  looksLikeCommand,
  matchesCaptchaPattern,
  matchesInstructionPattern,
} from "../extension/src/content/clickfix_detector";

// ---------------------------------------------------------------------------
// Complete keyword/phrase reference lists matching the implementation
// ---------------------------------------------------------------------------

const ALL_COMMAND_KEYWORDS = [
  "powershell", "cmd /", "cmd.exe", "mshta", "msiexec", "certutil",
  "bitsadmin", "rundll32", "regsvr32", "wscript", "cscript",
  "forfiles", "pcalua", "schtasks", "installutil",
  "curl ", "wget ", "bash", "sh ", "/bin/",
  "osascript", "invoke-", "iex ", "iex(", "iwr ",
  "start-process", "downloadstring", "downloadfile", "new-object",
  "system.net", "frombase64", "base64", "-encodedcommand", "-enc ",
];

const ALL_CAPTCHA_PHRASES = [
  "verify you are human",
  "prove you're not a robot",
  "i am not a robot",
  "human verification required",
  "security verification needed",
  "captcha verification",
  "verify you are not a bot",
  "anti-bot verification",
  "confirm you are human",
];

const ALL_INSTRUCTION_PHRASES = [
  "press win+r",
  "press ctrl+v",
  "press ⊞+r",
  "open run dialog",
  "open a terminal window",
  "open command prompt",
  "paste into the run dialog",
  "paste it in the terminal",
  "cmd+space",
  "windows+r",
  "win r",
  "copy and paste",
  "press enter to verify",
  "click the verify button then paste",
  "right-click paste",
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
    const seeds = [
      "powershell", "cmd.exe", "certutil", "base64", "osascript",
      "msiexec", "bitsadmin", "system.net",
    ];
    for (const kw of seeds) {
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
        fc.constantFrom(
          "powershell", "cmd.exe", "certutil", "curl ",
          "invoke-", "base64", "system.net", "/bin/",
          "osascript", "-encodedcommand"
        ),
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
      "verify you are human",
      "i am not a robot",
      "security verification",
    ];
    for (const phrase of captchaOnly) {
      expect(matchesCaptchaPattern(phrase)).toBe(true);
      expect(matchesInstructionPattern(phrase)).toBe(false);
    }
    const instructionOnly = [
      "press win+r",
      "open terminal",
      "copy and paste",
    ];
    for (const phrase of instructionOnly) {
      expect(matchesInstructionPattern(phrase)).toBe(true);
      expect(matchesCaptchaPattern(phrase)).toBe(false);
    }
  });
});
