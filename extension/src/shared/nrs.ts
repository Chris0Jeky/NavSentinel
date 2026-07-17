import type { ScoreResult } from "./scoring";
import { NRS_WEIGHT_JS_BEHAVIOR_CAP } from "./js_behavior_state";
import type { NavigationTrustTier } from "./top_sites";
import {
  TRUST_TIER_KNOWN_BAD,
  TRUST_TIER_TOP_SITE,
} from "./top_sites";
import { NRS_WEIGHT_VISUAL_SIM_CAP } from "./visual_sim_types";

export interface NavigationContext {
  isNewTabOrWindow: boolean;
  isCrossSite: boolean;
  timeSincePointerdownMs?: number | undefined;
  userActivationActive?: boolean | undefined;
  multipleAttemptsInGesture?: boolean | undefined;
  destinationAllowlisted?: boolean | undefined;
  explicitNewTabIntent?: boolean | undefined;
  doubleClickHijackActive?: boolean | undefined;
  /** Destination domain matched the bloom filter of known-bad domains */
  knownBadDomain?: boolean | undefined;
  /** Number of hops in the redirect chain leading to this navigation */
  redirectChainDepth?: number | undefined;
  /** Whether any hop in the redirect chain passed through a known redirector */
  redirectViaKnownRedirector?: boolean | undefined;
  /** Number of hops through known redirectors in the chain */
  knownRedirectorHops?: number | undefined;
  /** OAuth callback redirected to an unexpected domain */
  oauthRedirectMismatch?: boolean | undefined;
  /** Opener manipulation detected during an active OAuth flow */
  oauthOpenerManipulation?: boolean | undefined;
  /** ClickFix scan score (0-60 range from scanForClickFix); 0 or undefined = no ClickFix signal */
  clickfixScore?: number | undefined;
  /** The user previously allowed the popup that opened this tab */
  openerWindowPreviouslyAllowed?: boolean | undefined;
  /** Suspicious history.pushState/replaceState abuse detected after a user gesture */
  pushStateAbuse?: boolean | undefined;
  /** CSP weakness score from csp_analyzer (positive only; applied when base NRS > 20) */
  cspWeaknessScore?: number | undefined;
  /** Domain has been flagged as a repeat offender by domain profiling */
  domainRepeatOffender?: boolean | undefined;
  /** Navigation anomaly score from nav_anomaly (0-15 range) */
  navAnomalyScore?: number | undefined;
  /** JS behavior analysis score (0-35 range) - credential exfil/form manipulation signals */
  jsBehaviorScore?: number | undefined;
  /** Visual brand-match score (0-30 range) - page resembles a known brand login surface */
  visualSimilarityScore?: number | undefined;
  /** Local trust tier for the destination; known-bad always overrides benign priors */
  trustTier?: NavigationTrustTier | undefined;
}

export interface NRSResult {
  nrs: number;
  cds: number;
  reasonCodes: string[];
  nrsFactors: string[];
}

const NRS_WEIGHT_NEW_TAB_WINDOW = 20;
const NRS_WEIGHT_CROSS_SITE = 20;
const NRS_WEIGHT_FAST_ATTEMPT = 10;
const NRS_WEIGHT_USER_ACTIVATION = 5;
const NRS_WEIGHT_MULTIPLE_ATTEMPTS = 25;
const NRS_WEIGHT_ALLOWLIST = -100;
const NRS_WEIGHT_EXPLICIT_NEW_TAB = -30;
const NRS_WEIGHT_DOUBLE_CLICK_HIJACK = 40;
const NRS_WEIGHT_KNOWN_BAD_DOMAIN = 50;
const NRS_WEIGHT_REDIRECT_CHAIN_PER_HOP = 5;
const NRS_WEIGHT_REDIRECT_CHAIN_CAP = 25;
const NRS_WEIGHT_REDIRECT_CHAIN_THRESHOLD = 2;
const NRS_WEIGHT_REDIRECT_KNOWN_REDIRECTOR = 15;
const NRS_WEIGHT_REDIRECT_KNOWN_REDIRECTOR_CAP = 30;
const NRS_WEIGHT_OAUTH_REDIRECT_MISMATCH = 30;
const NRS_WEIGHT_OAUTH_OPENER_MANIPULATION = 45;
const NRS_WEIGHT_CLICKFIX_CAP = 40;
const NRS_WEIGHT_OPENER_PREVIOUSLY_ALLOWED = -20;
const NRS_WEIGHT_PUSHSTATE_ABUSE = 20;
/** Minimum base NRS before CSP weakness is applied as a modifier. */
const NRS_CSP_MODIFIER_THRESHOLD = 20;
const NRS_WEIGHT_CSP_CAP = 10;
const NRS_WEIGHT_DOMAIN_REPEAT_OFFENDER = 10;
const NRS_WEIGHT_NAV_ANOMALY_CAP = 15;

/** Raw scores above this get 50% weight on the excess. */
const NRS_DIMINISHING_RETURNS_THRESHOLD = 100;
const NRS_DIMINISHING_RETURNS_FACTOR = 0.5;

export const NRS_BLOCK_THRESHOLD = 70;
export const NRS_STRICT_BLOCK_THRESHOLD = 50;

/**
 * NRS factors that are benign navigation *structure* (a new tab, a cross-site
 * hop, a fast click, an active user gesture, explicit new-tab intent, an
 * allowlist/previously-allowed match) rather than attack signals. A score built
 * only from these plus CDS layout reasons is a candidate for top-site relief: a
 * vetted top-site destination is very unlikely to be running a layout clickjack
 * against its own users, while every genuine attack carries a factor NOT in this
 * set — known-bad, redirector, oauth-mismatch, opener-manipulation, clickfix,
 * double-click hijack, pushstate abuse, js-behavior, visual brand-match,
 * repeat-offender, multiple-attempts, nav-anomaly, csp-weakness — which still
 * blocks at full strength.
 */
const BENIGN_STRUCTURAL_NRS_FACTORS = new Set<string>([
  "nrs_new_tab_window",
  "nrs_cross_site",
  "nrs_fast_attempt",
  "nrs_user_activation_active",
  "nrs_explicit_new_tab_intent",
  "nrs_allowlisted",
  "nrs_opener_previously_allowed",
]);

/**
 * Block-threshold relief (raise the bar) for a trusted top-site destination whose
 * score is driven only by CDS layout reasons + benign structural NRS — i.e. no
 * attack factor at all. This is the "threshold = f(tier)" lever the top-site trust
 * tier (#234 / P5-A3) was meant to provide but never did (only KNOWN_BAD was ever
 * adjusted, so top-sites got zero relief).
 *
 * STARTING VALUE, not a validated number: Decision D25 forbids shipping a scoring
 * change without a measure:fp / corpus FP-TP delta + Gate-3. Tune against the
 * benign-journey harness (#232) and the attack gym before relying on +20.
 */
export const NRS_TOP_SITE_CDS_RELIEF = 20;

/**
 * True when every NRS factor present is benign navigation structure (no attack
 * signal). CDS layout reasons live in `reasonCodes`, not `nrsFactors`, so an empty
 * or all-benign `nrsFactors` means the score is driven only by page layout +
 * navigation structure — the false-positive-heavy path on SPA top-sites.
 */
export function isTopSiteReliefEligible(nrsFactors: readonly string[]): boolean {
  return nrsFactors.every((f) => BENIGN_STRUCTURAL_NRS_FACTORS.has(f));
}

export function getTierAdjustedBlockThreshold(
  baseThreshold: number,
  trustTier?: NavigationTrustTier | undefined,
  nrsFactors?: readonly string[] | undefined,
): number {
  const base = Number.isFinite(baseThreshold) ? baseThreshold : NRS_BLOCK_THRESHOLD;
  let adjustment = 0;
  if (trustTier === TRUST_TIER_KNOWN_BAD) {
    adjustment = -20;
  } else if (
    trustTier === TRUST_TIER_TOP_SITE &&
    nrsFactors !== undefined &&
    isTopSiteReliefEligible(nrsFactors)
  ) {
    // Only relieve when no attack factor is present — a top-site destination
    // reached purely via layout heuristics + benign structure. Any attack signal
    // (known-bad, oauth, clickfix, dblclick, pushstate, etc.) keeps the full bar.
    adjustment = NRS_TOP_SITE_CDS_RELIEF;
  }
  return Math.max(30, Math.min(100, base + adjustment));
}

export function computeNRS(cdsResult: ScoreResult, navCtx: NavigationContext): NRSResult {
  let nrs = cdsResult.cds;
  const nrsFactors: string[] = [];

  if (navCtx.isNewTabOrWindow) {
    nrs += NRS_WEIGHT_NEW_TAB_WINDOW;
    nrsFactors.push("nrs_new_tab_window");
  }

  if (navCtx.isCrossSite) {
    nrs += NRS_WEIGHT_CROSS_SITE;
    nrsFactors.push("nrs_cross_site");
  }

  if (navCtx.timeSincePointerdownMs !== undefined && navCtx.timeSincePointerdownMs <= 250) {
    nrs += NRS_WEIGHT_FAST_ATTEMPT;
    nrsFactors.push("nrs_fast_attempt");
  }

  if (navCtx.userActivationActive) {
    nrs += NRS_WEIGHT_USER_ACTIVATION;
    nrsFactors.push("nrs_user_activation_active");
  }

  if (navCtx.multipleAttemptsInGesture) {
    nrs += NRS_WEIGHT_MULTIPLE_ATTEMPTS;
    nrsFactors.push("nrs_multiple_attempts");
  }

  if (navCtx.doubleClickHijackActive) {
    nrs += NRS_WEIGHT_DOUBLE_CLICK_HIJACK;
    nrsFactors.push("nrs_double_click_hijack");
  }

  if (navCtx.destinationAllowlisted) {
    nrs += NRS_WEIGHT_ALLOWLIST;
    nrsFactors.push("nrs_allowlisted");
  }

  if (navCtx.explicitNewTabIntent) {
    nrs += NRS_WEIGHT_EXPLICIT_NEW_TAB;
    nrsFactors.push("nrs_explicit_new_tab_intent");
  }

  if (navCtx.knownBadDomain) {
    nrs += NRS_WEIGHT_KNOWN_BAD_DOMAIN;
    nrsFactors.push("nrs_known_bad_domain");
  }

  if (navCtx.redirectChainDepth !== undefined && navCtx.redirectChainDepth > NRS_WEIGHT_REDIRECT_CHAIN_THRESHOLD) {
    const hopsOverThreshold = navCtx.redirectChainDepth - NRS_WEIGHT_REDIRECT_CHAIN_THRESHOLD;
    const chainScore = Math.min(hopsOverThreshold * NRS_WEIGHT_REDIRECT_CHAIN_PER_HOP, NRS_WEIGHT_REDIRECT_CHAIN_CAP);
    nrs += chainScore;
    nrsFactors.push("nrs_redirect_chain_depth");
  }

  if (navCtx.redirectViaKnownRedirector) {
    const redirectorHops = navCtx.knownRedirectorHops ?? 1;
    const redirectorScore = Math.min(redirectorHops * NRS_WEIGHT_REDIRECT_KNOWN_REDIRECTOR, NRS_WEIGHT_REDIRECT_KNOWN_REDIRECTOR_CAP);
    nrs += redirectorScore;
    nrsFactors.push("nrs_redirect_via_known_redirector");
  }

  if (navCtx.oauthRedirectMismatch) {
    nrs += NRS_WEIGHT_OAUTH_REDIRECT_MISMATCH;
    nrsFactors.push("nrs_oauth_redirect_mismatch");
  }

  // When both oauthOpenerManipulation and doubleClickHijackActive fire
  // from the same event, use only the higher weight to avoid an overly
  // aggressive combined +85. We still record the factor for diagnostics.
  if (navCtx.oauthOpenerManipulation) {
    if (navCtx.doubleClickHijackActive) {
      const delta = NRS_WEIGHT_OAUTH_OPENER_MANIPULATION - NRS_WEIGHT_DOUBLE_CLICK_HIJACK;
      if (delta > 0) {
        nrs += delta;
      }
    } else {
      nrs += NRS_WEIGHT_OAUTH_OPENER_MANIPULATION;
    }
    nrsFactors.push("nrs_oauth_opener_manipulation");
  }

  if (navCtx.clickfixScore !== undefined && navCtx.clickfixScore > 0) {
    nrs += Math.min(navCtx.clickfixScore, NRS_WEIGHT_CLICKFIX_CAP);
    nrsFactors.push("nrs_clickfix_active");
  }

  if (navCtx.openerWindowPreviouslyAllowed) {
    nrs += NRS_WEIGHT_OPENER_PREVIOUSLY_ALLOWED;
    nrsFactors.push("nrs_opener_previously_allowed");
  }

  if (navCtx.pushStateAbuse) {
    nrs += NRS_WEIGHT_PUSHSTATE_ABUSE;
    nrsFactors.push("nrs_pushstate_abuse");
  }

  if (navCtx.cspWeaknessScore && navCtx.cspWeaknessScore > 0 && nrs > NRS_CSP_MODIFIER_THRESHOLD) {
    nrs += Math.min(navCtx.cspWeaknessScore, NRS_WEIGHT_CSP_CAP);
    nrsFactors.push("nrs_csp_weakness");
  }

  if (navCtx.domainRepeatOffender) {
    nrs += NRS_WEIGHT_DOMAIN_REPEAT_OFFENDER;
    nrsFactors.push("nrs_domain_repeat_offender");
  }

  if (navCtx.navAnomalyScore && navCtx.navAnomalyScore > 0 && nrs > NRS_CSP_MODIFIER_THRESHOLD) {
    nrs += Math.min(navCtx.navAnomalyScore, NRS_WEIGHT_NAV_ANOMALY_CAP);
    nrsFactors.push("nrs_nav_anomaly");
  }

  if (navCtx.jsBehaviorScore && navCtx.jsBehaviorScore > 0) {
    nrs += Math.min(navCtx.jsBehaviorScore, NRS_WEIGHT_JS_BEHAVIOR_CAP);
    nrsFactors.push("nrs_js_behavior_suspicious");
  }

  if (navCtx.visualSimilarityScore && navCtx.visualSimilarityScore > 0) {
    nrs += Math.min(navCtx.visualSimilarityScore, NRS_WEIGHT_VISUAL_SIM_CAP);
    nrsFactors.push("nrs_visual_brand_match");
  }

  // Diminishing returns: points above the threshold get reduced weight
  if (nrs > NRS_DIMINISHING_RETURNS_THRESHOLD) {
    nrs = NRS_DIMINISHING_RETURNS_THRESHOLD +
      (nrs - NRS_DIMINISHING_RETURNS_THRESHOLD) * NRS_DIMINISHING_RETURNS_FACTOR;
  }

  nrs = Math.max(0, nrs);

  return {
    nrs,
    cds: cdsResult.cds,
    reasonCodes: [...cdsResult.reasonCodes, ...nrsFactors],
    nrsFactors,
  };
}
