import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { areSameOrganization } from "../extension/src/shared/domain_groups";
import {
  normalizeAllowlist,
  isAllowlisted,
  type Allowlist,
} from "../extension/src/shared/allowlist";

const arbLabel = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")),
    { minLength: 1, maxLength: 12 },
  )
  .map((chars) => chars.join(""));

const arbMixedCaseLabel = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")),
    { minLength: 1, maxLength: 12 },
  )
  .map((chars) => chars.join(""));

const arbDomain = fc
  .tuple(arbLabel, fc.constantFrom("com", "org", "net", "io", "co.uk"))
  .map(([label, tld]) => `${label}.${tld}`);

// ---------------------------------------------------------------------------
// areSameOrganization
// ---------------------------------------------------------------------------

describe("areSameOrganization properties", () => {
  it("is reflexive: areSameOrganization(a, a) === true for non-empty domains", () => {
    fc.assert(
      fc.property(arbDomain, (domain) => {
        expect(areSameOrganization(domain, domain)).toBe(true);
      }),
    );
  });

  it("is commutative: areSameOrganization(a, b) === areSameOrganization(b, a)", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (a, b) => {
        expect(areSameOrganization(a, b)).toBe(areSameOrganization(b, a));
      }),
    );
  });

  it("returns false for empty strings", () => {
    fc.assert(
      fc.property(arbDomain, (domain) => {
        expect(areSameOrganization("", domain)).toBe(false);
        expect(areSameOrganization(domain, "")).toBe(false);
        expect(areSameOrganization("", "")).toBe(false);
      }),
    );
  });

  it("is case-insensitive", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (a, b) => {
        expect(areSameOrganization(a.toUpperCase(), b.toUpperCase())).toBe(
          areSameOrganization(a.toLowerCase(), b.toLowerCase()),
        );
      }),
    );
  });

  it("stable under subdomain prefix: result unchanged by adding a subdomain", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, arbLabel, (a, b, sub) => {
        const withSub = `${sub}.${a}`;
        expect(areSameOrganization(withSub, b)).toBe(areSameOrganization(a, b));
      }),
    );
  });

  it("known groups are reflexive and commutative", () => {
    const groups = [
      ["google.com", "youtube.com"],
      ["microsoft.com", "linkedin.com"],
      ["facebook.com", "instagram.com"],
      ["amazon.com", "amazonaws.com"],
      ["github.com", "githubassets.com"],
      ["reddit.com", "redditmedia.com"],
      ["apple.com", "icloud.com"],
      ["mozilla.org", "firefox.com"],
    ];
    for (const [a, b] of groups) {
      expect(areSameOrganization(a!, b!)).toBe(true);
      expect(areSameOrganization(b!, a!)).toBe(true);
    }
  });

  it("domains in different groups are not same organization", () => {
    expect(areSameOrganization("google.com", "facebook.com")).toBe(false);
    expect(areSameOrganization("microsoft.com", "amazon.com")).toBe(false);
    expect(areSameOrganization("apple.com", "reddit.com")).toBe(false);
  });

  it("is transitive within known groups", () => {
    expect(areSameOrganization("google.com", "youtube.com")).toBe(true);
    expect(areSameOrganization("youtube.com", "googleapis.com")).toBe(true);
    expect(areSameOrganization("google.com", "googleapis.com")).toBe(true);

    expect(areSameOrganization("microsoft.com", "bing.com")).toBe(true);
    expect(areSameOrganization("bing.com", "linkedin.com")).toBe(true);
    expect(areSameOrganization("microsoft.com", "linkedin.com")).toBe(true);
  });

  it("subdomains of grouped domains are recognized", () => {
    expect(areSameOrganization("mail.google.com", "www.youtube.com")).toBe(true);
    expect(areSameOrganization("api.github.com", "raw.github.com")).toBe(true);
    expect(areSameOrganization("old.reddit.com", "cdn.redditmedia.com")).toBe(true);
  });

  it("PSL wildcard limitation: raw.githubusercontent.com not matched (known edge case)", () => {
    expect(areSameOrganization("github.com", "raw.githubusercontent.com")).toBe(false);
  });

  it("unregistered random domains are not in the same org as each other", () => {
    fc.assert(
      fc.property(arbLabel, arbLabel, (a, b) => {
        const domA = `${a}-unique-test.example`;
        const domB = `${b}-unique-test.example`;
        if (domA !== domB) {
          expect(areSameOrganization(domA, domB)).toBe(false);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeAllowlist
// ---------------------------------------------------------------------------

const arbMixedCaseDomain = fc
  .tuple(arbMixedCaseLabel, fc.constantFrom("com", "org", "net", "io"))
  .map(([label, tld]) => `${label}.${tld}`);

const arbHostEntry = fc
  .tuple(arbMixedCaseLabel, fc.constantFrom("com", "org", "net"))
  .map(([label, tld]) => `${label}.${tld}`);

const arbAllowlistInput = fc
  .array(
    fc.tuple(arbMixedCaseDomain, fc.array(arbHostEntry, { minLength: 1, maxLength: 5 })),
    { minLength: 0, maxLength: 5 },
  )
  .map((entries) => {
    const obj: Record<string, string[]> = {};
    for (const [key, hosts] of entries) {
      obj[key] = hosts;
    }
    return obj;
  });

describe("normalizeAllowlist properties", () => {
  it("is idempotent: normalizeAllowlist(normalizeAllowlist(x)) === normalizeAllowlist(x)", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const once = normalizeAllowlist(input);
        const twice = normalizeAllowlist(once);
        expect(twice).toEqual(once);
      }),
    );
  });

  it("all keys are lowercase after normalization", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const result = normalizeAllowlist(input);
        for (const key of Object.keys(result)) {
          expect(key).toBe(key.toLowerCase());
        }
      }),
    );
  });

  it("all host values are lowercase after normalization", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const result = normalizeAllowlist(input);
        for (const hosts of Object.values(result)) {
          for (const h of hosts) {
            expect(h).toBe(h.toLowerCase());
          }
        }
      }),
    );
  });

  it("host arrays are sorted after normalization", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const result = normalizeAllowlist(input);
        for (const hosts of Object.values(result)) {
          const sorted = [...hosts].sort();
          expect(hosts).toEqual(sorted);
        }
      }),
    );
  });

  it("host arrays have no duplicates", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const result = normalizeAllowlist(input);
        for (const hosts of Object.values(result)) {
          expect(new Set(hosts).size).toBe(hosts.length);
        }
      }),
    );
  });

  it("no empty host arrays in output", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const result = normalizeAllowlist(input);
        for (const hosts of Object.values(result)) {
          expect(hosts.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("returns empty object for non-object inputs", () => {
    expect(normalizeAllowlist(null)).toEqual({});
    expect(normalizeAllowlist(undefined)).toEqual({});
    expect(normalizeAllowlist(42)).toEqual({});
    expect(normalizeAllowlist("string")).toEqual({});
    expect(normalizeAllowlist([])).toEqual({});
    expect(normalizeAllowlist(true)).toEqual({});
  });

  it("duplicate-cased keys: last writer wins", () => {
    const input = {
      "EXAMPLE.COM": ["host-a.com"],
      "example.com": ["host-b.com"],
    };
    const result = normalizeAllowlist(input);
    expect(result["example.com"]).toEqual(["host-b.com"]);
  });

  it("preserves all valid hosts when keys are unique", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const normalized = normalizeAllowlist(input);
        const seen = new Map<string, Set<string>>();
        for (const [rawKey, rawHosts] of Object.entries(input)) {
          const key = rawKey.trim().toLowerCase();
          if (!key || !Array.isArray(rawHosts)) continue;
          seen.set(key, new Set());
          for (const h of rawHosts) {
            if (typeof h === "string" && h.trim()) {
              seen.get(key)!.add(h.trim().toLowerCase());
            }
          }
        }
        for (const [key, expectedHosts] of seen) {
          const actual = normalized[key];
          if (actual) {
            for (const h of expectedHosts) {
              expect(actual).toContain(h);
            }
          }
        }
      }),
    );
  });

  it("strips whitespace-only keys and hosts", () => {
    expect(normalizeAllowlist({ "  ": ["valid.com"] })).toEqual({});
    expect(normalizeAllowlist({ "key.com": ["  ", ""] })).toEqual({});
    expect(normalizeAllowlist({ "key.com": ["  ", "valid.com"] })).toEqual({
      "key.com": ["valid.com"],
    });
  });
});

// ---------------------------------------------------------------------------
// isAllowlisted
// ---------------------------------------------------------------------------

describe("isAllowlisted properties", () => {
  it("returns true when siteKey/destHost are in the list", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const normalized = normalizeAllowlist(input);
        for (const [key, hosts] of Object.entries(normalized)) {
          for (const h of hosts) {
            expect(isAllowlisted(normalized, key, h)).toBe(true);
          }
        }
      }),
    );
  });

  it("returns false for non-existent siteKey", () => {
    fc.assert(
      fc.property(arbAllowlistInput, arbDomain, (input, randomKey) => {
        const normalized = normalizeAllowlist(input);
        if (!(randomKey.toLowerCase() in normalized)) {
          expect(isAllowlisted(normalized, randomKey, "anything.com")).toBe(false);
        }
      }),
    );
  });

  it("is case-insensitive for siteKey and destHost", () => {
    fc.assert(
      fc.property(arbAllowlistInput, (input) => {
        const normalized = normalizeAllowlist(input);
        for (const [key, hosts] of Object.entries(normalized)) {
          for (const h of hosts) {
            expect(isAllowlisted(normalized, key.toUpperCase(), h.toUpperCase())).toBe(true);
          }
        }
      }),
    );
  });

  it("does not cross-contaminate between siteKeys", () => {
    fc.assert(
      fc.property(arbMixedCaseDomain, arbMixedCaseDomain, arbHostEntry, (keyA, keyB, host) => {
        if (keyA.toLowerCase() === keyB.toLowerCase()) return;
        const list: Allowlist = normalizeAllowlist({ [keyA]: [host] });
        if (!(keyB.toLowerCase() in list)) {
          expect(isAllowlisted(list, keyB, host)).toBe(false);
        }
      }),
    );
  });

  it("returns false for empty allowlist", () => {
    fc.assert(
      fc.property(arbDomain, arbDomain, (siteKey, destHost) => {
        expect(isAllowlisted({}, siteKey, destHost)).toBe(false);
      }),
    );
  });

  it("consistent after re-normalization of the list", () => {
    fc.assert(
      fc.property(arbAllowlistInput, arbMixedCaseDomain, arbHostEntry, (input, siteKey, destHost) => {
        const normalized = normalizeAllowlist(input);
        const reNormalized = normalizeAllowlist(normalized);
        expect(isAllowlisted(normalized, siteKey, destHost)).toBe(
          isAllowlisted(reNormalized, siteKey, destHost),
        );
      }),
    );
  });
});
