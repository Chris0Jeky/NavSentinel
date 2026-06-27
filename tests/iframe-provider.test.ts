import { describe, expect, it } from "vitest";
import {
  matchProviderHostSrc,
  type ProviderHostEntry,
} from "../extension/src/shared/iframe_provider";

const TABLE: ProviderHostEntry[] = [
  { host: "google.com", pathPrefix: "/recaptcha" },
  { host: "recaptcha.net" },
  { host: "hcaptcha.com" },
];

describe("matchProviderHostSrc (#226 shared iframe-provider matcher)", () => {
  it("matches an exact host and a dot-boundary subdomain", () => {
    expect(matchProviderHostSrc("https://hcaptcha.com/x", TABLE)).toBe(true);
    expect(matchProviderHostSrc("https://api.hcaptcha.com/x", TABLE)).toBe(true);
    expect(matchProviderHostSrc("https://www.recaptcha.net/", TABLE)).toBe(true);
  });

  it("does not match a host that merely ends with the suffix without a dot boundary", () => {
    // "evilhcaptcha.com" must not match "hcaptcha.com".
    expect(matchProviderHostSrc("https://evilhcaptcha.com/x", TABLE)).toBe(false);
    expect(matchProviderHostSrc("https://nothcaptcha.com/x", TABLE)).toBe(false);
  });

  it("strips a single trailing dot from the host", () => {
    expect(matchProviderHostSrc("https://hcaptcha.com./x", TABLE)).toBe(true);
  });

  it("segment-anchors the path prefix (the #226/#211 fix vs the old unanchored startsWith)", () => {
    // Real recaptcha path matches: exact prefix or prefix + "/".
    expect(matchProviderHostSrc("https://google.com/recaptcha", TABLE)).toBe(true);
    expect(matchProviderHostSrc("https://google.com/recaptcha/api2/anchor", TABLE)).toBe(true);
    // A lookalike segment must NOT satisfy the prefix.
    expect(matchProviderHostSrc("https://google.com/recaptcha-evil/x", TABLE)).toBe(false);
    expect(matchProviderHostSrc("https://google.com/search", TABLE)).toBe(false);
  });

  it("matches any path when the entry has no pathPrefix", () => {
    expect(matchProviderHostSrc("https://recaptcha.net/anything/here", TABLE)).toBe(true);
    expect(matchProviderHostSrc("https://recaptcha.net/", TABLE)).toBe(true);
  });

  it("rejects non-http(s) and unparseable srcs", () => {
    expect(matchProviderHostSrc("data:text/html,hi", TABLE)).toBe(false);
    expect(matchProviderHostSrc("javascript:alert(1)", TABLE)).toBe(false);
    expect(matchProviderHostSrc("blob:https://google.com/abc", TABLE)).toBe(false);
    expect(matchProviderHostSrc("::::not a url", TABLE)).toBe(false);
  });

  it("rejects a non-listed host", () => {
    expect(matchProviderHostSrc("https://evil.example/recaptcha", TABLE)).toBe(false);
  });

  it("is case-insensitive on host and path", () => {
    expect(matchProviderHostSrc("https://HCaptcha.COM/X", TABLE)).toBe(true);
    expect(matchProviderHostSrc("https://google.com/ReCaptcha/Api2", TABLE)).toBe(true);
  });
});
