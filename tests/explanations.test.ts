import { describe, expect, it } from "vitest";
import { explainReasonCode, explainReasonCodes } from "../extension/src/shared/explanations";

const KNOWN_CDS_CODES = [
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
];

const KNOWN_NRS_CODES = [
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
  "nrs_csp_weakness",
  "nrs_domain_repeat_offender",
];

const KNOWN_CLICKFIX_CODES = [
  "clipboard_command_with_overlay",
  "clipboard_write_with_overlay",
  "clickfix_instruction_pattern",
  "clickfix_paste_instruction",
  "clickfix_captcha_text_with_overlay",
];

const KNOWN_MUTATION_CODES = [
  "overlay_injected",
  "form_action_changed",
  "password_injected",
  "suspicious_iframe",
];

const KNOWN_EVENT_CODES = [
  "clickfix_detected",
  "dblclickjack_detected",
  "mutation_alert",
  "pushstate_abuse",
];

const ALL_KNOWN_CODES = [...KNOWN_CDS_CODES, ...KNOWN_NRS_CODES, ...KNOWN_CLICKFIX_CODES, ...KNOWN_MUTATION_CODES, ...KNOWN_EVENT_CODES];

describe("explainReasonCode", () => {
  it("maps every known CDS reason code to a human-readable string", () => {
    for (const code of KNOWN_CDS_CODES) {
      const explanation = explainReasonCode(code);
      expect(explanation).not.toBe(code);
      expect(explanation.length).toBeGreaterThan(0);
    }
  });

  it("maps every known NRS factor code to a human-readable string", () => {
    for (const code of KNOWN_NRS_CODES) {
      const explanation = explainReasonCode(code);
      expect(explanation).not.toBe(code);
      expect(explanation.length).toBeGreaterThan(0);
    }
  });

  it("maps every known ClickFix reason code to a human-readable string", () => {
    for (const code of KNOWN_CLICKFIX_CODES) {
      const explanation = explainReasonCode(code);
      expect(explanation).not.toBe(code);
      expect(explanation.length).toBeGreaterThan(0);
    }
  });

  it("maps every known mutation reason code to a human-readable string", () => {
    for (const code of KNOWN_MUTATION_CODES) {
      const explanation = explainReasonCode(code);
      expect(explanation).not.toBe(code);
      expect(explanation.length).toBeGreaterThan(0);
    }
  });

  it("maps every known event code to a human-readable string", () => {
    for (const code of KNOWN_EVENT_CODES) {
      const explanation = explainReasonCode(code);
      expect(explanation).not.toBe(code);
      expect(explanation.length).toBeGreaterThan(0);
    }
  });

  it("returns unknown codes as-is (passthrough)", () => {
    expect(explainReasonCode("totally_unknown_code")).toBe("totally_unknown_code");
    expect(explainReasonCode("")).toBe("");
    expect(explainReasonCode("some_future_reason")).toBe("some_future_reason");
  });

  it("keeps all explanations under 80 characters", () => {
    for (const code of ALL_KNOWN_CODES) {
      const explanation = explainReasonCode(code);
      expect(explanation.length).toBeLessThanOrEqual(80);
    }
  });
});

describe("explainReasonCodes", () => {
  it("maps an array of codes to explanations", () => {
    const codes = ["no_accessible_name", "nrs_cross_site"];
    const result = explainReasonCodes(codes);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("This clickable area has no visible label");
    expect(result[1]).toBe("Navigation goes to a different website");
  });

  it("handles empty arrays", () => {
    expect(explainReasonCodes([])).toEqual([]);
  });

  it("passes through unknown codes in mixed arrays", () => {
    const codes = ["nrs_cross_site", "unknown_code"];
    const result = explainReasonCodes(codes);
    expect(result[0]).toBe("Navigation goes to a different website");
    expect(result[1]).toBe("unknown_code");
  });
});
