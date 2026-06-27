// Shared hostname+path validation for "is this iframe src from a known provider?" checks.
// Extracted from clickfix_detector (CAPTCHA_PROVIDERS / isProviderCaptchaIframe) and
// mutation_monitor (LEGIT_IFRAME_HOSTS / isLegitIframeSrc), which independently grew the
// same logic from #206/#211 and had drifted: clickfix's path test was an UNANCHORED
// startsWith while mutation's was segment-anchored (#211 R1). One matcher = the logic can
// no longer drift. The two *tables* intentionally stay per-consumer (clickfix matches only
// captcha providers; mutation_monitor matches a broader legit-iframe set), so this module
// owns only the matching, not the allowlists. (#226)

export interface ProviderHostEntry {
  /** Registrable host suffix, matched as an exact host or a dot-boundary subdomain. */
  host: string;
  /** Optional path prefix, matched at a whole-segment boundary (see below). */
  pathPrefix?: string;
}

/**
 * Whether `src` (resolved against the current page) is an http(s) URL whose host matches an
 * entry in `table` and, when the entry has a `pathPrefix`, whose path matches it at a whole
 * segment boundary (`=== prefix` OR `startsWith(prefix + "/")`). The segment anchoring
 * mirrors the host suffix boundary so a lookalike path like `/recaptcha-evil/x` cannot
 * satisfy `/recaptcha` (#211 R1). The host is lowercased with a single trailing dot stripped
 * ("hcaptcha.com." == "hcaptcha.com"). Opaque/script schemes (data:/blob:/javascript:) and
 * unparseable srcs return false. (#226)
 */
export function matchProviderHostSrc(
  src: string,
  table: readonly ProviderHostEntry[],
): boolean {
  let url: URL;
  try {
    url = new URL(src, typeof location !== "undefined" ? location.href : undefined);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const pathname = url.pathname.toLowerCase();
  for (const entry of table) {
    const hostMatch = hostname === entry.host || hostname.endsWith("." + entry.host);
    if (!hostMatch) continue;
    const pp = entry.pathPrefix;
    if (pp && pathname !== pp && !pathname.startsWith(pp + "/")) continue;
    return true;
  }
  return false;
}
