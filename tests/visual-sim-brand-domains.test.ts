import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRAND_CANONICAL_DOMAINS,
  isBrandCanonicalDomain,
  isCurrentPageCrossOriginFromBrand,
} from "../extension/src/shared/visual_sim_brand_domains";

describe("visual_sim_brand_domains", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isBrandCanonicalDomain", () => {
    it("matches an exact canonical domain", () => {
      expect(isBrandCanonicalDomain("google", "google.com")).toBe(true);
      expect(isBrandCanonicalDomain("paypal", "paypal.com")).toBe(true);
    });

    it("matches a subdomain of a canonical domain", () => {
      expect(isBrandCanonicalDomain("google", "accounts.google.com")).toBe(true);
      expect(isBrandCanonicalDomain("microsoft", "login.live.com")).toBe(true);
    });

    it("is case-insensitive on the hostname", () => {
      expect(isBrandCanonicalDomain("google", "ACCOUNTS.GOOGLE.COM")).toBe(true);
    });

    it("rejects a spoof / look-alike domain", () => {
      expect(isBrandCanonicalDomain("google", "google.com.evil.test")).toBe(false);
      expect(isBrandCanonicalDomain("paypal", "paypal-secure.test")).toBe(false);
      expect(isBrandCanonicalDomain("microsoft", "microsoftt.com")).toBe(false);
    });

    it("does not treat a canonical domain as a suffix of an unrelated host", () => {
      // "notgoogle.com" must not match "google.com" via naive endsWith.
      expect(isBrandCanonicalDomain("google", "notgoogle.com")).toBe(false);
    });

    it("returns false for an unknown template id", () => {
      expect(isBrandCanonicalDomain("not-a-real-brand", "google.com")).toBe(false);
    });

    it("returns false for an empty hostname", () => {
      expect(isBrandCanonicalDomain("google", "")).toBe(false);
      expect(isBrandCanonicalDomain("google", "   ")).toBe(false);
    });

    it("covers every brand template id that has canonical domains", () => {
      // Each mapped brand must have at least one non-empty domain entry.
      for (const [id, domains] of Object.entries(BRAND_CANONICAL_DOMAINS)) {
        expect(domains.length, `brand ${id} has no canonical domains`).toBeGreaterThan(0);
        for (const d of domains) {
          expect(isBrandCanonicalDomain(id, d)).toBe(true);
        }
      }
    });
  });

  describe("isCurrentPageCrossOriginFromBrand", () => {
    it("returns false when the current page is on the brand's canonical domain", () => {
      vi.stubGlobal("location", { hostname: "accounts.google.com" });
      expect(isCurrentPageCrossOriginFromBrand("google")).toBe(false);
    });

    it("returns true when the current page is on a spoof domain", () => {
      vi.stubGlobal("location", { hostname: "google-login.phish.test" });
      expect(isCurrentPageCrossOriginFromBrand("google")).toBe(true);
    });

    it("returns true for an unknown template id", () => {
      vi.stubGlobal("location", { hostname: "google.com" });
      expect(isCurrentPageCrossOriginFromBrand("not-a-real-brand")).toBe(true);
    });

    it("defaults to true (cross-origin) when location is unavailable", () => {
      vi.stubGlobal("location", undefined);
      expect(isCurrentPageCrossOriginFromBrand("google")).toBe(true);
    });
  });
});
