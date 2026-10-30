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
 * mixed-script codes the model raises alongside it. BRAND_KEYWORD_DOMAIN is
 * absent too: it is a prefix match, so applebees.com reads as "apple".
 */
const STRONG_PAGE_SIGNALS = [
  "LOOKALIKE_DOMAIN",
  "HOMOGLYPH_LOOKALIKE",
  "SUBDOMAIN_STUFFING",
  "MIXED_SCRIPT_HOST",
  "IP_HOST",
  "NON_HTTPS_PAGE"
];

const LOCAL_SUFFIX = /\.(?:localhost|test|local|lan|internal|home\.arpa|intranet|corp)$/;

function isPrivateIPv4(a: number, b: number): boolean {
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/**
 * Router, NAS, intranet and dev hosts: single-label names, reserved private
 * suffixes, and loopback/private/link-local/CGNAT IP literals (10/8,
 * 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10, ::1, fc00::/7,
 * fe80::/10, and IPv4-mapped forms of the IPv4 ranges).
 */
function isLocalHost(host: string): boolean {
  if (!isIPAddress(host)) return !host.includes(".") || host === "localhost" || LOCAL_SUFFIX.test(host);
  if (host.includes(":")) {
    // URL serializes ::ffff:a.b.c.d as ::ffff:XXXX:XXXX.
    const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(host);
    if (mapped) {
      const hi = parseInt(mapped[1]!, 16);
      return isPrivateIPv4(hi >> 8, hi & 255);
    }
    // A short first group has dropped leading zeros ("fc::1" is 00fc::1, public).
    return host === "::1" || /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(host);
  }
  const [a, b] = host.split(".").map(Number) as [number, number];
  return isPrivateIPv4(a, b);
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
