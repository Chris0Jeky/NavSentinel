import { describe, expect, it } from "vitest";
import { acceptExternalSettings } from "../extension/src/options/options_model";
import type { SuiteSettings } from "../extension/src/shared/storage";

const settings = (overrides: Record<string, unknown> = {}): SuiteSettings =>
  ({
    autoSave: true,
    nav: { defaultMode: "smart", debug: false, autoDismissOverlays: false },
    credential: {
      mode: "smart",
      promptOnUntrustedDomain: true,
      promptOnMediumRisk: true,
      mediumRiskThreshold: 40,
      blockHttpPasswordSubmit: true,
      warnOnPaste: true,
      similarity: { enabled: true, maxDistance: 2 },
    },
    logLimit: 300,
    ...overrides,
  }) as SuiteSettings;

describe("acceptExternalSettings never throws and never writes empty leaves", () => {
  it("still applies a valid leaf", () => {
    const draft = settings();
    const incoming = settings({ nav: { defaultMode: "strict" } });
    const result = acceptExternalSettings(draft, incoming, ["nav.defaultMode"]);
    expect(result.nav.defaultMode).toBe("strict");
    expect(draft.nav.defaultMode).toBe("smart");
  });

  it("skips a path whose draft intermediate is missing instead of throwing", () => {
    const draft = settings();
    const incoming = settings();
    expect(() =>
      acceptExternalSettings(draft, incoming, ["nav.missing.leaf"]),
    ).not.toThrow();
    const result = acceptExternalSettings(draft, incoming, ["nav.missing.leaf"]);
    expect(result).toEqual(draft);
    expect("missing" in result.nav).toBe(false);
  });

  it("skips a path whose incoming intermediate is missing instead of throwing", () => {
    const draft = settings({ nav: { defaultMode: "smart", extra: { leaf: 1 } } });
    const incoming = settings();
    const result = acceptExternalSettings(draft, incoming, ["nav.extra.leaf"]);
    expect(result).toEqual(draft);
  });

  it("skips a path with an empty segment instead of throwing", () => {
    const draft = settings();
    const incoming = settings();
    const result = acceptExternalSettings(draft, incoming, ["nav..defaultMode"]);
    expect(result).toEqual(draft);
  });

  it.each([[""], ["nav."]])("skips empty-leaf path %j without writing target['']", (path) => {
    const draft = settings();
    const incoming = settings();
    const result = acceptExternalSettings(draft, incoming, [path]);
    expect(result).toEqual(draft);
    expect("" in (result as unknown as Record<string, unknown>)).toBe(false);
    expect("" in (result.nav as unknown as Record<string, unknown>)).toBe(false);
  });

  it("skips __proto__ leaves without changing the result prototype", () => {
    const draft = settings();
    // Spread preserves the parsed own "__proto__" data property (no setter).
    const incoming = {
      ...settings(),
      ...JSON.parse('{"__proto__":{"polluted":true},"nav":{"__proto__":{"polluted":true}}}'),
    } as SuiteSettings;
    const result = acceptExternalSettings(draft, incoming, ["__proto__", "nav.__proto__"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.nav)).toBe(Object.prototype);
    expect((result as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect((result.nav as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("skips constructor/prototype segments without creating own props or polluting Function.prototype", () => {
    const draft = settings();
    const incoming = settings();
    try {
      const result = acceptExternalSettings(draft, incoming, [
        "constructor",
        "nav.constructor.prototype.polluted",
      ]);
      expect(result).toEqual(draft);
      expect(Object.prototype.hasOwnProperty.call(result, "constructor")).toBe(false);
      expect((Function.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
    } finally {
      delete (Function.prototype as unknown as Record<string, unknown>).polluted;
    }
  });
});
