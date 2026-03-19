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
  let host = "";
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
  return (log ?? []).slice(-limit).reverse();
}

export function formatPopupEventLine(
  event: EventLogEntry,
  formatTime: (ts: number) => string
): string {
  const site = event.site ? ` | ${event.site}` : "";
  const score = typeof event.score === "number" ? ` | score=${event.score}` : "";
  return `${formatTime(event.ts)} | ${event.kind}${site}${score}`;
}
