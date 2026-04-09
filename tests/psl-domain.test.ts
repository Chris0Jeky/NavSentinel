import { describe, expect, it } from "vitest";
import { getRegistrableDomain } from "../extension/src/shared/domain";

describe("PSL-based getRegistrableDomain", () => {
  describe("cloud / PaaS domains treated as public suffixes", () => {
    it("herokuapp.com", () => {
      expect(getRegistrableDomain("evil.herokuapp.com")).toBe("evil.herokuapp.com");
    });

    it("cloudfront.net", () => {
      expect(getRegistrableDomain("foo.cloudfront.net")).toBe("foo.cloudfront.net");
    });

    it("azurewebsites.net", () => {
      expect(getRegistrableDomain("bar.azurewebsites.net")).toBe("bar.azurewebsites.net");
    });

    it("pages.dev", () => {
      expect(getRegistrableDomain("app.pages.dev")).toBe("app.pages.dev");
    });

    it("workers.dev", () => {
      expect(getRegistrableDomain("app.workers.dev")).toBe("app.workers.dev");
    });

    it("vercel.app", () => {
      expect(getRegistrableDomain("site.vercel.app")).toBe("site.vercel.app");
    });

    it("netlify.app", () => {
      expect(getRegistrableDomain("site.netlify.app")).toBe("site.netlify.app");
    });
  });

  describe("traditional multipart suffixes", () => {
    it("co.uk", () => {
      expect(getRegistrableDomain("sub.example.co.uk")).toBe("example.co.uk");
    });

    it("com.au", () => {
      expect(getRegistrableDomain("sub.example.com.au")).toBe("example.com.au");
    });

    it("co.jp", () => {
      expect(getRegistrableDomain("sub.example.co.jp")).toBe("example.co.jp");
    });
  });

  describe("basic domains", () => {
    it("bare domain", () => {
      expect(getRegistrableDomain("example.com")).toBe("example.com");
    });

    it("subdomain stripped", () => {
      expect(getRegistrableDomain("sub.example.com")).toBe("example.com");
    });

    it("deep subdomains stripped", () => {
      expect(getRegistrableDomain("a.b.c.example.com")).toBe("example.com");
    });
  });

  describe("intermediate trie nodes (not public suffixes themselves)", () => {
    it("bytemark.co.uk is not a public suffix, co.uk is", () => {
      expect(getRegistrableDomain("example.bytemark.co.uk")).toBe("bytemark.co.uk");
    });

    it("dh.bytemark.co.uk IS a public suffix", () => {
      expect(getRegistrableDomain("site.dh.bytemark.co.uk")).toBe("site.dh.bytemark.co.uk");
    });
  });

  describe("wildcard and exception rules", () => {
    it("wildcard *.ck: any second-level .ck is a public suffix", () => {
      // foo.bar.ck -> bar.ck is public suffix, registrable = foo.bar.ck
      expect(getRegistrableDomain("foo.bar.ck")).toBe("foo.bar.ck");
    });

    it("exception !www.ck: www.ck is NOT a public suffix", () => {
      // www.ck is excepted, so ck is the public suffix, registrable = www.ck
      expect(getRegistrableDomain("www.ck")).toBe("www.ck");
      expect(getRegistrableDomain("sub.www.ck")).toBe("www.ck");
    });
  });

  describe("IP addresses pass through", () => {
    it("IPv4", () => {
      expect(getRegistrableDomain("192.168.1.1")).toBe("192.168.1.1");
    });

    it("IPv6", () => {
      expect(getRegistrableDomain("::1")).toBe("::1");
    });
  });

  describe("edge cases", () => {
    it("empty string", () => {
      expect(getRegistrableDomain("")).toBe("");
    });

    it("single label (TLD only)", () => {
      // A bare TLD is itself a public suffix; return as-is
      expect(getRegistrableDomain("com")).toBe("com");
    });

    it("trailing dot normalized", () => {
      expect(getRegistrableDomain("sub.example.com.")).toBe("example.com");
    });

    it("uppercase normalized", () => {
      expect(getRegistrableDomain("Sub.Example.COM")).toBe("example.com");
    });
  });
});
