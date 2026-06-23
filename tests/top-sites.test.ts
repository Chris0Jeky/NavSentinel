import { describe, expect, it } from "vitest";
import {
  isTopSiteDomain,
  resolveFrameNavigationTrustTier,
  resolveNavigationTrustTier,
  TRUST_TIER_KNOWN_BAD,
  TRUST_TIER_TOP_SITE,
  TRUST_TIER_UNKNOWN,
  TRUST_TIER_USER_ALLOWLISTED,
} from "../extension/src/shared/top_sites";
import { TOP_SITE_TIER_ENTRIES } from "../extension/src/shared/top_sites_data";

describe("top-sites trust tier", () => {
  it("matches exact filtered top-site domains", () => {
    expect(isTopSiteDomain("github.com")).toBe(true);
    expect(isTopSiteDomain("google.com")).toBe(true);
  });

  it("matches exact filtered top-site subdomains", () => {
    expect(isTopSiteDomain("login.microsoftonline.com")).toBe(true);
  });

  it("does not match lookalike or unknown domains", () => {
    expect(isTopSiteDomain("github-login.example")).toBe(false);
    expect(isTopSiteDomain("unknown.example")).toBe(false);
  });

  it("does not treat subdomains as top sites without an explicit generated policy", () => {
    expect(isTopSiteDomain("meta.stackoverflow.com")).toBe(false);
    expect(isTopSiteDomain("evil.auth0.com")).toBe(false);
    expect(isTopSiteDomain("evil.okta.com")).toBe(false);
    expect(isTopSiteDomain("evil.slack.com")).toBe(false);
    expect(isTopSiteDomain("tenant.salesforce.com")).toBe(false);
    expect(isTopSiteDomain("evil.shopify.com")).toBe(false);
    expect(isTopSiteDomain("evil.amazonaws.com")).toBe(false);
    expect(isTopSiteDomain("bucket.s3.amazonaws.com")).toBe(false);
    expect(isTopSiteDomain("evil.githubusercontent.com")).toBe(false);
    expect(isTopSiteDomain("evil.cloudfront.net")).toBe(false);
    expect(isTopSiteDomain("evil.vercel.app")).toBe(false);
    expect(isTopSiteDomain("evil.netlify.app")).toBe(false);
    expect(isTopSiteDomain("evil.pages.dev")).toBe(false);
    expect(isTopSiteDomain("evil.workers.dev")).toBe(false);
    expect(isTopSiteDomain("evil.herokuapp.com")).toBe(false);
    expect(isTopSiteDomain("evil.azurewebsites.net")).toBe(false);
    expect(isTopSiteDomain("evil.firebaseapp.com")).toBe(false);
  });

  it("treats subdomains as top sites ONLY when the entry opts in (includeSubdomains)", () => {
    // Brands flagged includeSubdomains (first-party subdomains only) inherit trust.
    expect(isTopSiteDomain("gist.github.com")).toBe(true);
    expect(isTopSiteDomain("api.anthropic.com")).toBe(true);
    expect(isTopSiteDomain("support.apple.com")).toBe(true);
    // Explicit Google subdomain entries resolve exactly (google.com itself is NOT
    // includeSubdomains because sites.google.com hosts user content).
    expect(isTopSiteDomain("accounts.google.com")).toBe(true);
    expect(isTopSiteDomain("mail.google.com")).toBe(true);
    expect(isTopSiteDomain("sites.google.com")).toBe(false);
    expect(isTopSiteDomain("evil.google.com")).toBe(false);
  });

  it("resolves the newly added major domains to the top-site tier", () => {
    for (const host of ["claude.ai", "anthropic.com", "gitlab.com", "figma.com", "npmjs.com"]) {
      expect(resolveNavigationTrustTier({ destHost: host })).toBe(TRUST_TIER_TOP_SITE);
    }
  });

  it("resolves known-bad before any benign prior", () => {
    expect(resolveNavigationTrustTier({
      destHost: "github.com",
      destinationAllowlisted: true,
      knownBadDomain: true,
    })).toBe(TRUST_TIER_KNOWN_BAD);
  });

  it("resolves allowlist before top-site prior", () => {
    expect(resolveNavigationTrustTier({
      destHost: "github.com",
      destinationAllowlisted: true,
    })).toBe(TRUST_TIER_USER_ALLOWLISTED);
  });

  it("resolves top-site and unknown destinations", () => {
    expect(resolveNavigationTrustTier({ destHost: "github.com" })).toBe(TRUST_TIER_TOP_SITE);
    expect(resolveNavigationTrustTier({ destHost: "unknown.example" })).toBe(TRUST_TIER_UNKNOWN);
  });

  it("does not grant top-site relief to child frames before reputation is known", () => {
    expect(resolveFrameNavigationTrustTier({
      isTopFrame: false,
      destHost: "github.com",
    })).toBe(TRUST_TIER_UNKNOWN);
  });

  it("preserves known-bad precedence for child frames", () => {
    expect(resolveFrameNavigationTrustTier({
      isTopFrame: false,
      destHost: "github.com",
      knownBadDomain: true,
    })).toBe(TRUST_TIER_KNOWN_BAD);
  });

  it("still lets known-bad override benign priors in top frames", () => {
    expect(resolveFrameNavigationTrustTier({
      isTopFrame: true,
      destHost: "github.com",
      knownBadDomain: true,
    })).toBe(TRUST_TIER_KNOWN_BAD);
  });
});

describe("top-sites generated-data binary-search contract (#322 / disc#17)", () => {
  // findTopSiteEntry binary-searches TOP_SITE_TIER_ENTRIES with `candidate.domain < domain`
  // (UTF-16 code units). If the build emitted the array in any other order (e.g. a
  // locale-aware localeCompare sort), the search could step past a present entry and
  // return null — a real top site would silently lose its trust tier. These invariants
  // protect the committed data regardless of how it was generated.
  it("is strictly ascending under the exact `<` the search uses", () => {
    for (let i = 1; i < TOP_SITE_TIER_ENTRIES.length; i += 1) {
      const prev = TOP_SITE_TIER_ENTRIES[i - 1]!.domain;
      const cur = TOP_SITE_TIER_ENTRIES[i]!.domain;
      expect(prev < cur).toBe(true); // strict: also rejects duplicate domains
    }
  });

  it("finds every committed entry via the binary search (no entry is unreachable)", () => {
    for (const entry of TOP_SITE_TIER_ENTRIES) {
      expect(isTopSiteDomain(entry.domain)).toBe(true);
    }
  });
});
