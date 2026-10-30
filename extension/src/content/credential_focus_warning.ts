import { appendEvent, getCredentialSettings, getTrustedDomains, type CredentialSettings } from "../shared/storage";
import { computeCredentialRisk, isIPAddress, normalizeHost, type RiskReason } from "../shared/domain";
import { explainJournalReason } from "../evidence/evidence_reasons";
import { showToast } from "./ui_toast";

/**
 * #1170: fetch/XHR credential kits never submit a form, so the submit guard
 * never sees them. At the first focus of a visible password field
 * (credential_guard's one-shot hook) warn, without blocking, when the page
 * ADDRESS alone carries a high-confidence phishing signal.
 *
 * Only these computeCredentialRisk page codes qualify, strongest first (the
 * toast names one). Weak codes (untrusted, deep subdomain) never warn: a
 * fresh install trusts nothing, so "untrusted" alone would fire everywhere.
 */
const STRONG_PAGE_SIGNALS = [
  "LOOKALIKE_DOMAIN",
  "HOMOGLYPH_LOOKALIKE",
  "BRAND_KEYWORD_DOMAIN",
  "SUBDOMAIN_STUFFING",
  "PUNYCODE_HOST",
  "MIXED_SCRIPT_HOST",
  "IP_HOST",
  "NON_HTTPS_PAGE"
];

function isLocalDevHost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".test") ||
    host === "::1" || (host.startsWith("127.") && isIPAddress(host));
}

/** The strongest page-only signal that warrants a focus warning, or null. */
export function focusWarningReason(
  pageUrl: string,
  trustedDomains: string[],
  config: CredentialSettings
): RiskReason | null {
  if (config.mode === "off") return null;
  // Page-only: the action is the page itself, so no cross-site signal applies.
  const risk = computeCredentialRisk({ pageUrl, actionUrl: pageUrl, trustedDomains, config });
  const host = risk.page.host;
  if (!host || risk.page.isTrusted || isLocalDevHost(host)) return null;
  for (const code of STRONG_PAGE_SIGNALS) {
    const reason = risk.reasons.find((r) => r.code === code);
    if (reason) return reason;
  }
  return null;
}

export function focusWarningMessage(code: string): string {
  const why = explainJournalReason(code);
  return `Heedline: this page's address looks risky for a password (${why.charAt(0).toLowerCase()}${why.slice(1)}). Check the address before typing.`;
}

export async function warnOnPasswordFocus(pageUrl: string): Promise<void> {
  const cfg = await getCredentialSettings();
  const reason = focusWarningReason(pageUrl, await getTrustedDomains(), cfg);
  if (!reason) return;
  // Warn and dismiss only (RI-01): no trust or allow action on page-injected UI.
  showToast({ message: focusWarningMessage(reason.code), timeoutMs: 12000 });
  // Existing warn-only credential kind; `trigger` tells it apart from a paste.
  await appendEvent({
    kind: "cred_paste_warn",
    site: normalizeHost(new URL(pageUrl).hostname),
    url: pageUrl,
    reasons: [reason.code],
    extra: { trigger: "password_focus" }
  });
}
