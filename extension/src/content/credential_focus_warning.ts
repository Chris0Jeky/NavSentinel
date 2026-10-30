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
 * PUNYCODE_HOST is deliberately absent: an IDN alone (müller.de) is an
 * ordinary non-English name. Punycode warns only through the lookalike or
 * mixed-script codes the model raises alongside it.
 */
const STRONG_PAGE_SIGNALS = [
  "LOOKALIKE_DOMAIN",
  "HOMOGLYPH_LOOKALIKE",
  "BRAND_KEYWORD_DOMAIN",
  "SUBDOMAIN_STUFFING",
  "MIXED_SCRIPT_HOST",
  "IP_HOST",
  "NON_HTTPS_PAGE"
];

/**
 * Router, NAS and dev hosts: loopback, private and link-local IP literals
 * (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7, fe80::/10).
 */
function isLocalHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".test")) return true;
  if (!isIPAddress(host)) return false;
  // A short first group has dropped leading zeros ("fc::1" is 00fc::1, public).
  if (host.includes(":")) return host === "::1" || /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(host);
  const [a, b] = host.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 169 && b === 254);
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
  if (!host || risk.page.isTrusted || isLocalHost(host)) return null;
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
