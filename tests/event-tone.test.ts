import { describe, it, expect } from "vitest";
import { classifyEventTone } from "../extension/src/shared/event_tone";

describe("classifyEventTone", () => {
  it("classifies credential events (real EventKind values)", () => {
    expect(classifyEventTone("cred_submit_prompt")).toBe("credential");
    expect(classifyEventTone("cred_paste_warn")).toBe("credential");
    expect(classifyEventTone("cred_trust_page")).toBe("credential");
    expect(classifyEventTone("cred_trust_dest")).toBe("credential");
  });

  it("classifies config events (real EventKind values)", () => {
    expect(classifyEventTone("suite_config_update")).toBe("config");
    expect(classifyEventTone("suite_mode_change")).toBe("config");
  });

  it("classifies navigation events as default", () => {
    expect(classifyEventTone("nav_click_block")).toBe("navigation");
    expect(classifyEventTone("nav_blank_prompt")).toBe("navigation");
    expect(classifyEventTone("nav_rollback")).toBe("navigation");
  });

  it("classifies unknown event kinds as navigation", () => {
    expect(classifyEventTone("unknown_event")).toBe("navigation");
    expect(classifyEventTone("something_else")).toBe("navigation");
  });

  it("handles non-string input gracefully", () => {
    expect(classifyEventTone(42 as unknown as string)).toBe("navigation");
    expect(classifyEventTone(null as unknown as string)).toBe("navigation");
    expect(classifyEventTone(undefined as unknown as string)).toBe("navigation");
  });

  it("handles empty string", () => {
    expect(classifyEventTone("")).toBe("navigation");
  });

  it("is case-sensitive (cred_ prefix must be lowercase)", () => {
    expect(classifyEventTone("CRED_submit")).toBe("navigation");
    expect(classifyEventTone("Cred_submit")).toBe("navigation");
  });

  it("detection events fall through to navigation (documented behavior)", () => {
    expect(classifyEventTone("clickfix_detected")).toBe("navigation");
    expect(classifyEventTone("dblclickjack_detected")).toBe("navigation");
    expect(classifyEventTone("pushstate_abuse")).toBe("navigation");
    expect(classifyEventTone("mutation_alert")).toBe("navigation");
  });
});
