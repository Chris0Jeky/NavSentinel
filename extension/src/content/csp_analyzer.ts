/**
 * CSP (Content Security Policy) analysis module.
 *
 * Extracts CSP from <meta http-equiv="Content-Security-Policy"> tags in the
 * DOM and scores the policy strength. CSP is a MODIFIER signal -- it only
 * elevates existing risk rather than acting as a primary detection signal.
 *
 * Content scripts in the isolated world can read meta tags but cannot see
 * HTTP response headers, so only meta-tag CSP is checked.
 *
 * Performance budget: < 2 ms for analyzeCSP().
 */

export interface CSPAnalysis {
  /** Whether any CSP was found (meta tag) */
  hasCSP: boolean;
  /**
   * Score adjustment for NRS. Positive = weaker policy (risk modifier),
   * negative = stronger policy (confidence reducer).
   */
  score: number;
  /** Human-readable reason codes for debug overlay / event log */
  reasons: string[];
  /** True when the CSP uses nonces or hashes (security-conscious site) */
  isStrict: boolean;
}

/** Directives we care about for scoring. */
const SCORED_DIRECTIVES = new Set([
  "default-src",
  "script-src",
  "frame-ancestors",
  "form-action",
]);

/**
 * Parse a raw CSP string into a map of directive -> values.
 * Only keeps directives we score; discards others for performance.
 */
export function parseCSP(raw: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const name = (tokens[0] ?? "").toLowerCase();
    if (SCORED_DIRECTIVES.has(name)) {
      directives.set(name, tokens.slice(1).map((t) => t.toLowerCase()));
    }
  }
  return directives;
}

/** Check if a list of source values contains `'unsafe-inline'` or `'unsafe-eval'`. */
function hasUnsafe(values: string[]): boolean {
  return values.some(
    (v) => v === "'unsafe-inline'" || v === "'unsafe-eval'"
  );
}

/** Check if a list of source values contains a wildcard `*`. */
function hasWildcard(values: string[]): boolean {
  return values.includes("*");
}

/** Check if a list of source values contains nonces or hashes. */
function hasNoncesOrHashes(values: string[]): boolean {
  return values.some(
    (v) => v.startsWith("'nonce-") || v.startsWith("'sha256-") ||
           v.startsWith("'sha384-") || v.startsWith("'sha512-")
  );
}

/**
 * Score an array of raw CSP strings. This is the pure-logic core of the
 * CSP analyzer, usable in tests without a DOM environment.
 *
 * @param cspStrings - CSP content-attribute values from meta tags (or empty
 *   array if no CSP meta tags were found).
 */
export function scoreCSPStrings(cspStrings: string[]): CSPAnalysis {
  if (cspStrings.length === 0) {
    return { hasCSP: false, score: 5, reasons: ["csp_no_policy"], isStrict: false };
  }

  const reasons: string[] = [];
  let score = 0;
  let isStrict = false;

  // Merge all CSP directives (browsers apply all meta CSP tags).
  const merged = new Map<string, string[]>();
  for (const raw of cspStrings) {
    if (!raw) continue;
    const parsed = parseCSP(raw);
    for (const [dir, vals] of parsed) {
      const existing = merged.get(dir);
      if (existing) {
        merged.set(dir, [...existing, ...vals]);
      } else {
        merged.set(dir, vals);
      }
    }
  }

  // If meta tags existed but had no parseable scored directives
  if (merged.size === 0) {
    return { hasCSP: false, score: 5, reasons: ["csp_no_policy"], isStrict: false };
  }

  // --- Score individual directives ---

  const scriptSrc = merged.get("script-src") ?? merged.get("default-src");
  const defaultSrc = merged.get("default-src");

  // Check for nonces/hashes in script-src (strong signal)
  if (scriptSrc && hasNoncesOrHashes(scriptSrc)) {
    isStrict = true;
    score -= 5;
    reasons.push("csp_strict_nonces");
  }

  // Check for unsafe-inline / unsafe-eval in script-src
  if (scriptSrc && hasUnsafe(scriptSrc)) {
    score += 3;
    reasons.push("csp_permissive");
  }

  // Check for wildcard in default-src
  if (defaultSrc && hasWildcard(defaultSrc)) {
    score += 3;
    reasons.push("csp_wildcard_default");
  }

  // Missing frame-ancestors is relevant for clickjacking context
  if (!merged.has("frame-ancestors")) {
    score += 2;
    reasons.push("csp_no_frame_ancestors");
  }

  // If no specific weakness was found and we have a CSP, it's neutral
  if (reasons.length === 0) {
    reasons.push("csp_present");
  }

  return { hasCSP: true, score, reasons, isStrict };
}

/**
 * Analyze CSP from the current document's meta tags.
 *
 * Called once per page load from capture_isolated. The result is cached
 * and fed into NRS as a modifier when other risk factors are present.
 */
export function analyzeCSP(doc: Document = document): CSPAnalysis {
  const metas = doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
  const cspStrings: string[] = [];
  for (let i = 0; i < metas.length; i++) {
    const content = (metas[i] as HTMLMetaElement).content;
    if (content) {
      cspStrings.push(content);
    }
  }
  return scoreCSPStrings(cspStrings);
}
