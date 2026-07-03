import { describe, it, expect } from "vitest";
import {
  classifyCorpusOutcome,
  tallyCorpusOutcomes,
  PROTECTED_EVENT_KINDS,
  FIRED_LATE_EVENT_KINDS,
  DETECTION_EVENT_KINDS,
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

  it("treats a bare toast as fired-late, NOT protected", () => {
    // A toast on its own is post-render (rollback toast / reputation late-warn /
    // mutation overlay), so it must not upgrade a page to protected.
    const out = classifyCorpusOutcome({ hadToast: true });
    expect(out.level).toBe("fired");
    expect(out.firedBy).toContain("toast");
    expect(out.protectedBy).toEqual([]);
  });

  it("keeps a post-render rollback + its own toast as fired (regression: #417 toast-upgrade bug)", () => {
    // The rollback path also shows a persistent toast; a rollback must NOT be
    // upgraded to protected just because it rendered a toast.
    const out = classifyCorpusOutcome({ detectionKinds: ["nav_rollback"], hadToast: true });
    expect(out.level).toBe("fired");
    expect(out.protectedBy).toEqual([]);
    expect(out.firedBy).toEqual(expect.arrayContaining(["nav_rollback", "toast"]));
  });

  it("classifies a lone post-render rollback as fired (not protected)", () => {
    const out = classifyCorpusOutcome({ detectionKinds: ["nav_rollback"] });
    expect(out.level).toBe("fired");
    expect(out.firedBy).toEqual(["nav_rollback"]);
    expect(out.protectedBy).toEqual([]);
  });

  it("still prefers protected when a pre-harm kind co-occurs with a toast", () => {
    const out = classifyCorpusOutcome({ detectionKinds: ["cred_submit_prompt"], hadToast: true });
    expect(out.level).toBe("protected");
    expect(out.protectedBy).toEqual(["cred_submit_prompt"]);
    expect(out.firedBy).toEqual(["toast"]);
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

  it("exposes DETECTION_EVENT_KINDS as exactly the union of protected + fired-late", () => {
    // The Playwright lane filters its event log by DETECTION_EVENT_KINDS; keeping
    // it derived here prevents drift (a kind in the filter but neither bucket
    // would silently classify as miss).
    const union = new Set([...PROTECTED_EVENT_KINDS, ...FIRED_LATE_EVENT_KINDS]);
    expect(new Set(DETECTION_EVENT_KINDS)).toEqual(union);
    expect(DETECTION_EVENT_KINDS.size).toBe(PROTECTED_EVENT_KINDS.size + FIRED_LATE_EVENT_KINDS.size);
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
