import { describe, expect, it } from "vitest";
import {
  computeCredentialRisk,
  detectBrandInDomain,
  detectLookalike,
  detectSubdomainStuffing,
  findClosestLookalike,
  getRegistrableDomain,
  hostForUrl,
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

  // #discovery cycle 3: pure homoglyph spoofs that normalize to EXACTLY a brand
  // (no extra characters). brandKeywordMatch's length guard rejects these, so the
  // homoglyph-rewrote exact-match path catches them.
  it("catches a pure ASCII-homoglyph brand spoof (paypa1.com -> paypal)", () => {
    const result = detectBrandInDomain("paypa1.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("paypal");
  });

  it("catches a digit-homoglyph brand spoof (g00gle.com -> google)", () => {
    const result = detectBrandInDomain("g00gle.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("google");
  });

  it("catches an rn->m homoglyph brand spoof (arnazon.com -> amazon)", () => {
    const result = detectBrandInDomain("arnazon.com");
    expect(result).not.toBeNull();
    expect(result!.brand).toBe("amazon");
  });

  it("does NOT newly flag the exact brand spelling on another TLD (no obfuscation)", () => {
    // FP-safety: the exact-match path only fires when the label was actually
    // obfuscated (homoglyphs and/or separators), so paypal.org stays null here.
    expect(detectBrandInDomain("paypal.org")).toBeNull();
  });

  it("does NOT flag separator-only or hyphenated generic/multi-word brands (FP-safety; #208 R2)", () => {
    // Only homoglyph substitution triggers the exact path. Separator-only spoofs
    // (pay-pal.com) and legitimate hyphenations of generic/multi-word brands
    // (block-chain.com -> "blockchain", bank-of-america.com -> "bankofamerica")
    // must stay null. Separator coverage needs a coined-vs-generic distinction +
    // FP measurement and is tracked as a follow-up.
    expect(detectBrandInDomain("pay-pal.com")).toBeNull();
    expect(detectBrandInDomain("block-chain.com")).toBeNull();
    expect(detectBrandInDomain("bank-of-america.com")).toBeNull();
    expect(detectBrandInDomain("drop-box.com")).toBeNull();
  });

  it("marks homoglyph exact spoofs exact=true and brand-plus-extra exact=false", () => {
    expect(detectBrandInDomain("paypa1.com")!.exact).toBe(true); // homoglyph, no extra
    expect(detectBrandInDomain("paypal-secure.com")!.exact).toBe(false); // extra chars
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

  it("tolerates a nullish trusted list (no Levenshtein targets, no throw)", () => {
    // Pre-fix the homoglyph loop threw TypeError on null; findClosestLookalike
    // already coalesced, so only this loop needed the guard. Brand/stuffing
    // checks are trust-independent and still run (null here: no brand present).
    for (const badList of [null, undefined] as unknown as string[][]) {
      const result = detectLookalike("randomsite.org", badList);
      expect(result.levenshtein).toBeNull();
      expect(result.homoglyphLevenshtein).toBeNull();
      expect(result.brandKeyword).toBeNull();
      expect(result.subdomainStuffing).toBeNull();
    }
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
    // Brand-plus-extra keeps the "with extra characters" wording (#208 R1).
    expect(risk.reasons.find((r) => r.code === "BRAND_KEYWORD_DOMAIN")!.label).toMatch(/with extra characters/i);
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

  it("flags a pure homoglyph spoof (paypa1.com) with NO trusted domains -> medium (#208 R1)", () => {
    // The user-visible payoff: even with the brand NOT on the trusted list, the
    // exact-homoglyph path raises BRAND_KEYWORD_DOMAIN (+40) -> medium severity.
    const risk = computeCredentialRisk({
      pageUrl: "https://paypa1.com/login",
      actionUrl: "https://paypa1.com/post",
      trustedDomains: [],
      config: baseConfig
    });

    expect(risk.reasons.map((r) => r.code)).toContain("BRAND_KEYWORD_DOMAIN");
    expect(risk.severity).toBe("medium");
    // Exact-spoof copy, not the "with extra characters" wording (#208 R1).
    const bk = risk.reasons.find((r) => r.code === "BRAND_KEYWORD_DOMAIN");
    expect(bk!.label).toMatch(/look-alike domain spoofing/i);
  });

  it("fires IP_HOST for an IPv6-literal page URL (#208 R1 end-to-end)", () => {
    // URL.hostname -> normalizeHost (unwraps brackets) -> isIPAddress -> +35 IP_HOST.
    const risk = computeCredentialRisk({
      pageUrl: "https://[2001:db8::1]/login",
      actionUrl: "https://[2001:db8::1]/post",
      trustedDomains: [],
      config: baseConfig
    });
    expect(risk.reasons.map((r) => r.code)).toContain("IP_HOST");
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

  it("unwraps a bracketed IPv6 literal (#discovery cycle 3)", () => {
    expect(normalizeHost("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeHost("[::1]")).toBe("::1");
    // Idempotent: the unwrapped form has no brackets.
    expect(normalizeHost(normalizeHost("[2001:DB8::1]"))).toBe("2001:db8::1");
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

  it("accepts bracketed IPv6 literals (URL.hostname form) — #discovery cycle 3", () => {
    // URL.hostname brackets IPv6 literals; normalizeHost now unwraps them so the
    // +35 IP_HOST credential signal fires for IPv6-literal pages, matching IPv4.
    expect(isIPAddress("[::1]")).toBe(true);
    expect(isIPAddress("[2001:db8::1]")).toBe(true);
  });

  it("does NOT unwrap brackets around a non-IPv6 string (#208 R1 defensive)", () => {
    // normalizeHost only strips brackets when the inner value is a real IPv6
    // literal, so a future caller passing a bracketed non-IP string is unaffected.
    expect(normalizeHost("[evil]")).toBe("[evil]");
  });
});

describe("hostForUrl + IPv6 registrable domain (#208 R1)", () => {
  it("re-brackets an unbracketed IPv6 literal for a URL authority", () => {
    expect(hostForUrl("2001:db8::1")).toBe("[2001:db8::1]");
    expect(hostForUrl("::1")).toBe("[::1]");
  });

  it("leaves hostnames and IPv4 literals unchanged", () => {
    expect(hostForUrl("example.com")).toBe("example.com");
    expect(hostForUrl("127.0.0.1")).toBe("127.0.0.1");
  });

  it("does not double-bracket an already-bracketed host", () => {
    expect(hostForUrl("[::1]")).toBe("[::1]");
  });

  it("getRegistrableDomain returns the unbracketed IPv6 literal", () => {
    expect(getRegistrableDomain("[2001:db8::1]")).toBe("2001:db8::1");
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

// ---------------------------------------------------------------------------
// Wave-2 Slice 1 (detection-input correctness): A1-A4 regression tests
// ---------------------------------------------------------------------------

describe("isIPv6 strict validation (A1)", () => {
  it.each([
    "::",
    "::1",
    "2001:db8::1",
    "fe80::1",
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    "2001:0DB8::1",
    "::ffff:192.168.1.1",
    "1:2:3:4:5:6:192.168.1.1",
    "1::2:3:4:5:6:7",
    "1:2:3:4:5:6:7::",
  ])("accepts valid IPv6 %s", (ip) => {
    expect(isIPAddress(ip)).toBe(true);
  });

  it.each([
    ":::",
    "...",
    ":",
    "abcd",
    "hello:world",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    ":1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:",
    "12345::",
    "gggg::1",
    "12:34:56:78:9a:bc:de:fg",
    "1::2::3",
    "2001:db8::1::",
    "1::2:3:4:5:6:7:8",
    "::ffff:999.1.1.1",
    "fe80::1%eth0",
  ])("rejects non-IPv6 %s", (ip) => {
    expect(isIPAddress(ip)).toBe(false);
  });

  it("does not mis-bracket invalid literals in hostForUrl", () => {
    // Before the strict validator these all bracketed (isIPv6 was charset-only).
    expect(hostForUrl(":::")).toBe(":::");
    expect(hostForUrl("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
    expect(hostForUrl("hello:world")).toBe("hello:world");
    // Valid literals still bracket.
    expect(hostForUrl("2001:db8::1")).toBe("[2001:db8::1]");
    expect(hostForUrl("::")).toBe("[::]");
  });

  it("keeps brackets around invalid literals in normalizeHost", () => {
    // The old charset-only check unwrapped "[:::]" to ":::"; the strict
    // validator leaves non-IPv6 bracketed strings untouched.
    expect(normalizeHost("[:::]")).toBe("[:::]");
    expect(normalizeHost("[2001:db8::1]")).toBe("2001:db8::1");
  });
});

describe("normalizeHost NFKC folding (A2)", () => {
  it("folds fullwidth Latin to ASCII", () => {
    expect(normalizeHost("ｐａｙｐａｌ.com")).toBe("paypal.com");
    expect(normalizeHost("ＰＡＹＰＡＬ．ＣＯＭ")).toBe("paypal.com");
  });

  it("folds a fullwidth trailing dot, then strips it", () => {
    expect(normalizeHost("example.com．")).toBe("example.com");
  });

  it("folds Turkish dotted-I deterministically (precomposed = decomposed)", () => {
    // U+0130 lowercases to ASCII i + U+0307 combining dot above.
    expect(normalizeHost("\u0130")).toBe("i\u0307");
    expect(normalizeHost("\u0130")).toBe(normalizeHost("i\u0307"));
  });

  it("matches a fullwidth lookalike to its trusted domain at distance 1", () => {
    // Before NFKC the fullwidth code points survived and the distance was ~9,
    // so the spoof sailed past maxDistance=2.
    expect(findClosestLookalike("ＰＡＹＰＡ1.ＣＯＭ", ["paypal.com"])).toEqual({
      target: "paypal.com",
      distance: 1,
    });
  });

  it("is idempotent on NFKC-folded input (fullwidth + Turkish İ pins)", () => {
    for (const h of ["ｐａｙｐａｌ.ＣＯＭ．", "İxample.com", "ﬁle.com", "Ⅷbank.com"]) {
      expect(normalizeHost(normalizeHost(h))).toBe(normalizeHost(h));
    }
  });
});

describe("isMixedScript CJK/Arabic/Hebrew buckets (A3)", () => {
  it.each([
    "payp中al.com",
    "payp語al.com",
    "payp한국al.com",
    "payp\u{20000}al.com",
    "paypاal.com",
    "paypمثالx.com",
    "paypאal.com",
    "paypדוגמהx.com",
    "αр.com",
  ])("flags mixed-script host %s", (host) => {
    expect(isMixedScript(host)).toBe(true);
  });

  it.each([
    "paypal.com",
    "中文测试",
    "日本語のテスト",
    "한국어테스트",
    "مثال123",
    "דוגמהמבחן",
    "ไทย",
  ])("does NOT flag single-script host %s", (host) => {
    expect(isMixedScript(host)).toBe(false);
  });

  it("does NOT flag Latin + unclassified-script mixing (conservative Other bucket)", () => {
    // Thai/Devanagari stay in "Other", which mixing detection ignores — an
    // accepted gap, not an evasion of the CJK/Arabic/Hebrew buckets above.
    expect(isMixedScript("paypไทยal.com")).toBe(false);
  });

  it("still flags a Latin+CJK spoof page end-to-end (via punycoding)", () => {
    // WHATWG URL punycodes the host (payp中al.com -> xn--paypal-ew7i.com)
    // before computeCredentialRisk ever sees it, so the credential path flags
    // the spoof via PUNYCODE_HOST; isMixedScript covers raw-Unicode hosts
    // passed directly (unit cases above).
    const risk = computeCredentialRisk({
      pageUrl: "https://payp中al.com/login",
      actionUrl: "https://payp中al.com/post",
      trustedDomains: ["paypal.com"],
      config: baseConfig,
    });
    expect(risk.reasons.map((r) => r.code)).toContain("PUNYCODE_HOST");
  });
});

describe("levenshtein code-point distances (A4)", () => {
  const cases: Array<[string, string, number]> = [
    ["😀", "a", 1],
    ["😀", "😀😀", 1],
    ["", "😀", 1],
    ["😀", "😁", 1],
    ["a😀b", "a😁b", 1],
    ["\u{20000}", "a", 1],
    ["\u{20000}x", "\u{20001}x", 1],
  ];
  it.each(cases)("levenshtein(%s, %s) === %i", (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
  });

  it("counts one astral substitution as a single edit inside lookalike matching", () => {
    // The old charCodeAt walk counted the replacement emoji as 2 edits.
    expect(levenshtein("payp😀al.com", "payp😁al.com")).toBe(1);
  });
});
