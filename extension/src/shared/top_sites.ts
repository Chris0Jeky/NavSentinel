import { getRegistrableDomain, normalizeHost } from "./domain";
import { TOP_SITE_TIER_DOMAINS } from "./top_sites_data";

export const TRUST_TIER_USER_ALLOWLISTED = 1;
export const TRUST_TIER_TOP_SITE = 2;
export const TRUST_TIER_UNKNOWN = 4;
export const TRUST_TIER_KNOWN_BAD = 5;

export type NavigationTrustTier =
  | typeof TRUST_TIER_USER_ALLOWLISTED
  | typeof TRUST_TIER_TOP_SITE
  | typeof TRUST_TIER_UNKNOWN
  | typeof TRUST_TIER_KNOWN_BAD;

function hasTopSiteDomain(domain: string): boolean {
  let lo = 0;
  let hi = TOP_SITE_TIER_DOMAINS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = TOP_SITE_TIER_DOMAINS[mid]!;
    if (candidate === domain) return true;
    if (candidate < domain) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

export function isTopSiteDomain(host: string | null | undefined): boolean {
  const normalized = normalizeHost(host ?? "");
  if (!normalized) return false;
  if (hasTopSiteDomain(normalized)) return true;
  const registrable = getRegistrableDomain(normalized);
  return !!registrable && hasTopSiteDomain(registrable);
}

export function resolveNavigationTrustTier(input: {
  destHost: string | null | undefined;
  destinationAllowlisted?: boolean | undefined;
  knownBadDomain?: boolean | undefined;
}): NavigationTrustTier {
  if (input.knownBadDomain) return TRUST_TIER_KNOWN_BAD;
  if (input.destinationAllowlisted) return TRUST_TIER_USER_ALLOWLISTED;
  if (isTopSiteDomain(input.destHost)) return TRUST_TIER_TOP_SITE;
  return TRUST_TIER_UNKNOWN;
}

export function resolveFrameNavigationTrustTier(input: {
  isTopFrame: boolean;
  destHost: string | null | undefined;
  destinationAllowlisted?: boolean | undefined;
  knownBadDomain?: boolean | undefined;
}): NavigationTrustTier {
  if (!input.isTopFrame) return TRUST_TIER_UNKNOWN;
  return resolveNavigationTrustTier(input);
}
