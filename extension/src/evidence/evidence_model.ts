import type { EventKind, EventLogEntry } from "../shared/storage";
import { normalizeEventPageSite } from "../shared/storage";
import { isKnownReasonCode } from "../shared/explanations";
import { isJournalReasonCode, isOverlayReviewReasonCode } from "./evidence_reasons";

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
/** Scores above this are corrupt, not diminished NRS; same bound as the popup gauge. */
const MAX_PLAUSIBLE_EVENT_SCORE = 1000;

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

/**
 * New objects from a strict allowlist; never spread stored/caller-owned entries.
 * Reasons keep only codes from a finite registry: the journal keeps every code
 * it can explain, and the export passes the portable registry instead (#867).
 */
export function projectEvidence(log: readonly EventLogEntry[], isReasonCode: (code: string) => boolean = isJournalReasonCode): EvidenceEvent[] {
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
        ? [...new Set(entry.reasons.filter(code => typeof code === "string" && isReasonCode(code)))].slice(0, 16)
        : [],
    };
    // computeNRS applies diminishing returns above 100 instead of clamping, so real
    // blocks journal scores such as 104. Show them as 100, as the popup gauge does
    // (#715), and keep the export inside the Lab importer's 0-100 range. (#883)
    if (typeof entry.score === "number" && Number.isFinite(entry.score) && entry.score >= 0 && entry.score <= MAX_PLAUSIBLE_EVENT_SCORE) {
      event.score = Math.min(100, entry.score);
    }
    events.push(event);
  }
  // Retention remains insertion-bounded above. Within that retained snapshot,
  // imported timestamps determine chronology; stable ties keep insertion order.
  return events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function createEvidenceExport(events: readonly EvidenceEvent[], now = new Date()): EvidenceExport {
  // Re-project even a caller-supplied view so export cannot inherit extra fields.
  // Only portable registry codes leave the browser: journal-only codes (credential
  // risk and similar) are shown locally but are outside the Lab importer's vocabulary.
  const projected = projectEvidence(events.map(event => ({
    id: "", ts: Date.parse(event.timestamp), kind: event.kind,
    ...(event.sourceSite === null ? {} : { site: event.sourceSite }),
    ...(event.destinationSite === null ? {} : { destHost: event.destinationSite }),
    reasons: event.reasons, ...(event.score === undefined ? {} : { score: event.score }),
  })), isKnownReasonCode);
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

// ---------------------------------------------------------------------------
// Overlay cleanup review queue (#591)
// ---------------------------------------------------------------------------

/** Finite local-review outcomes. Stored `budget_exhausted` reads as `budget_limited`. */
export const OVERLAY_REVIEW_OUTCOMES = [
  "suppressed",
  "reasserted",
  "already_hidden",
  "budget_limited",
  "restored",
  "user_reported_miss",
  "observed",
] as const;
export type OverlayReviewOutcome = (typeof OVERLAY_REVIEW_OUTCOMES)[number];

export interface OverlayReviewItem {
  /** Local-only key for labeling; never enters the diagnostic payload. */
  entryId: string;
  timestamp: string;
  outcome: OverlayReviewOutcome;
  reasons: string[];
  frame: "top" | "child" | "unknown";
  positionBucket: string;
  coverageBucket: string;
  stackingBucket: string;
  label?: "should_block" | "should_allow";
}

const OVERLAY_REVIEW_BUCKETS = new Set([
  "fixed", "absolute", "sticky",
  "quarter_to_half", "half_to_full", "full_or_more",
  "elevated", "high", "topmost", "unknown",
]);

function reviewFrame(value: unknown): OverlayReviewItem["frame"] {
  return value === "top" || value === "child" ? value : "unknown";
}

function reviewBucket(value: unknown): string {
  return typeof value === "string" && OVERLAY_REVIEW_BUCKETS.has(value) ? value : "unknown";
}

function safeField(value: unknown, key: string): unknown {
  try {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeStringReasons(entry: unknown): string[] {
  const value = safeField(entry, "reasons");
  if (!Array.isArray(value)) return [];
  const reasons: string[] = [];
  try {
    for (const code of value) if (typeof code === "string") reasons.push(code);
  } catch {
    return [];
  }
  return reasons;
}

function reviewOutcomeForEntry(entry: EventLogEntry): OverlayReviewOutcome | null {
  if (!entry || safeField(entry, "kind") !== "mutation_alert") return null;
  const extra = safeField(entry, "extra");
  try {
    const raw = safeField(extra, "overlayCleanupOutcome");
    if (raw === "suppressed") return "suppressed";
    if (raw === "reasserted") return "reasserted";
    if (raw === "already_hidden") return "already_hidden";
    if (raw === "budget_exhausted") return "budget_limited";
    if (raw === "restored") return "restored";
    if (raw === "user_reported_miss") return "user_reported_miss";
  } catch {
    return "observed";
  }
  try {
    const reasons = safeStringReasons(entry);
    if (reasons.includes("overlay_user_reported_miss")) return "user_reported_miss";
    if (reasons.includes("overlay_cleanup_undo") || reasons.includes("overlay_cleanup_setting_off")) return "restored";
    if (reasons.some((r) => r === "overlay_detected" || r === "overlay_injected")) return "observed";
  } catch {
    return null;
  }
  return null;
}

/**
 * Explicit projection for the local overlay review queue. Never spreads or
 * serializes the stored entry: only finite outcomes, journal reason codes,
 * coarse buckets, timestamps, and local labels. URLs, hostnames, details,
 * scores, and internal IDs (beyond the local labeling key) are omitted.
 * Labels are local-only and never inflate protection metrics.
 */
export function projectOverlayReviews(
  log: readonly EventLogEntry[],
  isReasonCode: (code: string) => boolean = isOverlayReviewReasonCode,
): OverlayReviewItem[] {
  const items: OverlayReviewItem[] = [];
  for (const entry of log.slice(-MAX_EVIDENCE_EVENTS)) {
    const ts = safeField(entry, "ts");
    if (!entry || safeField(entry, "kind") !== "mutation_alert" || typeof ts !== "number" || !Number.isFinite(ts)) continue;
    const entryReasons = safeStringReasons(entry);
    if (!entryReasons.some(isOverlayReviewReasonCode)) continue;
    const outcome = reviewOutcomeForEntry(entry as EventLogEntry);
    if (!outcome) continue;
    const date = new Date(ts);
    if (!Number.isFinite(date.getTime())) continue;
    const extra = safeField(entry, "extra");
    const candidateDiag = safeField(extra, "overlayDiag");
    const diag = typeof candidateDiag === "object" && candidateDiag !== null && !Array.isArray(candidateDiag)
      ? candidateDiag
      : undefined;
    const candidateLabel = safeField(extra, "overlayReviewLabel");
    const label = candidateLabel === "should_block" || candidateLabel === "should_allow" ? candidateLabel : undefined;
    const seenReasons = new Set<string>();
    const reasons: string[] = [];
    for (const code of entryReasons) {
      if (reasons.length >= 8) break;
      try {
        if (isReasonCode(code) && !seenReasons.has(code)) {
          seenReasons.add(code);
          reasons.push(code);
        }
      } catch {
        // An injected reason predicate must not make a local projection fail.
      }
    }
    const id = safeField(entry, "id");
    const item = {
      timestamp: date.toISOString(),
      outcome,
      reasons,
      frame: reviewFrame(safeField(diag, "frame")),
      positionBucket: reviewBucket(safeField(diag, "positionBucket")),
      coverageBucket: reviewBucket(safeField(diag, "coverageBucket")),
      stackingBucket: reviewBucket(safeField(diag, "stackingBucket")),
      ...(label === undefined ? {} : { label }),
    } as OverlayReviewItem;
    // Keep the row key available to the local label action without exposing it
    // through ordinary serialization, logs, or diagnostic projections.
    Object.defineProperty(item, "entryId", {
      value: typeof id === "string" ? id.slice(0, 256) : `review-${items.length + 1}`,
      enumerable: false,
    });
    items.push(item);
  }
  return items.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

/** Human-readable outcome for the review queue; budget wording stays user-facing. */
export function overlayReviewOutcomeLabel(outcome: OverlayReviewOutcome): string {
  if (outcome === "budget_limited") return "Budget-limited";
  if (outcome === "already_hidden") return "Already hidden";
  if (outcome === "user_reported_miss") return "Reported miss";
  if (outcome === "observed") return "Observed";
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}
