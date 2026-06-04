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
function httpOrigin(url: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(url, baseUrl);
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
function isCrossOrigin(resourceUrl: string, pageOrigin: string, pageUrl: string): boolean {
  const origin = httpOrigin(resourceUrl, pageUrl);
  if (!origin) return false;
  return origin !== pageOrigin;
}

/**
 * Check whether the page has at least one non-disabled, non-(inline-)hidden
 * password input. The hidden check mirrors content_analyzer.ts buildPageSnapshot
 * so SRI analysis and content fingerprinting agree on what counts as a "real"
 * credential field — a display:none / visibility:hidden password input should not
 * trigger SRI checks (#192). (The two copies of this style check are intentionally
 * kept in sync; a shared helper could DRY them up in a follow-up.)
 */
function hasPasswordField(doc: Document): boolean {
  const inputs = doc.querySelectorAll('input[type="password"]');
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i] as HTMLInputElement;
    if (input.disabled) continue;
    const style = input.getAttribute("style") || "";
    if (style.includes("display:none") || style.includes("display: none") ||
        style.includes("visibility:hidden") || style.includes("visibility: hidden")) {
      continue;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

function scanResources(
  doc: Document,
  selector: string,
  attrName: string,
  pageOrigin: string,
  pageUrl: string,
  result: SRIAnalysis,
): void {
  const elements = doc.querySelectorAll(selector);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement;
    const url = el.getAttribute(attrName) ?? "";
    if (!url || !isCrossOrigin(url, pageOrigin, pageUrl)) continue;

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
 * @param doc  The Document to scan (defaults to `document` in content script)
 * @param pageUrl  The page URL (defaults to `location.href`)
 * @param pageOrigin  The page origin (defaults to `location.origin`)
 */
export function checkSRI(
  doc: Document = document,
  pageUrl: string = location.href,
  pageOrigin: string = location.origin
): SRIAnalysis {
  const result: SRIAnalysis = {
    totalExternal: 0,
    withSRI: 0,
    withoutSRI: 0,
    score: 0,
    reasons: [],
  };

  // Gate: only check on credential pages
  if (!hasPasswordField(doc)) return result;

  scanResources(doc, "script[src]", "src", pageOrigin, pageUrl, result);
  scanResources(doc, 'link[rel~="stylesheet"][href]', "href", pageOrigin, pageUrl, result);

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
