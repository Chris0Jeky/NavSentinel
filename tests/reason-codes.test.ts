import { describe, expect, it } from "vitest";
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
