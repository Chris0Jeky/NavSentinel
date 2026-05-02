import { describe, expect, it } from "vitest";
import {
  RedirectChainTracker,
  isKnownRedirector,
} from "../extension/src/shared/redirect_chain";
import {
  computeNRS,
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

// --- isKnownRedirector ---

describe("isKnownRedirector", () => {
  it("detects URL shortener domains", () => {
    expect(isKnownRedirector("https://bit.ly/abc123")).toBe(true);
    expect(isKnownRedirector("https://t.co/xyz")).toBe(true);
    expect(isKnownRedirector("https://goo.gl/short")).toBe(true);
    expect(isKnownRedirector("https://tinyurl.com/abc")).toBe(true);
    expect(isKnownRedirector("https://ow.ly/foo")).toBe(true);
    expect(isKnownRedirector("https://is.gd/bar")).toBe(true);
    expect(isKnownRedirector("https://buff.ly/baz")).toBe(true);
    expect(isKnownRedirector("https://rebrand.ly/qux")).toBe(true);
  });

  it("detects tracking subdomain prefixes", () => {
    expect(isKnownRedirector("https://click.example.com/track")).toBe(true);
    expect(isKnownRedirector("https://track.newsletter.com/link")).toBe(true);
    expect(isKnownRedirector("https://redirect.ads.com/go")).toBe(true);
    expect(isKnownRedirector("https://go.somewhere.com/page")).toBe(true);
    expect(isKnownRedirector("https://redir.example.com/out")).toBe(true);
  });

  it("detects redirect query parameters", () => {
    expect(isKnownRedirector("https://example.com/login?redirect=https://evil.com")).toBe(true);
    expect(isKnownRedirector("https://example.com/go?url=https://other.com")).toBe(true);
    expect(isKnownRedirector("https://example.com/page?goto=foo")).toBe(true);
    expect(isKnownRedirector("https://example.com/link?dest=bar")).toBe(true);
    expect(isKnownRedirector("https://example.com/auth?redirect_uri=https://app.com/callback")).toBe(true);
    expect(isKnownRedirector("https://example.com/auth?redirect_url=https://app.com")).toBe(true);
    expect(isKnownRedirector("https://example.com/login?return_to=/dashboard")).toBe(true);
  });

  it("does not flag generic SSO/OAuth params (next, continue, target)", () => {
    // These were removed to reduce false positives on legitimate auth flows
    expect(isKnownRedirector("https://accounts.google.com/ServiceLogin?continue=https://mail.google.com")).toBe(false);
    expect(isKnownRedirector("https://example.com/auth?next=/dashboard")).toBe(false);
    expect(isKnownRedirector("https://example.com/sso?target=baz")).toBe(false);
  });

  it("detects open redirect path patterns", () => {
    expect(isKnownRedirector("https://example.com/redirect?url=foo")).toBe(true);
    expect(isKnownRedirector("https://example.com/go?to=bar")).toBe(true);
    expect(isKnownRedirector("https://example.com/redir/something")).toBe(true);
    expect(isKnownRedirector("https://example.com/out/link")).toBe(true);
    expect(isKnownRedirector("https://example.com/link/ext")).toBe(true);
  });

  it("does not flag known-legitimate tracking-prefix domains", () => {
    // These match tracking prefixes but are legitimate services.
    // Use paths that don't also match open-redirect path patterns.
    expect(isKnownRedirector("https://go.microsoft.com/fwlink/123")).toBe(false);
    expect(isKnownRedirector("https://go.dev/doc/tutorial")).toBe(false);
    expect(isKnownRedirector("https://go.google.com/something")).toBe(false);
    expect(isKnownRedirector("https://go.googleprod.com/foo")).toBe(false);
    expect(isKnownRedirector("https://click.mailchimp.com/track/click/abc")).toBe(false);
    expect(isKnownRedirector("https://click.convertkit.com/campaigns/xyz")).toBe(false);
  });

  it("still flags tracking prefixes for non-allowlisted domains", () => {
    expect(isKnownRedirector("https://go.somewhere-suspicious.com/page")).toBe(true);
    expect(isKnownRedirector("https://click.evil-tracker.com/redirect")).toBe(true);
  });

  it("handles mixed-case hostnames", () => {
    // Shortener domains
    expect(isKnownRedirector("https://BIT.LY/abc123")).toBe(true);
    expect(isKnownRedirector("https://T.Co/xyz")).toBe(true);
    // Tracking prefixes
    expect(isKnownRedirector("https://CLICK.Example.COM/track")).toBe(true);
    // Allowlisted domains should still be allowlisted regardless of case
    expect(isKnownRedirector("https://GO.MICROSOFT.COM/fwlink")).toBe(false);
  });

  it("handles URL-encoded redirect parameters", () => {
    // Param names are case-insensitive
    expect(isKnownRedirector("https://example.com/page?REDIRECT=foo")).toBe(true);
    expect(isKnownRedirector("https://example.com/page?Url=bar")).toBe(true);
    expect(isKnownRedirector("https://example.com/page?GOTO=baz")).toBe(true);
  });

  it("does not flag normal URLs", () => {
    expect(isKnownRedirector("https://example.com/")).toBe(false);
    expect(isKnownRedirector("https://www.google.com/search?q=test")).toBe(false);
    expect(isKnownRedirector("https://github.com/user/repo")).toBe(false);
    expect(isKnownRedirector("https://amazon.com/product/123")).toBe(false);
  });

  it("does not flag URLs with non-redirect query params", () => {
    // Common params that should not trigger redirector detection
    expect(isKnownRedirector("https://shop.com/product?id=123&size=large")).toBe(false);
    expect(isKnownRedirector("https://example.com/page?q=search&page=2")).toBe(false);
  });

  it("handles invalid URLs gracefully", () => {
    expect(isKnownRedirector("not-a-url")).toBe(false);
    expect(isKnownRedirector("")).toBe(false);
  });
});

// --- RedirectChainTracker ---

describe("RedirectChainTracker", () => {
  it("returns null for a single hop (no chain)", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://example.com/", 1000, "typed");
    expect(tracker.getChainInfo(1)).toBeNull();
  });

  it("records a 2-hop chain", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://a.com/", 1000, "link");
    tracker.recordHop(1, "https://b.com/", 2000, "link");
    const info = tracker.getChainInfo(1);
    expect(info).not.toBeNull();
    expect(info!.depth).toBe(2);
  });

  it("records a 5-hop chain through known redirectors", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://start.com/", 1000, "link");
    tracker.recordHop(1, "https://bit.ly/abc", 2000, "link");
    tracker.recordHop(1, "https://track.ads.com/go", 3000, "link");
    tracker.recordHop(1, "https://middle.com/page", 4000, "link");
    tracker.recordHop(1, "https://final.com/landing", 5000, "link");
    const info = tracker.getChainInfo(1);
    expect(info).not.toBeNull();
    expect(info!.depth).toBe(5);
    expect(info!.viaKnownRedirector).toBe(true);
    expect(info!.knownRedirectorHops).toBe(2); // bit.ly + track.ads.com
  });

  it("starts a new chain when hops are outside the 10s window", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://a.com/", 1000, "link");
    tracker.recordHop(1, "https://b.com/", 12000, "link"); // 11s later
    const info = tracker.getChainInfo(1);
    // Should be a new chain with just one hop
    expect(info).toBeNull();
  });

  it("caps chain at 10 hops but preserves the chain signal", () => {
    const tracker = new RedirectChainTracker();
    for (let i = 0; i < 12; i++) {
      tracker.recordHop(1, `https://hop${i}.com/`, 1000 + i * 500, "link");
    }
    const info = tracker.getChainInfo(1);
    expect(info).not.toBeNull();
    // Chain should remain at 10 hops (not reset by the 11th/12th)
    expect(info!.depth).toBe(10);
  });

  it("prunes chains older than 15 seconds", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://a.com/", 1000, "link");
    tracker.recordHop(1, "https://b.com/", 2000, "link");
    // Record on a different tab at t=20000 to trigger pruning
    tracker.recordHop(2, "https://c.com/", 20000, "link");
    // Chain for tab 1 should be pruned (last hop at 2000, now 20000 = 18s > 15s)
    expect(tracker.getChainInfo(1)).toBeNull();
  });

  it("cleans up on deleteTab", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://a.com/", 1000, "link");
    tracker.recordHop(1, "https://b.com/", 2000, "link");
    tracker.deleteTab(1);
    expect(tracker.getChainInfo(1)).toBeNull();
  });

  it("tracks chains independently per tab", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://a.com/", 1000, "link");
    tracker.recordHop(1, "https://b.com/", 2000, "link");
    tracker.recordHop(2, "https://x.com/", 1500, "link");
    expect(tracker.getChainInfo(1)!.depth).toBe(2);
    expect(tracker.getChainInfo(2)).toBeNull(); // only 1 hop
  });

  it("enforces map limit of 100 entries", () => {
    const tracker = new RedirectChainTracker();
    // Add 105 tabs
    for (let i = 0; i < 105; i++) {
      tracker.recordHop(i, `https://tab${i}.com/`, 1000 + i, "link");
    }
    expect(tracker.size).toBeLessThanOrEqual(100);
  });

  it("hasActiveChain returns true within chain window", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://a.com/", 1000, "link");
    expect(tracker.hasActiveChain(1, 5000)).toBe(true); // 4s < 10s window
  });

  it("hasActiveChain returns false outside chain window", () => {
    const tracker = new RedirectChainTracker();
    tracker.recordHop(1, "https://a.com/", 1000, "link");
    expect(tracker.hasActiveChain(1, 12000)).toBe(false); // 11s > 10s window
  });

  it("hasActiveChain returns false for unknown tab", () => {
    const tracker = new RedirectChainTracker();
    expect(tracker.hasActiveChain(99, 1000)).toBe(false);
  });
});

// --- False positive scenarios ---

describe("isKnownRedirector false positive scenarios", () => {
  it("does not flag a standard SSO login flow URL", () => {
    // Google SSO uses 'continue' param -- now excluded
    expect(isKnownRedirector("https://accounts.google.com/ServiceLogin?continue=https://mail.google.com")).toBe(false);
    // Microsoft SSO
    expect(isKnownRedirector("https://login.microsoftonline.com/common/oauth2/authorize?client_id=abc&response_type=code")).toBe(false);
  });

  it("does not flag legitimate email marketing tracking links", () => {
    // Mailchimp click tracking is allowlisted (tracking prefix bypassed)
    expect(isKnownRedirector("https://click.mailchimp.com/track/click/30abc")).toBe(false);
    // ConvertKit click tracking is allowlisted (use path that doesn't match open redirect patterns)
    expect(isKnownRedirector("https://click.convertkit.com/campaigns/xyz")).toBe(false);
  });

  it("does not flag Go language website", () => {
    expect(isKnownRedirector("https://go.dev/doc/tutorial/getting-started")).toBe(false);
  });

  it("does not flag Microsoft Go links", () => {
    expect(isKnownRedirector("https://go.microsoft.com/fwlink/?LinkId=2135060")).toBe(false);
  });
});

// --- NRS scoring for redirect chains ---

describe("computeNRS redirect chain factors", () => {
  it("does not add chain score for depth <= 2", () => {
    const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 2 }));
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
  });

  it("adds +5 for depth 3 (one hop beyond threshold of 2)", () => {
    const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 3 }));
    expect(result.nrs).toBe(5);
    expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
  });

  it("adds +15 for depth 5 (three hops beyond threshold)", () => {
    const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 5 }));
    expect(result.nrs).toBe(15);
    expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
  });

  it("caps chain depth score at +25", () => {
    const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 10 }));
    // 10 - 2 = 8 hops * 5 = 40, capped at 25
    expect(result.nrs).toBe(25);
    expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
  });

  it("adds +15 for one known redirector hop", () => {
    const result = computeNRS(baseCds(0), baseNav({
      redirectViaKnownRedirector: true,
      knownRedirectorHops: 1,
    }));
    expect(result.nrs).toBe(15);
    expect(result.nrsFactors).toContain("nrs_redirect_via_known_redirector");
  });

  it("adds +30 (capped) for two known redirector hops", () => {
    const result = computeNRS(baseCds(0), baseNav({
      redirectViaKnownRedirector: true,
      knownRedirectorHops: 2,
    }));
    expect(result.nrs).toBe(30);
    expect(result.nrsFactors).toContain("nrs_redirect_via_known_redirector");
  });

  it("caps known redirector score at +30 even with 3 hops", () => {
    const result = computeNRS(baseCds(0), baseNav({
      redirectViaKnownRedirector: true,
      knownRedirectorHops: 3,
    }));
    // 3 * 15 = 45, capped at 30
    expect(result.nrs).toBe(30);
  });

  it("defaults to 1 known redirector hop when knownRedirectorHops is undefined", () => {
    const result = computeNRS(baseCds(0), baseNav({
      redirectViaKnownRedirector: true,
    }));
    expect(result.nrs).toBe(15);
  });

  it("combines chain depth and known redirector scores", () => {
    const result = computeNRS(baseCds(0), baseNav({
      redirectChainDepth: 5,
      redirectViaKnownRedirector: true,
      knownRedirectorHops: 2,
    }));
    // depth: (5-2)*5 = 15, redirector: min(2*15, 30) = 30, total = 45
    expect(result.nrs).toBe(45);
    expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
    expect(result.nrsFactors).toContain("nrs_redirect_via_known_redirector");
  });

  it("combines chain factors with cross-site and other NRS factors", () => {
    const result = computeNRS(baseCds(10), baseNav({
      isCrossSite: true,
      redirectChainDepth: 4,
      redirectViaKnownRedirector: true,
      knownRedirectorHops: 1,
    }));
    // CDS=10, cross-site=+20, chain depth=(4-2)*5=+10, redirector=+15 = 55
    expect(result.nrs).toBe(55);
  });

  it("does not add chain factors when redirectChainDepth is undefined", () => {
    const result = computeNRS(baseCds(0), baseNav());
    expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    expect(result.nrsFactors).not.toContain("nrs_redirect_via_known_redirector");
  });

  it("does not add redirector score when redirectViaKnownRedirector is false", () => {
    const result = computeNRS(baseCds(0), baseNav({
      redirectChainDepth: 5,
      redirectViaKnownRedirector: false,
    }));
    expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
    expect(result.nrsFactors).not.toContain("nrs_redirect_via_known_redirector");
  });
});
