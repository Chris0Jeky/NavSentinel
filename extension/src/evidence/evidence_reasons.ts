import { explainReasonCode, isKnownReasonCode } from "../shared/explanations";

/**
 * Readable text for reason codes the product stores on event-log entries but
 * never shows in a page toast (#867), so they are not in `shared/explanations.ts`.
 * That table is a shared chunk every frame loads through capture_isolated, and
 * its keys are the portable export vocabulary the Lab importer accepts
 * (`experiments/vision-lab/shared/evidence.js` REASONS). These codes therefore
 * stay local to the Protection Center: they are displayed, never exported.
 *
 * Keys are the exact stored codes; `tests/evidence-reasons.test.ts` reads the
 * producers' source and fails when a stored code has no readable text.
 */
const JOURNAL_ONLY_EXPLANATIONS: Readonly<Record<string, string>> = {
  // Credential risk (shared/domain.ts computeCredentialRisk, content/credential_guard.ts)
  NON_HTTPS_PAGE: "The sign-in page was not using HTTPS, so a password could be intercepted",
  NON_HTTPS_ACTION: "The form sends its data without HTTPS",
  USERINFO_IN_URL: "The web address used the user@host trick to disguise the real site",
  IP_HOST: "The page address is a raw IP number, unusual for a real sign-in page",
  PUNYCODE_HOST: "The site name uses encoded characters (xn--) that can imitate another site",
  MIXED_SCRIPT_HOST: "The site name mixes alphabets, which can imitate another site",
  DEEP_SUBDOMAIN: "The site name has an unusually long chain of subdomains",
  CROSS_SITE_ACTION: "The form sends your details to a different site than the page",
  CROSS_SITE_ACTION_TRUSTED: "The form sends to a different site, one you have trusted (lower risk)",
  LOOKALIKE_DOMAIN: "The site name is spelled almost like a site you trust",
  HOMOGLYPH_LOOKALIKE: "The site name uses look-alike characters to resemble a site you trust",
  BRAND_KEYWORD_DOMAIN: "The site name borrows a well-known brand it does not belong to",
  SUBDOMAIN_STUFFING: "A brand name is placed in front of an unrelated site name",
  UNTRUSTED_DOMAIN: "This site is not on your trusted list",
  CONTENT_FP: "The page content resembles a phishing page (brand, template or form clues)",
  SRI_MISSING_ON_CREDENTIAL_PAGE: "Scripts on this sign-in page load without integrity checks",
  SRI_PRESENT_ON_CREDENTIAL_PAGE: "Scripts on this sign-in page use integrity checks (lower risk)",

  // ClickFix detector (content/clickfix_detector.ts)
  legit_captcha_present: "A recognized CAPTCHA provider was also on the page (lower risk)",

  // MAIN-world pushState checks (content/main_guard.ts checkPushStateSuspicious)
  rapid_pushstate: "The page rewrote its address many times in quick succession",
  domain_like_path_after_gesture: "After your click, the page changed its address to look like another site",

  // Overlay cleanup lifecycle (content/capture_isolated.ts)
  overlay_cleanup_setting_off: "Hidden overlays were restored because overlay cleanup was turned off",
  overlay_cleanup_undo: "You restored an overlay that NavSentinel had hidden",

  // Child-frame destination check (content/capture_isolated.ts, research profile only)
  late_async_child_frame: "An embedded frame's destination was later matched to a known malicious domain",
};

const UNRECOGNIZED = "A signal without a readable description was recorded";

/** Codes the Protection Center can explain: the portable registry plus journal-only codes. */
export function isJournalReasonCode(code: string): boolean {
  return isKnownReasonCode(code) || Object.hasOwn(JOURNAL_ONLY_EXPLANATIONS, code);
}

/** Plain-language text for a stored reason code; never echoes an unrecognized code. */
export function explainJournalReason(code: string): string {
  if (isKnownReasonCode(code)) return explainReasonCode(code);
  return Object.hasOwn(JOURNAL_ONLY_EXPLANATIONS, code) ? JOURNAL_ONLY_EXPLANATIONS[code]! : UNRECOGNIZED;
}

/** Journal-only codes, for the coverage test. */
export const JOURNAL_ONLY_REASON_CODES: readonly string[] = Object.keys(JOURNAL_ONLY_EXPLANATIONS);
