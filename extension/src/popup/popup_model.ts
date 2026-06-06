import type { EventLogEntry } from "../shared/storage";
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
  return (log ?? []).slice(-cappedLimit).reverse();
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
 * Reason-code markers that REDUCE risk (vs. signal a threat). Mirrors the
 * risk-reducing classification in capture_isolated.buildPlainMessage so the popup
 * colours benign factors green instead of orange. (#205)
 */
const RISK_REDUCING_MARKERS = [
  "allowlisted",
  "previously_allowed",
  "explicit_new_tab",
  "user_activation",
  "keyboard_",
  "legit_",
];

/**
 * CSS class for a signal chip: "ok" (green) for risk-reducing reason codes,
 * "warn" (orange) otherwise. Replaces a dead `startsWith("-")` check — no stored
 * reason code is dash-prefixed, so every chip rendered as a warning. (#205)
 */
export function signalChipClass(reasonCode: string): "signal-chip--ok" | "signal-chip--warn" {
  const r = (reasonCode ?? "").toLowerCase();
  return RISK_REDUCING_MARKERS.some((m) => r.includes(m)) ? "signal-chip--ok" : "signal-chip--warn";
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
 * The most recent event whose registrable domain matches the active site, or null
 * if the active site has produced no events. The event log is global (written by
 * every tab/frame), so the "Current page" gauge/signals must filter to the active
 * site rather than show log[last] — otherwise a clean site shows a previous site's
 * risk (false alarm) or a flagged site shows a background tab's green (false
 * reassurance). event.site is a full hostname, so reduce it to a registrable
 * domain for the comparison. (#205)
 */
export function pickSiteRiskEvent(
  log: EventLogEntry[],
  registrableDomain: string
): EventLogEntry | null {
  if (!registrableDomain) return null;
  const entries = log ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const ev = entries[i]!;
    const site = ev.site ? getRegistrableDomain(normalizeHost(ev.site)) : "";
    if (site && site === registrableDomain) return ev;
  }
  return null;
}
