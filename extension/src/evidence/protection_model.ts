import { isEventLogAppendMessage, type EventLogEntry } from "../shared/storage";
import { computeOverlayAutoDismissStats } from "../options/options_model";
import { MAX_EVIDENCE_EVENTS, projectEvidence, type EvidenceEvent } from "./evidence_model";

export const PROTECTION_CATEGORIES = ["overlays", "clicks", "redirects", "warnings", "corrections"] as const;
export type ProtectionCategory = typeof PROTECTION_CATEGORIES[number];
export type ProtectionRange = "history" | "today";
export interface ProtectionEvent extends EvidenceEvent {
  activity: ProtectionCategory | "other";
  activityDetail: string;
}

/** Priority matters: a cleanup accompanying a held click belongs to one total. */
function classify(entry: EventLogEntry): Pick<ProtectionEvent, "activity" | "activityDetail"> {
  const reasons = entry.reasons ?? [];
  const extra = entry.extra;
  if (entry.kind === "mutation_alert" && (reasons.includes("overlay_cleanup_undo") || reasons.includes("overlay_cleanup_setting_off"))) {
    const action = reasons.includes("overlay_cleanup_undo") ? "Undo requested." : "Cleanup turned off.";
    const result = extra?.restored === true ? "Restoration was reported successful."
      : extra?.restored === false ? "Restoration was not confirmed." : "Restoration result is unavailable in this record.";
    return { activity: "corrections", activityDetail: `${action} ${result}` };
  }
  if (["nav_allowlist_add", "nav_allowlist_remove", "cred_submit_allow_once", "cred_trust_domain", "cred_untrust_domain"].includes(entry.kind)) {
    return { activity: "corrections", activityDetail: "User choice, not proof that an earlier warning was wrong." };
  }
  const cleanupOutcome = extra?.overlayCleanupOutcome;
  if (entry.kind === "mutation_alert" && (cleanupOutcome === "reasserted" || cleanupOutcome === "already_hidden")) {
    return { activity: "other", activityDetail: "Cleanup already active or reasserted; not a new intervention." };
  }
  if ((cleanupOutcome === undefined || cleanupOutcome === "suppressed") && computeOverlayAutoDismissStats([entry]).total === 1) {
    return { activity: "overlays", activityDetail: "Overlay cleanup recorded; this record's held click or popup counts here only." };
  }
  if (entry.kind === "nav_click_block") return { activity: "clicks", activityDetail: "The navigation guard held a click." };
  if (entry.kind === "nav_blank_prompt" || entry.kind === "nav_rollback") {
    return { activity: "redirects", activityDetail: entry.kind === "nav_rollback" ? "A navigation rollback was recorded." : "New-tab or popup navigation held for a decision." };
  }
  if (["cred_paste_warn", "clickfix_detected", "nav_reputation_late_warn"].includes(entry.kind) ||
    (entry.kind === "mutation_alert" && (extra?.overlayCleanupOutcome === "budget_exhausted" ||
      (extra?.overlayAutoDismissed !== true && extra?.severity === "high" && reasons.some(reason => reason === "overlay_detected" || reason === "overlay_injected"))))) {
    return { activity: "warnings", activityDetail: "Warning recorded without a block in this record." };
  }
  return { activity: "other", activityDetail: "Observation; outside the activity totals." };
}

/** Display-only projection. Existing IDs deduplicate; none leave through export. */
export function projectProtection(log: readonly unknown[]): { events: ProtectionEvent[]; excluded: number; duplicates: number } {
  const retained = log.slice(-MAX_EVIDENCE_EVENTS);
  const unique = new Map<string, EventLogEntry>();
  let excluded = log.length - retained.length;
  let duplicates = 0;
  for (const candidate of retained) {
    if (!isEventLogAppendMessage({ type: "ns-event-log-append", entry: candidate })) { excluded++; continue; }
    const entry = candidate as EventLogEntry;
    if (!entry.id.trim() || !Number.isFinite(new Date(entry.ts).getTime())) { excluded++; continue; }
    // Last retained valid row wins, including a correction replacing a block.
    if (unique.delete(entry.id)) duplicates++;
    unique.set(entry.id, entry);
  }
  const events: ProtectionEvent[] = [];
  for (const entry of unique.values()) {
    const event = projectEvidence([entry])[0];
    if (!event) { excluded++; continue; }
    events.push({ ...event, id: `event-${events.length + 1}`, ...classify(entry) });
  }
  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { events, excluded, duplicates };
}

export function inProtectionRange(event: EvidenceEvent, range: ProtectionRange, now: Date): boolean {
  const timestamp = Date.parse(event.timestamp);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Number.isFinite(timestamp) && timestamp <= now.getTime() && (range === "history" || timestamp >= start.getTime());
}

export function summarizeProtection(events: readonly ProtectionEvent[], range: ProtectionRange, now = new Date()): Record<ProtectionCategory, number> {
  const counts = { overlays: 0, clicks: 0, redirects: 0, warnings: 0, corrections: 0 };
  for (const event of events) {
    if (event.activity !== "other" && inProtectionRange(event, range, now)) counts[event.activity]++;
  }
  return counts;
}
