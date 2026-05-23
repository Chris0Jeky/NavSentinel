import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  looksLikeCommand,
  matchesCaptchaPattern,
  matchesInstructionPattern,
} from "../extension/src/content/clickfix_detector";

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

  it("is case insensitive", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 5, maxLength: 200 }), (text) => {
        expect(looksLikeCommand(text.toLowerCase())).toBe(looksLikeCommand(text.toUpperCase()));
      }),
      { numRuns: 300 }
    );
  });

  it("known command keywords always trigger detection", () => {
    const keywords = [
      "powershell", "cmd /c", "cmd.exe", "mshta", "certutil",
      "curl http://evil.com", "wget http://evil.com", "bash -c",
      "invoke-expression", "iex (something)", "downloadstring",
      "start-process notepad", "system.net.webclient",
    ];
    for (const kw of keywords) {
      expect(looksLikeCommand(kw)).toBe(true);
    }
  });

  it("prepending/appending text preserves detection when keyword present", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("powershell", "cmd.exe", "certutil", "invoke-expression", "curl http"),
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
    let triggerCount = 0;
    const runs = 500;
    fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 50 }).map((s) =>
          s.replace(/[^a-zA-Z0-9 ]/g, "x")
        ),
        (text) => {
          if (looksLikeCommand(text)) triggerCount++;
        }
      ),
      { numRuns: runs }
    );
    expect(triggerCount).toBeLessThan(runs * 0.1);
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
    const phrases = [
      "Verify you are human",
      "Prove you're not a robot",
      "I am not a robot",
      "Human verification",
      "Security verification",
    ];
    for (const phrase of phrases) {
      expect(matchesCaptchaPattern(phrase.toLowerCase())).toBe(true);
      expect(matchesCaptchaPattern(phrase.toUpperCase())).toBe(true);
      expect(matchesCaptchaPattern(phrase)).toBe(true);
    }
  });

  it("known captcha phrases always match", () => {
    const phrases = [
      "verify you are human",
      "prove you're not a robot",
      "i am not a robot",
      "human verification required",
      "security verification needed",
      "captcha verification",
      "anti-bot verification",
      "confirm you are human",
    ];
    for (const phrase of phrases) {
      expect(matchesCaptchaPattern(phrase)).toBe(true);
    }
  });

  it("prepending/appending text preserves captcha match", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "verify you are human",
          "i am not a robot",
          "human verification"
        ),
        fc.string({ maxLength: 50 }),
        fc.string({ maxLength: 50 }),
        (phrase, prefix, suffix) => {
          expect(matchesCaptchaPattern(prefix + phrase + suffix)).toBe(true);
        }
      ),
      { numRuns: 100 }
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
    const phrases = [
      "Press Win+R",
      "Press Ctrl+V",
      "Open a Run dialog",
      "Paste into the terminal",
      "Windows+R",
    ];
    for (const phrase of phrases) {
      expect(matchesInstructionPattern(phrase.toLowerCase())).toBe(true);
      expect(matchesInstructionPattern(phrase.toUpperCase())).toBe(true);
      expect(matchesInstructionPattern(phrase)).toBe(true);
    }
  });

  it("known instruction phrases always match", () => {
    const phrases = [
      "press win+r",
      "press ctrl+v",
      "open run dialog",
      "open a terminal window",
      "open command prompt",
      "paste into the run dialog",
      "paste it in the terminal",
      "cmd+space",
      "windows+r",
      "copy and paste",
      "press enter to verify",
      "right-click paste",
    ];
    for (const phrase of phrases) {
      expect(matchesInstructionPattern(phrase)).toBe(true);
    }
  });

  it("prepending/appending text preserves instruction match", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "press win+r",
          "press ctrl+v",
          "open terminal",
          "copy and paste"
        ),
        fc.string({ maxLength: 50 }),
        fc.string({ maxLength: 50 }),
        (phrase, prefix, suffix) => {
          expect(matchesInstructionPattern(prefix + phrase + suffix)).toBe(true);
        }
      ),
      { numRuns: 100 }
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
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const captcha = matchesCaptchaPattern(text);
        const instruction = matchesInstructionPattern(text);
        if (captcha && instruction) {
          expect(text.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 300 }
    );
  });
});
