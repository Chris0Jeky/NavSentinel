import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeAllowlist,
  isAllowlisted,
  ALLOWLIST_KEY,
  type Allowlist,
} from "../extension/src/shared/allowlist";

describe("normalizeAllowlist", () => {
  it("returns empty object for null/undefined", () => {
    expect(normalizeAllowlist(null)).toEqual({});
    expect(normalizeAllowlist(undefined)).toEqual({});
  });

  it("returns empty object for non-object types", () => {
    expect(normalizeAllowlist(42)).toEqual({});
    expect(normalizeAllowlist("string")).toEqual({});
    expect(normalizeAllowlist(true)).toEqual({});
  });

  it("returns empty object for arrays", () => {
    expect(normalizeAllowlist([1, 2, 3])).toEqual({});
  });

  it("normalizes valid allowlist", () => {
    const input = { "example.com": ["foo.com", "bar.com"] };
    expect(normalizeAllowlist(input)).toEqual({
      "example.com": ["bar.com", "foo.com"],
    });
  });

  it("lowercases keys and values", () => {
    const input = { "Example.COM": ["FOO.com"] };
    expect(normalizeAllowlist(input)).toEqual({
      "example.com": ["foo.com"],
    });
  });

  it("trims whitespace", () => {
    const input = { "  example.com  ": ["  foo.com  "] };
    expect(normalizeAllowlist(input)).toEqual({
      "example.com": ["foo.com"],
    });
  });

  it("deduplicates hosts", () => {
    const input = { "example.com": ["foo.com", "foo.com", "FOO.com"] };
    expect(normalizeAllowlist(input)).toEqual({
      "example.com": ["foo.com"],
    });
  });

  it("drops entries with empty host arrays", () => {
    const input = { "example.com": [] as string[] };
    expect(normalizeAllowlist(input)).toEqual({});
  });

  it("drops non-array host values", () => {
    const input = { "example.com": "not-an-array" };
    expect(normalizeAllowlist(input)).toEqual({});
  });

  it("filters non-string entries from host arrays", () => {
    const input = { "example.com": ["foo.com", 42, null, "bar.com"] };
    expect(normalizeAllowlist(input)).toEqual({
      "example.com": ["bar.com", "foo.com"],
    });
  });

  it("drops empty-string keys", () => {
    const input = { "": ["foo.com"], "example.com": ["bar.com"] };
    expect(normalizeAllowlist(input)).toEqual({
      "example.com": ["bar.com"],
    });
  });

  it("drops blank-only string hosts", () => {
    const input = { "example.com": ["  ", "foo.com"] };
    expect(normalizeAllowlist(input)).toEqual({
      "example.com": ["foo.com"],
    });
  });

  it("sorts hosts alphabetically", () => {
    const input = { "example.com": ["z.com", "a.com", "m.com"] };
    const result = normalizeAllowlist(input);
    expect(result["example.com"]).toEqual(["a.com", "m.com", "z.com"]);
  });
});

describe("isAllowlisted", () => {
  const list: Allowlist = {
    "example.com": ["foo.com", "bar.com"],
    "other.com": ["baz.com"],
  };

  it("returns true for allowlisted pair", () => {
    expect(isAllowlisted(list, "example.com", "foo.com")).toBe(true);
  });

  it("returns false for non-allowlisted host", () => {
    expect(isAllowlisted(list, "example.com", "unknown.com")).toBe(false);
  });

  it("returns false for non-allowlisted site key", () => {
    expect(isAllowlisted(list, "missing.com", "foo.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isAllowlisted(list, "EXAMPLE.COM", "FOO.COM")).toBe(true);
  });

  it("returns false for empty list", () => {
    expect(isAllowlisted({}, "example.com", "foo.com")).toBe(false);
  });
});

describe("ALLOWLIST_KEY", () => {
  it("is a non-empty string", () => {
    expect(typeof ALLOWLIST_KEY).toBe("string");
    expect(ALLOWLIST_KEY.length).toBeGreaterThan(0);
  });
});
