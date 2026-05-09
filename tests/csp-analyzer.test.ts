import { describe, expect, it } from "vitest";
import { parseCSP, scoreCSPStrings } from "../extension/src/content/csp_analyzer";
import { computeNRS } from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

// --- parseCSP unit tests ---

describe("parseCSP", () => {
  it("parses a simple CSP with script-src", () => {
    const result = parseCSP("script-src 'self'; default-src 'none'");
    expect(result.get("script-src")).toEqual(["'self'"]);
    expect(result.get("default-src")).toEqual(["'none'"]);
  });

  it("handles multiple values for a directive", () => {
    const result = parseCSP("script-src 'self' 'unsafe-inline' https://cdn.example.com");
    expect(result.get("script-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://cdn.example.com",
    ]);
  });

  it("ignores directives we do not score", () => {
    const result = parseCSP("img-src *; style-src 'self'; script-src 'self'");
    expect(result.has("img-src")).toBe(false);
    expect(result.has("style-src")).toBe(false);
    expect(result.get("script-src")).toEqual(["'self'"]);
  });

  it("handles empty string", () => {
    const result = parseCSP("");
    expect(result.size).toBe(0);
  });

  it("handles extra whitespace and semicolons", () => {
    const result = parseCSP("  script-src   'self'  ;  ; default-src 'none'  ;");
    expect(result.get("script-src")).toEqual(["'self'"]);
    expect(result.get("default-src")).toEqual(["'none'"]);
  });

  it("parses frame-ancestors and form-action", () => {
    const result = parseCSP("frame-ancestors 'self'; form-action 'self' https://example.com");
    expect(result.get("frame-ancestors")).toEqual(["'self'"]);
    expect(result.get("form-action")).toEqual(["'self'", "https://example.com"]);
  });

  it("lowercases directive names", () => {
    const result = parseCSP("Script-Src 'self'; DEFAULT-SRC 'none'");
    expect(result.get("script-src")).toEqual(["'self'"]);
    expect(result.get("default-src")).toEqual(["'none'"]);
  });
});

// --- scoreCSPStrings unit tests ---

describe("scoreCSPStrings", () => {
  describe("no CSP", () => {
    it("returns hasCSP=false and score=5 for empty array", () => {
      const result = scoreCSPStrings([]);
      expect(result.hasCSP).toBe(false);
      expect(result.score).toBe(5);
      expect(result.reasons).toContain("csp_no_policy");
      expect(result.isStrict).toBe(false);
    });

    it("returns hasCSP=false when only empty strings provided", () => {
      const result = scoreCSPStrings([""]);
      expect(result.hasCSP).toBe(false);
      expect(result.score).toBe(5);
      expect(result.reasons).toContain("csp_no_policy");
    });

    it("returns hasCSP=false for CSP with only non-scored directives", () => {
      const result = scoreCSPStrings(["img-src *; style-src 'self'"]);
      expect(result.hasCSP).toBe(false);
      expect(result.score).toBe(5);
    });
  });

  describe("permissive CSP", () => {
    it("scores +3 for unsafe-inline in script-src", () => {
      const result = scoreCSPStrings(["script-src 'self' 'unsafe-inline'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_permissive");
      expect(result.score).toBeGreaterThanOrEqual(3);
    });

    it("scores +3 for unsafe-eval in script-src", () => {
      const result = scoreCSPStrings(["script-src 'self' 'unsafe-eval'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_permissive");
    });

    it("scores +3 for wildcard in default-src", () => {
      const result = scoreCSPStrings(["default-src *"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_wildcard_default");
      expect(result.score).toBeGreaterThanOrEqual(3);
    });

    it("scores +2 for missing frame-ancestors", () => {
      const result = scoreCSPStrings(["script-src 'self'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_no_frame_ancestors");
    });

    it("accumulates multiple weakness scores", () => {
      const result = scoreCSPStrings([
        "default-src *; script-src 'self' 'unsafe-inline'",
      ]);
      expect(result.hasCSP).toBe(true);
      // wildcard default (+3) + unsafe-inline (+3) + no frame-ancestors (+2) = 8
      expect(result.score).toBe(8);
      expect(result.reasons).toContain("csp_wildcard_default");
      expect(result.reasons).toContain("csp_permissive");
      expect(result.reasons).toContain("csp_no_frame_ancestors");
    });
  });

  describe("strict CSP", () => {
    it("scores -5 for nonce-based script-src", () => {
      const result = scoreCSPStrings([
        "script-src 'nonce-abc123'; frame-ancestors 'self'",
      ]);
      expect(result.hasCSP).toBe(true);
      expect(result.isStrict).toBe(true);
      expect(result.reasons).toContain("csp_strict_nonces");
      expect(result.score).toBe(-5);
    });

    it("scores -5 for hash-based script-src", () => {
      const result = scoreCSPStrings([
        "script-src 'sha256-abcdef123456'; frame-ancestors 'none'",
      ]);
      expect(result.isStrict).toBe(true);
      expect(result.reasons).toContain("csp_strict_nonces");
    });

    it("strict with frame-ancestors yields negative score", () => {
      const result = scoreCSPStrings([
        "default-src 'self'; script-src 'nonce-xyz'; frame-ancestors 'self'",
      ]);
      expect(result.hasCSP).toBe(true);
      expect(result.isStrict).toBe(true);
      expect(result.score).toBe(-5);
    });
  });

  describe("partial CSP", () => {
    it("neutral score when CSP is present but has no scored weaknesses", () => {
      const result = scoreCSPStrings([
        "default-src 'self'; frame-ancestors 'self'",
      ]);
      expect(result.hasCSP).toBe(true);
      expect(result.score).toBe(0);
      expect(result.reasons).toContain("csp_present");
    });

    it("only frame-ancestors missing on otherwise clean CSP", () => {
      const result = scoreCSPStrings(["default-src 'self'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.score).toBe(2);
      expect(result.reasons).toContain("csp_no_frame_ancestors");
    });
  });

  describe("multiple CSP strings (simulating multiple meta tags)", () => {
    it("merges directives from multiple strings", () => {
      const result = scoreCSPStrings([
        "script-src 'self'",
        "frame-ancestors 'none'",
      ]);
      expect(result.hasCSP).toBe(true);
      // script-src 'self' is fine, frame-ancestors present => neutral
      expect(result.score).toBe(0);
      expect(result.reasons).toContain("csp_present");
    });

    it("picks up unsafe from second string", () => {
      const result = scoreCSPStrings([
        "default-src 'self'",
        "script-src 'unsafe-eval'; frame-ancestors 'self'",
      ]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_permissive");
    });
  });

  describe("real-world CSP strings", () => {
    it("GitHub-style strict CSP", () => {
      const result = scoreCSPStrings([
        "default-src 'none'; script-src 'nonce-abc123' 'strict-dynamic'; " +
          "frame-ancestors 'none'; form-action 'self'",
      ]);
      expect(result.isStrict).toBe(true);
      expect(result.score).toBe(-5);
    });

    it("lax CSP with everything allowed", () => {
      const result = scoreCSPStrings([
        "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'",
      ]);
      expect(result.hasCSP).toBe(true);
      // wildcard default (+3) + unsafe-inline/eval (+3) + no frame-ancestors (+2) = 8
      expect(result.score).toBe(8);
    });
  });
});

// --- NRS integration tests ---

function baseCds(cds = 0, reasonCodes: string[] = []): ScoreResult {
  return { cds, reasonCodes };
}

function baseNav(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return {
    isNewTabOrWindow: false,
    isCrossSite: false,
    ...overrides,
  };
}

describe("NRS CSP modifier integration", () => {
  it("does not apply CSP weakness when base NRS <= 20", () => {
    const result = computeNRS(
      baseCds(10),
      baseNav({ cspWeaknessScore: 5 })
    );
    // Base NRS is 10, which is <= 20, so CSP weakness should NOT apply
    expect(result.nrs).toBe(10);
    expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
  });

  it("applies CSP weakness when base NRS > 20", () => {
    const result = computeNRS(
      baseCds(15),
      baseNav({ isNewTabOrWindow: true, cspWeaknessScore: 5 })
    );
    // Base NRS before CSP: 15 + 20 = 35 (> 20), so +5 applies => 40
    expect(result.nrs).toBe(40);
    expect(result.nrsFactors).toContain("nrs_csp_weakness");
  });

  it("applies strict CSP reduction regardless of base NRS", () => {
    const result = computeNRS(
      baseCds(10),
      baseNav({ cspWeaknessScore: -5 })
    );
    // 10 - 5 = 5
    expect(result.nrs).toBe(5);
    expect(result.nrsFactors).toContain("nrs_csp_strict");
  });

  it("strict CSP can reduce NRS to 0", () => {
    const result = computeNRS(
      baseCds(3),
      baseNav({ cspWeaknessScore: -5 })
    );
    // 3 - 5 = -2 -> clamped to 0
    expect(result.nrs).toBe(0);
    expect(result.nrsFactors).toContain("nrs_csp_strict");
  });

  it("does not apply when cspWeaknessScore is 0", () => {
    const result = computeNRS(
      baseCds(30),
      baseNav({ isNewTabOrWindow: true, cspWeaknessScore: 0 })
    );
    expect(result.nrs).toBe(50);
    expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
    expect(result.nrsFactors).not.toContain("nrs_csp_strict");
  });

  it("does not apply when cspWeaknessScore is undefined", () => {
    const result = computeNRS(
      baseCds(30),
      baseNav({ isNewTabOrWindow: true })
    );
    expect(result.nrs).toBe(50);
    expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
  });

  it("CSP weakness alone cannot push NRS above block threshold from zero", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({ cspWeaknessScore: 8 })
    );
    // Base NRS is 0 <= 20, so CSP weakness is NOT applied
    expect(result.nrs).toBe(0);
    expect(result.nrs).toBeLessThan(70);
  });

  it("CSP weakness applied in combination with cross-site new tab", () => {
    const result = computeNRS(
      baseCds(20),
      baseNav({
        isNewTabOrWindow: true,
        isCrossSite: true,
        cspWeaknessScore: 8,
      })
    );
    // 20 + 20 + 20 = 60 (> 20), so +8 => 68
    expect(result.nrs).toBe(68);
    expect(result.nrsFactors).toContain("nrs_csp_weakness");
  });

  it("CSP weakness at exactly NRS=20 threshold is not applied", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({ isNewTabOrWindow: true, cspWeaknessScore: 5 })
    );
    // Base NRS before CSP: 0 + 20 = 20 (not > 20), so CSP not applied
    expect(result.nrs).toBe(20);
    expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
  });

  it("CSP weakness at NRS=21 is applied", () => {
    const result = computeNRS(
      baseCds(1),
      baseNav({ isNewTabOrWindow: true, cspWeaknessScore: 5 })
    );
    // Base NRS before CSP: 1 + 20 = 21 (> 20), so +5 => 26
    expect(result.nrs).toBe(26);
    expect(result.nrsFactors).toContain("nrs_csp_weakness");
  });
});
