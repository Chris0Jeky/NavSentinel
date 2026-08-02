import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classifyEventTone, type EventTone } from "../extension/src/shared/event_tone";
import { explainReasonCode, explainReasonCodes } from "../extension/src/shared/explanations";

// ---------------------------------------------------------------------------
// Reference data matching the implementations
// ---------------------------------------------------------------------------

const VALID_TONES: ReadonlySet<EventTone> = new Set(["navigation", "credential", "config"]);

const ALL_KNOWN_CODES = [
  "no_accessible_name",
  "minimal_accessible_name",
  "overlay_large_interactive",
  "overlay_medium_interactive",
  "intent_mismatch_under_interactive",
  "retargeted_target_mismatch",
  "overlay_high_zindex",
  "overlay_elevated_zindex",
  "invisible_but_clickable",
  "near_invisible_opacity",
  "low_opacity",
  "cursor_pointer_no_affordance",
  "keyboard_activation",
  "legit_modal_backdrop",
  "composite_escalation",
  "nrs_new_tab_window",
  "nrs_cross_site",
  "nrs_fast_attempt",
  "nrs_user_activation_active",
  "nrs_multiple_attempts",
  "nrs_allowlisted",
  "nrs_explicit_new_tab_intent",
  "nrs_double_click_hijack",
  "nrs_known_bad_domain",
  "nrs_redirect_chain_depth",
  "nrs_redirect_via_known_redirector",
  "nrs_oauth_redirect_mismatch",
  "nrs_oauth_opener_manipulation",
  "nrs_clickfix_active",
  "nrs_opener_previously_allowed",
  "nrs_pushstate_abuse",
  "nrs_nav_anomaly",
  "nrs_csp_weakness",
  "nrs_domain_repeat_offender",
  "nrs_js_behavior_suspicious",
  "clipboard_command_with_overlay",
  "clipboard_write_with_overlay",
  "clickfix_instruction_pattern",
  "clickfix_paste_instruction",
  "clickfix_captcha_text_with_overlay",
  "overlay_injected",
  "form_action_changed",
  "password_injected",
  "suspicious_iframe",
  "clickfix_detected",
  "dblclickjack_detected",
  "mutation_alert",
  "pushstate_abuse",
] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbCredPrefix = fc.string({ minLength: 0, maxLength: 30 }).map(
  (s) => "cred_" + s.replace(/[^a-z0-9_]/g, "x"),
);

const arbSuitePrefix = fc.string({ minLength: 0, maxLength: 30 }).map(
  (s) => "suite_" + s.replace(/[^a-z0-9_]/g, "x"),
);

const arbNonPrefixedString = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => !s.startsWith("cred_") && !s.startsWith("suite_"));

const arbKnownCode = fc.constantFrom(...ALL_KNOWN_CODES);

const OBJECT_PROTOTYPE_KEYS = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

const VALID_CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_".split("");

const arbUnknownCode = fc
  .array(fc.constantFrom(...VALID_CODE_CHARS), { minLength: 1, maxLength: 50 })
  .map((arr) => arr.join(""))
  .filter(
    (s) =>
      !(ALL_KNOWN_CODES as readonly string[]).includes(s) &&
      !OBJECT_PROTOTYPE_KEYS.has(s),
  );

// ---------------------------------------------------------------------------
// classifyEventTone property tests
// ---------------------------------------------------------------------------

describe("classifyEventTone property tests", () => {
  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        const result = classifyEventTone(text);
        expect(VALID_TONES.has(result)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("always returns a valid EventTone for arbitrary inputs", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const result = classifyEventTone(input as string);
        expect(VALID_TONES.has(result)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("cred_ prefix always returns credential", () => {
    fc.assert(
      fc.property(arbCredPrefix, (kind) => {
        expect(classifyEventTone(kind)).toBe("credential");
      }),
      { numRuns: 200 },
    );
  });

  it("suite_ prefix always returns config", () => {
    fc.assert(
      fc.property(arbSuitePrefix, (kind) => {
        expect(classifyEventTone(kind)).toBe("config");
      }),
      { numRuns: 200 },
    );
  });

  it("strings without cred_/suite_ prefix return navigation", () => {
    fc.assert(
      fc.property(arbNonPrefixedString, (kind) => {
        expect(classifyEventTone(kind)).toBe("navigation");
      }),
      { numRuns: 300 },
    );
  });

  it("empty string returns navigation", () => {
    expect(classifyEventTone("")).toBe("navigation");
  });

  it("prefix routing is case-sensitive", () => {
    expect(classifyEventTone("CRED_submit")).toBe("navigation");
    expect(classifyEventTone("Cred_submit")).toBe("navigation");
    expect(classifyEventTone("SUITE_config")).toBe("navigation");
    expect(classifyEventTone("Suite_config")).toBe("navigation");
  });

  it("prefix must be exact (no partial matches)", () => {
    expect(classifyEventTone("credential_submit")).toBe("navigation");
    expect(classifyEventTone("suiteconfig")).toBe("navigation");
    expect(classifyEventTone("xcred_test")).toBe("navigation");
    expect(classifyEventTone("xsuite_test")).toBe("navigation");
  });

  it("non-string inputs return navigation", () => {
    const nonStrings = [42, null, undefined, true, false, {}, [], NaN, 0];
    for (const input of nonStrings) {
      expect(classifyEventTone(input as string)).toBe("navigation");
    }
  });

  it("cred_ takes priority (no suite_ collision possible)", () => {
    expect(classifyEventTone("cred_suite_test")).toBe("credential");
  });
});

// ---------------------------------------------------------------------------
// explainReasonCode property tests
// ---------------------------------------------------------------------------

describe("explainReasonCode property tests", () => {
  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (code) => {
        const result = explainReasonCode(code);
        expect(typeof result).toBe("string");
      }),
      { numRuns: 500 },
    );
  });

  it("known codes always map to a DIFFERENT string (not passthrough)", () => {
    for (const code of ALL_KNOWN_CODES) {
      const explanation = explainReasonCode(code);
      expect(explanation).not.toBe(code);
    }
  });

  it("known codes produce non-empty explanations", () => {
    for (const code of ALL_KNOWN_CODES) {
      expect(explainReasonCode(code).length).toBeGreaterThan(0);
    }
  });

  it("known code explanations are all unique (no two codes share an explanation)", () => {
    const seen = new Set<string>();
    for (const code of ALL_KNOWN_CODES) {
      const explanation = explainReasonCode(code);
      expect(seen.has(explanation)).toBe(false);
      seen.add(explanation);
    }
  });

  it("unknown codes pass through unchanged", () => {
    fc.assert(
      fc.property(arbUnknownCode, (code) => {
        expect(explainReasonCode(code)).toBe(code);
      }),
      { numRuns: 300 },
    );
  });

  it("empty string passes through as empty string", () => {
    expect(explainReasonCode("")).toBe("");
  });

  it("all Object.prototype keys pass through unchanged (no prototype pollution)", () => {
    for (const key of OBJECT_PROTOTYPE_KEYS) {
      expect(explainReasonCode(key)).toBe(key);
      expect(typeof explainReasonCode(key)).toBe("string");
    }
  });

  it("all known explanations are at most 80 characters", () => {
    for (const code of ALL_KNOWN_CODES) {
      expect(explainReasonCode(code).length).toBeLessThanOrEqual(80);
    }
  });

  it("is idempotent for unknown codes (explain(explain(x)) === explain(x))", () => {
    fc.assert(
      fc.property(arbUnknownCode, (code) => {
        const once = explainReasonCode(code);
        const twice = explainReasonCode(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 200 },
    );
  });

  it("explaining a known code's explanation returns it unchanged (explanation is not a code key)", () => {
    fc.assert(
      fc.property(arbKnownCode, (code) => {
        const explanation = explainReasonCode(code);
        const reExplained = explainReasonCode(explanation);
        expect(reExplained).toBe(explanation);
      }),
      { numRuns: 100 },
    );
  });

  it("no explanation text is itself a known code key", () => {
    const knownCodeSet = new Set(ALL_KNOWN_CODES);
    for (const code of ALL_KNOWN_CODES) {
      const explanation = explainReasonCode(code);
      expect((knownCodeSet as Set<string>).has(explanation)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// explainReasonCodes property tests
// ---------------------------------------------------------------------------

describe("explainReasonCodes property tests", () => {
  it("preserves array length", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 50 }), { maxLength: 20 }),
        (codes) => {
          expect(explainReasonCodes(codes)).toHaveLength(codes.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is element-wise equivalent to explainReasonCode", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 50 }), { maxLength: 20 }),
        (codes) => {
          const batch = explainReasonCodes(codes);
          for (let i = 0; i < codes.length; i++) {
            expect(batch[i]).toBe(explainReasonCode(codes[i]!));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("empty array returns empty array", () => {
    expect(explainReasonCodes([])).toEqual([]);
  });

  it("preserves order of inputs", () => {
    const codes = ["nrs_cross_site", "unknown_code", "no_accessible_name"];
    const result = explainReasonCodes(codes);
    expect(result[0]).toBe(explainReasonCode("nrs_cross_site"));
    expect(result[1]).toBe("unknown_code");
    expect(result[2]).toBe(explainReasonCode("no_accessible_name"));
  });

  it("all-known-codes array produces all-different explanations", () => {
    const result = explainReasonCodes([...ALL_KNOWN_CODES]);
    for (let i = 0; i < ALL_KNOWN_CODES.length; i++) {
      expect(result[i]).not.toBe(ALL_KNOWN_CODES[i]);
    }
  });

  it("mixed known and unknown codes are handled correctly", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(arbKnownCode, arbUnknownCode),
          { minLength: 1, maxLength: 10 },
        ),
        (codes) => {
          const result = explainReasonCodes(codes);
          expect(result).toHaveLength(codes.length);
          for (let i = 0; i < codes.length; i++) {
            if ((ALL_KNOWN_CODES as readonly string[]).includes(codes[i]!)) {
              expect(result[i]).not.toBe(codes[i]);
            } else {
              expect(result[i]).toBe(codes[i]);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
