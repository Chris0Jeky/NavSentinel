import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  isOAuthUrl,
  extractRedirectUri,
  isUnexpectedCallback,
  type OAuthFlowState,
} from "../extension/src/content/oauth_monitor";

// ---------------------------------------------------------------------------
// Reference lists matching the implementation
// ---------------------------------------------------------------------------

const OAUTH_PATH_KEYWORDS = [
  "oauth",
  "oauth2",
  "authorize",
  "consent",
  "openid",
] as const;

const OAUTH_QUERY_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
] as const;

const REDIRECT_PARAM_NAMES = [
  "redirect_uri",
  "redirect_url",
  "callback_url",
  "return_url",
] as const;

const LOCALHOST_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbPathKeyword = fc.constantFrom(...OAUTH_PATH_KEYWORDS);
const arbQueryParam = fc.constantFrom(...OAUTH_QUERY_PARAMS);
const arbRedirectParam = fc.constantFrom(...REDIRECT_PARAM_NAMES);
const arbLocalhostHost = fc.constantFrom(...LOCALHOST_HOSTS);

const arbDomainLabel = fc.string({ minLength: 1, maxLength: 12 }).map(
  (s) => s.replace(/[^a-z0-9]/g, "a"),
);

const arbTLD = fc.constantFrom("com", "org", "net", "io", "dev", "co.uk", "com.au");

const arbDomain = fc.tuple(arbDomainLabel, arbTLD).map(
  ([label, tld]) => `${label}.${tld}`,
);

const arbSafePathSegment = fc.string({ minLength: 1, maxLength: 20 }).map(
  (s) => s.replace(/[^a-zA-Z0-9_-]/g, "x"),
);

const arbParamValue = fc.string({ minLength: 1, maxLength: 30 }).map(
  (s) => encodeURIComponent(s.replace(/[^a-zA-Z0-9._~-]/g, "x")),
);

const arbNonBoundaryChar = fc.constantFrom(
  "x", "a", "2", "-", "_", ".", "d", "z", "0",
);

const arbScheme = fc.constantFrom("http", "https");

function makeOAuthUrl(
  domain: string,
  pathKeyword: string,
  queryParam: string,
  paramValue: string,
  extraPathBefore: string = "",
  extraPathAfter: string = "",
): string {
  const before = extraPathBefore ? `/${extraPathBefore}` : "";
  const after = extraPathAfter ? `/${extraPathAfter}` : "";
  return `https://${domain}${before}/${pathKeyword}${after}?${queryParam}=${paramValue}`;
}

function makeFlow(overrides: Partial<OAuthFlowState> = {}): OAuthFlowState {
  return {
    initiatorUrl: "https://app.example.com",
    consentUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    expectedCallbackDomain: "app.example.com",
    startedAt: Date.now(),
    phase: "consent",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isOAuthUrl property tests
// ---------------------------------------------------------------------------

describe("isOAuthUrl property tests", () => {
  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        const result = isOAuthUrl(text);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 500 },
    );
  });

  it("returns false for empty string", () => {
    expect(isOAuthUrl("")).toBe(false);
  });

  it("returns false for non-HTTP(S) protocols", () => {
    const protocols = ["ftp:", "file:", "data:", "javascript:", "blob:", "ws:", "wss:"];
    for (const proto of protocols) {
      for (const kw of OAUTH_PATH_KEYWORDS) {
        expect(isOAuthUrl(`${proto}//example.com/${kw}?client_id=x`)).toBe(false);
      }
    }
  });

  it("returns false for malformed URLs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => {
          try { new URL(s); return false; } catch { return true; }
        }),
        (text) => {
          expect(isOAuthUrl(text)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("requires BOTH path keyword AND query param (two-gate)", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbPathKeyword,
        arbQueryParam,
        arbParamValue,
        (domain, kw, param, value) => {
          const withBoth = `https://${domain}/${kw}?${param}=${value}`;
          expect(isOAuthUrl(withBoth)).toBe(true);

          const pathOnly = `https://${domain}/${kw}`;
          expect(isOAuthUrl(pathOnly)).toBe(false);

          const queryOnly = `https://${domain}/login?${param}=${value}`;
          expect(isOAuthUrl(queryOnly)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all path keywords are recognized at segment boundary", () => {
    for (const kw of OAUTH_PATH_KEYWORDS) {
      for (const param of OAUTH_QUERY_PARAMS) {
        const url = `https://example.com/${kw}?${param}=val`;
        expect(isOAuthUrl(url)).toBe(true);
      }
    }
  });

  it("all query params are recognized", () => {
    for (const param of OAUTH_QUERY_PARAMS) {
      const url = `https://example.com/oauth?${param}=val`;
      expect(isOAuthUrl(url)).toBe(true);
    }
  });

  it("path keyword must be preceded by / (not embedded in word)", () => {
    fc.assert(
      fc.property(
        arbPathKeyword,
        arbQueryParam,
        fc.string({ minLength: 1, maxLength: 10 }).map((s) => s.replace(/[^a-z]/g, "a")),
        (kw, param, prefix) => {
          const embedded = `https://example.com/my${prefix}${kw}page?${param}=val`;
          expect(isOAuthUrl(embedded)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("path keyword followed by non-boundary character is rejected", () => {
    fc.assert(
      fc.property(
        arbPathKeyword,
        arbQueryParam,
        arbNonBoundaryChar,
        fc.string({ minLength: 0, maxLength: 10 }).map((s) => s.replace(/[^a-z0-9]/g, "a")),
        (kw, param, trailingChar, extraSuffix) => {
          const url = `https://example.com/${kw}${trailingChar}${extraSuffix}?${param}=val`;
          expect(isOAuthUrl(url)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("path keyword at end of path is valid", () => {
    for (const kw of OAUTH_PATH_KEYWORDS) {
      expect(isOAuthUrl(`https://example.com/${kw}?client_id=x`)).toBe(true);
    }
  });

  it("path keyword followed by / is valid", () => {
    for (const kw of OAUTH_PATH_KEYWORDS) {
      expect(isOAuthUrl(`https://example.com/${kw}/extra?client_id=x`)).toBe(true);
    }
  });

  it("path keyword followed by ? is valid (boundary)", () => {
    for (const kw of OAUTH_PATH_KEYWORDS) {
      const url = `https://example.com/path/${kw}?scope=openid`;
      expect(isOAuthUrl(url)).toBe(true);
    }
  });

  it("path keyword embedded in word is rejected (both sides)", () => {
    expect(isOAuthUrl("https://example.com/myauthorizepage?client_id=x")).toBe(false);
    expect(isOAuthUrl("https://example.com/noauthenticate?client_id=x")).toBe(false);
    expect(isOAuthUrl("https://example.com/oauth2extra?client_id=x")).toBe(false);
    expect(isOAuthUrl("https://example.com/authorize.do?client_id=x")).toBe(false);
    expect(isOAuthUrl("https://example.com/consentform?scope=openid")).toBe(false);
  });

  it("is case insensitive on path keywords", () => {
    for (const kw of OAUTH_PATH_KEYWORDS) {
      const upper = kw.toUpperCase();
      const mixed = kw.split("").map((c, i) =>
        i % 2 === 0 ? c.toUpperCase() : c.toLowerCase(),
      ).join("");
      expect(isOAuthUrl(`https://example.com/${upper}?client_id=x`)).toBe(true);
      expect(isOAuthUrl(`https://example.com/${mixed}?client_id=x`)).toBe(true);
    }
  });

  it("query param matching is case-sensitive (uppercase not recognized)", () => {
    for (const param of OAUTH_QUERY_PARAMS) {
      expect(isOAuthUrl(`https://example.com/oauth?${param.toUpperCase()}=x`)).toBe(false);
    }
    expect(isOAuthUrl("https://example.com/oauth?Client_Id=x")).toBe(false);
    expect(isOAuthUrl("https://example.com/oauth?Response_Type=code")).toBe(false);
  });

  it("constructed OAuth URLs always match", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbPathKeyword,
        arbQueryParam,
        arbParamValue,
        arbSafePathSegment,
        arbSafePathSegment,
        (domain, kw, param, value, before, after) => {
          const url = makeOAuthUrl(domain, kw, param, value, before, after);
          expect(isOAuthUrl(url)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("generic login params do NOT satisfy the query gate", () => {
    const genericParams = ["continue", "next", "return_to", "callback"];
    for (const param of genericParams) {
      expect(isOAuthUrl(`https://example.com/oauth?${param}=https://app.com`)).toBe(false);
    }
  });

  it("http: URLs are accepted (not just https:)", () => {
    expect(isOAuthUrl("http://example.com/oauth?client_id=x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractRedirectUri property tests
// ---------------------------------------------------------------------------

describe("extractRedirectUri property tests", () => {
  it("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        const result = extractRedirectUri(text);
        expect(result === null || typeof result === "string").toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("returns null for empty string", () => {
    expect(extractRedirectUri("")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => {
          try { new URL(s); return false; } catch { return true; }
        }),
        (text) => {
          expect(extractRedirectUri(text)).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("extracts all recognized redirect param names", () => {
    for (const name of REDIRECT_PARAM_NAMES) {
      const url = `https://auth.example.com/login?${name}=https://app.com/cb`;
      expect(extractRedirectUri(url)).toBe("https://app.com/cb");
    }
  });

  it("returns null for non-redirect params", () => {
    const nonRedirect = ["callback", "return_to", "continue", "next", "state", "nonce"];
    for (const name of nonRedirect) {
      const url = `https://auth.example.com/login?${name}=https://app.com/cb`;
      expect(extractRedirectUri(url)).toBeNull();
    }
  });

  it("prefers earlier param in REDIRECT_PARAM_NAMES order", () => {
    const url = "https://auth.example.com/login?callback_url=https://second.com&redirect_uri=https://first.com";
    expect(extractRedirectUri(url)).toBe("https://first.com");
  });

  it("redirect_uri takes priority over redirect_url", () => {
    const url = "https://auth.example.com/login?redirect_url=https://second.com&redirect_uri=https://first.com";
    expect(extractRedirectUri(url)).toBe("https://first.com");
  });

  it("duplicate same-name params: first value wins", () => {
    const url = "https://auth.example.com/login?redirect_uri=https://first.com/cb&redirect_uri=https://second.com/cb";
    expect(extractRedirectUri(url)).toBe("https://first.com/cb");
  });

  it("returns null when URL has no query params", () => {
    expect(extractRedirectUri("https://example.com/auth")).toBeNull();
  });

  it("returns null when URL has only unrelated query params", () => {
    expect(extractRedirectUri("https://example.com/auth?state=abc&nonce=xyz")).toBeNull();
  });

  it("returns the param value unchanged", () => {
    fc.assert(
      fc.property(
        arbRedirectParam,
        fc.string({ minLength: 1, maxLength: 50 }).map(
          (s) => s.replace(/[^a-zA-Z0-9._~:/?#@!$&'()*+,;=-]/g, "x"),
        ),
        (param, value) => {
          const encoded = encodeURIComponent(value);
          const url = `https://auth.example.com/login?${param}=${encoded}`;
          const extracted = extractRedirectUri(url);
          expect(extracted).toBe(value);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns null for empty param values", () => {
    for (const name of REDIRECT_PARAM_NAMES) {
      const url = `https://auth.example.com/login?${name}=`;
      expect(extractRedirectUri(url)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// isUnexpectedCallback property tests
// ---------------------------------------------------------------------------

describe("isUnexpectedCallback property tests", () => {
  it("never throws on arbitrary callback URLs", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (text) => {
        const flow = makeFlow();
        const result = isUnexpectedCallback(flow, text);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 500 },
    );
  });

  it("returns false when expectedCallbackDomain is empty", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (url) => {
        const flow = makeFlow({ expectedCallbackDomain: "" });
        expect(isUnexpectedCallback(flow, url)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("returns true for malformed callback URLs (when expectedCallbackDomain is set)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => {
          try { new URL(s); return false; } catch { return true; }
        }),
        (text) => {
          const flow = makeFlow({ expectedCallbackDomain: "app.example.com" });
          expect(isUnexpectedCallback(flow, text)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("localhost callbacks are never unexpected (both http and https)", () => {
    for (const host of LOCALHOST_HOSTS) {
      const flow = makeFlow({ expectedCallbackDomain: "totally-different.com" });
      for (const scheme of ["http", "https"]) {
        const url = `${scheme}://${host}:3000/callback?code=abc`;
        expect(isUnexpectedCallback(flow, url)).toBe(false);
      }
    }
  });

  it("localhost callbacks with arbitrary ports and schemes are never unexpected", () => {
    fc.assert(
      fc.property(
        arbLocalhostHost,
        fc.integer({ min: 1, max: 65535 }),
        arbScheme,
        (host, port, scheme) => {
          const flow = makeFlow({ expectedCallbackDomain: "different.example.com" });
          const url = `${scheme}://${host}:${port}/callback`;
          expect(isUnexpectedCallback(flow, url)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("non-localhost IP callbacks are unexpected relative to domain expected", () => {
    const flow = makeFlow({ expectedCallbackDomain: "app.example.com" });
    expect(isUnexpectedCallback(flow, "http://10.0.0.1/cb")).toBe(true);
    expect(isUnexpectedCallback(flow, "http://192.168.1.100/steal")).toBe(true);
    expect(isUnexpectedCallback(flow, "https://203.0.113.50/cb")).toBe(true);
  });

  it("IP callback matches IP expected domain", () => {
    const flow = makeFlow({ expectedCallbackDomain: "192.168.1.1" });
    expect(isUnexpectedCallback(flow, "http://192.168.1.1/cb")).toBe(false);
  });

  it("different IP callback is unexpected relative to IP expected domain", () => {
    const flow = makeFlow({ expectedCallbackDomain: "192.168.1.1" });
    expect(isUnexpectedCallback(flow, "http://192.168.1.2/cb")).toBe(true);
  });

  it("same registrable domain is not unexpected", () => {
    const domains = [
      { expected: "app.example.com", callback: "https://other.example.com/cb" },
      { expected: "example.com", callback: "https://deep.sub.example.com/cb" },
      { expected: "sub.example.com", callback: "https://example.com/cb" },
      { expected: "myapp.co.uk", callback: "https://sub.myapp.co.uk/cb" },
    ];
    for (const { expected, callback } of domains) {
      const flow = makeFlow({ expectedCallbackDomain: expected });
      expect(isUnexpectedCallback(flow, callback)).toBe(false);
    }
  });

  it("different registrable domain IS unexpected", () => {
    const pairs = [
      { expected: "app.example.com", callback: "https://evil.com/steal" },
      { expected: "myapp.com", callback: "https://myapp.org/cb" },
      { expected: "github.com", callback: "https://github.io/cb" },
      { expected: "google.com", callback: "https://g00gle.com/cb" },
    ];
    for (const { expected, callback } of pairs) {
      const flow = makeFlow({ expectedCallbackDomain: expected });
      expect(isUnexpectedCallback(flow, callback)).toBe(true);
    }
  });

  it("different second-level domain under ccTLD is unexpected", () => {
    const flow = makeFlow({ expectedCallbackDomain: "myapp.co.uk" });
    expect(isUnexpectedCallback(flow, "https://evildomain.co.uk/cb")).toBe(true);
  });

  it("symmetric: if A matches B's domain, B matches A's domain", () => {
    const pairs = [
      ["app.example.com", "api.example.com"],
      ["sub.test.org", "other.test.org"],
    ];
    for (const [a, b] of pairs) {
      const flowA = makeFlow({ expectedCallbackDomain: a });
      const flowB = makeFlow({ expectedCallbackDomain: b });
      expect(isUnexpectedCallback(flowA, `https://${b}/cb`)).toBe(false);
      expect(isUnexpectedCallback(flowB, `https://${a}/cb`)).toBe(false);
    }
  });

  it("callback to exact expectedCallbackDomain is never unexpected", () => {
    fc.assert(
      fc.property(
        arbDomain,
        (domain) => {
          const flow = makeFlow({ expectedCallbackDomain: domain });
          expect(isUnexpectedCallback(flow, `https://${domain}/callback?code=x`)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("flow phase and other fields don't affect domain comparison", () => {
    const phases: OAuthFlowState["phase"][] = ["redirect", "consent", "callback", "complete"];
    for (const phase of phases) {
      const flow = makeFlow({
        expectedCallbackDomain: "app.example.com",
        phase,
        initiatorUrl: "https://random.site.com",
        consentUrl: "https://different.provider.com/auth",
      });
      expect(isUnexpectedCallback(flow, "https://app.example.com/cb")).toBe(false);
      expect(isUnexpectedCallback(flow, "https://evil.com/cb")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-function consistency tests
// ---------------------------------------------------------------------------

describe("isOAuthUrl + extractRedirectUri consistency", () => {
  it("if extractRedirectUri finds a value, the URL may or may not be OAuth", () => {
    const url = "https://example.com/login?redirect_uri=https://app.com/cb";
    const redirect = extractRedirectUri(url);
    expect(redirect).toBe("https://app.com/cb");
    expect(isOAuthUrl(url)).toBe(false);
  });

  it("OAuth URLs with redirect_uri have both signals", () => {
    fc.assert(
      fc.property(
        arbDomain,
        arbPathKeyword,
        arbDomain,
        (domain, kw, callbackDomain) => {
          const url = `https://${domain}/${kw}?redirect_uri=https://${callbackDomain}/cb&client_id=x`;
          expect(isOAuthUrl(url)).toBe(true);
          expect(extractRedirectUri(url)).toBe(`https://${callbackDomain}/cb`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("extracted redirect_uri can be used with isUnexpectedCallback", () => {
    const oauthUrl = "https://accounts.google.com/o/oauth2/auth?redirect_uri=https://evil.com/steal&client_id=x";
    const redirect = extractRedirectUri(oauthUrl);
    expect(redirect).not.toBeNull();
    if (redirect === null) return;
    const flow = makeFlow({ expectedCallbackDomain: "myapp.com" });
    expect(isUnexpectedCallback(flow, redirect)).toBe(true);
  });
});
