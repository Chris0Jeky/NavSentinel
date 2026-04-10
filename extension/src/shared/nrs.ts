import type { ScoreResult } from "./scoring";
import type { Mode } from "./types";
import { getRegistrableDomain, normalizeHost } from "./domain";

/**
 * Navigation context factors layered on top of CDS
 * to produce the Navigation Risk Score (NRS).
 */
export interface NavContext {
  /** CDS result from the click deception analysis. */
  cds: ScoreResult;

  /** True when navigation opens a new tab/window (window.open or target=_blank). */
  isNewTab: boolean;

  /** Destination URL (may be empty/absent for programmatic navigations). */
  destinationUrl?: string | undefined;

  /** Current page hostname for cross-site comparison. */
  pageHost: string;

  /** Milliseconds between pointerdown and the navigation attempt. */
  pointerdownDeltaMs?: number | undefined;

  /** navigator.userActivation.isActive at navigation time. */
  userActivationActive?: boolean | undefined;

  /** Number of navigation attempts within the current gesture token. */
  attemptsInGesture: number;

  /** True when the user explicitly requested a new tab (middle-click, ctrl/cmd+click). */
  explicitNewTabIntent: boolean;

  /** Allowlisted destination hosts for the current page (pre-resolved). */
  allowlistedHosts: string[];
}

export interface NrsResult {
  nrs: number;
  cds: number;
  reasonCodes: string[];
  /** True when the destination matched the user's allowlist (hard allow). */
  allowlisted: boolean;
}

/** NRS thresholds per the spec. */
export const NRS_ALLOW_THRESHOLD = 40;
/** Smart-mode block threshold (prompt zone is NRS_ALLOW_THRESHOLD..NRS_SMART_BLOCK_THRESHOLD-1). */
export const NRS_SMART_BLOCK_THRESHOLD = 70;
export const NRS_STRICT_BLOCK_THRESHOLD = 50;

/** Factor weights matching the spec table. */
const WEIGHT_NEW_TAB = 20;
const WEIGHT_CROSS_SITE = 20;
const WEIGHT_FAST_TIMING = 10;
const WEIGHT_USER_ACTIVATION = 5;
const WEIGHT_MULTI_ATTEMPT = 25;
const WEIGHT_ALLOWLIST = -100;
const WEIGHT_EXPLICIT_NEW_TAB = -30;

/**
 * Extract the registrable domain from a URL string.
 * Returns empty string on parse failure.
 */
function registrableDomainFromUrl(url: string, base?: string): string {
  try {
    const parsed = new URL(url, base || undefined);
    return getRegistrableDomain(normalizeHost(parsed.hostname));
  } catch {
    return "";
  }
}

/**
 * Check if the destination is cross-site relative to the page.
 */
function isCrossSite(pageHost: string, destinationUrl: string | undefined): boolean {
  if (!destinationUrl) return false;
  const pageReg = getRegistrableDomain(normalizeHost(pageHost));
  const destReg = registrableDomainFromUrl(destinationUrl);
  if (!pageReg || !destReg) return false;
  return pageReg !== destReg;
}

/**
 * Check if the destination matches any allowlisted host.
 */
function isDestinationAllowlisted(
  destinationUrl: string | undefined,
  allowlistedHosts: string[]
): boolean {
  if (!destinationUrl || allowlistedHosts.length === 0) return false;
  const destReg = registrableDomainFromUrl(destinationUrl);
  if (!destReg) return false;
  for (const host of allowlistedHosts) {
    const hostReg = getRegistrableDomain(normalizeHost(host));
    if (hostReg && hostReg === destReg) return true;
  }
  return false;
}

/**
 * Compute the Navigation Risk Score (NRS).
 *
 * NRS starts with the CDS value and adds navigation-context factors.
 * Each factor produces a reason code for explainability.
 */
export function computeNRS(ctx: NavContext): NrsResult {
  const cdsValue = ctx.cds.cds;
  const reasons = [...ctx.cds.reasonCodes];
  let nrs = cdsValue;

  // +20: New tab/window navigation
  if (ctx.isNewTab) {
    nrs += WEIGHT_NEW_TAB;
    reasons.push("nrs_new_tab");
  }

  // +20: Cross-site destination
  if (isCrossSite(ctx.pageHost, ctx.destinationUrl)) {
    nrs += WEIGHT_CROSS_SITE;
    reasons.push("nrs_cross_site");
  }

  // +10: Fast timing (0-250ms from pointerdown)
  if (
    ctx.pointerdownDeltaMs !== undefined &&
    ctx.pointerdownDeltaMs >= 0 &&
    ctx.pointerdownDeltaMs <= 250
  ) {
    nrs += WEIGHT_FAST_TIMING;
    reasons.push("nrs_fast_timing");
  }

  // +5: User activation confirmed
  if (ctx.userActivationActive === true) {
    nrs += WEIGHT_USER_ACTIVATION;
    reasons.push("nrs_user_activation");
  }

  // +25: Multiple attempts within one gesture
  if (ctx.attemptsInGesture > 1) {
    nrs += WEIGHT_MULTI_ATTEMPT;
    reasons.push("nrs_multi_attempt");
  }

  // -100: Destination matches allowlist (hard allow)
  const allowlisted = isDestinationAllowlisted(ctx.destinationUrl, ctx.allowlistedHosts);
  if (allowlisted) {
    nrs += WEIGHT_ALLOWLIST;
    reasons.push("nrs_allowlisted");
  }

  // -30: Explicit new-tab intent (middle click or ctrl/cmd click)
  // Only applies when the navigation actually opens a new tab;
  // otherwise an attacker could ctrl-click a same-tab deceptive link
  // to get a free -30 discount.
  if (ctx.explicitNewTabIntent && ctx.isNewTab) {
    nrs += WEIGHT_EXPLICIT_NEW_TAB;
    reasons.push("nrs_explicit_new_tab");
  }

  // Clamp to floor of 0 — negative NRS has no meaning
  nrs = Math.max(0, nrs);

  return { nrs, cds: cdsValue, reasonCodes: reasons, allowlisted };
}

/**
 * Determine the navigation decision from an NRS result.
 *
 * When `allowlisted` is true the destination matched the user's allowlist
 * and the spec says this is a "hard allow" — override to allow regardless
 * of score.
 */
export function nrsDecision(
  nrs: number,
  mode: Mode,
  allowlisted = false
): "allow" | "prompt" | "block" {
  if (mode === "off") return "allow";
  if (allowlisted) return "allow";

  const blockThreshold = mode === "strict"
    ? NRS_STRICT_BLOCK_THRESHOLD
    : NRS_SMART_BLOCK_THRESHOLD;

  if (nrs >= blockThreshold) return "block";
  if (nrs >= NRS_ALLOW_THRESHOLD) return "prompt";
  return "allow";
}
