import type { EventLogEntry } from "../shared/storage";
import { SILENT_DECISION_KINDS } from "../shared/storage";
import { getRegistrableDomain, normalizeHost } from "../shared/domain";

export interface PopupSiteState {
  siteLabel: string;
  registrableDomain: string;
  isTrusted: boolean;
  trustStatus: string;
  canTrust: boolean;
  canUntrust: boolean;
}

export function derivePopupSiteState(activeTabUrl: string, trustedDomains: string[]): PopupSiteState {
  let host: string;
  try {
    host = activeTabUrl ? new URL(activeTabUrl).hostname : "";
  } catch {
    host = "";
  }

  host = normalizeHost(host);
  const registrableDomain = host ? getRegistrableDomain(host) : "";
  const trusted = trustedDomains ?? [];
  const isTrusted = !!(registrableDomain && trusted.includes(registrableDomain));

  return {
    siteLabel: registrableDomain || host || "(no host)",
    registrableDomain,
    isTrusted,
    trustStatus: isTrusted
      ? "Trusted for credential submits."
      : "Not trusted (credential prompts may appear).",
    canTrust: !isTrusted && !!registrableDomain,
    canUntrust: isTrusted && !!registrableDomain
  };
}

export function getRecentPopupEvents(log: EventLogEntry[], limit = 8): EventLogEntry[] {
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 8;
  if (cappedLimit === 0) return [];
  // Silent-decision events (#236) populate the options audit log + tuning corpus
  // but are excluded from the popup's at-a-glance "recent signals" feed — that
  // surface is for notable events, not routine silent allows, and high-frequency
  // silent events would otherwise crowd the small feed. (Surfacing them in the
  // popup is the #205 / #214 / #219 consumer follow-up.)
  return (log ?? [])
    .filter((ev) => ev?.kind && !SILENT_DECISION_KINDS.has(ev.kind))
    .slice(-cappedLimit)
    .reverse();
}

export function formatPopupEventLine(
  event: EventLogEntry,
  formatTime: (ts: number) => string
): string {
  const site = event.site ? ` | ${event.site}` : "";
  const score = typeof event.score === "number" ? ` | score=${event.score}` : "";
  return `${formatTime(event.ts)} | ${event.kind}${site}${score}`;
}

/**
 * Whether a reason code REDUCES risk (vs. signals a threat). This is the exact
 * negation of the threat-filter in capture_isolated.buildPlainMessage (the source
 * of truth): startsWith for `keyboard_`/`legit_`, an exact match for
 * `nrs_user_activation_active`, and substring for the rest — so the popup chips and
 * the warning toast agree. Using startsWith/exact (not a broad substring) prevents
 * a future risk-INCREASING code that merely contains one of these tokens (e.g. a
 * "spoofed_user_activation") from being mis-coloured green. Extracting one shared
 * helper used by both call sites is the durable fix (seeded as a follow-up). (#205 R1)
 */
export function isRiskReducingReason(reasonCode: string): boolean {
  const r = reasonCode ?? "";
  return (
    r.startsWith("keyboard_") ||
    r.startsWith("legit_") ||
    r.includes("allowlisted") ||
    r.includes("previously_allowed") ||
    r.includes("explicit_new_tab") ||
    r === "nrs_user_activation_active"
  );
}

/**
 * CSS class for a signal chip: "ok" (green) for risk-reducing reason codes,
 * "warn" (orange) otherwise. Replaces a dead `startsWith("-")` check — no stored
 * reason code is dash-prefixed, so every chip rendered as a warning. (#205)
 */
export function signalChipClass(reasonCode: string): "signal-chip--ok" | "signal-chip--warn" {
  return isRiskReducingReason(reasonCode) ? "signal-chip--ok" : "signal-chip--warn";
}

/**
 * Popup event icon by kind, aligned with classifyEventTone: credential (cred_*)
 * -> key, config (suite_*) -> gear, everything else (navigation-toned, including
 * threat alerts like clickfix_detected / mutation_alert) -> shield. The old
 * mapping gave every non-nav_/cred_ kind a settings-gear glyph, contradicting the
 * navigation tone of threat alerts. (#205)
 */
export function eventIconName(kind: string): string {
  if (kind.startsWith("cred_")) return "key";
  if (kind.startsWith("suite_")) return "gear";
  return "shield";
}

/**
 * The most recent SCORED event whose registrable domain matches the active site,
 * or null if there is none. The event log is global (written by every tab/frame),
 * so the "Current page" gauge/signals must filter to the active site rather than
 * show log[last] — otherwise a clean site shows a previous site's risk (false
 * alarm) or a flagged site shows a background tab's green (false reassurance).
 *
 * Only SCORED events are considered (#205 R1): several threat events are logged
 * without a score (nav_rollback, mutation_alert, nav_reputation_late_warn,
 * nav_blank_prompt) and, being the most recent, would otherwise mask an earlier
 * scored block — dropping the gauge to 0/green — and produce orange chips beside a
 * green gauge. Scoreless alerts still appear in the event list, just not the gauge.
 *
 * Semantics: matching is by registrable domain over the persisted log, so the
 * gauge reflects the most recent scored risk for the DOMAIN (it can surface a score
 * from a prior visit or a sibling subdomain), not strictly the live page. Tighter
 * per-navigation binding is a tracked follow-up. event.site is a full hostname, so
 * it is reduced to a registrable domain for the comparison.
 */
export function pickSiteRiskEvent(
  log: EventLogEntry[],
  registrableDomain: string
): EventLogEntry | null {
  if (!registrableDomain) return null;
  const entries = log ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const ev = entries[i];
    if (!ev?.kind) continue;
    if (typeof ev.score !== "number") continue;
    // Silent-decision events (nav_silent_allow / cred_form_evaluated, #236) are
    // scored but must never drive the gauge: a routine silent allow would
    // otherwise mask an earlier scored block on the same domain (#205 / #214).
    if (SILENT_DECISION_KINDS.has(ev.kind)) continue;
    const site = ev.site ? getRegistrableDomain(normalizeHost(ev.site)) : "";
    if (site && site === registrableDomain) return ev;
  }
  return null;
}

export interface PopupTabRisk {
  tabRisk: number;
  reasons: string[] | undefined;
}

/**
 * The "Current page" gauge value + signal reasons for the active site, derived
 * from the most recent scored same-domain event (or 0 / none). Consolidates the
 * gauge/signals decision into one tested function so the popup wiring is a thin
 * pass-through. (#205 R1)
 */
export function derivePopupTabRisk(log: EventLogEntry[], registrableDomain: string): PopupTabRisk {
  const ev = pickSiteRiskEvent(log, registrableDomain);
  return {
    tabRisk: ev && typeof ev.score === "number" ? ev.score : 0,
    reasons: ev?.reasons,
  };
}
