import { describe, expect, it } from "vitest";
import { normalizeStoredSuiteSettings } from "../extension/src/shared/storage_impl";

describe("storage boolean coercion", () => {
  it("normalizes crafted non-boolean leaves to booleans with protections enabled by default", () => {
    const normalized = normalizeStoredSuiteSettings({
      autoSave: 0,
      nav: { debug: "yes", autoDismissOverlays: 1 },
      credential: {
        promptOnUntrustedDomain: "",
        promptOnMediumRisk: null,
        blockHttpPasswordSubmit: 0,
        warnOnPaste: "",
        similarity: { enabled: 0 },
      },
    } as unknown as Parameters<typeof normalizeStoredSuiteSettings>[0]);

    expect(typeof normalized.autoSave).toBe("boolean");
    expect(typeof normalized.nav.debug).toBe("boolean");
    expect(typeof normalized.nav.autoDismissOverlays).toBe("boolean");
    expect(typeof normalized.credential.promptOnUntrustedDomain).toBe("boolean");
    expect(typeof normalized.credential.promptOnMediumRisk).toBe("boolean");
    expect(typeof normalized.credential.blockHttpPasswordSubmit).toBe("boolean");
    expect(typeof normalized.credential.warnOnPaste).toBe("boolean");
    expect(typeof normalized.credential.similarity.enabled).toBe("boolean");

    expect(normalized.nav.debug).toBe(false);
    expect(normalized.nav.autoDismissOverlays).toBe(false);
    expect(normalized.credential.promptOnUntrustedDomain).toBe(true);
    expect(normalized.credential.promptOnMediumRisk).toBe(true);
    expect(normalized.credential.blockHttpPasswordSubmit).toBe(true);
    expect(normalized.credential.warnOnPaste).toBe(true);
    expect(normalized.credential.similarity.enabled).toBe(true);
  });

  it("keeps HTTP-submit block plus untrusted/medium-risk prompts enabled unless explicitly set false", () => {
    const enabled = normalizeStoredSuiteSettings({
      credential: {
        promptOnUntrustedDomain: "",
        promptOnMediumRisk: 0,
        blockHttpPasswordSubmit: null,
      },
    } as unknown as Parameters<typeof normalizeStoredSuiteSettings>[0]);
    expect(enabled.credential.promptOnUntrustedDomain).toBe(true);
    expect(enabled.credential.promptOnMediumRisk).toBe(true);
    expect(enabled.credential.blockHttpPasswordSubmit).toBe(true);

    const disabled = normalizeStoredSuiteSettings({
      credential: {
        promptOnUntrustedDomain: false,
        promptOnMediumRisk: false,
        blockHttpPasswordSubmit: false,
        warnOnPaste: false,
        similarity: { enabled: false },
      },
    } as unknown as Parameters<typeof normalizeStoredSuiteSettings>[0]);
    expect(disabled.credential.promptOnUntrustedDomain).toBe(false);
    expect(disabled.credential.promptOnMediumRisk).toBe(false);
    expect(disabled.credential.blockHttpPasswordSubmit).toBe(false);
    expect(disabled.credential.warnOnPaste).toBe(false);
    expect(disabled.credential.similarity.enabled).toBe(false);
  });
});
