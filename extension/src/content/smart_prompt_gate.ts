import type { Mode } from "../shared/types";

const SMART_GESTURE_WINDOW_MS = 1500;

const IDP_RE = /(^|\.)((accounts\.google\.com)|(login\.microsoftonline\.com)|(login\.live\.com)|(okta\.com)|(auth0\.com))$/;
const PAYMENT_RE = /(^|\.)(stripe\.com|paypal\.com|checkout\.com|squareup\.com|braintreegateway\.com|visa\.com|mastercard\.com|americanexpress\.com|cardinalcommerce\.com|arcot\.com)$/;
const OAUTH_PATH_RE = /\/(oauth2?|authorize|consent|openid)(\/|$)/i;
const OAUTH_QUERY_RE = /(^|[?&])(response_type|client_id|redirect_uri|scope)=/i;
const BENIGN_NRS_FACTORS = new Set([
  "nrs_new_tab_window",
  "nrs_cross_site",
  "nrs_fast_attempt",
  "nrs_user_activation_active",
]);
const SAME_ORG_LOW_CDS_REASONS = new Set(["no_accessible_name"]);

export interface SmartPromptSuppressionInput {
  mode: Mode;
  isBlankAnchor: boolean;
  isAllowed: boolean;
  explicitNewTab: boolean;
  cds: number;
  cdsReasons: readonly string[];
  nrs: number;
  nrsFactors: readonly string[];
  blockThreshold: number;
  pointerDownTrusted: boolean;
  clickTrusted: boolean;
  timeSincePointerdownMs?: number | undefined;
  destHost: string | null;
  destHref: string | null;
  sameOrganization: boolean;
  oauthRedirectMismatch: boolean;
  oauthOpenerManipulation: boolean;
}

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/\.$/, "");
}

export function isKnownIdpHost(host: string | null | undefined): boolean {
  return IDP_RE.test(normalizeHost(host));
}

export function isKnownPaymentOr3dsHost(host: string | null | undefined): boolean {
  return PAYMENT_RE.test(normalizeHost(host));
}

export function looksLikeOAuthUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return OAUTH_PATH_RE.test(parsed.pathname) && OAUTH_QUERY_RE.test(parsed.search);
}

/**
 * P5-A2: Smart Mode should be context-silent on clearly benign blank-anchor
 * flows while preserving block behavior and all CDS-backed attack prompts.
 */
export function shouldSuppressSmartBlankPrompt(input: SmartPromptSuppressionInput): boolean {
  if (input.mode !== "smart") return false;
  if (!input.isBlankAnchor || input.isAllowed || input.explicitNewTab) return false;
  const sameOrgLowCds = input.sameOrganization &&
    input.cds <= 15 &&
    input.cdsReasons.length > 0 &&
    input.cdsReasons.every((reason) => SAME_ORG_LOW_CDS_REASONS.has(reason));
  if (!sameOrgLowCds && (input.cds > 0 || input.cdsReasons.length > 0)) return false;
  if (input.nrs >= input.blockThreshold) return false;
  if (input.nrsFactors.some((factor) => !BENIGN_NRS_FACTORS.has(factor))) return false;
  if (!input.pointerDownTrusted || !input.clickTrusted) return false;

  const shortActiveGesture =
    input.timeSincePointerdownMs !== undefined &&
    input.timeSincePointerdownMs >= 0 &&
    input.timeSincePointerdownMs <= SMART_GESTURE_WINDOW_MS;
  if (!shortActiveGesture) return false;

  if (input.sameOrganization) return true;

  if (
    isKnownIdpHost(input.destHost) &&
    looksLikeOAuthUrl(input.destHref) &&
    !input.oauthRedirectMismatch &&
    !input.oauthOpenerManipulation
  ) {
    return true;
  }

  if (isKnownPaymentOr3dsHost(input.destHost)) return true;

  return false;
}
