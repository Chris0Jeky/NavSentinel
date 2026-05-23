import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  analyzeSnapshot,
  domainMatchesBrand,
  BRAND_DB,
  KIT_FINGERPRINTS,
  type PageSnapshot,
} from "../extension/src/content/content_analyzer";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbFormAction = fc.record({
  action: fc.string({ maxLength: 200 }),
  hasPassword: fc.boolean(),
});

const arbMetaTag = fc.record({
  name: fc.string({ maxLength: 50 }),
  content: fc.string({ maxLength: 200 }),
});

const arbPageSnapshot: fc.Arbitrary<PageSnapshot> = fc.record({
  title: fc.string({ maxLength: 200 }),
  bodyText: fc.string({ maxLength: 500 }),
  htmlSnippet: fc.string({ maxLength: 500 }),
  scriptText: fc.string({ maxLength: 500 }),
  imgSignals: fc.string({ maxLength: 200 }),
  hasPasswordField: fc.boolean(),
  formActions: fc.array(arbFormAction, { maxLength: 5 }),
  metaTags: fc.array(arbMetaTag, { maxLength: 5 }),
  matchedSelectors: fc.array(fc.string({ maxLength: 50 }), { maxLength: 5 }),
});

const arbDomainLabel = fc
  .string({ minLength: 1, maxLength: 15 })
  .map((s) => s.replace(/[^a-z0-9]/gi, "").toLowerCase() || "x");

const arbDomain = fc.oneof(
  fc.constantFrom("example.com", "evil.com", "phish.net", "test.org", "unknown.xyz"),
  fc.tuple(arbDomainLabel, fc.constantFrom(".com", ".org", ".net", ".xyz", ".test")).map(
    ([label, tld]) => label + tld
  )
);

function emptySnapshot(): PageSnapshot {
  return {
    title: "",
    bodyText: "",
    htmlSnippet: "",
    scriptText: "",
    imgSignals: "",
    hasPasswordField: false,
    formActions: [],
    metaTags: [],
    matchedSelectors: [],
  };
}

// ---------------------------------------------------------------------------
// domainMatchesBrand property tests
// ---------------------------------------------------------------------------

describe("domainMatchesBrand property tests", () => {
  it("never throws on arbitrary domain strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), fc.constantFrom(...BRAND_DB), (domain, brand) => {
        const result = domainMatchesBrand(domain, brand);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 500 }
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), fc.constantFrom(...BRAND_DB), (domain, brand) => {
        expect(domainMatchesBrand(domain, brand)).toBe(domainMatchesBrand(domain, brand));
      }),
      { numRuns: 200 }
    );
  });

  it("every brand's own domains match that brand", () => {
    for (const brand of BRAND_DB) {
      for (const domain of brand.domains) {
        expect(domainMatchesBrand(domain, brand)).toBe(true);
      }
    }
  });

  it("subdomains of brand domains always match", () => {
    fc.assert(
      fc.property(
        arbDomainLabel,
        fc.constantFrom(...BRAND_DB),
        fc.integer({ min: 0, max: 100 }),
        (subdomain, brand, idx) => {
          const parentDomain = brand.domains[idx % brand.domains.length]!;
          const sub = `${subdomain}.${parentDomain}`;
          expect(domainMatchesBrand(sub, brand)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("random domains with unusual TLDs don't match any brand", () => {
    fc.assert(
      fc.property(arbDomainLabel.filter((l) => l.length >= 5), (label) => {
        const domain = `${label}.invalid`;
        let matchCount = 0;
        for (const brand of BRAND_DB) {
          if (domainMatchesBrand(domain, brand)) matchCount++;
        }
        expect(matchCount).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("empty string never matches any brand", () => {
    for (const brand of BRAND_DB) {
      expect(domainMatchesBrand("", brand)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// analyzeSnapshot property tests
// ---------------------------------------------------------------------------

describe("analyzeSnapshot property tests", () => {
  it("score is always in [0, 100]", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const result = analyzeSnapshot(snap, domain);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }),
      { numRuns: 500 }
    );
  });

  it("never throws on arbitrary inputs", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const result = analyzeSnapshot(snap, domain);
        expect(typeof result.score).toBe("number");
        expect(typeof result.brandMismatch).toBe("boolean");
        expect(typeof result.phishingKitMatch).toBe("boolean");
        expect(typeof result.suspiciousFormAction).toBe("boolean");
        expect(Array.isArray(result.reasons)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const a = analyzeSnapshot(snap, domain);
        const b = analyzeSnapshot(snap, domain);
        expect(a.score).toBe(b.score);
        expect(a.reasons).toEqual(b.reasons);
        expect(a.brandMismatch).toBe(b.brandMismatch);
        expect(a.phishingKitMatch).toBe(b.phishingKitMatch);
      }),
      { numRuns: 200 }
    );
  });

  it("reasons are non-empty iff score > 0", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const result = analyzeSnapshot(snap, domain);
        if (result.score > 0) {
          expect(result.reasons.length).toBeGreaterThan(0);
        }
        if (result.reasons.length === 0) {
          expect(result.score).toBe(0);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("brandMismatch requires hasPasswordField", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const noPassword = { ...snap, hasPasswordField: false };
        const result = analyzeSnapshot(noPassword, domain);
        expect(result.brandMismatch).toBe(false);
        expect(result.brandDetected).toBeUndefined();
      }),
      { numRuns: 300 }
    );
  });

  it("empty snapshot always scores 0", () => {
    fc.assert(
      fc.property(arbDomain, (domain) => {
        const result = analyzeSnapshot(emptySnapshot(), domain);
        expect(result.score).toBe(0);
        expect(result.reasons).toEqual([]);
      }),
      { numRuns: 50 }
    );
  });

  it("brand on its own domain never triggers brandMismatch", () => {
    for (const brand of BRAND_DB) {
      for (const domain of brand.domains) {
        const snap: PageSnapshot = {
          ...emptySnapshot(),
          title: brand.name.toLowerCase(),
          bodyText: `welcome to ${brand.name.toLowerCase()}`,
          imgSignals: brand.name.toLowerCase(),
          hasPasswordField: true,
        };
        const result = analyzeSnapshot(snap, domain);
        expect(result.brandMismatch).toBe(false);
      }
    }
  });

  it("adding password field can only increase or maintain score", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const withoutPw = { ...snap, hasPasswordField: false };
        const withPw = { ...snap, hasPasswordField: true };
        const scoreWithout = analyzeSnapshot(withoutPw, domain).score;
        const scoreWith = analyzeSnapshot(withPw, domain).score;
        expect(scoreWith).toBeGreaterThanOrEqual(scoreWithout);
      }),
      { numRuns: 300 }
    );
  });

  it("phishingKitMatch implies score >= 40", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const result = analyzeSnapshot(snap, domain);
        if (result.phishingKitMatch) {
          expect(result.score).toBeGreaterThanOrEqual(40);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("suspiciousFormAction implies score >= 25", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const result = analyzeSnapshot(snap, domain);
        if (result.suspiciousFormAction) {
          expect(result.score).toBeGreaterThanOrEqual(25);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("data: URI form action always flags suspiciousFormAction", () => {
    fc.assert(
      fc.property(arbDomain, fc.string({ maxLength: 100 }), (domain, suffix) => {
        const snap: PageSnapshot = {
          ...emptySnapshot(),
          formActions: [{ action: `data:${suffix}`, hasPassword: false }],
        };
        const result = analyzeSnapshot(snap, domain);
        expect(result.suspiciousFormAction).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("javascript: URI form action always flags suspiciousFormAction", () => {
    fc.assert(
      fc.property(arbDomain, fc.string({ maxLength: 100 }), (domain, suffix) => {
        const snap: PageSnapshot = {
          ...emptySnapshot(),
          formActions: [{ action: `javascript:${suffix}`, hasPassword: false }],
        };
        const result = analyzeSnapshot(snap, domain);
        expect(result.suspiciousFormAction).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it("brandMismatch implies brandDetected is a non-empty string", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const result = analyzeSnapshot(snap, domain);
        if (result.brandMismatch) {
          expect(result.brandDetected).toBeDefined();
          expect(typeof result.brandDetected).toBe("string");
          expect(result.brandDetected!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("phishingKitMatch implies kitName is a non-empty string", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const result = analyzeSnapshot(snap, domain);
        if (result.phishingKitMatch) {
          expect(result.kitName).toBeDefined();
          expect(typeof result.kitName).toBe("string");
          expect(result.kitName!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 }
    );
  });

  it("flagged components set a minimum score floor", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const result = analyzeSnapshot(snap, domain);
        let minExpected = 0;
        if (result.brandMismatch) minExpected += 10;
        if (result.phishingKitMatch) minExpected += 40;
        if (result.suspiciousFormAction) minExpected += 25;
        expect(result.score).toBeGreaterThanOrEqual(Math.min(100, minExpected));
      }),
      { numRuns: 500 }
    );
  });

  it("common-word brands don't trigger brandMismatch on bodyText alone", () => {
    const commonWordBrands = BRAND_DB.filter((b) => b.commonWord);
    expect(commonWordBrands.length).toBeGreaterThan(0);
    for (const brand of commonWordBrands) {
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        bodyText: brand.name.toLowerCase(),
        hasPasswordField: true,
      };
      const result = analyzeSnapshot(snap, "evil.com");
      expect(result.brandMismatch).toBe(false);
    }
  });

  it("common-word brands DO trigger with title match + bodyText", () => {
    const commonWordBrands = BRAND_DB.filter((b) => b.commonWord);
    for (const brand of commonWordBrands) {
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        title: brand.name.toLowerCase(),
        bodyText: brand.name.toLowerCase(),
        hasPasswordField: true,
      };
      const result = analyzeSnapshot(snap, "evil.com");
      if (brand.titlePatterns.some((p) => p.test(brand.name.toLowerCase()))) {
        expect(result.brandMismatch).toBe(true);
      }
    }
  });

  it("known kit HTML patterns in htmlSnippet trigger phishingKitMatch", () => {
    for (const kit of KIT_FINGERPRINTS) {
      if (!kit.htmlPatterns || kit.htmlPatterns.length === 0) continue;
      const pattern = kit.htmlPatterns[0]!;
      const kitNameLower = kit.name.toLowerCase();
      if (!pattern.test(kitNameLower)) continue;
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        htmlSnippet: kitNameLower,
      };
      const result = analyzeSnapshot(snap, "evil.com");
      expect(result.phishingKitMatch).toBe(true);
      expect(result.kitName).toBe(kit.name);
    }
  });

  it("known kit script patterns in scriptText trigger phishingKitMatch", () => {
    for (const kit of KIT_FINGERPRINTS) {
      if (!kit.scriptVarPatterns || kit.scriptVarPatterns.length === 0) continue;
      const pattern = kit.scriptVarPatterns[0]!;
      const kitNameLower = kit.name.toLowerCase().replace(/[-_]/g, "");
      if (!pattern.test(kitNameLower)) continue;
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        scriptText: kitNameLower,
      };
      const result = analyzeSnapshot(snap, "evil.com");
      expect(result.phishingKitMatch).toBe(true);
    }
  });

  it("brand signal tiers are correctly ordered: title+img > title > img > bodyText", () => {
    const brand = BRAND_DB[0]!; // Google
    const domain = "evil.com";

    const titleImgSnap: PageSnapshot = {
      ...emptySnapshot(),
      title: brand.name.toLowerCase(),
      imgSignals: brand.name.toLowerCase(),
      hasPasswordField: true,
    };
    const titleOnlySnap: PageSnapshot = {
      ...emptySnapshot(),
      title: brand.name.toLowerCase(),
      hasPasswordField: true,
    };
    const imgOnlySnap: PageSnapshot = {
      ...emptySnapshot(),
      imgSignals: brand.name.toLowerCase(),
      hasPasswordField: true,
    };
    const bodyOnlySnap: PageSnapshot = {
      ...emptySnapshot(),
      bodyText: brand.name.toLowerCase(),
      hasPasswordField: true,
    };

    const titleImgResult = analyzeSnapshot(titleImgSnap, domain);
    const titleResult = analyzeSnapshot(titleOnlySnap, domain);
    const imgResult = analyzeSnapshot(imgOnlySnap, domain);
    const bodyResult = analyzeSnapshot(bodyOnlySnap, domain);

    expect(titleImgResult.score).toBeGreaterThan(titleResult.score);
    expect(titleResult.score).toBeGreaterThan(imgResult.score);
    expect(imgResult.score).toBeGreaterThan(bodyResult.score);
    expect(bodyResult.score).toBeGreaterThan(0);
  });
});
