import { describe, expect, it } from "vitest";
import {
  deriveOptionsSettingsPatch,
  type SuiteSettings,
} from "../extension/src/shared/storage_impl";

const BASELINE: SuiteSettings = {
  autoSave: true,
  nav: { defaultMode: "smart", debug: false, autoDismissOverlays: false },
  credential: {
    mode: "smart",
    promptOnUntrustedDomain: true,
    promptOnMediumRisk: true,
    mediumRiskThreshold: 40,
    blockHttpPasswordSubmit: true,
    warnOnPaste: true,
    similarity: { enabled: true, maxDistance: 2 },
  },
  logLimit: 300,
};

describe("deriveOptionsSettingsPatch", () => {
  it("ignores inherited keys on the draft", () => {
    const draft = Object.assign(Object.create({ injected: 1 }), BASELINE, {
      nav: { ...BASELINE.nav },
    });
    const patch = deriveOptionsSettingsPatch(BASELINE, draft as SuiteSettings);
    expect(Object.keys(patch)).not.toContain("injected");
    expect("injected" in patch).toBe(false);
  });

  it("derives the changed leaves for a normal diff", () => {
    const draft: SuiteSettings = {
      ...BASELINE,
      nav: { ...BASELINE.nav, debug: true },
      logLimit: 400,
    };
    expect(deriveOptionsSettingsPatch(BASELINE, draft)).toEqual({
      nav: { debug: true },
      logLimit: 400,
    });
  });
});
