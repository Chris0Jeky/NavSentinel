/**
 * Visual Similarity - Brand Canonical Domains (P4-01, Approach A)
 *
 * Static map from brand template id -> the registrable domains that
 * legitimately render that brand's sign-in surface. Used to decide whether a
 * visual brand match occurred on a page that is *not* one of the brand's own
 * domains (i.e. a likely spoof). This is a local, offline lookup: no network
 * calls and no telemetry.
 *
 * The ids here MUST stay in sync with the template ids in
 * extension/public/brand_templates.json. A brand may have multiple legitimate
 * domains (regional variants, dedicated login hosts, etc.).
 */

export const BRAND_CANONICAL_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  // Email / identity
  google: ["google.com", "accounts.google.com", "gmail.com"],
  microsoft: ["microsoft.com", "live.com", "microsoftonline.com", "outlook.com", "office.com"],
  yahoo: ["yahoo.com", "login.yahoo.com"],
  protonmail: ["proton.me", "protonmail.com"],

  // Social
  facebook: ["facebook.com", "fb.com"],
  twitter: ["twitter.com", "x.com"],
  instagram: ["instagram.com"],
  linkedin: ["linkedin.com"],
  tiktok: ["tiktok.com"],

  // Banking
  chase: ["chase.com", "jpmorganchase.com"],
  bankofamerica: ["bankofamerica.com", "bofa.com"],
  wellsfargo: ["wellsfargo.com"],
  citi: ["citi.com", "citibank.com", "citigroup.com"],
  capitalone: ["capitalone.com"],
  hsbc: ["hsbc.com", "hsbc.co.uk", "us.hsbc.com"],
  barclays: ["barclays.com", "barclays.co.uk"],

  // Commerce / payments
  amazon: ["amazon.com", "amazon.co.uk", "aws.amazon.com"],
  ebay: ["ebay.com"],
  paypal: ["paypal.com"],
  stripe: ["stripe.com"],

  // Cloud / infrastructure
  aws: ["aws.amazon.com", "amazon.com", "amazonaws.com"],
  azure: ["azure.com", "microsoft.com", "microsoftonline.com", "azure.microsoft.com"],
  gcp: ["cloud.google.com", "google.com"],
  cloudflare: ["cloudflare.com"],
  digitalocean: ["digitalocean.com"],

  // Crypto
  coinbase: ["coinbase.com"],
  binance: ["binance.com", "binance.us"],
  kraken: ["kraken.com"],
  metamask: ["metamask.io"],

  // Developer
  github: ["github.com"],
  gitlab: ["gitlab.com"],
  bitbucket: ["bitbucket.org", "atlassian.com"],
  npm: ["npmjs.com"],

  // SaaS / enterprise identity
  salesforce: ["salesforce.com", "force.com"],
  okta: ["okta.com"],
  duo: ["duosecurity.com", "duo.com", "cisco.com"],
  workday: ["workday.com", "myworkday.com"],

  // Telecom
  att: ["att.com"],
  verizon: ["verizon.com"],
  tmobile: ["t-mobile.com", "tmobile.com"],

  // Media / productivity
  netflix: ["netflix.com"],
  spotify: ["spotify.com"],
  apple: ["apple.com", "icloud.com"],
  dropbox: ["dropbox.com"],
  zoom: ["zoom.us", "zoom.com"],
  slack: ["slack.com"],
  discord: ["discord.com"],
};

/**
 * Returns true when `hostname` is, or is a subdomain of, one of the canonical
 * registrable domains for `templateId`. Matching is case-insensitive. An
 * unknown template id always returns false (we cannot vouch for it).
 */
export function isBrandCanonicalDomain(templateId: string, hostname: string): boolean {
  const domains = BRAND_CANONICAL_DOMAINS[templateId];
  if (!domains) return false;

  let host = hostname.trim().toLowerCase();
  // A fully-qualified hostname may carry a trailing dot (e.g. "google.com.").
  // Strip it so a legitimate canonical domain is not mistaken for a spoof.
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host) return false;

  for (const domain of domains) {
    const d = domain.toLowerCase();
    if (host === d || host.endsWith("." + d)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true when the current page's hostname is NOT a canonical domain for
 * the matched brand (i.e. the brand surface is being rendered cross-origin,
 * which is the high-risk spoof signal). Defaults to `true` on any error so a
 * brand match is never silently downgraded by an unreadable location.
 */
export function isCurrentPageCrossOriginFromBrand(templateId: string): boolean {
  try {
    return !isBrandCanonicalDomain(templateId, location.hostname);
  } catch {
    return true;
  }
}
