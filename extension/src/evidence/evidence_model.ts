import type { EventKind, EventLogEntry } from "../shared/storage";
import { normalizeEventPageSite } from "../shared/storage";
import { isKnownReasonCode } from "../shared/explanations";

/** Explicit wire vocabulary. A new runtime event needs deliberate export review. */
export const EVIDENCE_KINDS = [
  "nav_blank_prompt", "nav_click_block", "nav_silent_allow", "nav_rollback",
  "nav_allowlist_add", "nav_allowlist_remove", "cred_submit_prompt",
  "cred_submit_allow_once", "cred_trust_domain", "cred_untrust_domain",
  "cred_paste_warn", "cred_form_evaluated", "suite_config_update",
  "clickfix_detected", "dblclickjack_detected", "nav_reputation_late_warn",
  "mutation_alert", "pushstate_abuse", "bridge_buffer_overflow",
] as const satisfies readonly EventKind[];
const kinds = new Set<string>(EVIDENCE_KINDS);
export const MAX_EVIDENCE_EVENTS = 5000;

export interface EvidenceEvent {
  id: string;
  timestamp: string;
  kind: EventKind;
  sourceSite: string | null;
  destinationSite: string | null;
  outcome: "recorded";
  reasons: string[];
  score?: number;
}
export interface EvidenceExport {
  format: "navsentinel-evidence";
  schema: 1;
  exportedAt: string;
  source: "navsentinel-extension";
  evidence: "recorded-observation";
  events: EvidenceEvent[];
}

/** Accept hostname metadata only: never turn an arbitrary URL into exportable text. */
export function evidenceHostname(value: unknown): string | null {
  // The portable format remains stricter than backup import about whitespace.
  // Reuse the hostname/IP validator rather than adding a second URL parser.
  if (typeof value !== "string" || value !== value.trim()) return null;
  return normalizeEventPageSite(value) ?? null;
}

/** New objects from a strict allowlist; never spread stored/caller-owned entries. */
export function projectEvidence(log: readonly EventLogEntry[]): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];
  for (const entry of log.slice(-MAX_EVIDENCE_EVENTS)) {
    if (!entry || !kinds.has(entry.kind) || !Number.isFinite(entry.ts)) continue;
    const date = new Date(entry.ts);
    if (!Number.isFinite(date.getTime())) continue;
    const event: EvidenceEvent = {
      id: `event-${events.length + 1}`,
      timestamp: date.toISOString(),
      kind: entry.kind,
      sourceSite: evidenceHostname(entry.pageSite) ?? evidenceHostname(entry.site),
      destinationSite: evidenceHostname(entry.destHost),
      outcome: "recorded",
      reasons: Array.isArray(entry.reasons)
        ? [...new Set(entry.reasons.filter(code => typeof code === "string" && isKnownReasonCode(code)))].slice(0, 16)
        : [],
    };
    if (typeof entry.score === "number" && Number.isFinite(entry.score) && entry.score >= 0 && entry.score <= 100) event.score = entry.score;
    events.push(event);
  }
  // Retention remains insertion-bounded above. Within that retained snapshot,
  // imported timestamps determine chronology; stable ties keep insertion order.
  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function createEvidenceExport(events: readonly EvidenceEvent[], now = new Date()): EvidenceExport {
  // Re-project even a caller-supplied view so export cannot inherit extra fields.
  const projected = projectEvidence(events.map(event => ({
    id: "", ts: Date.parse(event.timestamp), kind: event.kind,
    ...(event.sourceSite === null ? {} : { site: event.sourceSite }),
    ...(event.destinationSite === null ? {} : { destHost: event.destinationSite }),
    reasons: event.reasons, ...(event.score === undefined ? {} : { score: event.score }),
  })));
  return { format: "navsentinel-evidence", schema: 1, exportedAt: now.toISOString(),
    source: "navsentinel-extension", evidence: "recorded-observation", events: projected };
}

export type EvidenceCategory = "all" | "navigation" | "credential" | "activity";
export function evidenceCategory(kind: EventKind): Exclude<EvidenceCategory, "all"> {
  return kind.startsWith("cred_") ? "credential" : kind.startsWith("nav_") ? "navigation" : "activity";
}
export function filterEvidence(events: readonly EvidenceEvent[], query: string, category: EvidenceCategory, scoredOnly: boolean): EvidenceEvent[] {
  const needle = query.trim().toLowerCase().slice(0, 253);
  return events.filter(event =>
    (category === "all" || evidenceCategory(event.kind) === category) &&
    (!scoredOnly || event.score !== undefined) &&
    (!needle || [event.sourceSite, event.destinationSite].some(host => host?.includes(needle)))
  ).slice().reverse();
}
export function summarizeEvidence(events: readonly EvidenceEvent[]): { recorded: number; scored: number; sites: number } {
  return { recorded: events.length, scored: events.filter(event => event.score !== undefined).length,
    sites: new Set(events.flatMap(event => [event.sourceSite, event.destinationSite].filter((site): site is string => site !== null))).size };
}
export function eventTitle(kind: EventKind): string {
  return kind.replace(/^nav_/, "navigation_").replace(/^cred_/, "credential_").replace(/^suite_/, "settings_").replaceAll("_", " ");
}
