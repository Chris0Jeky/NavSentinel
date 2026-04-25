import type { ScoreResult } from "./scoring";

export interface NavigationContext {
  isNewTabOrWindow: boolean;
  isCrossSite: boolean;
  timeSincePointerdownMs?: number | undefined;
  userActivationActive?: boolean | undefined;
  multipleAttemptsInGesture?: boolean | undefined;
  destinationAllowlisted?: boolean | undefined;
  explicitNewTabIntent?: boolean | undefined;
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

export const NRS_ALLOW_THRESHOLD = 40;
export const NRS_PROMPT_THRESHOLD = 40;
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

  if (navCtx.destinationAllowlisted) {
    nrs += NRS_WEIGHT_ALLOWLIST;
    nrsFactors.push("nrs_allowlisted");
  }

  if (navCtx.explicitNewTabIntent) {
    nrs += NRS_WEIGHT_EXPLICIT_NEW_TAB;
    nrsFactors.push("nrs_explicit_new_tab_intent");
  }

  nrs = Math.max(0, nrs);

  return {
    nrs,
    cds: cdsResult.cds,
    reasonCodes: [...cdsResult.reasonCodes, ...nrsFactors],
    nrsFactors,
  };
}
