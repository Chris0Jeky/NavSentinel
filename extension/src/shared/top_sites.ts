import { getRegistrableDomain, normalizeHost } from "./domain";
import { TOP_SITE_TIER_DOMAIN_BLOB } from "./top_sites_data";

export const TRUST_TIER_USER_ALLOWLISTED = 1;
export const TRUST_TIER_TOP_SITE = 2;
export const TRUST_TIER_SEEN_BENIGN = 3;
export const TRUST_TIER_UNKNOWN = 4;
export const TRUST_TIER_KNOWN_BAD = 5;

export type NavigationTrustTier =
  | typeof TRUST_TIER_USER_ALLOWLISTED
  | typeof TRUST_TIER_TOP_SITE
  | typeof TRUST_TIER_SEEN_BENIGN
  | typeof TRUST_TIER_UNKNOWN
  | typeof TRUST_TIER_KNOWN_BAD;

const TOP_SITE_BLOB = ` ${TOP_SITE_TIER_DOMAIN_BLOB} `;

function containsTopSiteDomain(domain: string): boolean {
  return TOP_SITE_BLOB.includes(` ${domain} `);
}

export function isTopSiteDomain(host: string | null | undefined): boolean {
  const normalized = normalizeHost(host ?? "");
  if (!normalized) return false;
  if (containsTopSiteDomain(normalized)) return true;
  const registrable = getRegistrableDomain(normalized);
  return !!registrable && containsTopSiteDomain(registrable);
}

export function resolveNavigationTrustTier(input: {
  destHost: string | null | undefined;
  destinationAllowlisted?: boolean | undefined;
  knownBadDomain?: boolean | undefined;
  seenBeforeBenign?: boolean | undefined;
}): NavigationTrustTier {
  if (input.knownBadDomain) return TRUST_TIER_KNOWN_BAD;
  if (input.destinationAllowlisted) return TRUST_TIER_USER_ALLOWLISTED;
  if (isTopSiteDomain(input.destHost)) return TRUST_TIER_TOP_SITE;
  if (input.seenBeforeBenign) return TRUST_TIER_SEEN_BENIGN;
  return TRUST_TIER_UNKNOWN;
}
