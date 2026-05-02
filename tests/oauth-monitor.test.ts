import { describe, expect, it, beforeEach } from "vitest";
import {
  isOAuthFlow,
  trackOAuthRedirect,
  isOAuthCallbackSuspicious,
  getOAuthFlowState,
  isOAuthCallback,
  markOpenerManipulated,
  _resetOAuthState,
} from "../extension/src/content/oauth_monitor";
import {
  computeNRS,
  NRS_BLOCK_THRESHOLD,
} from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// isOAuthFlow — URL detection
// ---------------------------------------------------------------------------

describe("isOAuthFlow", () => {
  describe("Google OAuth", () => {
    it("detects Google accounts authorize URL", () => {
      expect(
        isOAuthFlow("https://accounts.google.com/o/oauth2/v2/auth?client_id=123&redirect_uri=https://app.example.com/callback&response_type=code&scope=openid+email")
      ).toBe(true);
    });

    it("detects Google consent URL", () => {
      expect(
        isOAuthFlow("https://accounts.google.com/o/oauth2/consent?client_id=123")
      ).toBe(true);
    });
  });

  describe("GitHub OAuth", () => {
    it("detects GitHub login authorize", () => {
      expect(
        isOAuthFlow("https://github.com/login/oauth/authorize?client_id=abc&scope=user")
      ).toBe(true);
    });

    it("detects GitHub login oauth callback", () => {
      expect(
        isOAuthFlow("https://github.com/login/oauth/callback?code=abc&state=xyz")
      ).toBe(true);
    });
  });

  describe("Microsoft / Azure AD", () => {
    it("detects Microsoft common oauth2 authorize", () => {
      expect(
        isOAuthFlow("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&response_type=code&scope=openid")
      ).toBe(true);
    });

    it("detects Azure AD consent endpoint", () => {
      expect(
        isOAuthFlow("https://login.microsoftonline.com/tenant-id/oauth2/authorize?client_id=abc")
      ).toBe(true);
    });
  });

  describe("Facebook", () => {
    it("detects Facebook dialog oauth", () => {
      expect(
        isOAuthFlow("https://www.facebook.com/v18.0/dialog/oauth?client_id=123&redirect_uri=https://app.example.com/fb")
      ).toBe(true);
    });
  });

  describe("custom / generic providers", () => {
    it("detects generic /oauth/authorize endpoint", () => {
      expect(
        isOAuthFlow("https://auth.example.com/oauth/authorize?client_id=abc")
      ).toBe(true);
    });

    it("detects URL with only response_type and client_id params", () => {
      expect(
        isOAuthFlow("https://idp.example.com/auth?response_type=code&client_id=xyz")
      ).toBe(true);
    });

    it("detects URL with redirect_uri param", () => {
      expect(
        isOAuthFlow("https://idp.example.com/connect?redirect_uri=https://app.example.com/callback")
      ).toBe(true);
    });

    it("detects URL with scope param", () => {
      expect(
        isOAuthFlow("https://idp.example.com/auth?scope=openid+profile")
      ).toBe(true);
    });

    it("detects URL with /consent path", () => {
      expect(
        isOAuthFlow("https://idp.example.com/consent?request_id=abc")
      ).toBe(true);
    });

    it("detects URL with /login path", () => {
      expect(
        isOAuthFlow("https://idp.example.com/login?return=https://app.example.com")
      ).toBe(true);
    });
  });

  describe("false positives — should NOT trigger", () => {
    it("does not match 'author' in a URL path", () => {
      expect(isOAuthFlow("https://example.com/blog/author/john")).toBe(false);
    });

    it("does not match 'authentication-service' URL", () => {
      expect(isOAuthFlow("https://example.com/api/authentication-service/v1/token")).toBe(false);
    });

    it("does not match 'authority' in URL", () => {
      expect(isOAuthFlow("https://example.com/certificate-authority/root")).toBe(false);
    });

    it("does not match plain homepage", () => {
      expect(isOAuthFlow("https://example.com/")).toBe(false);
    });

    it("does not match empty string", () => {
      expect(isOAuthFlow("")).toBe(false);
    });

    it("does not match generic product page", () => {
      expect(isOAuthFlow("https://store.example.com/products/shoes?color=blue")).toBe(false);
    });

    it("does not match 'authored' in path", () => {
      expect(isOAuthFlow("https://example.com/docs/authored-by-admin")).toBe(false);
    });

    it("does not match 'authorization_details' without other indicators", () => {
      // This contains 'authorization' which includes 'authorize' as a substring
      // but the function checks for "/authorize" path segment. Since
      // "authorization_details" would be in a query key, not a path, and
      // there's no "/authorize" path, this depends on implementation.
      // The URL below has NO path indicator and no word-boundary match.
      expect(isOAuthFlow("https://example.com/api/data?authorization_details=foo")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// trackOAuthRedirect + getOAuthFlowState
// ---------------------------------------------------------------------------

describe("trackOAuthRedirect", () => {
  beforeEach(() => {
    _resetOAuthState();
  });

  it("starts a flow with the initiating URL", () => {
    trackOAuthRedirect("https://accounts.google.com/o/oauth2/auth?client_id=abc&redirect_uri=https://app.example.com/callback");
    const state = getOAuthFlowState();
    expect(state.active).toBe(true);
    expect(state.currentFlow?.initiatingUrl).toContain("accounts.google.com");
    expect(state.currentFlow?.expectedRedirectUri).toBe("https://app.example.com/callback");
  });

  it("extracts redirect_uri from query string", () => {
    trackOAuthRedirect("https://auth.example.com/authorize?client_id=x&redirect_uri=https://myapp.com/cb&scope=openid");
    const state = getOAuthFlowState();
    expect(state.currentFlow?.expectedRedirectUri).toBe("https://myapp.com/cb");
  });

  it("handles URL without redirect_uri", () => {
    trackOAuthRedirect("https://auth.example.com/oauth/authorize?client_id=abc");
    const state = getOAuthFlowState();
    expect(state.active).toBe(true);
    expect(state.currentFlow?.expectedRedirectUri).toBeUndefined();
  });

  it("replaces current flow when a new one is tracked", () => {
    trackOAuthRedirect("https://auth1.example.com/oauth?client_id=a");
    trackOAuthRedirect("https://auth2.example.com/oauth?client_id=b");
    const state = getOAuthFlowState();
    expect(state.active).toBe(true);
    expect(state.currentFlow?.initiatingUrl).toContain("auth2.example.com");
    expect(state.recentFlows).toHaveLength(1);
    expect(state.recentFlows[0]?.initiatingUrl).toContain("auth1.example.com");
  });

  it("stores tabId when provided", () => {
    trackOAuthRedirect("https://auth.example.com/oauth?client_id=a", 42);
    expect(getOAuthFlowState().currentFlow?.tabId).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// isOAuthCallbackSuspicious — redirect_uri mismatch
// ---------------------------------------------------------------------------

describe("isOAuthCallbackSuspicious", () => {
  beforeEach(() => {
    _resetOAuthState();
  });

  it("returns false when no expected redirect_uri exists", () => {
    expect(isOAuthCallbackSuspicious("https://app.example.com/callback")).toBe(false);
  });

  it("returns false when callback matches expected redirect_uri (origin + path)", () => {
    trackOAuthRedirect("https://auth.example.com/oauth?redirect_uri=https://app.example.com/callback");
    expect(isOAuthCallbackSuspicious("https://app.example.com/callback?code=abc")).toBe(false);
  });

  it("returns true when callback origin differs from redirect_uri", () => {
    trackOAuthRedirect("https://auth.example.com/oauth?redirect_uri=https://app.example.com/callback");
    expect(isOAuthCallbackSuspicious("https://evil.example.com/callback?code=abc")).toBe(true);
  });

  it("returns true when callback path differs from redirect_uri", () => {
    trackOAuthRedirect("https://auth.example.com/oauth?redirect_uri=https://app.example.com/callback");
    expect(isOAuthCallbackSuspicious("https://app.example.com/evil-path?code=abc")).toBe(true);
  });

  it("uses explicit originalRedirectUri when provided", () => {
    // No active flow, but explicit URI provided
    expect(
      isOAuthCallbackSuspicious("https://evil.example.com/cb", "https://app.example.com/cb")
    ).toBe(true);
  });

  it("marks current flow as mismatch when suspicious", () => {
    trackOAuthRedirect("https://auth.example.com/oauth?redirect_uri=https://app.example.com/callback");
    isOAuthCallbackSuspicious("https://evil.example.com/steal?code=abc");
    const state = getOAuthFlowState();
    expect(state.currentFlow?.redirectMismatch).toBe(true);
    expect(state.currentFlow?.callbackSeen).toBe(true);
  });

  it("ignores trailing slashes when comparing paths", () => {
    trackOAuthRedirect("https://auth.example.com/oauth?redirect_uri=https://app.example.com/callback/");
    expect(isOAuthCallbackSuspicious("https://app.example.com/callback")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isOAuthCallback
// ---------------------------------------------------------------------------

describe("isOAuthCallback", () => {
  it("detects /callback path", () => {
    expect(isOAuthCallback("https://app.example.com/callback?code=abc&state=xyz")).toBe(true);
  });

  it("detects /auth/callback path", () => {
    expect(isOAuthCallback("https://app.example.com/auth/callback?code=abc")).toBe(true);
  });

  it("detects /signin-oidc path", () => {
    expect(isOAuthCallback("https://app.example.com/signin-oidc?code=abc&state=xyz")).toBe(true);
  });

  it("detects code + state params", () => {
    expect(isOAuthCallback("https://app.example.com/return?code=abc123&state=xyz789")).toBe(true);
  });

  it("does not match unrelated URL", () => {
    expect(isOAuthCallback("https://example.com/products/shoes")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markOpenerManipulated
// ---------------------------------------------------------------------------

describe("markOpenerManipulated", () => {
  beforeEach(() => {
    _resetOAuthState();
  });

  it("marks current flow when called during active flow", () => {
    trackOAuthRedirect("https://auth.example.com/oauth?client_id=abc");
    markOpenerManipulated();
    const state = getOAuthFlowState();
    expect(state.currentFlow?.openerManipulated).toBe(true);
  });

  it("does nothing when no active flow", () => {
    // Should not throw
    markOpenerManipulated();
    expect(getOAuthFlowState().active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NRS integration — OAuth factors
// ---------------------------------------------------------------------------

describe("NRS OAuth integration", () => {
  it("adds +30 for OAuth redirect mismatch", () => {
    const result = computeNRS(baseCds(0), baseNav({ oauthRedirectMismatch: true }));
    expect(result.nrs).toBe(30);
    expect(result.nrsFactors).toContain("nrs_oauth_redirect_mismatch");
  });

  it("adds +35 for OAuth opener manipulation", () => {
    const result = computeNRS(baseCds(0), baseNav({ oauthOpenerManipulation: true }));
    expect(result.nrs).toBe(35);
    expect(result.nrsFactors).toContain("nrs_oauth_opener_manipulation");
  });

  it("combines OAuth mismatch + opener manipulation", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({ oauthRedirectMismatch: true, oauthOpenerManipulation: true })
    );
    expect(result.nrs).toBe(30 + 35);
  });

  it("OAuth redirect mismatch + cross-site + new tab exceeds block threshold", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({
        oauthRedirectMismatch: true,
        isCrossSite: true,
        isNewTabOrWindow: true,
      })
    );
    // 30 + 20 + 20 = 70 >= NRS_BLOCK_THRESHOLD
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
  });

  it("OAuth opener manipulation + double-click hijack yields high NRS", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({
        oauthOpenerManipulation: true,
        doubleClickHijackActive: true,
      })
    );
    // 35 + 40 = 75
    expect(result.nrs).toBe(75);
    expect(result.nrs).toBeGreaterThanOrEqual(NRS_BLOCK_THRESHOLD);
  });

  it("does not add OAuth factors when flags are false/undefined", () => {
    const result = computeNRS(baseCds(10), baseNav());
    expect(result.nrsFactors).not.toContain("nrs_oauth_redirect_mismatch");
    expect(result.nrsFactors).not.toContain("nrs_oauth_opener_manipulation");
    expect(result.nrs).toBe(10);
  });

  it("allowlist still reduces OAuth-elevated score", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({
        oauthRedirectMismatch: true,
        oauthOpenerManipulation: true,
        destinationAllowlisted: true,
      })
    );
    // 30 + 35 - 100 = -35 -> clamped to 0
    expect(result.nrs).toBe(0);
  });
});
