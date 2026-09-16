import type { EventLogEntry } from "../shared/storage";
import { normalizeEventPageSite, SILENT_DECISION_KINDS } from "../shared/storage";
import type { PopupTabRisk } from "./popup_model";
import { isUnscoredThreatEvent } from "./popup_model";

/**
 * Maximum age for evidence shown as belonging to the live page (#215).
 *
 * The persisted event log is intentionally long-lived, but the popup is a live
 * surface. Ten minutes keeps a recent protective action visible long enough to
 * explain what happened while preventing an old visit from driving the gauge.
 */
export const POPUP_CURRENT_PAGE_MAX_EVENT_AGE_MS = 10 * 60 * 1000;

function activePageHost(activeTabUrl: string): string {
  if (!activeTabUrl) return "";
  try {
    const parsed = new URL(activeTabUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return normalizeEventPageSite(parsed.hostname) ?? "";
  } catch {
    return "";
  }
}

function isGaugeScoredEvent(event: EventLogEntry): event is EventLogEntry {
  return (
    !!event.kind &&
    typeof event.score === "number" &&
    !SILENT_DECISION_KINDS.has(event.kind)
  );
}

/**
 * Newest qualifying event for the exact active-page hostname inside the live
 * evidence window. `pageSite` is browser-derived at the service-worker boundary;
 * legacy rows fall back to their emitting `site`. Imported future timestamps are
 * rejected rather than allowed to pin the gauge indefinitely.
 */
function pickCurrentPageEvent<T extends EventLogEntry>(
  log: EventLogEntry[],
  activeTabUrl: string,
  now: number,
  match: (event: EventLogEntry) => event is T,
): T | null {
  const host = activePageHost(activeTabUrl);
  if (!host || !Number.isFinite(now)) return null;

  const oldestAcceptedTs = now - POPUP_CURRENT_PAGE_MAX_EVENT_AGE_MS;
  const entries = log ?? [];
  let newest: T | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const event = entries[i];
    if (!event || !match(event)) continue;
    if (
      !Number.isFinite(event.ts) ||
      event.ts < oldestAcceptedTs ||
      event.ts > now
    ) {
      continue;
    }

    const eventHost =
      normalizeEventPageSite(event.pageSite) ?? normalizeEventPageSite(event.site);
    if (eventHost !== host) continue;

    // Imported backups preserve payload order, and delayed delivery can append an
    // older-created event later. Timestamp is the evidence clock; reverse array
    // order is used only as a deterministic tie-breaker for equal timestamps.
    if (!newest || event.ts > newest.ts) newest = event;
  }

  return newest;
}

/**
 * Risk state for the popup's "Current page" surface (#215).
 *
 * Unlike the legacy domain-history helper, this is scoped to the active tab's
 * exact HTTP(S) hostname and a bounded recency window. It preserves the existing
 * scored-first contract: a later scoreless alert cannot erase a scored decision.
 */
export function derivePopupCurrentPageRisk(
  log: EventLogEntry[],
  activeTabUrl: string,
  now = Date.now(),
): PopupTabRisk {
  const scored = pickCurrentPageEvent(log, activeTabUrl, now, isGaugeScoredEvent);
  if (scored) {
    return {
      tabRisk: typeof scored.score === "number" ? scored.score : 0,
      reasons: scored.reasons,
      state: "scored",
      threatKind: undefined,
    };
  }

  const threat = pickCurrentPageEvent(log, activeTabUrl, now, isUnscoredThreatEvent);
  if (threat) {
    return {
      tabRisk: 0,
      reasons: threat.reasons,
      state: "unscored-threat",
      threatKind: threat.kind,
    };
  }

  return {
    tabRisk: 0,
    reasons: undefined,
    state: "clear",
    threatKind: undefined,
  };
}
