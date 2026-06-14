import { describe, expect, it } from "vitest";
import {
  isTopSiteDomain,
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
});
