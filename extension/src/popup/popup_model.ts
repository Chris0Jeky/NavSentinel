import type { EventLogEntry, UnscoredThreatKind } from "../shared/storage";
import { isUnscoredThreatKind, SILENT_DECISION_KINDS } from "../shared/storage";
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
 * green gauge. Scoreless alerts still appear in the event list; when a site has NO
 * scored event at all they now drive a distinct unscored-threat gauge state rather
 * than leaving it green (#219) — see derivePopupTabRisk.
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

/** An event-log entry narrowed to a known unscored threat kind. (#219) */
export interface UnscoredThreatEvent extends EventLogEntry {
  kind: UnscoredThreatKind;
}

/**
 * Whether an entry is a threat alert that carries no risk score (#219).
 *
 * Narrow by construction:
 *  - the kind must be in the enumerated UNSCORED_THREAT_KINDS set (shared types),
 *    never a loose string match and never "any event without a score";
 *  - an entry that DOES carry a score is not this state — the scored path owns it;
 *  - `mutation_alert` additionally requires `extra.severity === "high"`. The
 *    mutation monitor downgrades known-benign DOM churn (cookie banners, chat
 *    widgets, ARIA dialogs) to low severity and only high-severity overlay
 *    injection raises a user-visible warning, so warning on every mutation_alert
 *    would be the over-warning failure mode. A malformed/legacy entry with no
 *    severity is treated as non-threatening for the same reason.
 */
export function isUnscoredThreatEvent(event: EventLogEntry): event is UnscoredThreatEvent {
  if (!event?.kind || !isUnscoredThreatKind(event.kind)) return false;
  if (typeof event.score === "number") return false;
  if (event.kind !== "mutation_alert") return true;
  const severity = event.extra?.["severity"];
  return typeof severity === "string" && severity === "high";
}

/**
 * The most recent same-domain unscored threat alert, or null. Same domain
 * matching and same log-order semantics as pickSiteRiskEvent. (#219)
 */
export function pickSiteUnscoredThreatEvent(
  log: EventLogEntry[],
  registrableDomain: string
): UnscoredThreatEvent | null {
  if (!registrableDomain) return null;
  const entries = log ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const ev = entries[i];
    if (!ev || !isUnscoredThreatEvent(ev)) continue;
    const site = ev.site ? getRegistrableDomain(normalizeHost(ev.site)) : "";
    if (site && site === registrableDomain) return ev;
  }
  return null;
}

/**
 * Honest one-line description of an unscored threat alert, for the gauge note
 * and its aria-label. The wording must say a threat was RECORDED here, never
 * imply the page scored badly — there is no score to report. (#219)
 *
 * Typed as an exhaustive Record over UnscoredThreatKind, so adding a kind to the
 * shared set without a description is a build error rather than a raw event kind
 * leaking into the UI.
 */
const UNSCORED_THREAT_TEXT: Readonly<Record<UnscoredThreatKind, string>> = {
  mutation_alert: "suspicious content was injected after this page loaded",
  nav_blank_prompt: "a blank-target navigation from this page was held for confirmation",
  nav_reputation_late_warn: "a frame on this page navigated to a known-malicious domain",
  nav_rollback: "a navigation from this page was rolled back",
};

export function describeUnscoredThreat(kind: UnscoredThreatKind): string {
  return UNSCORED_THREAT_TEXT[kind];
}

/**
 * Gauge presentation state (#219):
 *  - "scored"          — a scored same-domain event drives the numeric gauge;
 *  - "unscored-threat" — no scored event, but a threat alert with no score was
 *                        recorded here (distinct gauge; NOT a score of any value);
 *  - "clear"           — nothing recorded for this site.
 */
export type PopupGaugeState = "scored" | "unscored-threat" | "clear";

export interface PopupTabRisk {
  tabRisk: number;
  reasons: string[] | undefined;
  state: PopupGaugeState;
  threatKind: UnscoredThreatKind | undefined;
}

/**
 * The "Current page" gauge value + signal reasons for the active site, derived
 * from the most recent scored same-domain event (or 0 / none). Consolidates the
 * gauge/signals decision into one tested function so the popup wiring is a thin
 * pass-through. (#205 R1)
 *
 * A SCORED event always wins (#219): the scored lookup runs first and returns
 * unchanged, so a scored block on the domain is never masked or softened by a
 * later scoreless alert. Only when there is no scored event at all does a
 * recorded unscored threat take over the gauge, and it does so as a distinct
 * presentation state — `tabRisk` stays 0 and no synthetic score is invented, so
 * nothing downstream can mistake this for a measurement.
 */
export function derivePopupTabRisk(log: EventLogEntry[], registrableDomain: string): PopupTabRisk {
  const ev = pickSiteRiskEvent(log, registrableDomain);
  if (ev) {
    return {
      tabRisk: typeof ev.score === "number" ? ev.score : 0,
      reasons: ev.reasons,
      state: "scored",
      threatKind: undefined,
    };
  }

  const threat = pickSiteUnscoredThreatEvent(log, registrableDomain);
  if (threat) {
    // The threat's own reason codes are safe to surface here: the gauge is no
    // longer green, so orange chips beside it no longer contradict it (#205 R1).
    return { tabRisk: 0, reasons: threat.reasons, state: "unscored-threat", threatKind: threat.kind };
  }

  return { tabRisk: 0, reasons: undefined, state: "clear", threatKind: undefined };
}
