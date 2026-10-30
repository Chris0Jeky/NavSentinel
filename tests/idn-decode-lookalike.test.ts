import { describe, expect, it } from "vitest";
import {
  computeCredentialRisk,
  decodePunycode,
  detectLookalike,
  idnSkeletonHost
} from "../extension/src/shared/domain";
import type { CredentialSettings } from "../extension/src/shared/storage";

const config: CredentialSettings = {
  mode: "smart",
  promptOnUntrustedDomain: true,
  promptOnMediumRisk: true,
  mediumRiskThreshold: 40,
  blockHttpPasswordSubmit: true,
  warnOnPaste: true,
  similarity: { enabled: true, maxDistance: 2 }
};

/** Unicode label in, the punycode host the browser would hand the extension out. */
function asciiHost(unicodeHost: string): string {
  const host = new URL(`https://${unicodeHost}/`).hostname;
  expect(host).toContain("xn--");
  return host;
}

function codes(host: string, trustedDomains: string[]): string[] {
  const url = `https://${host}/login`;
  return computeCredentialRisk({ pageUrl: url, actionUrl: url, trustedDomains, config }).reasons.map(
    (r) => r.code
  );
}

describe("decodePunycode (RFC 3492 section 7.1 sample vectors)", () => {
  const vectors: Array<[string, string, string]> = [
    ["Arabic (Egyptian)", "egbpdaj6bu4bxfgehfvwxn", "ليهمابتكلموشعربي؟"],
    ["Chinese (simplified)", "ihqwcrb4cv8a8dqg056pqjye", "他们为什么不说中文"],
    ["Chinese (traditional)", "ihqwctvzc91f659drss3x8bo0yb", "他們爲什麽不說中文"],
    ["Czech", "Proprostnemluvesky-uyb24dma41a", "Pročprostěnemluvíčesky"],
    ["Japanese 3<nen>B<gumi>", "3B-ww4c5e180e575a65lsy2b", "3年B組金八先生"],
    ["Japanese with ASCII", "-with-SUPER-MONKEYS-pc58ag80a8qai00g7n9n", "安室奈美恵-with-SUPER-MONKEYS"],
    ["Japanese mixed", "Hello-Another-Way--fc4qua05auwb3674vfr0b", "Hello-Another-Way-それぞれの場所"],
    ["all basic", "-> $1.00 <--", "-> $1.00 <-"]
  ];

  it.each(vectors)("decodes %s", (_name, encoded, expected) => {
    expect(decodePunycode(encoded)).toBe(expected);
  });

  it("decodes the Cyrillic a of xn--pypal-4ve", () => {
    expect(decodePunycode("pypal-4ve")).toBe("pаypal");
  });

  it("returns null for malformed input instead of throwing", () => {
    expect(decodePunycode("!!!")).toBeNull();
    expect(decodePunycode("ab-é")).toBeNull();
    expect(decodePunycode("zzzzzzzzzzzzzzzzzzzz")).toBeNull();
    expect(decodePunycode("a-9")).toBeNull();
  });
});

describe("idnSkeletonHost", () => {
  it("folds a punycode homograph to its Latin skeleton", () => {
    expect(idnSkeletonHost("xn--pypal-4ve.com")).toBe("paypal.com");
    expect(idnSkeletonHost("login.xn--pypal-4ve.evil.com")).toBe("login.paypal.evil.com");
  });

  it("leaves plain IDNs, ASCII hosts and malformed labels unchanged", () => {
    for (const host of ["xn--mller-kva.de", "xn--bcher-kva.ch", "xn--wgv71a.jp", "paypal.com", "xn--!!!.com"]) {
      expect(idnSkeletonHost(host)).toBe(host);
    }
  });
});

describe("punycode homographs raise the lookalike signal", () => {
  const homographs: Array<[brand: string, script: string, unicodeLabel: string]> = [
    ["paypal", "Cyrillic", "pаypal"],
    ["paypal", "Greek", "pαypal"],
    ["apple", "Cyrillic", "аррlе"],
    ["apple", "Greek", "αpple"],
    ["microsoft", "Cyrillic", "miсrоsоft"],
    ["microsoft", "Greek", "mιcrosoft"],
    ["google", "Cyrillic", "gооgle"],
    ["google", "Greek", "gοοgle"]
  ];

  it.each(homographs)("%s via %s", (brand, _script, label) => {
    const host = asciiHost(`${label}.com`);
    // No trusted list: the brand-keyword spoof fires.
    expect(codes(host, [])).toEqual(expect.arrayContaining(["PUNYCODE_HOST", "BRAND_KEYWORD_DOMAIN"]));
    // Trusted real domain: it reads as that domain at distance 0.
    expect(codes(host, [`${brand}.com`])).toContain("LOOKALIKE_DOMAIN");
    // The shared lookalike detector (used by any caller, not just the submit path).
    expect(detectLookalike(host, []).brandKeyword?.brand).toBe(brand);
  });

  it("flags the issue's xn--pypal-4ve.com", () => {
    expect(codes("xn--pypal-4ve.com", [])).toContain("BRAND_KEYWORD_DOMAIN");
  });

  it("still flags a homograph of a brand-owned alias", () => {
    const host = asciiHost("micrоsoftonline.com");
    expect(detectLookalike(host, []).brandKeyword?.brand).toBe("microsoft");
  });

  it("does not flag the genuine ASCII domains", () => {
    for (const host of ["paypal.com", "apple.com", "www.microsoft.com", "accounts.google.com"]) {
      const found = codes(host, []);
      expect(found).not.toContain("BRAND_KEYWORD_DOMAIN");
      expect(found).not.toContain("LOOKALIKE_DOMAIN");
    }
  });
});

describe("plain IDNs gain no lookalike signal", () => {
  it.each(["müller.de", "bücher.ch", "日本.jp"])("%s", (unicodeHost) => {
    const host = asciiHost(unicodeHost);
    const found = codes(host, ["paypal.com", "mueller.de", "bucher.ch", "muller.de"]);
    expect(found).toContain("PUNYCODE_HOST");
    for (const code of ["LOOKALIKE_DOMAIN", "HOMOGLYPH_LOOKALIKE", "BRAND_KEYWORD_DOMAIN", "SUBDOMAIN_STUFFING"]) {
      expect(found).not.toContain(code);
    }
    const lookalike = detectLookalike(host, ["paypal.com"]);
    expect(lookalike.brandKeyword).toBeNull();
    expect(lookalike.subdomainStuffing).toBeNull();
  });
});

describe("isMixedScript on decoded punycode labels (#1196)", () => {
  it("flags a homograph label and keeps plain IDNs unflagged", async () => {
    const { isMixedScript } = await import("../extension/src/shared/domain");
    expect(isMixedScript("xn--pypal-4ve.com")).toBe(true);
    for (const plain of ["xn--mller-kva.de", "xn--bcher-kva.ch", "xn--wgv71a.jp", "paypal.com"]) {
      expect(isMixedScript(plain), plain).toBe(false);
    }
  });
});
