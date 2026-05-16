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

  it("does not parse form-action (not scored)", () => {
    const result = parseCSP("form-action 'self' https://example.com");
    expect(result.has("form-action")).toBe(false);
  });

  it("does not parse frame-ancestors (not enforceable in meta tags)", () => {
    const result = parseCSP("frame-ancestors 'self'; script-src 'self'");
    expect(result.has("frame-ancestors")).toBe(false);
    expect(result.get("script-src")).toEqual(["'self'"]);
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

    it("returns hasCSP=true with score 0 for CSP with only non-scored directives", () => {
      const result = scoreCSPStrings(["img-src *; style-src 'self'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.score).toBe(0);
      expect(result.reasons).toContain("csp_present");
    });
  });

  describe("permissive CSP", () => {
    it("scores +3 for unsafe-inline in script-src", () => {
      const result = scoreCSPStrings(["script-src 'self' 'unsafe-inline'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_permissive");
      expect(result.score).toBe(3);
    });

    it("scores +3 for unsafe-eval in script-src", () => {
      const result = scoreCSPStrings(["script-src 'self' 'unsafe-eval'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_permissive");
      expect(result.score).toBe(3);
    });

    it("scores +3 for wildcard in default-src (effective script source)", () => {
      const result = scoreCSPStrings(["default-src *"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_wildcard");
      expect(result.score).toBe(3);
    });

    it("scores +3 for wildcard in explicit script-src", () => {
      const result = scoreCSPStrings(["script-src *; default-src 'self'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).toContain("csp_wildcard");
      expect(result.score).toBe(3);
    });

    it("does not score missing frame-ancestors (not enforceable in meta)", () => {
      const result = scoreCSPStrings(["script-src 'self'"]);
      expect(result.hasCSP).toBe(true);
      expect(result.reasons).not.toContain("csp_no_frame_ancestors");
      // script-src 'self' with no weakness => neutral
      expect(result.score).toBe(0);
      expect(result.reasons).toContain("csp_present");
    });

    it("accumulates multiple weakness scores", () => {
      const result = scoreCSPStrings([
        "default-src *; script-src 'self' 'unsafe-inline'",
      ]);
      expect(result.hasCSP).toBe(true);
      // script-src has unsafe-inline (+3) but no wildcard; default-src
      // wildcard doesn't affect scripts when script-src is present.
      expect(result.score).toBe(3);
      expect(result.reasons).toContain("csp_permissive");
      expect(result.reasons).not.toContain("csp_no_frame_ancestors");
    });
  });

  describe("strict CSP (informational only, no score reduction)", () => {
    it("detects nonce-based script-src but does not reduce score", () => {
      const result = scoreCSPStrings([
        "script-src 'nonce-abc123'",
      ]);
      expect(result.hasCSP).toBe(true);
      expect(result.isStrict).toBe(true);
      expect(result.reasons).toContain("csp_strict_nonces");
      // Strict CSP no longer reduces score (attacker-controlled meta tags)
      expect(result.score).toBe(0);
    });

    it("detects hash-based script-src but does not reduce score", () => {
      const result = scoreCSPStrings([
        "script-src 'sha256-abcdef123456'",
      ]);
      expect(result.isStrict).toBe(true);
      expect(result.reasons).toContain("csp_strict_nonces");
      expect(result.score).toBe(0);
    });

    it("strict CSP yields neutral score", () => {
      const result = scoreCSPStrings([
        "default-src 'self'; script-src 'nonce-xyz'",
      ]);
      expect(result.hasCSP).toBe(true);
      expect(result.isStrict).toBe(true);
      expect(result.score).toBe(0);
    });

    it("score is never negative (attackers cannot game a reduction)", () => {
      const result = scoreCSPStrings([
        "default-src 'none'; script-src 'nonce-fake123' 'strict-dynamic'; " +
          "form-action 'self'",
      ]);
      expect(result.isStrict).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });
  });

  describe("partial CSP", () => {
    it("neutral score when CSP is present but has no scored weaknesses", () => {
      const result = scoreCSPStrings([
        "default-src 'self'",
      ]);
      expect(result.hasCSP).toBe(true);
      expect(result.score).toBe(0);
      expect(result.reasons).toContain("csp_present");
    });
  });

  describe("multiple CSP strings (per-policy intersection)", () => {
    it("takes minimum score across independent policies", () => {
      const result = scoreCSPStrings([
        "script-src 'self'",
        "default-src 'none'",
      ]);
      expect(result.hasCSP).toBe(true);
      expect(result.score).toBe(0);
      expect(result.reasons).toContain("csp_present");
    });

    it("strict policy blocks permissive policy (intersection semantics)", () => {
      const result = scoreCSPStrings([
        "default-src 'self'",
        "script-src 'unsafe-eval'",
      ]);
      expect(result.hasCSP).toBe(true);
      // Policy 1 is strict (score 0), policy 2 is permissive (score 3).
      // Intersection: the strict policy dominates, so score = 0.
      expect(result.score).toBe(0);
      expect(result.reasons).toContain("csp_present");
    });

    it("both policies permissive yields permissive score", () => {
      const result = scoreCSPStrings([
        "script-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-eval'",
      ]);
      expect(result.hasCSP).toBe(true);
      // Both policies score +3, so min is 3
      expect(result.score).toBe(3);
    });

    it("isStrict true if any policy uses nonces", () => {
      const result = scoreCSPStrings([
        "script-src 'nonce-abc123'",
        "script-src 'self' 'unsafe-inline'",
      ]);
      expect(result.isStrict).toBe(true);
      // Policy 1 score=0 (nonce), policy 2 score=3 (unsafe). Min=0.
      expect(result.score).toBe(0);
    });
  });

  describe("real-world CSP strings", () => {
    it("GitHub-style strict CSP has neutral score (not negative)", () => {
      const result = scoreCSPStrings([
        "default-src 'none'; script-src 'nonce-abc123' 'strict-dynamic'; " +
          "form-action 'self'",
      ]);
      expect(result.isStrict).toBe(true);
      // Strict CSP is informational only; score stays at 0
      expect(result.score).toBe(0);
    });

    it("lax CSP with everything allowed", () => {
      const result = scoreCSPStrings([
        "default-src *; script-src * 'unsafe-inline' 'unsafe-eval'",
      ]);
      expect(result.hasCSP).toBe(true);
      // script-src wildcard (+3) + unsafe-inline/eval (+3) = 6
      expect(result.score).toBe(6);
      expect(result.reasons).toContain("csp_wildcard");
      expect(result.reasons).toContain("csp_permissive");
    });
  });

  describe("Content-Security-Policy-Report-Only exclusion", () => {
    it("Report-Only is excluded by analyzeCSP (not scoreCSPStrings)", () => {
      // scoreCSPStrings only processes raw strings; the filtering of
      // Report-Only happens in analyzeCSP via the httpEquiv check.
      // This test documents that scoreCSPStrings is agnostic to the
      // header type -- the caller (analyzeCSP) is responsible for
      // excluding Report-Only meta tags by comparing httpEquiv.
      const result = scoreCSPStrings(["script-src 'self'"]);
      expect(result.hasCSP).toBe(true);
      // The filtering is in analyzeCSP, not here
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

  it("ignores negative cspWeaknessScore (meta CSP is attacker-controlled)", () => {
    const result = computeNRS(
      baseCds(10),
      baseNav({ cspWeaknessScore: -5 })
    );
    // Negative scores are never applied -- attacker can fake strict CSP
    expect(result.nrs).toBe(10);
    expect(result.nrsFactors).not.toContain("nrs_csp_strict");
    expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
  });

  it("ignores negative cspWeaknessScore even with high base NRS", () => {
    const result = computeNRS(
      baseCds(30),
      baseNav({ isNewTabOrWindow: true, cspWeaknessScore: -5 })
    );
    // 30 + 20 = 50; negative CSP ignored
    expect(result.nrs).toBe(50);
    expect(result.nrsFactors).not.toContain("nrs_csp_strict");
  });

  it("does not apply when cspWeaknessScore is 0", () => {
    const result = computeNRS(
      baseCds(30),
      baseNav({ isNewTabOrWindow: true, cspWeaknessScore: 0 })
    );
    expect(result.nrs).toBe(50);
    expect(result.nrsFactors).not.toContain("nrs_csp_weakness");
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
