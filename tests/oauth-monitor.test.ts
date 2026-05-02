import { describe, expect, it, beforeEach } from "vitest";
import {
  isOAuthUrl,
  extractRedirectUri,
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

// --- isOAuthUrl ---

describe("isOAuthUrl", () => {
  it("detects /oauth/ in path", () => {
    expect(isOAuthUrl("https://accounts.google.com/o/oauth2/v2/auth?client_id=123")).toBe(true);
  });

  it("detects /authorize in path", () => {
    expect(isOAuthUrl("https://github.com/login/oauth/authorize?client_id=abc")).toBe(true);
  });

  it("detects /consent in path", () => {
    expect(isOAuthUrl("https://login.microsoftonline.com/common/oauth2/v2.0/consent")).toBe(true);
  });

  it("detects /login in path", () => {
    expect(isOAuthUrl("https://id.example.com/login?return_to=/dashboard")).toBe(true);
  });

  it("detects /auth in path", () => {
    expect(isOAuthUrl("https://auth.example.com/auth/realms/master")).toBe(true);
  });

  it("detects /signin in path", () => {
    expect(isOAuthUrl("https://login.example.com/signin")).toBe(true);
  });

  it("detects /sign-in in path", () => {
    expect(isOAuthUrl("https://auth.example.com/sign-in")).toBe(true);
  });

  it("detects /openid in path", () => {
    expect(isOAuthUrl("https://provider.example.com/openid/connect")).toBe(true);
  });

  it("detects oauth keyword in query", () => {
    expect(isOAuthUrl("https://example.com/start?type=oauth&provider=google")).toBe(true);
  });

  it("returns false for normal URLs", () => {
    expect(isOAuthUrl("https://www.example.com/products?id=42")).toBe(false);
  });

  it("returns false for non-HTTP URLs", () => {
    expect(isOAuthUrl("ftp://auth.example.com/oauth")).toBe(false);
  });

  it("returns false for malformed URLs", () => {
    expect(isOAuthUrl("not-a-url")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isOAuthUrl("")).toBe(false);
  });
});

// --- extractRedirectUri ---

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

  it("extracts callback parameter", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?callback=https://myapp.com/cb"
    )).toBe("https://myapp.com/cb");
  });

  it("extracts return_to parameter", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?return_to=https://myapp.com/dashboard"
    )).toBe("https://myapp.com/dashboard");
  });

  it("extracts callback_url parameter", () => {
    expect(extractRedirectUri(
      "https://auth.example.com/login?callback_url=https://myapp.com/cb"
    )).toBe("https://myapp.com/cb");
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
      "https://auth.example.com/auth?redirect_uri=https://first.com/cb&callback=https://second.com/cb"
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

// --- NRS integration ---

describe("NRS OAuth factors", () => {
  it("adds +30 for oauthRedirectMismatch", () => {
    const result = computeNRS(baseCds(0), baseNav({ oauthRedirectMismatch: true }));
    expect(result.nrs).toBe(30);
    expect(result.nrsFactors).toContain("nrs_oauth_redirect_mismatch");
    expect(result.reasonCodes).toContain("nrs_oauth_redirect_mismatch");
  });

  it("adds +45 for oauthOpenerManipulation", () => {
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

  it("OAuth opener manipulation stacks with doubleClickHijack", () => {
    const result = computeNRS(baseCds(0), baseNav({
      oauthOpenerManipulation: true,
      doubleClickHijackActive: true,
    }));
    // 0 + 45 + 40 = 85
    expect(result.nrs).toBe(85);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
    expect(result.nrsFactors).toContain("nrs_oauth_opener_manipulation");
    expect(result.nrsFactors).toContain("nrs_double_click_hijack");
  });

  it("OAuth factors + cross-site reaches block threshold", () => {
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
});
