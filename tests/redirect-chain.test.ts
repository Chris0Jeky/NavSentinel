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
    expect(isKnownRedirector("https://example.com/auth?next=/dashboard")).toBe(true);
    expect(isKnownRedirector("https://example.com/go?url=https://other.com")).toBe(true);
    expect(isKnownRedirector("https://example.com/page?goto=foo")).toBe(true);
    expect(isKnownRedirector("https://example.com/link?dest=bar")).toBe(true);
    expect(isKnownRedirector("https://example.com/sso?target=baz")).toBe(true);
    expect(isKnownRedirector("https://example.com/oauth?continue=qux")).toBe(true);
  });

  it("detects open redirect path patterns", () => {
    expect(isKnownRedirector("https://example.com/redirect?url=foo")).toBe(true);
    expect(isKnownRedirector("https://example.com/go?to=bar")).toBe(true);
    expect(isKnownRedirector("https://example.com/redir/something")).toBe(true);
    expect(isKnownRedirector("https://example.com/out/link")).toBe(true);
    expect(isKnownRedirector("https://example.com/link/ext")).toBe(true);
  });

  it("does not flag normal URLs", () => {
    expect(isKnownRedirector("https://example.com/")).toBe(false);
    expect(isKnownRedirector("https://www.google.com/search?q=test")).toBe(false);
    expect(isKnownRedirector("https://github.com/user/repo")).toBe(false);
    expect(isKnownRedirector("https://amazon.com/product/123")).toBe(false);
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

  it("caps chain at 10 hops", () => {
    const tracker = new RedirectChainTracker();
    for (let i = 0; i < 12; i++) {
      tracker.recordHop(1, `https://hop${i}.com/`, 1000 + i * 500, "link");
    }
    const info = tracker.getChainInfo(1);
    expect(info).not.toBeNull();
    // 10 hops max, then 11th starts a new chain
    expect(info!.depth).toBeLessThanOrEqual(10);
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
