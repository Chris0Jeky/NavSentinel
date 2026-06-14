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

describe("top-sites trust tier", () => {
  it("matches exact filtered top-site domains", () => {
    expect(isTopSiteDomain("github.com")).toBe(true);
    expect(isTopSiteDomain("google.com")).toBe(true);
  });

  it("matches subdomains through their registrable domain", () => {
    expect(isTopSiteDomain("www.github.com")).toBe(true);
    expect(isTopSiteDomain("docs.github.com")).toBe(true);
  });

  it("does not match lookalike or unknown domains", () => {
    expect(isTopSiteDomain("github-login.example")).toBe(false);
    expect(isTopSiteDomain("unknown.example")).toBe(false);
  });

  it("does not treat shared-hosting tenant domains as top sites", () => {
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

  it("still lets known-bad override benign priors in top frames", () => {
    expect(resolveFrameNavigationTrustTier({
      isTopFrame: true,
      destHost: "github.com",
      knownBadDomain: true,
    })).toBe(TRUST_TIER_KNOWN_BAD);
  });
});
