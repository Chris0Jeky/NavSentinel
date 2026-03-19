import { describe, expect, it } from "vitest";
import {
  computeCredentialRisk,
  findClosestLookalike,
  getRegistrableDomain,
  isMixedScript
} from "../extension/src/shared/domain";
import type { CredentialSettings } from "../extension/src/shared/storage";

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

describe("credential domain heuristics", () => {
  it("handles multipart public suffixes", () => {
    expect(getRegistrableDomain("foo.bar.co.uk")).toBe("bar.co.uk");
    expect(getRegistrableDomain("app.example.com")).toBe("example.com");
  });

  it("detects mixed-script hostnames", () => {
    expect(isMixedScript("раypal.com")).toBe(true);
    expect(isMixedScript("paypal.com")).toBe(false);
  });

  it("finds the closest trusted lookalike", () => {
    expect(findClosestLookalike("paypa1.com", ["paypal.com", "example.com"])).toEqual({
      target: "paypal.com",
      distance: 1
    });
  });

  it("scores risky non-https lookalike submits as high severity", () => {
    const risk = computeCredentialRisk({
      pageUrl: "http://paypa1.com/login",
      actionUrl: "http://paypa1.com/post",
      trustedDomains: ["paypal.com"],
      config: baseConfig
    });

    expect(risk.severity).toBe("high");
    expect(risk.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(["NON_HTTPS_PAGE", "NON_HTTPS_ACTION", "LOOKALIKE_DOMAIN"])
    );
  });

  it("reuses the closest lookalike result in the returned risk payload", () => {
    const risk = computeCredentialRisk({
      pageUrl: "https://paypa1.com/login",
      actionUrl: "https://paypa1.com/post",
      trustedDomains: ["paypal.com"],
      config: baseConfig
    });

    expect(risk.lookalike).toEqual({
      target: "paypal.com",
      distance: 1
    });
  });
});
