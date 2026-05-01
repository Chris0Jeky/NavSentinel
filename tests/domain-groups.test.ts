import { describe, expect, it } from "vitest";
import { areSameOrganization } from "../extension/src/shared/domain_groups";

describe("areSameOrganization", () => {
  describe("returns true for same-organization domain pairs", () => {
    it("unity3d.com and unity.com", () => {
      expect(areSameOrganization("unity3d.com", "unity.com")).toBe(true);
      expect(areSameOrganization("unity.com", "unity3d.com")).toBe(true);
    });

    it("google.com and youtube.com", () => {
      expect(areSameOrganization("google.com", "youtube.com")).toBe(true);
    });

    it("google.com and googleapis.com", () => {
      expect(areSameOrganization("google.com", "googleapis.com")).toBe(true);
    });

    it("microsoft.com and live.com", () => {
      expect(areSameOrganization("microsoft.com", "live.com")).toBe(true);
    });

    it("microsoft.com and outlook.com", () => {
      expect(areSameOrganization("microsoft.com", "outlook.com")).toBe(true);
    });

    it("microsoft.com and linkedin.com", () => {
      expect(areSameOrganization("microsoft.com", "linkedin.com")).toBe(true);
    });

    it("amazon.com and amazonaws.com", () => {
      expect(areSameOrganization("amazon.com", "amazonaws.com")).toBe(true);
    });

    it("apple.com and icloud.com", () => {
      expect(areSameOrganization("apple.com", "icloud.com")).toBe(true);
    });

    it("facebook.com and instagram.com", () => {
      expect(areSameOrganization("facebook.com", "instagram.com")).toBe(true);
    });

    it("github.com and githubusercontent.com", () => {
      expect(areSameOrganization("github.com", "githubusercontent.com")).toBe(true);
    });

    it("reddit.com and redditmedia.com", () => {
      expect(areSameOrganization("reddit.com", "redditmedia.com")).toBe(true);
    });
  });

  describe("handles subdomains correctly", () => {
    it("www.unity3d.com and www.unity.com", () => {
      expect(areSameOrganization("www.unity3d.com", "www.unity.com")).toBe(true);
    });

    it("store.unity3d.com and docs.unity.com", () => {
      expect(areSameOrganization("store.unity3d.com", "docs.unity.com")).toBe(true);
    });

    it("mail.google.com and www.youtube.com", () => {
      expect(areSameOrganization("mail.google.com", "www.youtube.com")).toBe(true);
    });
  });

  describe("returns true for same domain (trivially)", () => {
    it("same registrable domain", () => {
      expect(areSameOrganization("example.com", "example.com")).toBe(true);
    });

    it("same domain with different subdomains", () => {
      expect(areSameOrganization("www.example.com", "mail.example.com")).toBe(true);
    });
  });

  describe("returns false for unrelated domains", () => {
    it("google.com and facebook.com", () => {
      expect(areSameOrganization("google.com", "facebook.com")).toBe(false);
    });

    it("unity.com and example.com", () => {
      expect(areSameOrganization("unity.com", "example.com")).toBe(false);
    });

    it("apple.com and amazon.com", () => {
      expect(areSameOrganization("apple.com", "amazon.com")).toBe(false);
    });

    it("unknown domains", () => {
      expect(areSameOrganization("randomsite.com", "otherdomain.org")).toBe(false);
    });
  });

  describe("abuse resistance", () => {
    it("attacker domain with unity prefix is not in the group", () => {
      expect(areSameOrganization("unity-phishing.com", "unity.com")).toBe(false);
    });

    it("attacker domain with google prefix is not in the group", () => {
      expect(areSameOrganization("google-login.com", "google.com")).toBe(false);
    });

    it("attacker domain with similar name is not in the group", () => {
      expect(areSameOrganization("unity3d.net", "unity.com")).toBe(false);
    });

    it("substring match does not grant group membership", () => {
      expect(areSameOrganization("myunity.com", "unity.com")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("empty strings return false", () => {
      expect(areSameOrganization("", "unity.com")).toBe(false);
      expect(areSameOrganization("unity.com", "")).toBe(false);
      expect(areSameOrganization("", "")).toBe(false);
    });

    it("case insensitive", () => {
      expect(areSameOrganization("Unity3D.com", "UNITY.com")).toBe(true);
      expect(areSameOrganization("Google.COM", "YouTube.COM")).toBe(true);
    });

    it("trailing dot normalized", () => {
      expect(areSameOrganization("unity3d.com.", "unity.com")).toBe(true);
    });
  });

  describe("symmetry", () => {
    it("order does not matter for any group pair", () => {
      const pairs: [string, string][] = [
        ["unity3d.com", "unity.com"],
        ["google.com", "youtube.com"],
        ["microsoft.com", "bing.com"],
        ["amazon.com", "amazonaws.com"],
        ["apple.com", "icloud.com"],
        ["facebook.com", "whatsapp.com"],
      ];
      for (const [a, b] of pairs) {
        expect(areSameOrganization(a, b)).toBe(areSameOrganization(b, a));
      }
    });
  });
});
