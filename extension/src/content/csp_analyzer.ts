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
 * IMPORTANT: Because meta tags are attacker-controlled, CSP is only used
 * as a risk-elevating signal (positive scores for weakness). A "strict"
 * CSP detected via meta tag is NOT treated as a safety signal because an
 * attacker can trivially inject a fake nonce-based CSP meta tag.
 *
 * Performance budget: < 2 ms for analyzeCSP().
 */

export interface CSPAnalysis {
  /** Whether any CSP was found (meta tag) */
  hasCSP: boolean;
  /**
   * Score adjustment for NRS. Positive = weaker policy (risk modifier).
   * CSP is never used as a negative reducer because content scripts read
   * meta tags which are attacker-controlled.
   */
  score: number;
  /** Human-readable reason codes for debug overlay / event log */
  reasons: string[];
  /** True when the CSP uses nonces or hashes (informational only) */
  isStrict: boolean;
}

/**
 * Directives we care about for scoring.
 *
 * Note: frame-ancestors is NOT included because it is not supported in
 * <meta> CSP tags per the CSP Level 3 spec. Browsers ignore
 * frame-ancestors in meta elements, so scoring its absence would be a
 * false signal.
 */
const SCORED_DIRECTIVES = new Set([
  "default-src",
  "script-src",
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

  // Merge all CSP directives. Browsers actually *intersect* multiple
  // policies (every policy must permit a resource), but we union the
  // values as a conservative heuristic: if *any* policy allows a weak
  // source, we still flag it.
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

  // Detect nonces/hashes in script-src for informational purposes.
  // We do NOT reduce the score here because content scripts read meta
  // tags which are attacker-controlled -- an attacker can inject a fake
  // <meta> CSP with a nonce to game the reduction. Strict CSP is only
  // trustworthy from HTTP headers, which content scripts cannot read.
  if (scriptSrc && hasNoncesOrHashes(scriptSrc)) {
    isStrict = true;
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

  // NOTE: frame-ancestors is intentionally NOT scored here. Per the CSP
  // Level 3 spec, frame-ancestors is not enforced in <meta> elements, so
  // its absence in meta CSP is meaningless.

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
  // Query all meta[http-equiv] and filter case-insensitively. The HTML
  // spec says http-equiv is case-insensitive, but CSS attribute selectors
  // are case-sensitive by default. We also exclude
  // Content-Security-Policy-Report-Only which is report-only and does
  // not enforce restrictions.
  const allMetas = doc.querySelectorAll("meta[http-equiv]");
  const cspStrings: string[] = [];
  for (let i = 0; i < allMetas.length; i++) {
    const el = allMetas[i] as HTMLMetaElement;
    if (el.httpEquiv.toLowerCase() === "content-security-policy") {
      const content = el.content;
      if (content) {
        cspStrings.push(content);
      }
    }
  }
  return scoreCSPStrings(cspStrings);
}
