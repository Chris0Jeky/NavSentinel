import { describe, it, expect } from "vitest";
import {
  classifyCorpusOutcome,
  tallyCorpusOutcomes,
  PROTECTED_EVENT_KINDS,
  FIRED_LATE_EVENT_KINDS,
  type CorpusOutcome,
} from "./corpus_scoring";

describe("classifyCorpusOutcome", () => {
  it("classifies a pre-submit credential prompt as protected", () => {
    const out = classifyCorpusOutcome({ detectionKinds: ["cred_submit_prompt"] });
    expect(out.level).toBe("protected");
    expect(out.protectedBy).toEqual(["cred_submit_prompt"]);
    expect(out.firedBy).toEqual([]);
  });

  it.each([
    "nav_blank_prompt",
    "nav_click_block",
    "cred_submit_prompt",
    "cred_paste_warn",
  ])("classifies pre-harm signal %s as protected", (kind) => {
    expect(classifyCorpusOutcome({ detectionKinds: [kind] }).level).toBe("protected");
  });

  it("treats a shown credential modal as protected", () => {
    const out = classifyCorpusOutcome({ hadCredentialModal: true });
    expect(out.level).toBe("protected");
    expect(out.protectedBy).toContain("credential_modal");
  });

  it("treats a shown risk toast/prompt as protected", () => {
    const out = classifyCorpusOutcome({ hadToastPrompt: true });
    expect(out.level).toBe("protected");
    expect(out.protectedBy).toContain("toast_prompt");
  });

  it("classifies a lone post-render rollback as fired (not protected)", () => {
    const out = classifyCorpusOutcome({ detectionKinds: ["nav_rollback"] });
    expect(out.level).toBe("fired");
    expect(out.firedBy).toEqual(["nav_rollback"]);
    expect(out.protectedBy).toEqual([]);
  });

  it("prefers protected when both a pre-harm block and a rollback fired", () => {
    const out = classifyCorpusOutcome({
      detectionKinds: ["nav_rollback", "cred_submit_prompt"],
    });
    expect(out.level).toBe("protected");
    expect(out.protectedBy).toEqual(["cred_submit_prompt"]);
    expect(out.firedBy).toEqual(["nav_rollback"]);
  });

  it("classifies no signals as miss", () => {
    expect(classifyCorpusOutcome({}).level).toBe("miss");
    expect(classifyCorpusOutcome({ detectionKinds: [] }).level).toBe("miss");
  });

  it("ignores unknown event kinds (miss when nothing else fires)", () => {
    const out = classifyCorpusOutcome({ detectionKinds: ["some_unrelated_kind"] });
    expect(out.level).toBe("miss");
    expect(out.protectedBy).toEqual([]);
    expect(out.firedBy).toEqual([]);
  });

  it("deduplicates repeated signals in the reported arrays", () => {
    const out = classifyCorpusOutcome({
      detectionKinds: ["nav_rollback", "nav_rollback"],
    });
    expect(out.level).toBe("fired");
    expect(out.firedBy).toEqual(["nav_rollback"]);
  });

  it("keeps the protected and fired-late kind sets disjoint (no signal counts as both)", () => {
    for (const k of PROTECTED_EVENT_KINDS) {
      expect(FIRED_LATE_EVENT_KINDS.has(k)).toBe(false);
    }
  });
});

describe("tallyCorpusOutcomes", () => {
  it("counts protected / fired / miss and the total", () => {
    const outcomes: CorpusOutcome[] = [
      { level: "protected", protectedBy: ["cred_submit_prompt"], firedBy: [] },
      { level: "protected", protectedBy: ["nav_click_block"], firedBy: [] },
      { level: "fired", protectedBy: [], firedBy: ["nav_rollback"] },
      { level: "miss", protectedBy: [], firedBy: [] },
    ];
    expect(tallyCorpusOutcomes(outcomes)).toEqual({
      protected: 2,
      fired: 1,
      miss: 1,
      total: 4,
    });
  });

  it("returns all-zero (total 0) for an empty run", () => {
    expect(tallyCorpusOutcomes([])).toEqual({ protected: 0, fired: 0, miss: 0, total: 0 });
  });
});
