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
  ),
  fc.tuple(arbDomainLabel, arbDomainLabel, fc.constantFrom(".com", ".org", ".net")).map(
    ([sub, label, tld]) => sub + "." + label + tld
  ),
  fc.tuple(arbDomainLabel, fc.constantFrom(".co.uk", ".co.jp", ".com.br", ".de")).map(
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
// Known trigger strings for kit detection tests
// ---------------------------------------------------------------------------

const KIT_HTML_TRIGGERS: Record<string, string> = {
  "16Shop": "16shop",
  "Kr3pto": "kr3pto",
  "LogoKit": "logokit",
  "Chase-XBALTI": "xbalti",
  "Ex-Robotos": "ex-robotos",
  "Bulletproof-Link": "bulletprooflink",
  "EvilProxy": "evilproxy",
  "W3LL-Panel": "w3ll-panel",
  "Greatness": "greatness-phish",
  "Caffeine": "caffeine-phish",
  "Robin-Banks": "robin-banks",
  "BulletProofPanel": "bp-panel",
  "Base64-Form-Action": 'action="data:text/html"',
  "Phish-Hidden-Iframe": '<iframe style="display: none">',
  "Exfil-Hidden-Form": '<form style="display:none">',
  "Data-Exfil-Iframe": '<iframe src="https://evil.com/collect">',
  "Telegram-Exfil": "api.telegram.org/bot12345",
  "Discord-Webhook-Exfil": "discord.com/api/webhooks/123",
  "OTP-Kit": "otp-intercept",
  "Modlishka": "modlishka",
  "Gophish": "gophish",
  "Evilginx": "evilginx",
  "King-Phisher": "king-phisher",
  "Hidden-Input-Harvester": "harvester",
  "SocialFish": "socialfish",
  "Zphisher": "zphisher",
  "HiddenEye": "hiddeneye",
  "Nexphisher": "nexphisher",
};

const KIT_SCRIPT_TRIGGERS: Record<string, string> = {
  "16Shop": " 16shop ",
  "Kr3pto": " kr3pto ",
  "LogoKit": " logokit ",
  "Ex-Robotos": " exrobotos ",
  "Bulletproof-Link": " bulletprooflink ",
  "EvilProxy": " evilproxy ",
  "W3LL-Panel": " w3ll ",
  "Greatness": " greatnessphish ",
  "Caffeine": " caffeinephish ",
  "Robin-Banks": " robinbanks ",
  "Telegram-Exfil": " telegram_bot ",
  "Discord-Webhook-Exfil": " discord_webhook ",
  "Modlishka": " modlishka ",
  "Gophish": " gophish ",
  "Evilginx": " evilginx ",
  "King-Phisher": " kingphisher ",
  "SocialFish": " socialfish ",
  "Zphisher": " zphisher ",
  "HiddenEye": " hiddeneye ",
  "Nexphisher": " nexphisher ",
};

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

  it("random domains with .invalid TLD don't match any brand", () => {
    fc.assert(
      fc.property(arbDomainLabel, (label) => {
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

  it("brandMismatch requires hasPasswordField and implies brandDetected", () => {
    fc.assert(
      fc.property(arbPageSnapshot, arbDomain, (snap, domain) => {
        const noPassword = { ...snap, hasPasswordField: false };
        const result = analyzeSnapshot(noPassword, domain);
        expect(result.brandMismatch).toBe(false);

        const withPassword = { ...snap, hasPasswordField: true };
        const resultPw = analyzeSnapshot(withPassword, domain);
        if (resultPw.brandMismatch) {
          expect(resultPw.brandDetected).toBeDefined();
          expect(typeof resultPw.brandDetected).toBe("string");
          expect(resultPw.brandDetected!.length).toBeGreaterThan(0);
        }
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
      fc.property(
        arbDomain,
        fc.string({ maxLength: 100 }),
        fc.boolean(),
        (domain, suffix, hasPassword) => {
          const snap: PageSnapshot = {
            ...emptySnapshot(),
            formActions: [{ action: `data:${suffix}`, hasPassword }],
          };
          const result = analyzeSnapshot(snap, domain);
          expect(result.suspiciousFormAction).toBe(true);
        }
      ),
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

  it("common-word brands DO trigger with matching title + bodyText", () => {
    const titleInputs: Record<string, string> = {
      Apple: "apple id sign in",
      Adobe: "adobe sign in",
      Chase: "chase bank online",
    };
    const commonWordBrands = BRAND_DB.filter((b) => b.commonWord);
    expect(commonWordBrands.length).toBeGreaterThan(0);
    for (const brand of commonWordBrands) {
      const titleInput = titleInputs[brand.name];
      expect(titleInput).toBeDefined();
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        title: titleInput!,
        bodyText: brand.name.toLowerCase(),
        hasPasswordField: true,
      };
      const result = analyzeSnapshot(snap, "evil.com");
      expect(result.brandMismatch).toBe(true);
    }
  });

  it("known kit HTML patterns in htmlSnippet trigger phishingKitMatch", () => {
    for (const kit of KIT_FINGERPRINTS) {
      if (!kit.htmlPatterns || kit.htmlPatterns.length === 0) continue;
      const trigger = KIT_HTML_TRIGGERS[kit.name];
      expect(trigger).toBeDefined();
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        htmlSnippet: trigger!,
      };
      const result = analyzeSnapshot(snap, "evil.com");
      expect(result.phishingKitMatch).toBe(true);
      expect(result.kitName).toBe(kit.name);
    }
  });

  it("known kit script patterns in scriptText trigger phishingKitMatch", () => {
    for (const kit of KIT_FINGERPRINTS) {
      if (!kit.scriptVarPatterns || kit.scriptVarPatterns.length === 0) continue;
      const trigger = KIT_SCRIPT_TRIGGERS[kit.name];
      expect(trigger).toBeDefined();
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        scriptText: trigger!,
      };
      const result = analyzeSnapshot(snap, "evil.com");
      expect(result.phishingKitMatch).toBe(true);
    }
  });

  it("brand signal tiers are correctly ordered: title+img > title > img > bodyText", () => {
    const brand = BRAND_DB.find((b) => b.name === "Google")!;
    expect(brand).toBeDefined();
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

  it("base64-encoded form action flags suspiciousFormAction", () => {
    fc.assert(
      fc.property(arbDomain, (domain) => {
        const snap: PageSnapshot = {
          ...emptySnapshot(),
          formActions: [{ action: "aHR0cHM6Ly9ldmlsLmNvbS9jYXB0dXJl", hasPassword: false }],
        };
        const result = analyzeSnapshot(snap, domain);
        expect(result.suspiciousFormAction).toBe(true);
      }),
      { numRuns: 50 }
    );
  });

  it("metaPatterns-based kit detection triggers phishingKitMatch", () => {
    const metaKits = KIT_FINGERPRINTS.filter((k) => k.metaPatterns && k.metaPatterns.length > 0);
    expect(metaKits.length).toBeGreaterThan(0);
    for (const kit of metaKits) {
      const mp = kit.metaPatterns![0]!;
      const triggerContent = mp.name === "refresh"
        ? "url=data:text/html,evil"
        : kit.name.toLowerCase();
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        metaTags: [{ name: mp.name, content: triggerContent }],
      };
      const result = analyzeSnapshot(snap, "evil.com");
      expect(result.phishingKitMatch).toBe(true);
      expect(result.kitName).toBe(kit.name);
    }
  });

  it("matchedSelectors-based kit detection triggers phishingKitMatch", () => {
    const selectorKits = KIT_FINGERPRINTS.filter((k) => k.selectors && k.selectors.length > 0);
    expect(selectorKits.length).toBeGreaterThan(0);
    for (const kit of selectorKits) {
      const selector = kit.selectors![0]!;
      const snap: PageSnapshot = {
        ...emptySnapshot(),
        matchedSelectors: [selector],
      };
      const result = analyzeSnapshot(snap, "evil.com");
      expect(result.phishingKitMatch).toBe(true);
      expect(result.kitName).toBe(kit.name);
    }
  });

  it("cross-domain form action with hasPassword flags suspiciousFormAction", () => {
    const snap: PageSnapshot = {
      ...emptySnapshot(),
      formActions: [{ action: "https://evil-exfil.com/capture", hasPassword: true }],
    };
    const result = analyzeSnapshot(snap, "example.com");
    expect(result.suspiciousFormAction).toBe(true);
    expect(result.reasons.some((r) => r.includes("Password form submits to different domain"))).toBe(true);
  });

  it("clean page with password field but no signals never scores above 5", () => {
    fc.assert(
      fc.property(arbDomain, (domain) => {
        const snap: PageSnapshot = {
          ...emptySnapshot(),
          hasPasswordField: true,
        };
        const result = analyzeSnapshot(snap, domain);
        expect(result.score).toBeLessThanOrEqual(5);
        expect(result.brandMismatch).toBe(false);
        expect(result.phishingKitMatch).toBe(false);
        expect(result.suspiciousFormAction).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("isolated form-only suspicious action scores exactly 25", () => {
    fc.assert(
      fc.property(arbDomain, fc.string({ maxLength: 50 }), (domain, suffix) => {
        const snap: PageSnapshot = {
          ...emptySnapshot(),
          formActions: [{ action: `data:${suffix}`, hasPassword: false }],
        };
        const result = analyzeSnapshot(snap, domain);
        expect(result.score).toBe(25);
      }),
      { numRuns: 100 }
    );
  });

  it("score cap at 100 is exercised with combined brand + kit + form", () => {
    const brand = BRAND_DB.find((b) => b.name === "Google")!;
    const snap: PageSnapshot = {
      ...emptySnapshot(),
      title: brand.name.toLowerCase(),
      imgSignals: brand.name.toLowerCase(),
      bodyText: brand.name.toLowerCase(),
      htmlSnippet: "16shop",
      hasPasswordField: true,
      formActions: [{ action: "data:text/html,evil", hasPassword: false }],
    };
    const result = analyzeSnapshot(snap, "evil.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.phishingKitMatch).toBe(true);
    expect(result.suspiciousFormAction).toBe(true);
    expect(result.score).toBe(100);
  });
});
