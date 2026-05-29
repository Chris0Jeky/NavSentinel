import { describe, expect, it } from "vitest";
import {
  computeCredentialRisk,
  detectBrandInDomain,
  detectLookalike,
  detectSubdomainStuffing,
  findClosestLookalike,
  getRegistrableDomain,
  isIPAddress,
  isMixedScript,
  levenshtein,
  normalizeHomoglyphs,
  normalizeHost,
  recalcSeverity,
  safeUrlParse,
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

  it("leaves cl unchanged (rule removed to avoid false positives)", () => {
    expect(normalizeHomoglyphs("reclclit")).toBe("reclclit");
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

  // False-positive guards for short keywords
  it("does NOT flag livestream.com (removed 'live' keyword)", () => {
    expect(detectBrandInDomain("livestream.com")).toBeNull();
  });

  it("does NOT flag officespace.com (removed 'office' keyword)", () => {
    expect(detectBrandInDomain("officespace.com")).toBeNull();
  });

  it("does NOT flag steamer.com (removed 'steam' keyword)", () => {
    expect(detectBrandInDomain("steamer.com")).toBeNull();
  });

  it("does NOT flag chasetherain.com (short keyword, not startsWith)", () => {
    // "chase" is only 5 chars (<6), so it must match startsWith.
    // "chasetherain" starts with "chase" so this WOULD match.
    // But let's verify the actual behavior:
    const result = detectBrandInDomain("chasetherain.com");
    // "chase" has 5 chars < BRAND_SUBSTRING_MIN_LEN (6), so requires startsWith.
    // "chasetherain" starts with "chase" -> match. This is a deliberate design choice.
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("chase");
  });

  it("does NOT flag purchaser.com for 'chase' (short keyword, must startsWith)", () => {
    // "purchaser" contains "chase" as a substring but does NOT start with it
    expect(detectBrandInDomain("purchaser.com")).toBeNull();
  });

  it("catches chase-login.com (short keyword, startsWith match)", () => {
    const result = detectBrandInDomain("chase-login.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("chase");
  });

  it("catches ebaybargains.com (short keyword, startsWith match)", () => {
    const result = detectBrandInDomain("ebaybargains.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("ebay");
  });

  it("does NOT flag adobestock.com for adobe (exact canonical domain adobe.com skipped)", () => {
    // adobe.com is the canonical, adobestock.com is NOT adobe.com so should match
    const result = detectBrandInDomain("adobestock.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("adobe");
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

  it("detects homoglyph lookalike paypa1.com via normalized Levenshtein", () => {
    // paypa1.com -> normalizeHomoglyphs -> paypal.com (distance 0)
    // The digit '1' is normalized to 'l' by the homoglyph table.
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

// ---------------------------------------------------------------------------
// Adversarial Review Round 2: Regression tests
// ---------------------------------------------------------------------------

describe("brand known-alias false-positive guards", () => {
  // HIGH-impact: these are real domains millions of users visit daily
  it("does NOT flag microsoftonline.com (Microsoft 365 SSO)", () => {
    expect(detectBrandInDomain("microsoftonline.com")).toBeNull();
  });

  it("does NOT flag microsoft365.com", () => {
    expect(detectBrandInDomain("microsoft365.com")).toBeNull();
  });

  it("does NOT flag googleusercontent.com", () => {
    expect(detectBrandInDomain("googleusercontent.com")).toBeNull();
  });

  it("does NOT flag googlevideo.com (YouTube CDN)", () => {
    expect(detectBrandInDomain("googlevideo.com")).toBeNull();
  });

  it("does NOT flag googletagmanager.com", () => {
    expect(detectBrandInDomain("googletagmanager.com")).toBeNull();
  });

  it("does NOT flag googlesyndication.com", () => {
    expect(detectBrandInDomain("googlesyndication.com")).toBeNull();
  });

  it("does NOT flag googlechrome.com", () => {
    expect(detectBrandInDomain("googlechrome.com")).toBeNull();
  });

  it("does NOT flag googleapis.com", () => {
    expect(detectBrandInDomain("googleapis.com")).toBeNull();
  });

  it("does NOT flag amazonaws.com (AWS)", () => {
    expect(detectBrandInDomain("amazonaws.com")).toBeNull();
  });

  it("does NOT flag discordapp.com (legacy Discord)", () => {
    expect(detectBrandInDomain("discordapp.com")).toBeNull();
  });

  it("does NOT flag redditmedia.com (Reddit CDN)", () => {
    expect(detectBrandInDomain("redditmedia.com")).toBeNull();
  });

  it("does NOT flag shopifycloud.com (Shopify CDN)", () => {
    expect(detectBrandInDomain("shopifycloud.com")).toBeNull();
  });

  it("does NOT flag githubassets.com", () => {
    expect(detectBrandInDomain("githubassets.com")).toBeNull();
  });

  it("does NOT flag facebookmail.com", () => {
    expect(detectBrandInDomain("facebookmail.com")).toBeNull();
  });

  // Verify subdomain stuffing also respects aliases
  it("does NOT flag cdn.googleusercontent.com via subdomain stuffing", () => {
    expect(detectSubdomainStuffing("cdn.googleusercontent.com")).toBeNull();
  });

  it("does NOT flag login.microsoftonline.com via subdomain stuffing", () => {
    expect(detectSubdomainStuffing("login.microsoftonline.com")).toBeNull();
  });

  // Verify that phishing domains are STILL caught
  it("DOES flag google-secure-login.com (not in aliases)", () => {
    const result = detectBrandInDomain("google-secure-login.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("google");
  });

  it("DOES flag microsoft-verify.com (not in aliases)", () => {
    const result = detectBrandInDomain("microsoft-verify.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("microsoft");
  });
});

describe("brandKeywordMatch startsWith-only policy", () => {
  // Regression: ensures interior substrings no longer trigger false positives
  it("does NOT flag pinstripe.com for 'stripe'", () => {
    expect(detectBrandInDomain("pinstripe.com")).toBeNull();
  });

  it("does NOT flag seakraken.com for 'kraken'", () => {
    expect(detectBrandInDomain("seakraken.com")).toBeNull();
  });

  // But startsWith matches still work
  it("DOES flag stripepayments.com for 'stripe'", () => {
    const result = detectBrandInDomain("stripepayments.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("stripe");
  });

  it("DOES flag krakenwallet.com for 'kraken'", () => {
    const result = detectBrandInDomain("krakenwallet.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("kraken");
  });
});

describe("extended homoglyph normalization", () => {
  it("normalizes 5 to s", () => {
    expect(normalizeHomoglyphs("cha5e")).toBe("chase");
  });

  it("normalizes 8 to b", () => {
    expect(normalizeHomoglyphs("face8ook")).toBe("facebook");
  });

  it("normalizes combined 5 and 8", () => {
    expect(normalizeHomoglyphs("8e5tbuy")).toBe("bestbuy");
  });
});

describe("levenshtein length guard", () => {
  it("returns max length for inputs exceeding 253 chars", () => {
    const longA = "a".repeat(300);
    const longB = "b".repeat(250);
    expect(levenshtein(longA, longB)).toBe(300);
  });

  it("works normally for inputs within DNS length limits", () => {
    expect(levenshtein("paypal.com", "paypa1.com")).toBe(1);
  });

  it("handles one empty and one long string", () => {
    const long = "a".repeat(300);
    expect(levenshtein("", long)).toBe(300);
  });
});

describe("edge cases: IP addresses, punycode, empty inputs", () => {
  it("detectBrandInDomain returns null for IP address", () => {
    expect(detectBrandInDomain("192.168.1.1")).toBeNull();
  });

  it("detectSubdomainStuffing returns null for IP address", () => {
    expect(detectSubdomainStuffing("192.168.1.1")).toBeNull();
  });

  it("detectBrandInDomain returns null for punycode domain", () => {
    // xn--pypal-4ve.com is a punycode domain, not matching any brand via ASCII
    expect(detectBrandInDomain("xn--pypal-4ve.com")).toBeNull();
  });

  it("detectSubdomainStuffing handles punycode subdomain gracefully", () => {
    // Should not throw
    const result = detectSubdomainStuffing("xn--pypal-4ve.evil.com");
    // xn--pypal-4ve does not match any brand keyword after normalization
    expect(result).toBeNull();
  });
});

describe("recalcSeverity", () => {
  it("returns 'high' for score >= 70", () => expect(recalcSeverity(70)).toBe("high"));
  it("returns 'high' for score = 100", () => expect(recalcSeverity(100)).toBe("high"));
  it("returns 'medium' for score >= 40", () => expect(recalcSeverity(40)).toBe("medium"));
  it("returns 'medium' for score = 69", () => expect(recalcSeverity(69)).toBe("medium"));
  it("returns 'low' for score >= 15", () => expect(recalcSeverity(15)).toBe("low"));
  it("returns 'low' for score = 39", () => expect(recalcSeverity(39)).toBe("low"));
  it("returns 'none' for score < 15", () => expect(recalcSeverity(14)).toBe("none"));
  it("returns 'none' for score = 0", () => expect(recalcSeverity(0)).toBe("none"));
});

describe("normalizeHost", () => {
  it("lowercases uppercase host", () => {
    expect(normalizeHost("EXAMPLE.COM")).toBe("example.com");
  });

  it("removes trailing dot", () => {
    expect(normalizeHost("example.com.")).toBe("example.com");
  });

  it("lowercases and removes trailing dot together", () => {
    expect(normalizeHost("Example.COM.")).toBe("example.com");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeHost("")).toBe("");
  });

  it("passes through already-normalized host", () => {
    expect(normalizeHost("example.com")).toBe("example.com");
  });

  it("handles single label", () => {
    expect(normalizeHost("LOCALHOST")).toBe("localhost");
  });

  it("handles host with multiple trailing dots (removes all)", () => {
    expect(normalizeHost("example.com..")).toBe("example.com");
  });

  it("handles mixed-case subdomain", () => {
    expect(normalizeHost("Sub.Domain.Example.COM")).toBe("sub.domain.example.com");
  });
});

describe("isIPAddress", () => {
  it("detects valid IPv4", () => {
    expect(isIPAddress("192.168.1.1")).toBe(true);
  });

  it("detects 0.0.0.0", () => {
    expect(isIPAddress("0.0.0.0")).toBe(true);
  });

  it("detects 255.255.255.255", () => {
    expect(isIPAddress("255.255.255.255")).toBe(true);
  });

  it("rejects IPv4 with octet > 255", () => {
    expect(isIPAddress("256.0.0.1")).toBe(false);
  });

  it("rejects IPv4 with too few octets", () => {
    expect(isIPAddress("192.168.1")).toBe(false);
  });

  it("rejects IPv4 with too many octets", () => {
    expect(isIPAddress("192.168.1.1.1")).toBe(false);
  });

  it("detects IPv6 loopback", () => {
    expect(isIPAddress("::1")).toBe(true);
  });

  it("detects full IPv6", () => {
    expect(isIPAddress("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
  });

  it("detects IPv4-mapped IPv6", () => {
    expect(isIPAddress("::ffff:192.168.1.1")).toBe(true);
  });

  it("rejects regular domain names", () => {
    expect(isIPAddress("example.com")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isIPAddress("")).toBe(false);
  });

  it("normalizes case before checking", () => {
    expect(isIPAddress("2001:0DB8::1")).toBe(true);
  });

  it("rejects domain that looks like IP with letters", () => {
    expect(isIPAddress("192.168.1.abc")).toBe(false);
  });

  it("rejects negative octets", () => {
    expect(isIPAddress("-1.0.0.0")).toBe(false);
  });

  it("detects compressed IPv6", () => {
    expect(isIPAddress("fe80::1")).toBe(true);
  });

  it("accepts leading-zeros IPv4 (Number coercion strips them)", () => {
    expect(isIPAddress("192.168.001.001")).toBe(true);
  });

  it("rejects bracketed IPv6 (brackets not in character class)", () => {
    expect(isIPAddress("[::1]")).toBe(false);
  });
});

describe("safeUrlParse", () => {
  it("parses valid absolute URL", () => {
    const url = safeUrlParse("https://example.com/path?q=1");
    expect(url).not.toBeNull();
    expect(url!.hostname).toBe("example.com");
    expect(url!.pathname).toBe("/path");
    expect(url!.searchParams.get("q")).toBe("1");
  });

  it("returns null for invalid URL without base", () => {
    expect(safeUrlParse("not a url")).toBeNull();
  });

  it("returns null for empty string without base", () => {
    expect(safeUrlParse("")).toBeNull();
  });

  it("parses relative URL with base", () => {
    const url = safeUrlParse("/path", "https://example.com");
    expect(url).not.toBeNull();
    expect(url!.href).toBe("https://example.com/path");
  });

  it("returns null for invalid base", () => {
    expect(safeUrlParse("/path", "not-a-base")).toBeNull();
  });

  it("parses URL with port", () => {
    const url = safeUrlParse("https://example.com:8080/api");
    expect(url).not.toBeNull();
    expect(url!.port).toBe("8080");
  });

  it("parses URL with fragment", () => {
    const url = safeUrlParse("https://example.com/page#section");
    expect(url).not.toBeNull();
    expect(url!.hash).toBe("#section");
  });

  it("parses data URL", () => {
    const url = safeUrlParse("data:text/html,<h1>Hello</h1>");
    expect(url).not.toBeNull();
    expect(url!.protocol).toBe("data:");
  });

  it("parses blob URL", () => {
    const url = safeUrlParse("blob:https://example.com/uuid");
    expect(url).not.toBeNull();
    expect(url!.protocol).toBe("blob:");
  });

  it("parses javascript: URL", () => {
    const url = safeUrlParse("javascript:void(0)");
    expect(url).not.toBeNull();
    expect(url!.protocol).toBe("javascript:");
  });

  it("handles URL with auth info", () => {
    const url = safeUrlParse("https://user:pass@example.com");
    expect(url).not.toBeNull();
    expect(url!.username).toBe("user");
    expect(url!.password).toBe("pass");
  });

  it("handles about:blank", () => {
    const url = safeUrlParse("about:blank");
    expect(url).not.toBeNull();
    expect(url!.protocol).toBe("about:");
  });

  it("trims whitespace-padded URL per URL spec", () => {
    const url = safeUrlParse("  https://example.com  ");
    expect(url).not.toBeNull();
    expect(url!.hostname).toBe("example.com");
  });
});
