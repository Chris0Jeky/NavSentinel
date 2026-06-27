import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  isOAuthUrl,
  extractRedirectUri,
  hasOAuthResponseParams,
  hasCorroboratedOAuthResponse,
  isUnexpectedCallback,
  handleOAuthRuntimeMessage,
  isOAuthRedirectMismatch,
  isOAuthOpenerManipulation,
  getOAuthFlowState,
  _resetOAuthState,
  type OAuthFlowState,
} from "../extension/src/content/oauth_monitor";
import {
  computeNRS,
  NRS_BLOCK_THRESHOLD,
  NRS_STRICT_BLOCK_THRESHOLD,
} from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

// --- Helpers ---

function baseCds(cds = 0, reasonCodes: string[] = []): ScoreResult {
  return { cds, reasonCodes };
}

function baseNav(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return {
    isNewTabOrWindow: false,
    isCrossSite: false,
    ...overrides,
  };
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

// --- isOAuthUrl (narrowed: requires path segment + OAuth query param) ---

describe("isOAuthUrl", () => {
  it("detects /oauth2/ in path with client_id param", () => {
    expect(isOAuthUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=123")).toBe(true);
  });

  it("detects /authorize in path with client_id param", () => {
    expect(isOAuthUrl("https://github.com/login/oauth/authorize?client_id=abc")).toBe(true);
  });

  it("detects /consent in path with scope param", () => {
    expect(isOAuthUrl("https://login.microsoftonline.com/common/oauth2/v2.0/consent?scope=openid")).toBe(true);
  });

  it("detects /openid in path with response_type param", () => {
    expect(isOAuthUrl("https://provider.example.com/openid/connect?response_type=code")).toBe(true);
  });

  it("detects /oauth in path with redirect_uri param", () => {
    expect(isOAuthUrl("https://example.com/oauth?redirect_uri=https://app.com/cb")).toBe(true);
  });

  it("detects Microsoft consumer Live OAuth authorize endpoint", () => {
    expect(
      isOAuthUrl("https://login.live.com/oauth20_authorize.srf?client_id=abc&response_type=code"),
    ).toBe(true);
  });

  // --- False positive reduction (Critical 1) ---

  it("rejects /login without OAuth query params", () => {
    expect(isOAuthUrl("https://id.example.com/login?return_to=/dashboard")).toBe(false);
  });

  it("rejects /auth without OAuth query params", () => {
    expect(isOAuthUrl("https://auth.example.com/auth/realms/master")).toBe(false);
  });

  it("rejects /signin without OAuth query params", () => {
    expect(isOAuthUrl("https://login.example.com/signin")).toBe(false);
  });

  it("rejects /sign-in (removed from keyword list)", () => {
    expect(isOAuthUrl("https://auth.example.com/sign-in?client_id=abc")).toBe(false);
  });

  it("rejects substring match inside a word (e.g. /myauthpage)", () => {
    expect(isOAuthUrl("https://example.com/myauthpage?client_id=abc")).toBe(false);
  });

  it("rejects keyword in query only (no path segment)", () => {
    expect(isOAuthUrl("https://example.com/start?type=oauth&provider=google")).toBe(false);
  });

  it("rejects /consent without OAuth query params", () => {
    expect(isOAuthUrl("https://example.com/consent")).toBe(false);
  });

  it("requires path segment AND query param together", () => {
    // Path has /oauth/ but no OAuth query param
    expect(isOAuthUrl("https://example.com/oauth/info")).toBe(false);
    // Path has /oauth/ AND has client_id -> true
    expect(isOAuthUrl("https://example.com/oauth/info?client_id=x")).toBe(true);
  });

  it("returns false for normal URLs", () => {
    expect(isOAuthUrl("https://www.example.com/products?id=42")).toBe(false);
  });

  it("returns false for non-HTTP URLs", () => {
    expect(isOAuthUrl("ftp://auth.example.com/oauth?client_id=x")).toBe(false);
  });

  it("returns false for malformed URLs", () => {
    expect(isOAuthUrl("not-a-url")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isOAuthUrl("")).toBe(false);
  });

  it("matches path segment at end of path", () => {
    expect(isOAuthUrl("https://example.com/oauth?client_id=x")).toBe(true);
  });

  it("matches path segment followed by /", () => {
    expect(isOAuthUrl("https://example.com/authorize/?response_type=code")).toBe(true);
  });
});

// --- extractRedirectUri (narrowed param list) ---

describe("extractRedirectUri", () => {
  it("extracts redirect_uri parameter", () => {
    expect(extractRedirectUri(
      "https://accounts.google.com/o/oauth2/auth?redirect_uri=https://app.example.com/callback"
    )).toBe("https://app.example.com/callback");
  });

  it("extracts redirect_url parameter", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/authorize?redirect_url=https://app.example.com/done"
    )).toBe("https://app.example.com/done");
  });

  it("extracts callback_url parameter", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?callback_url=https://myapp.com/cb"
    )).toBe("https://myapp.com/cb");
  });

  it("extracts return_url parameter", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?return_url=https://myapp.com/dashboard"
    )).toBe("https://myapp.com/dashboard");
  });

  // --- Removed generic params (Important 4) ---

  it("does not extract 'callback' (generic, removed)", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?callback=https://myapp.com/cb"
    )).toBeNull();
  });

  it("does not extract 'return_to' (generic, removed)", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?return_to=https://myapp.com/dashboard"
    )).toBeNull();
  });

  it("does not extract 'continue' (generic, removed)", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?continue=https://myapp.com/next"
    )).toBeNull();
  });

  it("does not extract 'next' (generic, removed)", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?next=https://myapp.com/home"
    )).toBeNull();
  });

  it("returns null when no redirect parameter exists", () => {
    expect(extractRedirectUri(
      "https://accounts.google.com/o/oauth2/auth?client_id=123&scope=openid"
    )).toBeNull();
  });

  it("returns null for malformed URL", () => {
    expect(extractRedirectUri("not-a-url")).toBeNull();
  });

  it("prefers redirect_uri over later parameters", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/auth?redirect_uri=https://first.com/cb&callback_url=https://second.com/cb"
    )).toBe("https://first.com/cb");
  });
});

// --- isUnexpectedCallback ---

describe("isUnexpectedCallback", () => {
  it("returns false when callback matches expected domain", () => {
    const flow = makeFlow({ expectedCallbackDomain: "app.example.com" });
    expect(isUnexpectedCallback(flow, "https://app.example.com/callback?code=abc")).toBe(false);
  });

  it("returns false when callback is subdomain of expected", () => {
    const flow = makeFlow({ expectedCallbackDomain: "example.com" });
    expect(isUnexpectedCallback(flow, "https://app.example.com/callback")).toBe(false);
  });

  it("returns true when callback domain differs", () => {
    const flow = makeFlow({ expectedCallbackDomain: "app.example.com" });
    expect(isUnexpectedCallback(flow, "https://evil.com/steal?code=abc")).toBe(true);
  });

  it("returns true for malformed callback URL", () => {
    const flow = makeFlow({ expectedCallbackDomain: "app.example.com" });
    expect(isUnexpectedCallback(flow, "not-a-url")).toBe(true);
  });

  it("returns false when expectedCallbackDomain is empty", () => {
    const flow = makeFlow({ expectedCallbackDomain: "" });
    expect(isUnexpectedCallback(flow, "https://anything.com/cb")).toBe(false);
  });

  it("handles callback to same registrable domain", () => {
    const flow = makeFlow({ expectedCallbackDomain: "sub.example.com" });
    expect(isUnexpectedCallback(flow, "https://other.example.com/cb")).toBe(false);
  });

  // --- Localhost exclusion (Important 6) ---

  it("returns false for localhost callback", () => {
    const flow = makeFlow({ expectedCallbackDomain: "app.example.com" });
    expect(isUnexpectedCallback(flow, "http://localhost:8080/callback?code=abc")).toBe(false);
  });

  it("returns false for 127.0.0.1 callback", () => {
    const flow = makeFlow({ expectedCallbackDomain: "app.example.com" });
    expect(isUnexpectedCallback(flow, "http://127.0.0.1:3000/callback?code=abc")).toBe(false);
  });

  it("returns false for [::1] callback", () => {
    const flow = makeFlow({ expectedCallbackDomain: "app.example.com" });
    expect(isUnexpectedCallback(flow, "http://[::1]:5000/callback?code=abc")).toBe(false);
  });
});

// --- Content script state management ---

describe("OAuth runtime message handling", () => {
  beforeEach(() => {
    _resetOAuthState();
  });

  it("handles ns-oauth-flow-update", () => {
    const flow = makeFlow();
    const handled = handleOAuthRuntimeMessage({
      type: "ns-oauth-flow-update",
      flow,
    });
    expect(handled).toBe(true);
    expect(getOAuthFlowState()).toEqual(flow);
  });

  it("returns null for a 'complete' flow (it is finished, not active) (#366)", () => {
    // The SW forwards the terminal 'complete' update; getOAuthFlowState's contract
    // is "null if no flow is active", so a completed flow must not read as active.
    handleOAuthRuntimeMessage({ type: "ns-oauth-flow-update", flow: makeFlow({ phase: "complete" }) });
    expect(getOAuthFlowState()).toBeNull();
  });

  it("keeps a still-active (consent) flow non-null", () => {
    handleOAuthRuntimeMessage({ type: "ns-oauth-flow-update", flow: makeFlow({ phase: "consent" }) });
    expect(getOAuthFlowState()?.phase).toBe("consent");
  });

  it("handles ns-oauth-redirect-mismatch", () => {
    expect(isOAuthRedirectMismatch()).toBe(false);
    const handled = handleOAuthRuntimeMessage({
      type: "ns-oauth-redirect-mismatch",
      callbackUrl: "https://evil.com/steal",
    });
    expect(handled).toBe(true);
    expect(isOAuthRedirectMismatch()).toBe(true);
  });

  it("handles ns-oauth-opener-manipulation", () => {
    expect(isOAuthOpenerManipulation()).toBe(false);
    const handled = handleOAuthRuntimeMessage({
      type: "ns-oauth-opener-manipulation",
      flow: makeFlow(),
    });
    expect(handled).toBe(true);
    expect(isOAuthOpenerManipulation()).toBe(true);
  });

  it("returns false for unknown messages", () => {
    expect(handleOAuthRuntimeMessage({ type: "ns-something-else" })).toBe(false);
    expect(handleOAuthRuntimeMessage(null)).toBe(false);
    expect(handleOAuthRuntimeMessage(undefined)).toBe(false);
  });

  it("resets state correctly", () => {
    handleOAuthRuntimeMessage({ type: "ns-oauth-redirect-mismatch" });
    handleOAuthRuntimeMessage({ type: "ns-oauth-opener-manipulation", flow: makeFlow() });
    handleOAuthRuntimeMessage({ type: "ns-oauth-flow-update", flow: makeFlow() });

    _resetOAuthState();

    expect(isOAuthRedirectMismatch()).toBe(false);
    expect(isOAuthOpenerManipulation()).toBe(false);
    expect(getOAuthFlowState()).toBeNull();
  });
});

// --- TTL-based flag expiry (Critical 2) ---

describe("OAuth flag TTL expiry", () => {
  beforeEach(() => {
    _resetOAuthState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("redirect mismatch flag expires after 60s", () => {
    handleOAuthRuntimeMessage({ type: "ns-oauth-redirect-mismatch" });
    expect(isOAuthRedirectMismatch()).toBe(true);

    vi.advanceTimersByTime(59_999);
    expect(isOAuthRedirectMismatch()).toBe(true);

    vi.advanceTimersByTime(2);
    expect(isOAuthRedirectMismatch()).toBe(false);
  });

  it("opener manipulation flag expires after 60s", () => {
    handleOAuthRuntimeMessage({ type: "ns-oauth-opener-manipulation", flow: makeFlow() });
    expect(isOAuthOpenerManipulation()).toBe(true);

    vi.advanceTimersByTime(59_999);
    expect(isOAuthOpenerManipulation()).toBe(true);

    vi.advanceTimersByTime(2);
    expect(isOAuthOpenerManipulation()).toBe(false);
  });

  it("flow state expires after 60s", () => {
    const flow = makeFlow({ startedAt: Date.now() });
    handleOAuthRuntimeMessage({ type: "ns-oauth-flow-update", flow });
    expect(getOAuthFlowState()).not.toBeNull();

    vi.advanceTimersByTime(60_000);
    expect(getOAuthFlowState()).toBeNull();
  });

  it("SPA navigation after flag expiry does not carry penalty", () => {
    handleOAuthRuntimeMessage({ type: "ns-oauth-redirect-mismatch" });
    handleOAuthRuntimeMessage({ type: "ns-oauth-opener-manipulation", flow: makeFlow() });

    vi.advanceTimersByTime(60_001);

    // Both flags should have expired
    expect(isOAuthRedirectMismatch()).toBe(false);
    expect(isOAuthOpenerManipulation()).toBe(false);
  });
});

// --- NRS integration ---

describe("NRS OAuth factors", () => {
  it("adds +30 for oauthRedirectMismatch", () => {
    const result = computeNRS(baseCds(0), baseNav({ oauthRedirectMismatch: true }));
    expect(result.nrs).toBe(30);
    expect(result.nrsFactors).toContain("nrs_oauth_redirect_mismatch");
    expect(result.reasonCodes).toContain("nrs_oauth_redirect_mismatch");
  });

  it("adds +45 for oauthOpenerManipulation (without dblclick)", () => {
    const result = computeNRS(baseCds(0), baseNav({ oauthOpenerManipulation: true }));
    expect(result.nrs).toBe(45);
    expect(result.nrsFactors).toContain("nrs_oauth_opener_manipulation");
    expect(result.reasonCodes).toContain("nrs_oauth_opener_manipulation");
  });

  it("does not add OAuth factors when fields are false", () => {
    const result = computeNRS(baseCds(0), baseNav({
      oauthRedirectMismatch: false,
      oauthOpenerManipulation: false,
    }));
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).not.toContain("nrs_oauth_redirect_mismatch");
    expect(result.nrsFactors).not.toContain("nrs_oauth_opener_manipulation");
  });

  it("does not add OAuth factors when fields are undefined", () => {
    const result = computeNRS(baseCds(0), baseNav());
    expect(result.nrsFactors).not.toContain("nrs_oauth_redirect_mismatch");
    expect(result.nrsFactors).not.toContain("nrs_oauth_opener_manipulation");
  });

  it("OAuth redirect mismatch alone does not reach block threshold", () => {
    const result = computeNRS(baseCds(0), baseNav({ oauthRedirectMismatch: true }));
    expect(result.nrs).toBe(30);
    expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
  });

  it("OAuth opener manipulation alone does not reach block threshold", () => {
    const result = computeNRS(baseCds(0), baseNav({ oauthOpenerManipulation: true }));
    expect(result.nrs).toBe(45);
    expect(result.nrs).toBeLessThan(NRS_BLOCK_THRESHOLD);
  });

  it("OAuth redirect mismatch reaches strict block threshold with some CDS", () => {
    const result = computeNRS(baseCds(20), baseNav({ oauthRedirectMismatch: true }));
    expect(result.nrs).toBe(50);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
  });

  it("OAuth opener manipulation reaches strict block threshold with zero CDS", () => {
    const result = computeNRS(baseCds(5), baseNav({ oauthOpenerManipulation: true }));
    expect(result.nrs).toBe(50);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
  });

  it("both OAuth factors stack", () => {
    const result = computeNRS(baseCds(0), baseNav({
      oauthRedirectMismatch: true,
      oauthOpenerManipulation: true,
    }));
    // 0 + 30 + 45 = 75
    expect(result.nrs).toBe(75);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
  });

  // --- OAuth + DoubleClickjacking dedup (Important 5) ---

  it("OAuth opener + dblclick uses higher weight only (no double-counting)", () => {
    const result = computeNRS(baseCds(0), baseNav({
      oauthOpenerManipulation: true,
      doubleClickHijackActive: true,
    }));
    // dblclick = +40, oauth opener delta = max(45-40, 0) = +5, total = 45
    expect(result.nrs).toBe(45);
    expect(result.nrsFactors).toContain("nrs_oauth_opener_manipulation");
    expect(result.nrsFactors).toContain("nrs_double_click_hijack");
  });

  it("OAuth opener + dblclick + CDS stays below old combined value", () => {
    const result = computeNRS(baseCds(10), baseNav({
      oauthOpenerManipulation: true,
      doubleClickHijackActive: true,
    }));
    // 10 + 40 + 5 = 55  (was 10 + 40 + 45 = 95 before dedup)
    expect(result.nrs).toBe(55);
    expect(result.nrs).toBeLessThan(95); // old stacked value
  });

  it("OAuth redirect mismatch + dblclick still stacks (different signals)", () => {
    const result = computeNRS(baseCds(0), baseNav({
      oauthRedirectMismatch: true,
      doubleClickHijackActive: true,
    }));
    // redirect mismatch is a different signal from opener manipulation,
    // so it stacks normally: 0 + 30 + 40 = 70
    expect(result.nrs).toBe(70);
  });

  it("OAuth factors + cross-site reaches strict block threshold", () => {
    const result = computeNRS(baseCds(0), baseNav({
      oauthRedirectMismatch: true,
      isCrossSite: true,
    }));
    // 0 + 30 + 20 = 50
    expect(result.nrs).toBe(50);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_STRICT_BLOCK_THRESHOLD);
  });

  it("allowlist reduces OAuth factor scores", () => {
    const result = computeNRS(baseCds(0), baseNav({
      oauthRedirectMismatch: true,
      oauthOpenerManipulation: true,
      destinationAllowlisted: true,
    }));
    // 0 + 30 + 45 - 100 = -25 -> clamped to 0
    expect(result.nrs).toBe(0);
  });

  it("preserves CDS reasons alongside OAuth NRS factors", () => {
    const cdsReasons = ["no_accessible_name", "overlay_large_interactive"];
    const result = computeNRS(
      baseCds(20, cdsReasons),
      baseNav({ oauthRedirectMismatch: true }),
    );
    expect(result.reasonCodes).toContain("no_accessible_name");
    expect(result.reasonCodes).toContain("overlay_large_interactive");
    expect(result.reasonCodes).toContain("nrs_oauth_redirect_mismatch");
    expect(result.cds).toBe(20);
    expect(result.nrs).toBe(50);
  });
});

// --- Legitimate OAuth flows (must NOT trigger) ---

describe("legitimate OAuth flows", () => {
  it("Google OAuth URL is detected as OAuth", () => {
    expect(isOAuthUrl(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=123&redirect_uri=https://myapp.com/callback&scope=openid"
    )).toBe(true);
  });

  it("GitHub OAuth URL is detected as OAuth", () => {
    expect(isOAuthUrl(
      "https://github.com/login/oauth/authorize?client_id=abc&redirect_uri=https://myapp.com/github/callback"
    )).toBe(true);
  });

  it("Microsoft OAuth URL is detected as OAuth", () => {
    expect(isOAuthUrl(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=xyz&redirect_uri=https://myapp.com/auth/microsoft"
    )).toBe(true);
  });

  it("legitimate callback to same domain is not unexpected", () => {
    const flow = makeFlow({
      expectedCallbackDomain: "myapp.com",
      consentUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    });
    expect(isUnexpectedCallback(flow, "https://myapp.com/callback?code=abc123")).toBe(false);
  });

  it("legitimate callback to subdomain is not unexpected", () => {
    const flow = makeFlow({
      expectedCallbackDomain: "myapp.com",
    });
    expect(isUnexpectedCallback(flow, "https://auth.myapp.com/callback?code=abc")).toBe(false);
  });

  it("localhost callback is never unexpected (dev flow)", () => {
    const flow = makeFlow({
      expectedCallbackDomain: "myapp.com",
    });
    expect(isUnexpectedCallback(flow, "http://localhost:3000/callback?code=abc")).toBe(false);
  });
});

describe("hasOAuthResponseParams (#207)", () => {
  it("detects an authorization-code callback (?code=)", () => {
    expect(hasOAuthResponseParams("https://app.com/cb?code=abc&state=x")).toBe(true);
  });

  it("detects an error callback (?error=)", () => {
    expect(hasOAuthResponseParams("https://app.com/cb?error=access_denied&state=x")).toBe(true);
  });

  it("detects an implicit/hybrid token callback in the fragment (#access_token / #id_token)", () => {
    expect(hasOAuthResponseParams("https://app.com/cb#access_token=t&token_type=bearer")).toBe(true);
    expect(hasOAuthResponseParams("https://app.com/cb#id_token=jwt&state=x")).toBe(true);
  });

  it("does NOT treat an authorization REQUEST (client_id/response_type/state, no code) as a response", () => {
    // Genuine provider hop — state is a CSRF echo that requests carry too.
    expect(
      hasOAuthResponseParams(
        "https://login.live.com/oauth20_authorize.srf?client_id=x&response_type=code&scope=openid&state=abc",
      ),
    ).toBe(false);
  });

  it("does NOT treat state alone as a response indicator", () => {
    expect(hasOAuthResponseParams("https://example.com/page?state=abc")).toBe(false);
  });

  it("returns false for unrelated navigations and malformed URLs", () => {
    expect(hasOAuthResponseParams("https://gmail.com/")).toBe(false);
    expect(hasOAuthResponseParams("https://shop.example/promo")).toBe(false);
    expect(hasOAuthResponseParams("not a url")).toBe(false);
  });
});

describe("hasCorroboratedOAuthResponse (#223)", () => {
  it("requires a state echo to corroborate a query code/error", () => {
    expect(hasCorroboratedOAuthResponse("https://app.com/cb?code=abc&state=x")).toBe(true);
    expect(hasCorroboratedOAuthResponse("https://app.com/cb?error=denied&state=x")).toBe(true);
    // code/error WITHOUT state is not corroborated (the #223 coupon false-positive case).
    expect(hasCorroboratedOAuthResponse("https://shop.example/sale?code=SUMMER")).toBe(false);
    expect(hasCorroboratedOAuthResponse("https://app.com/cb?error=oops")).toBe(false);
  });

  it("accepts a fragment access_token / id_token on its own (implicit/hybrid)", () => {
    expect(hasCorroboratedOAuthResponse("https://app.com/cb#access_token=t&token_type=bearer")).toBe(true);
    expect(hasCorroboratedOAuthResponse("https://app.com/cb#id_token=jwt")).toBe(true);
  });

  it("does NOT treat state alone (an authorization request hop) as a corroborated response", () => {
    expect(
      hasCorroboratedOAuthResponse(
        "https://login.live.com/oauth20_authorize.srf?client_id=x&response_type=code&state=abc",
      ),
    ).toBe(false);
    expect(hasCorroboratedOAuthResponse("https://example.com/page?state=abc")).toBe(false);
  });

  it("returns false for unrelated navigations and malformed URLs", () => {
    expect(hasCorroboratedOAuthResponse("https://gmail.com/")).toBe(false);
    expect(hasCorroboratedOAuthResponse("not a url")).toBe(false);
  });
});
