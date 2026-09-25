import { describe, expect, it } from "vitest";
import { explainReasonCode } from "../extension/src/shared/explanations";
import { isRiskReducingReason as sharedIsRiskReducingReason } from "../extension/src/shared/reason_codes";
import { isRiskReducingReason as popupIsRiskReducingReason } from "../extension/src/popup/popup_model";

describe("isRiskReducingReason consumers (#216)", () => {
  it("keeps popup and content-toast classifications identical", () => {
    const reasonCodes = [
      "nrs_allowlisted",
      "nrs_user_activation_active",
      "nrs_explicit_new_tab_intent",
      "nrs_opener_previously_allowed",
      "keyboard_activation",
      "legit_captcha_present",
      "legit_modal_backdrop",
      "spoofed_user_activation",
      "fake_legit_overlay",
      "no_keyboard_activation",
      "clickfix_command_with_overlay",
      "",
    ];

    for (const reasonCode of reasonCodes) {
      expect(popupIsRiskReducingReason(reasonCode)).toBe(sharedIsRiskReducingReason(reasonCode));
    }
  });
});

describe("user-activation presentation (#217)", () => {
  it("does not present a positive-score signal as risk-reducing", () => {
    expect(sharedIsRiskReducingReason("nrs_user_activation_active")).toBe(false);
    expect(popupIsRiskReducingReason("nrs_user_activation_active")).toBe(false);
  });

  it("describes the observation without claiming that it makes navigation safer", () => {
    const explanation = explainReasonCode("nrs_user_activation_active");

    expect(explanation).toBe(
      "The browser still considered a user gesture active when navigation began",
    );
    expect(explanation.toLowerCase()).not.toContain("safer");
    expect(explanation.toLowerCase()).not.toContain("lower risk");
  });
});
