import { describe, expect, it } from "vitest";
import type { CredentialSettings } from "../extension/src/shared/storage";
import type { RiskResult } from "../extension/src/shared/domain";
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

function cfg(overrides: Partial<CredentialSettings> = {}): CredentialSettings {
  return { ...baseConfig, ...overrides };
}

describe("shouldPromptCredentialSubmit", () => {
  it("returns false when mode is off", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "off",
        riskScore: 100,
        pageTrusted: false,
        actionTrusted: false,
        isHttpsOk: false,
        crossSite: true,
        config: baseConfig,
      })
    ).toBe(false);
  });

  it("prompts for non-HTTPS when blockHttpPasswordSubmit is enabled", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 0,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: false,
        crossSite: false,
        config: cfg({ blockHttpPasswordSubmit: true }),
      })
    ).toBe(true);
  });

  it("does not prompt for non-HTTPS when blockHttpPasswordSubmit is disabled", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 0,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: false,
        crossSite: false,
        config: cfg({ blockHttpPasswordSubmit: false }),
      })
    ).toBe(false);
  });

  it("prompts for cross-site untrusted action at risk >= 15", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 15,
        pageTrusted: true,
        actionTrusted: false,
        isHttpsOk: true,
        crossSite: true,
        config: baseConfig,
      })
    ).toBe(true);
  });

  it("does not prompt for cross-site untrusted action at risk < 15", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 14,
        pageTrusted: true,
        actionTrusted: false,
        isHttpsOk: true,
        crossSite: true,
        config: baseConfig,
      })
    ).toBe(false);
  });

  it("does not prompt for cross-site trusted action even at high risk", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 80,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: true,
        config: cfg({ promptOnMediumRisk: false }),
      })
    ).toBe(false);
  });

  it("strict mode prompts for untrusted page even at low risk", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "strict",
        riskScore: 0,
        pageTrusted: false,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: baseConfig,
      })
    ).toBe(true);
  });

  it("strict mode prompts at threshold even when page is trusted", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "strict",
        riskScore: 40,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: cfg({ mediumRiskThreshold: 40 }),
      })
    ).toBe(true);
  });

  it("strict mode does not prompt for trusted page below threshold", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "strict",
        riskScore: 39,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: cfg({ mediumRiskThreshold: 40 }),
      })
    ).toBe(false);
  });

  it("smart mode prompts for untrusted page when promptOnUntrustedDomain is on", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 0,
        pageTrusted: false,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: cfg({ promptOnUntrustedDomain: true }),
      })
    ).toBe(true);
  });

  it("smart mode does not prompt for untrusted page when promptOnUntrustedDomain is off", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 0,
        pageTrusted: false,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: cfg({ promptOnUntrustedDomain: false, promptOnMediumRisk: false }),
      })
    ).toBe(false);
  });

  it("smart mode prompts at threshold when promptOnMediumRisk is on", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 40,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: cfg({ mediumRiskThreshold: 40, promptOnMediumRisk: true }),
      })
    ).toBe(true);
  });

  it("smart mode does not prompt at threshold when promptOnMediumRisk is off", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 40,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: cfg({ mediumRiskThreshold: 40, promptOnMediumRisk: false }),
      })
    ).toBe(false);
  });

  it("falls back to 40 threshold when mediumRiskThreshold is NaN", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "strict",
        riskScore: 40,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: cfg({ mediumRiskThreshold: NaN }),
      })
    ).toBe(true);
  });

  it("does not prompt when all signals are safe", () => {
    expect(
      shouldPromptCredentialSubmit({
        mode: "smart",
        riskScore: 10,
        pageTrusted: true,
        actionTrusted: true,
        isHttpsOk: true,
        crossSite: false,
        config: baseConfig,
      })
    ).toBe(false);
  });
});

describe("getCredentialReasonLines", () => {
  it("returns empty array for no reasons", () => {
    expect(getCredentialReasonLines([])).toEqual([]);
  });

  it("maps reason labels for short list", () => {
    const reasons = [
      { code: "A", label: "Alpha" },
      { code: "B", label: "Beta" },
    ];
    expect(getCredentialReasonLines(reasons)).toEqual(["Alpha", "Beta"]);
  });

  it("returns exactly 10 labels for 10 reasons", () => {
    const reasons = Array.from({ length: 10 }, (_, i) => ({
      code: `R${i}`,
      label: `Reason ${i}`,
    }));
    expect(getCredentialReasonLines(reasons)).toHaveLength(10);
  });

  it("truncates to 10 labels for more than 10 reasons", () => {
    const reasons = Array.from({ length: 15 }, (_, i) => ({
      code: `R${i}`,
      label: `Reason ${i}`,
    }));
    const result = getCredentialReasonLines(reasons);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("Reason 0");
    expect(result[9]).toBe("Reason 9");
  });

  it("returns single label for single reason", () => {
    expect(getCredentialReasonLines([{ code: "X", label: "Only one" }])).toEqual(["Only one"]);
  });
});

function makeRisk(pageHost: string, actionHost: string): RiskResult {
  return {
    score: 0,
    severity: "none",
    reasons: [],
    page: {
      url: `https://${pageHost}/`,
      host: pageHost,
      registrableDomain: pageHost,
      isHttps: true,
      isTrusted: true,
    },
    action: {
      url: `https://${actionHost}/submit`,
      host: actionHost,
      registrableDomain: actionHost,
      isHttps: true,
      isTrusted: true,
    },
    lookalike: null,
  };
}

describe("isCrossSiteCredentialAction", () => {
  it("returns true when page and action hosts differ", () => {
    expect(isCrossSiteCredentialAction(makeRisk("example.com", "submit.example.com"))).toBe(true);
  });

  it("returns false when page and action hosts match", () => {
    expect(isCrossSiteCredentialAction(makeRisk("example.com", "example.com"))).toBe(false);
  });

  it("returns false when page host is empty", () => {
    expect(isCrossSiteCredentialAction(makeRisk("", "example.com"))).toBe(false);
  });

  it("returns false when action host is empty", () => {
    expect(isCrossSiteCredentialAction(makeRisk("example.com", ""))).toBe(false);
  });

  it("returns false when both hosts are empty", () => {
    expect(isCrossSiteCredentialAction(makeRisk("", ""))).toBe(false);
  });
});

describe("deriveCredentialPasteState", () => {
  it("returns shouldWarn=false for trusted domain", () => {
    const result = deriveCredentialPasteState("https://login.example.com/account", ["example.com"]);
    expect(result.siteLabel).toBe("example.com");
    expect(result.shouldWarn).toBe(false);
  });

  it("returns shouldWarn=true for untrusted domain", () => {
    const result = deriveCredentialPasteState("https://unknown-site.net/login", []);
    expect(result.siteLabel).toBe("unknown-site.net");
    expect(result.shouldWarn).toBe(true);
  });

  it("returns shouldWarn=true for IP address (not in trusted list)", () => {
    const result = deriveCredentialPasteState("http://127.0.0.1:5173/demo", []);
    expect(result.siteLabel).toBe("127.0.0.1");
    expect(result.shouldWarn).toBe(true);
  });

  it("returns (unknown) and shouldWarn=false for invalid URL", () => {
    const result = deriveCredentialPasteState("not-a-url", []);
    expect(result.siteLabel).toBe("(unknown)");
    expect(result.shouldWarn).toBe(false);
  });

  it("returns (unknown) and shouldWarn=false for empty string URL", () => {
    const result = deriveCredentialPasteState("", []);
    expect(result.siteLabel).toBe("(unknown)");
    expect(result.shouldWarn).toBe(false);
  });

  it("extracts registrable domain from deep subdomain", () => {
    const result = deriveCredentialPasteState("https://a.b.c.example.co.uk/page", ["example.co.uk"]);
    expect(result.siteLabel).toBe("example.co.uk");
    expect(result.shouldWarn).toBe(false);
  });

  it("returns shouldWarn=true for subdomain not in trusted list", () => {
    const result = deriveCredentialPasteState("https://login.phishing.com/", []);
    expect(result.siteLabel).toBe("phishing.com");
    expect(result.shouldWarn).toBe(true);
  });
});
