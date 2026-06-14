import { describe, expect, it } from "vitest";
import { classifyEventTone } from "../extension/src/shared/event_tone";

describe("classifyEventTone", () => {
  it('returns "credential" for cred_ prefixed kinds', () => {
    expect(classifyEventTone("cred_submit_prompt")).toBe("credential");
    expect(classifyEventTone("cred_submit_allow_once")).toBe("credential");
    expect(classifyEventTone("cred_trust_domain")).toBe("credential");
    expect(classifyEventTone("cred_untrust_domain")).toBe("credential");
    expect(classifyEventTone("cred_paste_warn")).toBe("credential");
    expect(classifyEventTone("cred_form_evaluated")).toBe("credential");
  });

  it('returns "config" for suite_ prefixed kinds', () => {
    expect(classifyEventTone("suite_config_update")).toBe("config");
    expect(classifyEventTone("suite_anything")).toBe("config");
  });

  it('returns "navigation" for nav_ prefixed kinds', () => {
    expect(classifyEventTone("nav_blank_prompt")).toBe("navigation");
    expect(classifyEventTone("nav_click_block")).toBe("navigation");
    expect(classifyEventTone("nav_silent_allow")).toBe("navigation");
    expect(classifyEventTone("nav_rollback")).toBe("navigation");
    expect(classifyEventTone("nav_allowlist_add")).toBe("navigation");
    expect(classifyEventTone("nav_allowlist_remove")).toBe("navigation");
  });

  it('returns "navigation" for unprefixed kinds', () => {
    expect(classifyEventTone("clickfix_detected")).toBe("navigation");
    expect(classifyEventTone("dblclickjack_detected")).toBe("navigation");
    expect(classifyEventTone("mutation_alert")).toBe("navigation");
    expect(classifyEventTone("pushstate_abuse")).toBe("navigation");
    expect(classifyEventTone("nav_reputation_late_warn")).toBe("navigation");
  });

  it('returns "navigation" for non-string input', () => {
    expect(classifyEventTone(42 as unknown as string)).toBe("navigation");
    expect(classifyEventTone(null as unknown as string)).toBe("navigation");
    expect(classifyEventTone(undefined as unknown as string)).toBe("navigation");
  });

  it('returns "navigation" for empty string', () => {
    expect(classifyEventTone("")).toBe("navigation");
  });

  it('returns "navigation" for unknown string kinds', () => {
    expect(classifyEventTone("unknown_kind")).toBe("navigation");
    expect(classifyEventTone("something_else")).toBe("navigation");
  });
});
