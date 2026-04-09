import { describe, expect, it } from "vitest";
import {
  computeCredentialRisk,
  detectBrandInDomain,
  detectLookalike,
  detectSubdomainStuffing,
  findClosestLookalike,
  getRegistrableDomain,
  isMixedScript,
  normalizeHomoglyphs
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

// ---------------------------------------------------------------------------
// P1-03: Enhanced lookalike detection tests
// ---------------------------------------------------------------------------

describe("normalizeHomoglyphs", () => {
  it("normalizes 0 to o", () => {
    expect(normalizeHomoglyphs("g00gle")).toBe("google");
  });

  it("normalizes 1 to l", () => {
    expect(normalizeHomoglyphs("paypa1")).toBe("paypal");
  });

  it("normalizes rn to m", () => {
    expect(normalizeHomoglyphs("arnazon")).toBe("amazon");
  });

  it("normalizes vv to w", () => {
    expect(normalizeHomoglyphs("vvellsfargo")).toBe("wellsfargo");
  });

  it("normalizes cl to d", () => {
    expect(normalizeHomoglyphs("reclclit")).toBe("reddit");
  });

  it("handles mixed confusables", () => {
    expect(normalizeHomoglyphs("paypa1-secure")).toBe("paypal-secure");
  });

  it("returns empty for empty input", () => {
    expect(normalizeHomoglyphs("")).toBe("");
  });

  it("lowercases input", () => {
    expect(normalizeHomoglyphs("PAYPAL")).toBe("paypal");
  });

  it("leaves clean strings untouched", () => {
    expect(normalizeHomoglyphs("paypal")).toBe("paypal");
  });
});

describe("detectBrandInDomain", () => {
  it("catches paypal-secure.com", () => {
    const result = detectBrandInDomain("paypal-secure.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("paypal");
    expect(result!.canonicalDomain).toBe("paypal.com");
  });

  it("catches apple-verify.net", () => {
    const result = detectBrandInDomain("apple-verify.net");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("apple");
  });

  it("catches googlesecurity.com", () => {
    const result = detectBrandInDomain("googlesecurity.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("google");
  });

  it("catches netflix-login.com", () => {
    const result = detectBrandInDomain("netflix-login.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("netflix");
  });

  it("catches microsoft-update.com", () => {
    const result = detectBrandInDomain("microsoft-update.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("microsoft");
  });

  it("does NOT flag paypal.com itself", () => {
    expect(detectBrandInDomain("paypal.com")).toBeNull();
  });

  it("does NOT flag google.com itself", () => {
    expect(detectBrandInDomain("google.com")).toBeNull();
  });

  it("does NOT flag apple.com itself", () => {
    expect(detectBrandInDomain("apple.com")).toBeNull();
  });

  it("does NOT flag an unrelated domain", () => {
    expect(detectBrandInDomain("example.com")).toBeNull();
  });

  it("does NOT flag a domain with no dots", () => {
    expect(detectBrandInDomain("localhost")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(detectBrandInDomain("")).toBeNull();
  });

  it("catches homoglyph-augmented brand domains (paypa1-login.com)", () => {
    const result = detectBrandInDomain("paypa1-login.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("paypal");
  });

  it("catches brand with hyphens stripped (pay-pal-secure.com)", () => {
    const result = detectBrandInDomain("pay-pal-secure.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("paypal");
  });
});

describe("detectSubdomainStuffing", () => {
  it("catches paypal.login.example.com", () => {
    const result = detectSubdomainStuffing("paypal.login.example.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("paypal");
    expect(result!.canonicalDomain).toBe("paypal.com");
  });

  it("catches google.auth.phishing.net", () => {
    const result = detectSubdomainStuffing("google.auth.phishing.net");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("google");
  });

  it("catches apple.secure.evil.com", () => {
    const result = detectSubdomainStuffing("apple.secure.evil.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("apple");
  });

  it("catches microsoft as a subdomain", () => {
    const result = detectSubdomainStuffing("microsoft.update.phish.org");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("microsoft");
  });

  it("does NOT flag legitimate subdomain of brand domain (login.paypal.com)", () => {
    expect(detectSubdomainStuffing("login.paypal.com")).toBeNull();
  });

  it("does NOT flag www.google.com", () => {
    expect(detectSubdomainStuffing("www.google.com")).toBeNull();
  });

  it("does NOT flag domains with no subdomains", () => {
    expect(detectSubdomainStuffing("example.com")).toBeNull();
  });

  it("does NOT flag unrelated subdomains", () => {
    expect(detectSubdomainStuffing("foo.bar.example.com")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(detectSubdomainStuffing("")).toBeNull();
  });

  it("catches homoglyph subdomain stuffing (paypa1.evil.com)", () => {
    const result = detectSubdomainStuffing("paypa1.evil.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("paypal");
  });
});

describe("detectLookalike (combined)", () => {
  const trusted = ["paypal.com", "google.com"];

  it("detects homoglyph lookalike paypaI.com via normalized Levenshtein", () => {
    // Capital I -> lowercase i via normalizeHost, but "paypai.com" vs "paypal.com"
    // has Levenshtein distance 1 (i vs l). The homoglyph normalization doesn't
    // help here because 'i' is not in the confusable table.
    // But paypa1.com -> normalizeHomoglyphs -> paypal.com (distance 0)
    const result = detectLookalike("paypa1.com", trusted);
    expect(result.homoglyphLevenshtein).not.toBeNull();
    expect(result.homoglyphLevenshtein!.distance).toBe(0);
    expect(result.homoglyphLevenshtein!.target).toBe("paypal.com");
  });

  it("detects brand keyword in paypal-secure.com", () => {
    const result = detectLookalike("paypal-secure.com", trusted);
    expect(result.brandKeyword).not.toBeNull();
    expect(result.brandKeyword!.brand).toBe("paypal");
  });

  it("detects subdomain stuffing in paypal.login.example.com", () => {
    const result = detectLookalike("paypal.login.example.com", trusted);
    expect(result.subdomainStuffing).not.toBeNull();
    expect(result.subdomainStuffing!.brand).toBe("paypal");
  });

  it("returns nulls for a completely unrelated domain", () => {
    const result = detectLookalike("randomsite.org", trusted);
    expect(result.brandKeyword).toBeNull();
    expect(result.subdomainStuffing).toBeNull();
  });

  it("returns nulls for empty input", () => {
    const result = detectLookalike("", trusted);
    expect(result.brandKeyword).toBeNull();
    expect(result.subdomainStuffing).toBeNull();
    expect(result.levenshtein).toBeNull();
    expect(result.homoglyphLevenshtein).toBeNull();
  });
});

describe("computeCredentialRisk enhanced detection", () => {
  it("flags paypal-secure.com with BRAND_KEYWORD_DOMAIN", () => {
    const risk = computeCredentialRisk({
      pageUrl: "https://paypal-secure.com/login",
      actionUrl: "https://paypal-secure.com/post",
      trustedDomains: ["paypal.com"],
      config: baseConfig
    });

    expect(risk.reasons.map((r) => r.code)).toContain("BRAND_KEYWORD_DOMAIN");
    expect(risk.severity).toBe("medium");
  });

  it("flags apple-verify.net with BRAND_KEYWORD_DOMAIN", () => {
    const risk = computeCredentialRisk({
      pageUrl: "https://apple-verify.net/login",
      actionUrl: "https://apple-verify.net/post",
      trustedDomains: ["apple.com"],
      config: baseConfig
    });

    expect(risk.reasons.map((r) => r.code)).toContain("BRAND_KEYWORD_DOMAIN");
  });

  it("flags paypal.login.example.com with SUBDOMAIN_STUFFING", () => {
    const risk = computeCredentialRisk({
      pageUrl: "https://paypal.login.example.com/login",
      actionUrl: "https://paypal.login.example.com/post",
      trustedDomains: ["paypal.com"],
      config: baseConfig
    });

    expect(risk.reasons.map((r) => r.code)).toContain("SUBDOMAIN_STUFFING");
  });

  it("does NOT flag paypal.com itself", () => {
    const risk = computeCredentialRisk({
      pageUrl: "https://paypal.com/login",
      actionUrl: "https://paypal.com/post",
      trustedDomains: ["paypal.com"],
      config: baseConfig
    });

    const codes = risk.reasons.map((r) => r.code);
    expect(codes).not.toContain("BRAND_KEYWORD_DOMAIN");
    expect(codes).not.toContain("SUBDOMAIN_STUFFING");
    expect(codes).not.toContain("HOMOGLYPH_LOOKALIKE");
    expect(codes).not.toContain("LOOKALIKE_DOMAIN");
    expect(risk.severity).toBe("none");
  });

  it("does NOT flag login.paypal.com (legitimate subdomain)", () => {
    const risk = computeCredentialRisk({
      pageUrl: "https://login.paypal.com/login",
      actionUrl: "https://login.paypal.com/post",
      trustedDomains: ["paypal.com"],
      config: baseConfig
    });

    const codes = risk.reasons.map((r) => r.code);
    expect(codes).not.toContain("SUBDOMAIN_STUFFING");
    expect(codes).not.toContain("BRAND_KEYWORD_DOMAIN");
    expect(risk.severity).toBe("none");
  });

  it("skips enhanced detection when similarity is disabled", () => {
    const disabledConfig: CredentialSettings = {
      ...baseConfig,
      similarity: { enabled: false, maxDistance: 2 }
    };

    const risk = computeCredentialRisk({
      pageUrl: "https://paypal-secure.com/login",
      actionUrl: "https://paypal-secure.com/post",
      trustedDomains: ["paypal.com"],
      config: disabledConfig
    });

    const codes = risk.reasons.map((r) => r.code);
    expect(codes).not.toContain("BRAND_KEYWORD_DOMAIN");
    expect(codes).not.toContain("SUBDOMAIN_STUFFING");
    expect(codes).not.toContain("HOMOGLYPH_LOOKALIKE");
  });

  it("flags g00gle-login.com via brand keyword + homoglyph normalization", () => {
    const risk = computeCredentialRisk({
      pageUrl: "https://g00gle-login.com/login",
      actionUrl: "https://g00gle-login.com/post",
      trustedDomains: ["google.com"],
      config: baseConfig
    });

    expect(risk.reasons.map((r) => r.code)).toContain("BRAND_KEYWORD_DOMAIN");
  });

  it("does not double-count raw and homoglyph Levenshtein", () => {
    // paypa1.com: raw Levenshtein = 1 (already caught), so homoglyph should not add extra
    const risk = computeCredentialRisk({
      pageUrl: "https://paypa1.com/login",
      actionUrl: "https://paypa1.com/post",
      trustedDomains: ["paypal.com"],
      config: baseConfig
    });

    const codes = risk.reasons.map((r) => r.code);
    expect(codes).toContain("LOOKALIKE_DOMAIN");
    expect(codes).not.toContain("HOMOGLYPH_LOOKALIKE");
  });
});
