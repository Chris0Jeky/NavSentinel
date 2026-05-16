import type { ScoreResult } from "./scoring";

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
const NRS_WEIGHT_JS_BEHAVIOR_CAP = 35;

/** Raw scores above this get 50% weight on the excess. */
const NRS_DIMINISHING_RETURNS_THRESHOLD = 100;
const NRS_DIMINISHING_RETURNS_FACTOR = 0.5;

export const NRS_BLOCK_THRESHOLD = 70;
export const NRS_STRICT_BLOCK_THRESHOLD = 50;

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
