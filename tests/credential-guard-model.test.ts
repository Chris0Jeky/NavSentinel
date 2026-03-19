import { describe, expect, it } from "vitest";
import type { CredentialSettings } from "../extension/src/shared/storage";
import {
  deriveCredentialPasteState,
  getCredentialReasonLines,
  isCrossSiteCredentialAction,
  shouldPromptCredentialSubmit
} from "../extension/src/content/credential_guard_model";

const baseConfig: CredentialSettings = {
  mode: "smart",
  promptOnUntrustedDomain: true,
  promptOnMediumRisk: true,
  mediumRiskThreshold: 40,
  blockHttpPasswordSubmit: true,
  warnOnPaste: true,
  similarity: {
    enabled: true,
    maxDistance: 2
  }
};

describe("credential guard model", () => {
  it("prompts for non-https submits regardless of trust state", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 5,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: false,
        crossSite: false,
        config: baseConfig
      })
    ).toBe(true);
  });

  it("prompts for untrusted cross-site actions even below medium risk", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 18,
        pageTrusted: true,
        actionTrusted: false,
        isHttpsOk: true,
        crossSite: true,
        config: baseConfig
      })
    ).toBe(true);
  });

  it("does not prompt when the page is trusted and risk stays below threshold", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 10,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: baseConfig
      })
    ).toBe(false);
  });

  it("derives paste warning state from the registrable domain", () => {
    expect(deriveCredentialPasteState("https://login.example.com/account", ["example.com"])).toEqual({
      siteLabel: "example.com",
      shouldWarn: false
    });

    expect(deriveCredentialPasteState("http://127.0.0.1:5173/demo", [])).toEqual({
      siteLabel: "127.0.0.1",
      shouldWarn: true
    });
  });

  it("limits modal reason lines and detects cross-site actions by host", () => {
    const reasons = Array.from({ length: 12 }, (_, index) => ({
      code: `R${index}`,
      label: `Reason ${index}`
    }));

    expect(getCredentialReasonLines(reasons)).toHaveLength(10);
    expect(
      isCrossSiteCredentialAction({
        score: 0,
        severity: "none",
        reasons: [],
        page: {
          url: "https://example.com/login",
          host: "example.com",
          registrableDomain: "example.com",
          isHttps: true,
          isTrusted: true
        },
        action: {
          url: "https://submit.example.com/post",
          host: "submit.example.com",
          registrableDomain: "example.com",
          isHttps: true,
          isTrusted: true
        },
        lookalike: null
      })
    ).toBe(true);
  });
});
