import type { CredentialSettings } from "./storage";
import pslTrie from "./psl_data.json" with { type: "json" };

type TrieNode = { [label: string]: TrieNode | number };
const PSL_ROOT: TrieNode = pslTrie as TrieNode;

export function normalizeHost(host: string): string {
  if (!host) return "";
  return host.toLowerCase().replace(/\.$/, "");
}

export function isIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})(\.\d{1,3}){3}$/);
  if (!m) return false;
  const parts = host.split(".").map((x) => Number(x));
  return parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);
}

export function isIPv6(host: string): boolean {
  if (!host.includes(":")) return false;
  return /^[0-9a-fA-F:.]+$/.test(host);
}

export function isIPAddress(host: string): boolean {
  const h = normalizeHost(host);
  return isIPv4(h) || isIPv6(h);
}

export function splitLabels(host: string): string[] {
  const h = normalizeHost(host);
  if (!h) return [];
  return h.split(".").filter(Boolean);
}

/**
 * Count how many labels from the right form the public suffix for this host,
 * using the PSL trie.  Returns the number of labels in the public suffix,
 * or 0 if no rule matches (fallback: treat TLD as the public suffix).
 *
 * Algorithm (per https://wiki.mozilla.org/Public_Suffix_List/Algorithm):
 *   Walk labels right-to-left. At each level check:
 *     1. If the current label has an exception marker ("!"), stop — it is NOT
 *        part of the public suffix.
 *     2. If the current label has an exact match in the trie, descend.
 *     3. Else if a wildcard ("*") child exists, use that.
 *     4. Else stop — the trie has no deeper rule.
 */
function pslSuffixLength(labels: string[]): number {
  let node: TrieNode = PSL_ROOT;
  let depth = 0;
  let confirmedSuffix = 0;

  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i] as string;

    // Check for an exact match first
    const exactChild = node[label];
    if (exactChild !== undefined && typeof exactChild === "object") {
      // Check exception marker on the matched child
      if ((exactChild as TrieNode)["!"] === 1) {
        // This label is an exception to a wildcard rule.
        // The public suffix is everything traversed so far (depth),
        // because the exception implies the parent path is a valid suffix.
        confirmedSuffix = depth;
        break;
      }
      node = exactChild as TrieNode;
      depth++;
      // Only confirm this depth if the node is a valid suffix endpoint
      if (node[""] === 1) {
        confirmedSuffix = depth;
      }
      continue;
    }

    // Check for wildcard
    const wildChild = node["*"];
    if (wildChild !== undefined && typeof wildChild === "object") {
      node = wildChild as TrieNode;
      depth++;
      // Wildcard matches always confirm the suffix
      confirmedSuffix = depth;
      continue;
    }

    // No match at this level — stop
    break;
  }

  return confirmedSuffix;
}

export function getRegistrableDomain(host: string): string {
  const h = normalizeHost(host);
  if (!h) return "";
  if (isIPAddress(h)) return h;

  const labels = splitLabels(h);
  if (labels.length === 0) return "";

  const suffixLen = pslSuffixLength(labels);

  // If PSL matched nothing, fall back to treating the TLD as the suffix
  const effectiveSuffix = suffixLen > 0 ? suffixLen : 1;

  // The registrable domain is the public suffix + one label to the left
  const regLen = effectiveSuffix + 1;

  if (labels.length <= effectiveSuffix) {
    // The entire hostname IS a public suffix (or shorter) — return as-is
    return h;
  }

  return labels.slice(-regLen).join(".");
}

export function subdomainDepth(host: string): number {
  const h = normalizeHost(host);
  if (!h || isIPAddress(h)) return 0;
  const labels = splitLabels(h);
  const regLabels = splitLabels(getRegistrableDomain(h));
  return Math.max(0, labels.length - regLabels.length);
}

export function containsPunycode(host: string): boolean {
  return normalizeHost(host)
    .split(".")
    .some((label) => label.startsWith("xn--"));
}

type ScriptClass = "Latin" | "Greek" | "Cyrillic" | "Digit" | "Common" | "Other";

function charScript(cp: number): ScriptClass {
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return "Latin";
  if (cp >= 0x30 && cp <= 0x39) return "Digit";
  if ((cp >= 0x00c0 && cp <= 0x024f) || (cp >= 0x1e00 && cp <= 0x1eff)) return "Latin";
  if ((cp >= 0x0370 && cp <= 0x03ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return "Greek";
  if (
    (cp >= 0x0400 && cp <= 0x052f) ||
    (cp >= 0x2de0 && cp <= 0x2dff) ||
    (cp >= 0xa640 && cp <= 0xa69f)
  ) {
    return "Cyrillic";
  }
  if (cp === 0x2d || cp === 0x2e) return "Common";
  return "Other";
}

export function isMixedScript(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return false;

  const scripts = new Set<ScriptClass>();
  for (const ch of h) {
    const cp = ch.codePointAt(0) ?? 0;
    const script = charScript(cp);
    if (script === "Digit" || script === "Common") continue;
    scripts.add(script);
    if (scripts.size >= 2) break;
  }

  const hasLatin = scripts.has("Latin");
  const hasGreek = scripts.has("Greek");
  const hasCyrillic = scripts.has("Cyrillic");

  return (
    (hasLatin && hasGreek) ||
    (hasLatin && hasCyrillic) ||
    (hasGreek && hasCyrillic)
  );
}

/**
 * Maximum input length for Levenshtein distance computation.
 * DNS hostnames are limited to 253 characters; anything beyond that
 * is either malformed or adversarial. We bail out early to prevent
 * quadratic time/memory usage on crafted inputs.
 */
const LEVENSHTEIN_MAX_LEN = 253;

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  // Guard against pathologically long inputs
  if (n > LEVENSHTEIN_MAX_LEN || m > LEVENSHTEIN_MAX_LEN) {
    return Math.max(n, m);
  }

  const prev = new Array<number>(m + 1);
  const cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= m; j++) prev[j] = cur[j] ?? 0;
  }

  return prev[m] ?? m;
}

export function findClosestLookalike(
  currentRegDomain: string,
  trustedRegDomains: string[]
): { target: string; distance: number } | null {
  const cur = normalizeHost(currentRegDomain);
  if (!cur) return null;

  let best: { target: string; distance: number } | null = null;
  for (const t of trustedRegDomains ?? []) {
    const target = normalizeHost(t);
    if (!target || target === cur) continue;
    const distance = levenshtein(cur, target);
    if (!best || distance < best.distance) {
      best = { target, distance };
    }
  }

  return best;
}

export function safeUrlParse(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}

export interface RiskReason {
  code: string;
  label: string;
}

export interface RiskResult {
  score: number;
  severity: "none" | "low" | "medium" | "high";
  reasons: RiskReason[];
  page: {
    url: string;
    host: string;
    registrableDomain: string;
    isHttps: boolean;
    isTrusted: boolean;
  };
  action: {
    url: string;
    host: string;
    registrableDomain: string;
    isHttps: boolean;
    isTrusted: boolean;
  };
  lookalike: { target: string; distance: number } | null;
}

export function recalcSeverity(score: number): RiskResult["severity"] {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  if (score >= 15) return "low";
  return "none";
}

export function computeCredentialRisk(params: {
  pageUrl: string;
  actionUrl: string;
  trustedDomains: string[];
  config: CredentialSettings;
}): RiskResult {
  const cfg = params.config;
  const trusted = params.trustedDomains ?? [];

  const page = safeUrlParse(params.pageUrl);
  const action = safeUrlParse(params.actionUrl, params.pageUrl);

  const reasons: RiskReason[] = [];
  let score = 0;

  const pageHost = page ? normalizeHost(page.hostname) : "";
  const actionHost = action ? normalizeHost(action.hostname) : "";
  const pageReg = pageHost ? getRegistrableDomain(pageHost) : "";
  const actionReg = actionHost ? getRegistrableDomain(actionHost) : "";
  const pageHttps = page ? page.protocol === "https:" : false;
  const actionHttps = action ? action.protocol === "https:" : false;
  const pageTrusted = !!(pageReg && trusted.includes(pageReg));
  const actionTrusted = !!(actionReg && trusted.includes(actionReg));

  if (page && !pageHttps) {
    score += 55;
    reasons.push({
      code: "NON_HTTPS_PAGE",
      label: "Page is not HTTPS (credentials can be intercepted)."
    });
  }

  if (action && !actionHttps) {
    score += 45;
    reasons.push({
      code: "NON_HTTPS_ACTION",
      label: "Form action is not HTTPS."
    });
  }

  if (page && page.username) {
    score += 35;
    reasons.push({
      code: "USERINFO_IN_URL",
      label: "URL contains userinfo (the user@host trick)."
    });
  }

  if (pageHost && isIPAddress(pageHost)) {
    score += 35;
    reasons.push({
      code: "IP_HOST",
      label: "Hostname is an IP address (unusual for real login pages)."
    });
  }

  if (pageHost && containsPunycode(pageHost)) {
    score += 25;
    reasons.push({
      code: "PUNYCODE_HOST",
      label: "Hostname contains punycode (xn--). Potential IDN homograph."
    });
  }

  if (pageHost && isMixedScript(pageHost)) {
    score += 25;
    reasons.push({
      code: "MIXED_SCRIPT_HOST",
      label: "Hostname mixes scripts (Latin/Cyrillic/Greek). Potential homograph."
    });
  }

  const depth = pageHost ? subdomainDepth(pageHost) : 0;
  if (depth >= 3) {
    score += 10;
    reasons.push({
      code: "DEEP_SUBDOMAIN",
      label: `Deep subdomain depth (${depth}).`
    });
  }

  if (pageHost && actionHost && pageHost !== actionHost) {
    if (!actionTrusted) {
      score += 18;
      reasons.push({
        code: "CROSS_SITE_ACTION",
        label: "Form submits to a different host than the page."
      });
    } else {
      score += 5;
      reasons.push({
        code: "CROSS_SITE_ACTION_TRUSTED",
        label: "Form submits cross-site, but destination is trusted."
      });
    }
  }

  const maxDistance = Number.isFinite(cfg.similarity.maxDistance)
    ? cfg.similarity.maxDistance
    : 2;
  const lookalike = cfg.similarity.enabled && pageReg
    ? findClosestLookalike(pageReg, trusted)
    : null;

  if (cfg.similarity.enabled) {
    if (lookalike && lookalike.distance <= maxDistance) {
      score += 45;
      reasons.push({
        code: "LOOKALIKE_DOMAIN",
        label: `Domain is similar to trusted domain "${lookalike.target}" (edit distance ${lookalike.distance}).`
      });
    }
  }

  // Enhanced lookalike checks (P1-03)
  if (cfg.similarity.enabled && pageHost) {
    const enhanced = detectLookalike(pageHost, trusted, lookalike);

    // Homoglyph-normalized Levenshtein (catches paypa1.com -> paypal.com)
    if (enhanced.homoglyphLevenshtein &&
        enhanced.homoglyphLevenshtein.distance <= maxDistance &&
        !(lookalike && lookalike.distance <= maxDistance)) {
      // Only add if raw Levenshtein didn't already catch it
      score += 45;
      reasons.push({
        code: "HOMOGLYPH_LOOKALIKE",
        label: `Domain resembles trusted domain "${enhanced.homoglyphLevenshtein.target}" after homoglyph normalization (normalized distance ${enhanced.homoglyphLevenshtein.distance}).`
      });
    }

    // Brand keyword in registrable domain (catches paypal-secure.com)
    if (enhanced.brandKeyword) {
      score += 40;
      reasons.push({
        code: "BRAND_KEYWORD_DOMAIN",
        label: `Domain contains brand keyword "${enhanced.brandKeyword.brand}" with extra characters (impersonating ${enhanced.brandKeyword.canonicalDomain}).`
      });
    }

    // Subdomain stuffing (catches paypal.login.example.com)
    if (enhanced.subdomainStuffing) {
      score += 35;
      reasons.push({
        code: "SUBDOMAIN_STUFFING",
        label: `Subdomain contains brand name "${enhanced.subdomainStuffing.brand}" but registrable domain is unrelated (impersonating ${enhanced.subdomainStuffing.canonicalDomain}).`
      });
    }
  }

  if (!pageTrusted) {
    score += 10;
    reasons.push({
      code: "UNTRUSTED_DOMAIN",
      label: "Domain is not in your trusted list."
    });
  }

  score = Math.max(0, Math.min(100, score));

  const severity = recalcSeverity(score);

  return {
    score,
    severity,
    reasons,
    page: {
      url: page ? page.href : String(params.pageUrl || ""),
      host: pageHost,
      registrableDomain: pageReg,
      isHttps: pageHttps,
      isTrusted: pageTrusted
    },
    action: {
      url: action ? action.href : String(params.actionUrl || ""),
      host: actionHost,
      registrableDomain: actionReg,
      isHttps: actionHttps,
      isTrusted: actionTrusted
    },
    lookalike
  };
}

export function isHostWithinDomain(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

// ---------------------------------------------------------------------------
// Enhanced lookalike detection (P1-03)
// ---------------------------------------------------------------------------

/**
 * Top 50 phishing-target brands. Each entry is [brand keyword, canonical domain].
 * The brand keyword is used for substring matching; the canonical domain is used
 * for subdomain-stuffing checks.
 */
export const BRAND_LIST: ReadonlyArray<readonly [brand: string, domain: string]> = [
  ["google", "google.com"],
  ["gmail", "gmail.com"],
  ["youtube", "youtube.com"],
  ["apple", "apple.com"],
  ["icloud", "icloud.com"],
  ["microsoft", "microsoft.com"],
  ["outlook", "outlook.com"],
  ["amazon", "amazon.com"],
  ["paypal", "paypal.com"],
  ["netflix", "netflix.com"],
  ["facebook", "facebook.com"],
  ["instagram", "instagram.com"],
  ["whatsapp", "whatsapp.com"],
  ["twitter", "twitter.com"],
  ["linkedin", "linkedin.com"],
  ["dropbox", "dropbox.com"],
  ["adobe", "adobe.com"],
  ["spotify", "spotify.com"],
  ["ebay", "ebay.com"],
  ["chase", "chase.com"],
  ["wellsfargo", "wellsfargo.com"],
  ["bankofamerica", "bankofamerica.com"],
  ["citibank", "citibank.com"],
  ["usbank", "usbank.com"],
  ["capitalone", "capitalone.com"],
  ["americanexpress", "americanexpress.com"],
  ["hsbc", "hsbc.com"],
  ["barclays", "barclays.com"],
  ["coinbase", "coinbase.com"],
  ["binance", "binance.com"],
  ["kraken", "kraken.com"],
  ["blockchain", "blockchain.com"],
  ["stripe", "stripe.com"],
  ["shopify", "shopify.com"],
  ["walmart", "walmart.com"],
  ["bestbuy", "bestbuy.com"],
  ["github", "github.com"],
  ["gitlab", "gitlab.com"],
  ["discord", "discord.com"],
  ["reddit", "reddit.com"],
  ["yahoo", "yahoo.com"],
  ["docusign", "docusign.com"],
] as const;

/**
 * Known legitimate domains owned by brands that would otherwise
 * false-positive on brand-keyword detection. Keyed by brand keyword,
 * each value is a set of registrable domains that belong to the brand
 * and should NOT trigger BRAND_KEYWORD_DOMAIN or SUBDOMAIN_STUFFING.
 *
 * This list is intentionally conservative -- only high-traffic domains
 * that users encounter daily are included.
 */
export const BRAND_KNOWN_ALIASES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["google", new Set([
    "googleapis.com", "googleusercontent.com", "googlevideo.com",
    "googletagmanager.com", "googlesyndication.com", "googleadservices.com",
    "googleads.com", "googlechrome.com", "googleanalytics.com",
    "googlemail.com", "googledomains.com", "google-analytics.com",
  ])],
  ["microsoft", new Set([
    "microsoftonline.com", "microsoft365.com", "microsoftstream.com",
    "microsoftedge.com",
  ])],
  ["amazon", new Set([
    "amazonaws.com", "amazonws.com", "amazontrust.com",
    "amazonpay.com", "amazoncognito.com",
  ])],
  ["discord", new Set(["discordapp.com"])],
  ["reddit", new Set(["redditmedia.com", "redditinc.com", "redditstatic.com"])],
  ["shopify", new Set(["shopifycloud.com", "shopifysvc.com"])],
  ["github", new Set(["githubusercontent.com", "githubusercontent.com", "githubassets.com"])],
  ["gitlab", new Set(["gitlab.io"])],
  ["apple", new Set(["apple-dns.net", "appleid.apple.com"])],
  ["facebook", new Set(["facebookcorewwwi.onion", "facebookmail.com"])],
  ["instagram", new Set(["instagramstatic.com"])],
  ["netflix", new Set(["nflxext.com", "nflxvideo.net"])],
  ["stripe", new Set(["stripecdn.com"])],
  ["yahoo", new Set(["yahooapis.com", "yahoodns.net"])],
  ["coinbase", new Set(["coinbasecloud.com"])],
]);

/**
 * Check if a registrable domain is a known legitimate alias of a brand.
 */
function isBrandAlias(brand: string, registrableDomain: string): boolean {
  const aliases = BRAND_KNOWN_ALIASES.get(brand);
  return aliases ? aliases.has(registrableDomain) : false;
}

/**
 * Minimum brand keyword length for substring matching.
 * Keywords shorter than this threshold must match the full label exactly
 * (after separator stripping and homoglyph normalization) to avoid
 * false positives from common English words like "chase", "ebay", "hsbc".
 */
const BRAND_SUBSTRING_MIN_LEN = 6;

/**
 * Static table of visually confusable character replacements.
 * Maps a confusable substring to its canonical Latin form.
 * Order matters: multi-char patterns must come before single-char ones
 * so that 'rn' is normalized to 'm' before 'r' or 'n' are processed individually.
 */
const HOMOGLYPH_MAP: ReadonlyArray<readonly [from: string, to: string]> = [
  // Multi-char patterns (must come first)
  ["rn", "m"],
  ["vv", "w"],
  // Note: "cl" -> "d" was removed due to high false-positive rate
  // (e.g. "include" -> "indude", "clinic" -> "dinic").
  // Single-char confusables
  ["0", "o"],
  ["1", "l"],
  ["!", "l"],
  ["|", "l"],
  ["5", "s"],
  ["8", "b"],
];

/**
 * Normalize a domain label by replacing visually confusable characters
 * with their canonical Latin equivalents. Works on the lowercased input.
 *
 * This intentionally operates on ASCII-range confusables only.
 * Script-mixing (Cyrillic/Greek homoglyphs) is handled separately by
 * isMixedScript / containsPunycode.
 */
export function normalizeHomoglyphs(input: string): string {
  if (!input) return "";
  let result = input.toLowerCase();
  for (const [from, to] of HOMOGLYPH_MAP) {
    result = result.replaceAll(from, to);
  }
  return result;
}

/**
 * Strip hyphens and dots from a string for fuzzy brand-keyword matching.
 * This lets us detect "pay-pal" or "pay.pal" as containing "paypal".
 */
function stripSeparators(s: string): string {
  return s.replace(/[-_.]/g, "");
}

export interface BrandMatch {
  brand: string;
  canonicalDomain: string;
}

/**
 * Lazily-initialized cache mapping each brand's canonical domain string
 * to its registrable domain. Avoids calling getRegistrableDomain(canonical)
 * on every invocation of detectBrandInDomain / detectSubdomainStuffing.
 */
let _brandRegCache: Map<string, string> | null = null;
function getBrandRegDomain(canonical: string): string {
  if (!_brandRegCache) {
    _brandRegCache = new Map();
    for (const [, c] of BRAND_LIST) {
      _brandRegCache.set(c, getRegistrableDomain(c));
    }
  }
  return _brandRegCache.get(canonical) ?? getRegistrableDomain(canonical);
}

/**
 * Returns true if `label` (after normalization) matches the brand keyword
 * at a word-start position. For all brand lengths, the brand must appear
 * at the start of the label (i.e. `startsWith`). This prevents false
 * positives from unrelated words that happen to embed the brand as an
 * interior substring (e.g. "pinstripe" should not match "stripe",
 * "usbankruptcy" should not match "usbank").
 *
 * The label must also be strictly longer than the brand keyword, so that
 * `detectBrandInDomain` doesn't flag the brand's own canonical domain
 * (which has exactly the same length as the keyword).
 */
function brandKeywordMatch(strippedLabel: string, brand: string): boolean {
  if (strippedLabel.length <= brand.length) return false;
  // Require the brand to appear at the start of the label
  return strippedLabel.startsWith(brand);
}

/**
 * Check whether a registrable domain contains a well-known brand keyword
 * with extra characters appended or prepended (e.g. "paypal-secure.com").
 *
 * Returns null if the domain IS the brand's canonical domain (no false positive),
 * or if no brand keyword is found.
 */
export function detectBrandInDomain(
  registrableDomain: string
): BrandMatch | null {
  const reg = normalizeHost(registrableDomain);
  if (!reg) return null;

  // Extract just the registrable label (everything before the first dot / TLD)
  const dotIdx = reg.indexOf(".");
  if (dotIdx <= 0) return null;
  const label = reg.slice(0, dotIdx);

  // Normalize homoglyphs in the label for comparison
  const normalizedLabel = normalizeHomoglyphs(label);
  const strippedLabel = stripSeparators(normalizedLabel);

  for (const [brand, canonical] of BRAND_LIST) {
    const canonicalReg = getBrandRegDomain(canonical);
    // Skip if this IS the brand's own domain
    if (reg === canonicalReg) continue;
    // Skip known legitimate brand-owned aliases (e.g. microsoftonline.com)
    if (isBrandAlias(brand, reg)) continue;

    if (brandKeywordMatch(strippedLabel, brand)) {
      return { brand, canonicalDomain: canonicalReg };
    }
  }

  return null;
}

/**
 * Detect subdomain stuffing: a well-known brand name appears as a subdomain
 * label of an unrelated registrable domain.
 *
 * Example: "paypal.login.example.com" -- "paypal" appears as a subdomain
 * but the registrable domain is "example.com", not "paypal.com".
 *
 * Returns the matched brand info or null.
 */
export function detectSubdomainStuffing(
  fullHost: string
): BrandMatch | null {
  const h = normalizeHost(fullHost);
  if (!h) return null;

  const reg = getRegistrableDomain(h);
  if (!reg || h === reg) return null; // No subdomains to check

  // Extract the subdomain portion (everything before the registrable domain)
  const subdomainPart = h.slice(0, h.length - reg.length - 1); // -1 for the dot
  if (!subdomainPart) return null;

  const subLabels = subdomainPart.split(".");

  for (const [brand, canonical] of BRAND_LIST) {
    const canonicalReg = getBrandRegDomain(canonical);
    // Skip if the registrable domain IS the brand's domain
    if (reg === canonicalReg) continue;
    // Skip known legitimate brand-owned aliases
    if (isBrandAlias(brand, reg)) continue;

    for (const sub of subLabels) {
      const normalizedSub = normalizeHomoglyphs(sub);
      const strippedSub = stripSeparators(normalizedSub);
      // Match if the subdomain label equals the brand or contains it
      // For subdomain stuffing, exact match is the primary signal
      if (strippedSub === brand || brandKeywordMatch(strippedSub, brand)) {
        return { brand, canonicalDomain: canonicalReg };
      }
    }
  }

  return null;
}

/**
 * Enhanced lookalike detection combining:
 * 1. Levenshtein distance against trusted domains (existing, can be precomputed)
 * 2. Homoglyph-normalized Levenshtein (new)
 * 3. Brand keyword in registrable domain (new)
 * 4. Subdomain stuffing (new)
 *
 * @param rawLookalike - Optional precomputed result from findClosestLookalike.
 *   When provided, avoids a redundant O(N) Levenshtein scan over trusted domains.
 */
export function detectLookalike(
  fullHost: string,
  trustedDomains: string[],
  rawLookalike?: { target: string; distance: number } | null
): {
  levenshtein: { target: string; distance: number } | null;
  homoglyphLevenshtein: { target: string; distance: number } | null;
  brandKeyword: BrandMatch | null;
  subdomainStuffing: BrandMatch | null;
} {
  const h = normalizeHost(fullHost);
  const reg = h ? getRegistrableDomain(h) : "";

  // Use precomputed raw Levenshtein if provided, otherwise compute it
  const lev = rawLookalike !== undefined
    ? rawLookalike
    : (reg ? findClosestLookalike(reg, trustedDomains) : null);

  // Homoglyph-normalized Levenshtein: normalize both sides then compare
  let homoglyphLev: { target: string; distance: number } | null = null;
  if (reg) {
    const normalizedCur = normalizeHomoglyphs(reg);
    let best: { target: string; distance: number } | null = null;
    for (const t of trustedDomains) {
      const target = normalizeHost(t);
      if (!target || target === reg) continue;
      const normalizedTarget = normalizeHomoglyphs(target);
      if (normalizedCur === normalizedTarget) {
        // Perfect match after normalization -- distance 0
        best = { target, distance: 0 };
        break;
      }
      const dist = levenshtein(normalizedCur, normalizedTarget);
      if (!best || dist < best.distance) {
        best = { target, distance: dist };
      }
    }
    // Only report if the homoglyph distance is better than raw Levenshtein
    if (best && (!lev || best.distance < lev.distance)) {
      homoglyphLev = best;
    }
  }

  const brandKeyword = reg ? detectBrandInDomain(reg) : null;
  const subStuffing = h ? detectSubdomainStuffing(h) : null;

  return {
    levenshtein: lev,
    homoglyphLevenshtein: homoglyphLev,
    brandKeyword,
    subdomainStuffing: subStuffing,
  };
}
