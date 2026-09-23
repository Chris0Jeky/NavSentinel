/**
 * Sub-resource Integrity (SRI) Awareness (P4-06)
 *
 * Flags when scripts or stylesheets loaded on credential-handling pages
 * lack SRI (Subresource Integrity) hashes. Missing SRI on pages with
 * login forms is a supply-chain risk signal.
 *
 * Design:
 * - Only checks EXTERNAL (cross-origin) resources
 * - Only runs on pages with password fields (credential gate)
 * - Runs once per page load, not continuously
 * - Checks for presence of `integrity` attribute, does not validate algorithms
 * - No network calls — purely local DOM inspection
 */

import { hasVisiblePasswordField } from "./password_field";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SRIAnalysis {
  /** Number of external (cross-origin) scripts and stylesheets found */
  totalExternal: number;
  /** Number of external resources with an `integrity` attribute */
  withSRI: number;
  /** Number of external resources missing an `integrity` attribute */
  withoutSRI: number;
  /** Credential risk score modifier (positive = riskier, negative = safer) */
  score: number;
  /** Explainable reason codes */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the origin portion of a URL string, or null if parsing fails
 * or the URL uses a non-http(s) scheme (data:, blob:, javascript:, etc.).
 */
function httpOrigin(url: string, base: string): string | null {
  try {
    const parsed = new URL(url, base);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Returns true when the resource URL is cross-origin relative to the
 * current page, meaning SRI would be meaningful for it.
 */
function isCrossOrigin(resourceUrl: string, pageOrigin: string, base: string): boolean {
  const origin = httpOrigin(resourceUrl, base);
  if (!origin) return false;
  return origin !== pageOrigin;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

function scanResources(
  doc: Document,
  selector: string,
  attrName: string,
  pageOrigin: string,
  base: string,
  result: SRIAnalysis,
): void {
  const elements = doc.querySelectorAll(selector);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement;
    const url = el.getAttribute(attrName) ?? "";
    if (!url || !isCrossOrigin(url, pageOrigin, base)) continue;

    result.totalExternal++;
    if (el.hasAttribute("integrity") && (el.getAttribute("integrity") ?? "").trim().length > 0) {
      result.withSRI++;
    } else {
      result.withoutSRI++;
    }
  }
}

/**
 * Scan the page for external scripts and stylesheets and check whether
 * they carry SRI hashes. Only meaningful on credential pages.
 *
 * Relative `src`/`href` values resolve against the effective document base
 * URL, matching what the browser actually fetches — resolving against the
 * page URL instead misbinds whenever a `<base href>` element is present
 * (same class as the form-action base binding, #650).
 *
 * @param doc  The Document to scan (defaults to `document` in content script)
 * @param pageOrigin  The page origin (defaults to `location.origin`)
 * @param baseUrl  Effective base URL for relative resources (defaults to
 *   `doc.baseURI`, which honors `<base href>`)
 */
export function checkSRI(
  doc: Document = document,
  pageOrigin: string = location.origin,
  baseUrl: string = doc.baseURI
): SRIAnalysis {
  const result: SRIAnalysis = {
    totalExternal: 0,
    withSRI: 0,
    withoutSRI: 0,
    score: 0,
    reasons: [],
  };

  // Gate: only check on credential pages (shared visible-credential-field
  // helper — see password_field.ts; #196).
  if (!hasVisiblePasswordField(doc)) return result;

  scanResources(doc, "script[src]", "src", pageOrigin, baseUrl, result);
  scanResources(doc, 'link[rel~="stylesheet"][href]', "href", pageOrigin, baseUrl, result);

  // Scoring
  if (result.totalExternal === 0) {
    // No external resources — nothing to check
    return result;
  }

  const coverageRatio = result.withSRI / result.totalExternal;

  if (coverageRatio === 0) {
    // Zero SRI on a credential page — highest risk
    result.score = 8;
    result.reasons.push(
      `None of ${result.totalExternal} external resource(s) have SRI hashes on this credential page`
    );
  } else if (coverageRatio < 0.5) {
    // More than half lack SRI
    result.score = 5;
    result.reasons.push(
      `Only ${result.withSRI}/${result.totalExternal} external resource(s) have SRI hashes on this credential page`
    );
  } else if (coverageRatio === 1) {
    // All external resources have SRI — security-conscious site
    result.score = -3;
    result.reasons.push(
      `All ${result.totalExternal} external resource(s) have SRI hashes (security-conscious site)`
    );
  }
  // coverageRatio >= 0.5 and < 1: no score modifier (partial coverage, neutral)

  return result;
}
