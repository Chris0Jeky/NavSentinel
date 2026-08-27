import type { Mode } from "./types";
import { ALLOWLIST_KEY, getAllowlist, normalizeAllowlist, type Allowlist } from "./allowlist";
import { getRegistrableDomain, hostForUrl, normalizeHost, safeUrlParse } from "./domain";
import {
  ADAPTIVE_SCORES_KEY,
  clearAdaptiveScoresDirect,
  computeAdaptiveScoreMap,
  type DomainAdjustment,
} from "./adaptive_scoring";
import { NRS_BLOCK_THRESHOLD, NRS_STRICT_BLOCK_THRESHOLD } from "./nrs";
import type { ClickContext, ElementHint } from "./scoring";

export type CredMode = "off" | "smart" | "strict";

export interface NavSettings {
  defaultMode: Mode;
  debug: boolean;
}

export interface CredentialSettings {
  mode: CredMode;
  promptOnUntrustedDomain: boolean;
  promptOnMediumRisk: boolean;
  mediumRiskThreshold: number;
  blockHttpPasswordSubmit: boolean;
  warnOnPaste: boolean;
  similarity: {
    enabled: boolean;
    maxDistance: number;
  };
}

export interface SuiteSettings {
  nav: NavSettings;
  credential: CredentialSettings;
  logLimit: number;
}

export type SuiteSettingsPatch = Partial<Omit<SuiteSettings, "nav" | "credential">> & {
  nav?: Partial<NavSettings>;
  credential?: Partial<Omit<CredentialSettings, "similarity">> & {
    similarity?: Partial<CredentialSettings["similarity"]>;
  };
};

export const SUITE_SETTINGS_KEY = "sentinelsuite:settings_v1";
export const TRUSTED_DOMAINS_KEY = "sentinelsuite:trusted_domains_v1";
export const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";
export const PROMPT_OUTCOMES_KEY = "sentinelsuite:prompt_outcomes_v1";
const LEGACY_SETTINGS_KEY = "navsentinel:settings";

export type PromptType = "nav" | "cred";
export type PromptOutcome = "allow" | "allow_once" | "always_allow" | "block" | "trust" | "dismiss" | "cancel";

export interface PromptOutcomeEntry {
  id: string;
  ts: number;
  domain: string;
  destDomain?: string;
  type: PromptType;
  score: number;
  outcome: PromptOutcome;
  /** Reason codes behind the decision. Populated on BOTH nav and cred paths
   *  (P5-C1 fixed the prior inconsistency where the nav path dropped them). */
  reasons?: string[];

  // --- Replay-grade feature vector (P5-C1 / #238). All optional for backward
  // compatibility: older records and the main-world bridge prompt path omit them.
  // These capture the decision inputs/outputs so a stored record can be
  // offline re-scored to reproduce the live decision (advisor journal + tuning
  // corpus). Nav-decision fields; the cred path leaves the scorer-specific ones
  // unset. ElementHint context carries only structural DOM signals (tags, roles,
  // capped name *lengths*, dims, styles) — no text content, URLs, or PII.
  /** CDS sub-score at decision time (nav). */
  cds?: number;
  /** NRS factor names that contributed (nav). */
  nrsFactors?: string[];
  /** Navigation-anomaly contribution (nav). */
  navAnomalyScore?: number;
  /** Adaptive threshold adjustment applied at decision time (nav). */
  adaptiveAdj?: number;
  /** Effective block threshold used for the decision = base + adaptiveAdj (nav). */
  thresholdUsed?: number;
  /** Serialized click context (top/underlying ElementHint, viewport, input) for
   *  offline computeCDS replay (nav). */
  elementContext?: ClickContext;
}

// Bounds for the enriched fields so a buggy/hostile caller can't bloat a record.
const MAX_REASON_CODES = 32;
const MAX_REASON_CODE_LEN = 80;
// Bounds for imported EventLogEntry content (#299). isEventLogEntry validates SHAPE, not SIZE,
// so a crafted backup could otherwise persist megabytes (e.g. extra:{x:'A'.repeat(5e6)}) into the
// shared chrome.storage.local quota. URLs can legitimately run long, so the string cap is generous.
const MAX_EVENT_STRING_LEN = 2048;
const MAX_EVENT_EXTRA_BYTES = 4096;
// Max plausible viewport/element dimension in CSS px (generous; covers 8K/multi-
// monitor). Defends persisted replay records against extreme/negative values.
const MAX_CLICK_CONTEXT_DIM = 32000;

/**
 * Replay-grade enrichment (P5-C1 / #238) attached to a nav PromptOutcome — the
 * subset of PromptOutcomeEntry the nav decision path can populate. Lives here
 * (not in the all-frames content-script chunk) so the heavy content bundle stays
 * lean; capture_isolated only references it. Build it from the LOCAL decision
 * scope at decision time, NOT from a global debug snapshot.
 */
export type NavOutcomeFeatures = Pick<
  PromptOutcomeEntry,
  "reasons" | "cds" | "nrsFactors" | "navAnomalyScore" | "adaptiveAdj" | "thresholdUsed" | "elementContext"
>;

/**
 * Select which replay fields to attach to a nav outcome record, omitting empty
 * or absent signals so thin records stay lean. `appendPromptOutcome` still
 * sanitizes/bounds whatever this passes; this only decides inclusion. Pure +
 * side-effect-free for unit-testability.
 */
export function buildNavOutcomeFeatures(input: {
  reasonCodes?: string[];
  nrsFactors?: string[];
  cds?: number;
  navAnomalyScore?: number;
  adaptiveAdj?: number;
  thresholdUsed: number;
  ctx?: ClickContext;
}): NavOutcomeFeatures {
  const out: NavOutcomeFeatures = { thresholdUsed: input.thresholdUsed };
  if (input.reasonCodes && input.reasonCodes.length > 0) out.reasons = input.reasonCodes;
  if (input.nrsFactors && input.nrsFactors.length > 0) out.nrsFactors = input.nrsFactors;
  if (typeof input.cds === "number" && Number.isFinite(input.cds)) out.cds = input.cds;
  if (typeof input.navAnomalyScore === "number" && input.navAnomalyScore > 0) out.navAnomalyScore = input.navAnomalyScore;
  if (typeof input.adaptiveAdj === "number" && Number.isFinite(input.adaptiveAdj)) out.adaptiveAdj = input.adaptiveAdj;
  if (input.ctx) out.elementContext = input.ctx;
  return out;
}

const DEFAULT_SUITE_SETTINGS: SuiteSettings = {
  nav: {
    defaultMode: "smart",
    debug: false
  },
  credential: {
    mode: "smart",
    promptOnUntrustedDomain: true,
    promptOnMediumRisk: true,
    mediumRiskThreshold: 40,
    blockHttpPasswordSubmit: true,
    warnOnPaste: true,
    similarity: {
      enabled: true,
      maxDistance: 2
    }
  },
  logLimit: 300
};

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;
  return Math.max(min, Math.min(max, n));
}

// RI-05 retired the test-only DNR backstop, but installed profiles still hold its
// `dnrEnabled` flag inside the stored nav settings. Rebuild nav from known fields
// only so the retired flag is dropped instead of being spread forward and
// re-persisted by the next settings write. No runtime code reads it.
//
// RI-07 relies on the same allow-list rebuild: an upgrading profile that carries an
// unrecognised nav flag (e.g. a `jsBehavior*` capability flag from a local or future
// build) cannot survive a settings read and cannot re-enable JavaScript-behaviour
// instrumentation. That capability is a build-time release-profile decision, so no
// stored value participates in it at all.
function mergeNavSettings(cur: NavSettings, partial: Partial<NavSettings> | undefined): NavSettings {
  const merged = { ...cur, ...(partial ?? {}) };
  return { defaultMode: merged.defaultMode, debug: merged.debug };
}

function mergeSuiteSettings(cur: SuiteSettings, partial: SuiteSettingsPatch): SuiteSettings {
  const next: SuiteSettings = {
    ...cur,
    ...partial,
    nav: mergeNavSettings(cur.nav, partial.nav),
    credential: {
      ...cur.credential,
      ...(partial.credential ?? {}),
      similarity: { ...cur.credential.similarity, ...(partial.credential?.similarity ?? {}) }
    }
  };

  next.logLimit = clampInt(next.logLimit, 50, 5000, DEFAULT_SUITE_SETTINGS.logLimit);
  next.credential.mediumRiskThreshold = clampInt(
    next.credential.mediumRiskThreshold,
    0,
    100,
    DEFAULT_SUITE_SETTINGS.credential.mediumRiskThreshold
  );
  next.credential.similarity.maxDistance = clampInt(
    next.credential.similarity.maxDistance,
    0,
    8,
    DEFAULT_SUITE_SETTINGS.credential.similarity.maxDistance
  );

  return next;
}

type SettingsRecord = Record<string, unknown>;

/** Parse an Options numeric control without converting an empty field to zero. */
export function parseOptionsInt(value: string, fallback: number): number {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function reconcileSettings(
  baseline: SettingsRecord,
  draft: SettingsRecord,
  incoming?: SettingsRecord,
): SettingsRecord {
  const result: SettingsRecord = incoming ? structuredClone(incoming) as SettingsRecord : {};
  for (const key in draft) {
    const value = draft[key];
    if (value && typeof value === "object") {
      const nested = reconcileSettings(
        baseline[key] as SettingsRecord,
        value as SettingsRecord,
        incoming && incoming[key] as SettingsRecord | undefined,
      );
      if (incoming || Object.keys(nested).length) result[key] = nested;
    } else if (value !== baseline[key]) {
      result[key] = value;
    }
  }
  return result;
}

/** Return the smallest explicit leaf patch that makes `baseline` match `draft`. */
export function deriveOptionsSettingsPatch(baseline: SuiteSettings, draft: SuiteSettings): SuiteSettingsPatch {
  return reconcileSettings(baseline as unknown as SettingsRecord, draft as unknown as SettingsRecord) as SuiteSettingsPatch;
}

/** Preserve dirty leaves while adopting an external normalized settings update. */
export function rebaseOptionsSettingsDraft(
  baseline: SuiteSettings,
  draft: SuiteSettings,
  incoming: SuiteSettings,
): SuiteSettings {
  return reconcileSettings(
    baseline as unknown as SettingsRecord,
    draft as unknown as SettingsRecord,
    incoming as unknown as SettingsRecord,
  ) as unknown as SuiteSettings;
}

export async function getSuiteSettings(): Promise<SuiteSettings> {
  const res = await chrome.storage.local.get([SUITE_SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  const stored = res[SUITE_SETTINGS_KEY] as SuiteSettings | undefined;
  if (!stored || typeof stored !== "object") {
    const legacy = res[LEGACY_SETTINGS_KEY] as Partial<NavSettings> | undefined;
    if (legacy && typeof legacy === "object") {
      const migrated = mergeSuiteSettings(structuredClone(DEFAULT_SUITE_SETTINGS), { nav: legacy });
      await chrome.storage.local.set({ [SUITE_SETTINGS_KEY]: migrated });
      await chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
      return migrated;
    }
    return structuredClone(DEFAULT_SUITE_SETTINGS);
  }
  return mergeSuiteSettings(structuredClone(DEFAULT_SUITE_SETTINGS), stored);
}

let settingsPending: Promise<unknown> = Promise.resolve();

export function updateSuiteSettings(partial: SuiteSettingsPatch): Promise<SuiteSettings> {
  // Serialize the read-modify-write so rapid concurrent updates (e.g. the popup nav-mode and
  // cred-mode toggles fired in quick succession, or a double-tap on one segment) don't both read
  // the same state and have the second write silently clobber the first's change. (#305)
  const next = settingsPending.then(async (): Promise<SuiteSettings> => {
    const cur = await getSuiteSettings();
    const merged = mergeSuiteSettings(cur, partial);
    await chrome.storage.local.set({ [SUITE_SETTINGS_KEY]: merged });
    return merged;
  });
  settingsPending = next.catch((err) => {
    console.warn("[NavSentinel] suite settings serialization error:", err);
  });
  return next;
}

export function onSuiteSettingsChange(cb: (s: SuiteSettings) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[SUITE_SETTINGS_KEY];
    if (!change) return;
    const next = (change.newValue as SuiteSettings | undefined) ?? DEFAULT_SUITE_SETTINGS;
    cb(mergeSuiteSettings(structuredClone(DEFAULT_SUITE_SETTINGS), next));
  });
}

export async function getNavSettings(): Promise<NavSettings> {
  const s = await getSuiteSettings();
  return s.nav;
}

export function onNavSettingsChange(cb: (s: NavSettings) => void): void {
  onSuiteSettingsChange((s) => cb(s.nav));
}

export async function getCredentialSettings(): Promise<CredentialSettings> {
  const s = await getSuiteSettings();
  return s.credential;
}


function normalizeTrustedDomain(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const parsed =
    safeUrlParse(trimmed) ??
    // hostForUrl re-brackets a bare IPv6 literal so the authority parses; since
    // normalizeHost emits IPv6 unbracketed, a persisted "2001:db8::1" must
    // round-trip back through this fallback without being dropped (#208 R2).
    (trimmed.includes("://") ? null : safeUrlParse(`https://${hostForUrl(trimmed)}`));
  const host = parsed?.hostname;
  if (!host) return "";
  const normalized = normalizeHost(host);
  if (!normalized) return "";
  return getRegistrableDomain(normalized);
}

function normalizeDomainList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    const d = normalizeTrustedDomain(x);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.sort();
}

export async function getTrustedDomains(): Promise<string[]> {
  const res = await chrome.storage.local.get(TRUSTED_DOMAINS_KEY);
  return normalizeDomainList(res[TRUSTED_DOMAINS_KEY] ?? []);
}

export interface TrustedDomainAddResult {
  domains: string[];
  normalized: string;
  added: boolean;
}

let trustedDomainsPending: Promise<unknown> = Promise.resolve();

// Serialize trusted-domain read-modify-write ops. Each mutator reads the current list
// then writes a derived list; without a queue, two concurrent calls (e.g. the options
// page removing one domain while credential_guard adds another, or a double-tap on the
// "trust this site" control) both read the same base and the second write silently
// clobbers the first -> a lost trust decision. Mirrors updateSuiteSettings (#305 / #339).
function queueTrustedDomainsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = trustedDomainsPending.then(operation);
  trustedDomainsPending = next.catch((err) => {
    console.warn("[NavSentinel] trusted domains serialization error:", err);
  });
  return next;
}

export function addTrustedDomainWithResult(
  domain: string
): Promise<TrustedDomainAddResult | null> {
  return queueTrustedDomainsWrite(async () => {
    const d = normalizeTrustedDomain(domain);
    if (!d) return null;
    const cur = await getTrustedDomains();
    if (cur.includes(d)) {
      return { domains: cur, normalized: d, added: false };
    }
    const next = [...cur, d].sort();
    await chrome.storage.local.set({ [TRUSTED_DOMAINS_KEY]: next });
    return { domains: next, normalized: d, added: true };
  });
}

export async function addTrustedDomain(domain: string): Promise<string[]> {
  const result = await addTrustedDomainWithResult(domain);
  return result ? result.domains : getTrustedDomains();
}

export function removeTrustedDomain(domain: string): Promise<string[]> {
  return queueTrustedDomainsWrite(async () => {
    const d = normalizeTrustedDomain(domain);
    const cur = await getTrustedDomains();
    const next = cur.filter((x) => x !== d);
    await chrome.storage.local.set({ [TRUSTED_DOMAINS_KEY]: next });
    return next;
  });
}

export function clearTrustedDomains(): Promise<void> {
  return queueTrustedDomainsWrite(async () => {
    await chrome.storage.local.set({ [TRUSTED_DOMAINS_KEY]: [] });
  });
}

export type EventKind =
  | "nav_blank_prompt"
  | "nav_click_block"
  | "nav_silent_allow"
  | "nav_rollback"
  | "nav_allowlist_add"
  | "nav_allowlist_remove"
  | "cred_submit_prompt"
  | "cred_submit_allow_once"
  | "cred_trust_domain"
  | "cred_untrust_domain"
  | "cred_paste_warn"
  | "cred_form_evaluated"
  | "suite_config_update"
  | "clickfix_detected"
  | "dblclickjack_detected"
  | "nav_reputation_late_warn"
  | "mutation_alert"
  | "pushstate_abuse"
  | "bridge_buffer_overflow";

const EVENT_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  "nav_blank_prompt",
  "nav_click_block",
  "nav_silent_allow",
  "nav_rollback",
  "nav_allowlist_add",
  "nav_allowlist_remove",
  "cred_submit_prompt",
  "cred_submit_allow_once",
  "cred_trust_domain",
  "cred_untrust_domain",
  "cred_paste_warn",
  "cred_form_evaluated",
  "suite_config_update",
  "clickfix_detected",
  "dblclickjack_detected",
  "nav_reputation_late_warn",
  "mutation_alert",
  "pushstate_abuse",
  "bridge_buffer_overflow",
]);

/**
 * Silent-decision event kinds (P5-B1 / #236): non-alarming records of decisions
 * made WITHOUT a user prompt (silent nav allows, silently-passed credential
 * forms). They populate the reviewable event stream + tuning corpus, but are
 * deliberately excluded from the popup "Current page" gauge (pickSiteRiskEvent)
 * so that a routine silent allow can never mask an earlier scored block on the
 * same domain (preserving the #205 / #214 gauge-accuracy contract). Wiring the
 * gauge to reflect these for the live page is the popup-consumer follow-up
 * (#205 / #214 / #219).
 */
export const SILENT_DECISION_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  "nav_silent_allow",
  "cred_form_evaluated",
]);

/**
 * Threat event kinds that are recorded WITHOUT a risk score (#219).
 *
 * These are real protective actions/alerts, but nothing on their path produces a
 * number: `nav_reputation_late_warn` comes from the late async child-frame
 * reputation check (the synchronous NRS could not include the known-bad factor),
 * `mutation_alert` comes from the DOM monitor, and `nav_rollback` /
 * `nav_blank_prompt` record a navigation that was undone or held rather than
 * scored. The popup gauge is deliberately driven by scored events only
 * (pickSiteRiskEvent), so a site whose ONLY events are these used to read
 * 0/green. The popup renders a distinct unscored-threat gauge state for them
 * instead of inventing a score — see popup_model.derivePopupTabRisk.
 *
 * Deliberately narrow: this is the enumerated set of threat kinds, NOT "every
 * event that happens to lack a score". Routine/benign scoreless kinds
 * (allowlist edits, config updates, trust changes) must never warn.
 * `Extract<EventKind, ...>` ties the union to the EventKind source of truth, so
 * renaming a kind breaks the build here rather than silently emptying the set.
 */
export type UnscoredThreatKind = Extract<
  EventKind,
  "nav_blank_prompt" | "nav_reputation_late_warn" | "nav_rollback" | "mutation_alert"
>;

export const UNSCORED_THREAT_KINDS: ReadonlySet<EventKind> = new Set<UnscoredThreatKind>([
  "nav_blank_prompt",
  "nav_reputation_late_warn",
  "nav_rollback",
  "mutation_alert",
]);

export function isUnscoredThreatKind(kind: EventKind): kind is UnscoredThreatKind {
  return UNSCORED_THREAT_KINDS.has(kind);
}

export interface EventLogEntry {
  id: string;
  ts: number;
  kind: EventKind;
  site?: string;
  url?: string;
  destHost?: string;
  score?: number;
  reasons?: string[];
  extra?: Record<string, unknown>;
}

export type EventLogAppendMessage = { type: "ns-event-log-append"; entry: EventLogEntry };
export type EventLogMigrationMessage = { type: "ns-event-log-migrate" };
export type EventLogControlMessage =
  | { type: "ns-event-log-clear" }
  | { type: "ns-event-log-import-core"; writes: Record<string, unknown> };

export type SuiteImportMessage = { type: "ns-suite-import"; payload: unknown };

export interface ImportAllResult {
  eventLogDropped: number;
}

type SuiteImportResponse =
  | { ok: true; result: ImportAllResult }
  | { ok: false; error: string; code?: "unauthorized" | "partial" };

type EventLogStorageResponse =
  | { ok: true }
  | { ok: false; error: string; code?: "unauthorized" };

/**
 * Retry schedule for page-context writes delegated to the service worker.
 *
 * @internal Exported only for `behavioural_reset.ts`, which lives in its own
 * module so that the clear-all does not drag `domain_profile` into this chunk.
 * Not part of the storage API; do not use from UI or content code.
 */
export const STORAGE_DELEGATE_RETRY_DELAYS_MS = [50, 150, 400];

function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && EVENT_KINDS.has(value as EventKind);
}

function isEventLogEntry(value: unknown): value is EventLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" &&
    typeof entry.ts === "number" &&
    Number.isFinite(entry.ts) &&
    isEventKind(entry.kind) &&
    (entry.site === undefined || typeof entry.site === "string") &&
    (entry.url === undefined || typeof entry.url === "string") &&
    (entry.destHost === undefined || typeof entry.destHost === "string") &&
    (entry.score === undefined || (typeof entry.score === "number" && Number.isFinite(entry.score))) &&
    (entry.reasons === undefined || (Array.isArray(entry.reasons) && entry.reasons.every((reason) => typeof reason === "string"))) &&
    (entry.extra === undefined || (typeof entry.extra === "object" && entry.extra !== null && !Array.isArray(entry.extra)));
}

export function isEventLogAppendMessage(message: unknown): message is EventLogAppendMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Record<string, unknown>;
  return candidate.type === "ns-event-log-append" && isEventLogEntry(candidate.entry);
}

export function isEventLogMigrationMessage(message: unknown): message is EventLogMigrationMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).type === "ns-event-log-migrate"
  );
}

const EVENT_LOG_IMPORT_CORE_KEYS = new Set([
  SUITE_SETTINGS_KEY,
  ALLOWLIST_KEY,
  TRUSTED_DOMAINS_KEY,
  EVENT_LOG_KEY,
  ADAPTIVE_SCORES_KEY,
]);

function isEventLogImportCoreWrites(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const writes = value as Record<string, unknown>;
  return Array.isArray(writes[EVENT_LOG_KEY]) &&
    writes[EVENT_LOG_KEY].every(isEventLogEntry) &&
    Object.keys(writes).every((key) => EVENT_LOG_IMPORT_CORE_KEYS.has(key));
}

export function isEventLogControlMessage(message: unknown): message is EventLogControlMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Record<string, unknown>;
  if (candidate.type === "ns-event-log-clear") return true;
  return candidate.type === "ns-event-log-import-core" && isEventLogImportCoreWrites(candidate.writes);
}

export function isSuiteImportMessage(message: unknown): message is SuiteImportMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).type === "ns-suite-import"
  );
}

const MAX_NORMALIZED_EVENT_LOG_ENTRIES = 5000;

function normalizeEventLogWithMetadata(value: unknown): {
  entries: EventLogEntry[];
  eventLogDropped: number;
} {
  if (!Array.isArray(value)) return { entries: [], eventLogDropped: 0 };
  const validEntries = value.filter(isEventLogEntry);
  return {
    entries: validEntries.slice(-MAX_NORMALIZED_EVENT_LOG_ENTRIES),
    eventLogDropped: Math.max(0, validEntries.length - MAX_NORMALIZED_EVENT_LOG_ENTRIES),
  };
}

function normalizeEventLog(value: unknown): EventLogEntry[] {
  return normalizeEventLogWithMetadata(value).entries;
}

function makeId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getEventLog(): Promise<EventLogEntry[]> {
  const res = await chrome.storage.local.get(EVENT_LOG_KEY);
  return normalizeEventLog(res[EVENT_LOG_KEY]);
}

/**
 * Trim the event log to `limit`, evicting the OLDEST silent-decision events
 * first (P5-B1 / #236). High-frequency silent records (nav_silent_allow /
 * cred_form_evaluated) must never push the rarer loud threat events out of the
 * shared FIFO log — the journal and the popup "Current page" gauge depend on the
 * loud events surviving (preserving the #205 / #214 gauge-accuracy contract).
 * Loud events are only trimmed if loud events alone still exceed the cap. Order
 * is preserved. (Per-store separation is the eventual P5-C4 / #240 end-state.)
 */
export function trimEventLog(entries: EventLogEntry[], limit: number): EventLogEntry[] {
  return trimValidEventLog(normalizeEventLog(entries), limit);
}

/**
 * Silent-eviction trim for entries that are ALREADY shape-validated (no normalizeEventLog pass).
 * Use this when the caller has already normalized — e.g. importAll normalizes then sanitizes each
 * entry, so re-validating inside trimEventLog would be a redundant O(N) pass (#299 R1). The public
 * trimEventLog wrapper above is for raw / storage-read input.
 */
function trimValidEventLog(validEntries: EventLogEntry[], limit: number): EventLogEntry[] {
  if (validEntries.length <= limit) return validEntries;
  let overflow = validEntries.length - limit;
  const kept: EventLogEntry[] = [];
  for (const entry of validEntries) {
    if (overflow > 0 && SILENT_DECISION_KINDS.has(entry.kind)) {
      overflow--;
      continue;
    }
    kept.push(entry);
  }
  return kept.length > limit ? kept.slice(-limit) : kept;
}

type EventLogAppendPartial = Omit<EventLogEntry, "id" | "ts"> & { id?: string; ts?: number };
let eventLogPending: Promise<unknown> = Promise.resolve();
const EVENT_LOG_RESET_TS_KEY = "ns_sw:eventLogResetTs";
let eventLogResetCutoffTs = Number.NEGATIVE_INFINITY;
let eventLogResetHydrate: Promise<void> | null = null;

function queueEventLogWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = eventLogPending.then(operation);
  eventLogPending = next.catch((err) => {
    console.warn("[NavSentinel] event log serialization error:", err);
  });
  return next;
}

type EventLogBarrierStorage = Pick<chrome.storage.StorageArea, "get" | "set">;

// Keep the event-log reset barrier in session storage: a content script can
// retry an append after the service worker that processed a clear/import has
// been reclaimed. The next worker must still recognize that old entry as
// pre-control state. (Firefox MV3 currently has no storage.session shim; this
// remains fail-open across a worker restart there, matching the prompt-outcome
// compatibility limitation tracked under FF-03.)
function getEventLogBarrierStorage(): EventLogBarrierStorage | null {
  const storage = (globalThis as { chrome?: { storage?: { session?: EventLogBarrierStorage } } })
    .chrome?.storage?.session;
  return typeof storage?.get === "function" && typeof storage.set === "function" ? storage : null;
}

function normalizeEventLogResetCutoff(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function hydrateEventLogResetCutoff(): Promise<void> {
  if (eventLogResetHydrate) return eventLogResetHydrate;
  eventLogResetHydrate = (async () => {
    const session = getEventLogBarrierStorage();
    if (!session) return;
    try {
      const res = await session.get(EVENT_LOG_RESET_TS_KEY);
      eventLogResetCutoffTs = Math.max(
        eventLogResetCutoffTs,
        normalizeEventLogResetCutoff(res[EVENT_LOG_RESET_TS_KEY])
      );
    } catch (err) {
      console.warn("[NavSentinel] event-log reset barrier hydration failed:", err);
      throw err;
    }
  })();
  return eventLogResetHydrate;
}

async function setEventLogResetCutoff(ts = Date.now()): Promise<void> {
  eventLogResetCutoffTs = Math.max(eventLogResetCutoffTs, ts);
  const session = getEventLogBarrierStorage();
  if (!session) return;
  try {
    await session.set({ [EVENT_LOG_RESET_TS_KEY]: eventLogResetCutoffTs });
  } catch (err) {
    console.warn("[NavSentinel] event-log reset barrier persist failed:", err);
    throw err;
  }
}

const REDACTED_PATH_SEGMENT = "[redacted]";
const SENSITIVE_PATH_MARKERS = new Set([
  "reset",
  "reset-password",
  "password-reset",
  "invite",
  "invitation",
  "share",
  "verify",
  "verification",
  "confirm",
  "confirmation",
  "magic",
  "magic-link",
  "auth",
  "session",
  "sessions",
  "oauth",
  "oauth2",
  "authorize",
  "authorization",
  "callback",
  "code",
  "token",
  "access-token",
  "id-token",
]);
const UUID_PATH_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_PATH_SEGMENT = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HEX_TOKEN_PATH_SEGMENT = /^[0-9a-f]{32,}$/i;
const BASE64URL_TOKEN_PATH_SEGMENT = /^[A-Za-z0-9_-]{32,}={0,2}$/;

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isLikelyOpaquePathSegment(segment: string): boolean {
  const decoded = decodePathSegment(segment);
  if (!decoded || decoded === REDACTED_PATH_SEGMENT) return false;
  if (
    UUID_PATH_SEGMENT.test(decoded) ||
    JWT_PATH_SEGMENT.test(decoded) ||
    HEX_TOKEN_PATH_SEGMENT.test(decoded)
  ) {
    return true;
  }
  if (!BASE64URL_TOKEN_PATH_SEGMENT.test(decoded)) return false;

  // Require upper, lower, and numeric characters for generic base64url-like
  // values. This keeps readable long slugs and numeric resource IDs useful in
  // the review corpus while still catching common opaque capability tokens.
  return /[A-Z]/.test(decoded) && /[a-z]/.test(decoded) && /\d/.test(decoded);
}

function redactSensitivePathSegments(pathname: string): string {
  const segments = pathname.split("/");
  let redactSensitiveRouteTail = false;

  return segments
    .map((segment) => {
      if (!segment) return segment;
      const marker = decodePathSegment(segment).toLowerCase().replace(/_/g, "-");
      if (SENSITIVE_PATH_MARKERS.has(marker)) {
        // Sensitive routes can carry more than one capability component (for
        // example, /reset/<uid>/<token>). Keep route labels useful, but redact
        // every value segment that follows the first sensitive route marker.
        redactSensitiveRouteTail = true;
        return segment;
      }
      if (redactSensitiveRouteTail) return REDACTED_PATH_SEGMENT;
      return isLikelyOpaquePathSegment(segment) ? REDACTED_PATH_SEGMENT : segment;
    })
    .join("/");
}

/**
 * Reduce an event-log URL to `origin + sanitized pathname`, dropping the query
 * string and fragment and redacting path-borne tokens (RI-06). The event log is
 * a REVIEW/tuning corpus, not a correctness store, and the pages most likely logged
 * (credential/submit) are exactly those
 * that carry reset/magic-link/session/OAuth tokens in the query or fragment — so
 * exact URLs are both unnecessary and a privacy liability here. No consumer reads
 * the query/fragment of an event-log url (options/popup render site/destHost/
 * score/reasons only; the gauge matches on registrable domain), so origin plus
 * a sanitized path suffices everywhere. Host-level fields (site/destHost) are
 * already minimal and left untouched.
 *
 * Robust by contract: undefined/empty pass through unchanged; a parseable URL is
 * reduced via the URL API (which also strips any userinfo in the authority); a
 * non-parseable value (or an opaque/unknown origin) falls back to a sanitized
 * strip from the first `?` or `#` so this NEVER throws and never emits a "null…"
 * origin.
 */
export function minimizeEventUrl(rawUrl: string): string;
export function minimizeEventUrl(rawUrl: string | undefined): string | undefined;
export function minimizeEventUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return rawUrl; // undefined or "" — preserve as-is
  const parsed = safeUrlParse(rawUrl);
  if (parsed) {
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin + redactSensitivePathSegments(parsed.pathname);
    }
    // Opaque and local schemes can carry a document, address, local path, or
    // script before any ?/# delimiter. The event log only needs to identify
    // the non-web scheme, so retain that marker alone.
    return parsed.protocol;
  }
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(rawUrl);
  if (scheme) return `${scheme[1]!.toLowerCase()}:`;
  // Non-parseable input can be a relative URL supplied by an imported legacy
  // backup. Strip the query/fragment and apply the same path-boundary policy
  // without reformatting the rest, so this remains safe and never throws.
  return redactSensitivePathSegments(stripUrlQueryAndFragment(rawUrl));
}

/** Rewrite pre-RI-06 event URLs through the service worker's serialized write lane. */
export function migrateStoredEventLogUrls(): Promise<void> {
  return queueEventLogWrite(async () => {
    const res = await chrome.storage.local.get(EVENT_LOG_KEY);
    const current = normalizeEventLog(res[EVENT_LOG_KEY]);
    let changed = false;
    const minimized = current.map((entry) => {
      if (entry.url === undefined) return entry;
      const url = minimizeEventUrl(entry.url);
      if (url === entry.url) return entry;
      changed = true;
      return { ...entry, url };
    });
    if (changed) {
      await chrome.storage.local.set({ [EVENT_LOG_KEY]: minimized });
    }
  });
}

function stripUrlQueryAndFragment(raw: string): string {
  let end = raw.length;
  const q = raw.indexOf("?");
  if (q >= 0 && q < end) end = q;
  const h = raw.indexOf("#");
  if (h >= 0 && h < end) end = h;
  return raw.slice(0, end);
}

function buildEventLogEntry(partial: EventLogAppendPartial): EventLogEntry {
  return {
    id: partial.id ?? makeId(),
    ts: Number.isFinite(partial.ts) ? (partial.ts as number) : Date.now(),
    kind: partial.kind,
    ...(partial.site !== undefined ? { site: partial.site } : {}),
    // RI-06: persist only origin+path for new entries (drop query+fragment tokens).
    ...(partial.url !== undefined ? { url: minimizeEventUrl(partial.url) } : {}),
    ...(partial.destHost !== undefined ? { destHost: partial.destHost } : {}),
    ...(partial.score !== undefined ? { score: Number.isFinite(partial.score) ? partial.score : 0 } : {}),
    // Sanitize reasons to a bounded string[] (reuses the prompt-outcome helper). A
    // malformed runtime append message could carry non-string reasons; left raw, the
    // entry would fail isEventLogEntry and persistEventLogEntry's re-validation would
    // silently drop it (mistaking the drop for an intentional silent-decision eviction).
    // Sanitizing keeps the entry valid (and bounds per-entry size, cf. #299). (#339)
    ...(partial.reasons !== undefined ? { reasons: sanitizeCodeList(partial.reasons) ?? [] } : {}),
    ...(partial.extra !== undefined ? { extra: partial.extra } : {})
  };
}

async function persistEventLogEntry(entry: EventLogEntry): Promise<void> {
  const settings = await getSuiteSettings();
  const limit = clampInt(settings.logLimit, 50, 5000, DEFAULT_SUITE_SETTINGS.logLimit);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await chrome.storage.local.get(EVENT_LOG_KEY);
    const cur = normalizeEventLog(res[EVENT_LOG_KEY]);
    // trimEventLog (re-normalizes via isEventLogEntry) is kept here as a defense-in-depth
    // gate at the storage-write boundary: buildEventLogEntry sanitizes reasons, but `kind`
    // is not validated there, so a crafted/abnormal entry with a bad kind is dropped at
    // write rather than persisted as junk (it would otherwise sit in storage until the next
    // append re-normalizes it, and — worse — survive `next` only to be filtered by the
    // verify re-read below, burning all 3 retries). The #339 silent-loss is fixed upstream
    // by sanitizing reasons in buildEventLogEntry, so VALID entries are no longer dropped. (#339)
    const next = trimEventLog([...cur.filter((item) => item.id !== entry.id), entry], limit);
    await chrome.storage.local.set({ [EVENT_LOG_KEY]: next });

    // trimEventLog intentionally drops a brand-new silent-decision event when the
    // log is saturated with loud events (loud must win). The set above already
    // persisted the correct log, so that is success — not a failed write. Without
    // this, appendEvent would burn all 3 retries and console.warn on every silent
    // allow once the log fills with loud events. (#236)
    if (!next.some((item) => item.id === entry.id)) return;

    const verify = await chrome.storage.local.get(EVENT_LOG_KEY);
    const verifyLog = normalizeEventLog(verify[EVENT_LOG_KEY]);
    if (verifyLog.some((item) => item.id === entry.id)) {
      return;
    }
  }
  console.warn("[NavSentinel] appendEvent: failed to persist after 3 attempts, id:", entry.id);
}

function appendEventDirect(entry: EventLogEntry): Promise<void> {
  return queueEventLogWrite(async () => {
    await hydrateEventLogResetCutoff();
    // `<=` deliberately rejects the one-millisecond control boundary as well:
    // a delayed/retried message created before a clear/import must never
    // resurrect the prior corpus. An append issued after a queued control is
    // already ordered after it, so only cross-message retries can take this
    // bounded same-ms path.
    if (entry.ts <= eventLogResetCutoffTs) return;
    await persistEventLogEntry(entry);
  });
}

/** @internal Serialized event-log clear lane. Exported for `behavioural_reset.ts`. */
export function clearEventLogDirect(progressMarker?: Record<string, unknown>): Promise<void> {
  return queueEventLogWrite(async () => {
    await hydrateEventLogResetCutoff();
    const resetTs = Date.now();
    // Persist the barrier first so worker termination cannot leave a completed
    // clear without restart protection. If the subsequent local write fails,
    // the conservative cutoff is safe and the surfaced control error is
    // retryable.
    await setEventLogResetCutoff(resetTs);
    // The reset caller supplies its narrowed crash marker in this SAME local
    // storage commit. A worker therefore cannot observe a cleared lane beside
    // an older marker that would replay it after restart.
    await chrome.storage.local.set({ ...progressMarker, [EVENT_LOG_KEY]: [] });
  });
}

function importEventLogCoreDirect(writes: Record<string, unknown>): Promise<void> {
  // Keep settings/allowlist/trusted-domains/event-log in the single storage.set
  // built by importAll. Moving this into the service worker must not turn that
  // existing atomic core import into separate writes.
  return queueEventLogWrite(async () => {
    await hydrateEventLogResetCutoff();
    const resetTs = Date.now();
    // The cutoff is the control time, NOT the newest imported event timestamp:
    // backups can contain future-dated rows, which must not suppress genuinely
    // new runtime events after a successful import.
    await setEventLogResetCutoff(resetTs);
    await chrome.storage.local.set(writes);
  });
}

function shouldDelegateEventLogWrite(): boolean {
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  return !isExtensionServiceWorkerContext() && typeof runtime?.sendMessage === "function";
}

function sendEventLogAppendMessage(message: EventLogAppendMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response?: EventLogStorageResponse) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message ?? "runtime.sendMessage failed"));
          return;
        }
        if (response?.ok) {
          resolve();
          return;
        }
        reject(new Error(response?.error ?? "Event log append failed"));
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

class EventLogRetryableError extends Error {}
class EventLogUnauthorizedError extends Error {}
export class EventLogDeliveryError extends Error {}

function sendEventLogControlMessage(message: EventLogControlMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response?: EventLogStorageResponse) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new EventLogRetryableError(lastError.message ?? "runtime.sendMessage failed"));
          return;
        }
        if (response?.ok) {
          resolve();
          return;
        }
        if (response?.code === "unauthorized") {
          reject(new EventLogUnauthorizedError(response.error));
          return;
        }
        reject(new EventLogRetryableError(response?.error ?? "Event-log control write failed"));
      });
    } catch (err) {
      reject(new EventLogRetryableError(err instanceof Error ? err.message : String(err)));
    }
  });
}

async function delegateEventLogControl(message: EventLogControlMessage): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= STORAGE_DELEGATE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await sendEventLogControlMessage(message);
      return;
    } catch (err) {
      if (err instanceof EventLogUnauthorizedError) throw err;
      lastErr = err;
      const delay = STORAGE_DELEGATE_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await delayMs(delay);
    }
  }
  throw new EventLogDeliveryError("Event-log control write unavailable; refusing an unqueued mutation", {
    cause: lastErr,
  });
}

async function delegateEventLogAppend(message: EventLogAppendMessage): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= STORAGE_DELEGATE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await sendEventLogAppendMessage(message);
      return;
    } catch (err) {
      lastErr = err;
      const delay = STORAGE_DELEGATE_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await delayMs(delay);
    }
  }
  console.warn(
    "[NavSentinel] event log append dropped - service worker unreachable after retries:",
    message.entry.id,
    lastErr
  );
}

export async function appendEvent(partial: EventLogAppendPartial): Promise<void> {
  const entry = buildEventLogEntry(partial);
  if (shouldDelegateEventLogWrite()) {
    return delegateEventLogAppend({ type: "ns-event-log-append", entry });
  }
  return appendEventDirect(entry);
}

export async function handleEventLogAppendMessage(message: EventLogAppendMessage): Promise<EventLogStorageResponse> {
  try {
    // Re-build through buildEventLogEntry so the entry is sanitized at the SW trust
    // boundary too. The normal sender already calls buildEventLogEntry before delegating,
    // but isEventLogAppendMessage only validates shape (not per-element types), so a
    // crafted message could otherwise carry non-string reasons straight to storage. The
    // rebuild preserves the sender's id/ts. (#339)
    await appendEventDirect(buildEventLogEntry(message.entry));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleEventLogControlMessage(
  message: EventLogControlMessage,
  sender?: chrome.runtime.MessageSender
): Promise<EventLogStorageResponse> {
  // A content script runs on arbitrary web pages and therefore may append only.
  // Clear/import replace the whole event corpus, so accept them only from this
  // extension's options/popup pages (the same authorization boundary as prompt
  // outcome clear/replace).
  if (!isTrustedExtensionPageSender(sender)) {
    return {
      ok: false,
      error: "Unauthorized event-log mutation from untrusted sender",
      code: "unauthorized",
    };
  }
  try {
    if (message.type === "ns-event-log-clear") {
      await clearEventLogDirect();
    } else {
      await importEventLogCoreDirect(message.writes);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function clearEventLog(): Promise<void> {
  if (shouldDelegateEventLogWrite()) {
    return delegateEventLogControl({ type: "ns-event-log-clear" });
  }
  return clearEventLogDirect();
}

const PROMPT_OUTCOMES_LIMIT = 500;
const PROMPT_OUTCOME_RESET_TS_KEY = "ns_sw:promptOutcomeResetTs";
let promptOutcomePending: Promise<unknown> = Promise.resolve();
let promptOutcomeResetCutoffTs = Number.NEGATIVE_INFINITY;
let promptOutcomeResetHydrate: Promise<void> | null = null;

export async function getPromptOutcomes(): Promise<PromptOutcomeEntry[]> {
  const res = await chrome.storage.local.get(PROMPT_OUTCOMES_KEY);
  const log = res[PROMPT_OUTCOMES_KEY];
  return boundPromptOutcomeLog(log);
}

/**
 * Reduce a prompt-outcome domain value to the hostname needed by scoring and
 * smart defaults. A stored outcome must never retain a route, query, fragment,
 * or URL userinfo from a caller or imported backup.
 */
function normalizePromptOutcomeHost(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Domains and URLs with embedded control whitespace are malformed. Reject
  // rather than relying on URL's normalization, which can join surrounding
  // text into a hostname.
  if (/\s/.test(trimmed) || hasPromptOutcomeControlCharacter(trimmed)) return "";

  // A bare route or query/fragment is not an authority. Do this before the
  // fallback parser because WHATWG URL can reinterpret `/token` as the host
  // in `https:///token`.
  if (/^[\\/?#]/.test(trimmed) && !trimmed.startsWith("//")) return "";

  if (trimmed.startsWith("//")) {
    if (!hasValidPromptOutcomeUrlAuthority(trimmed.slice(2))) return "";
    const parsed = safeUrlParse(`https:${trimmed}`);
    return parsed?.protocol === "https:" && parsed.hostname ? normalizeHost(parsed.hostname) : "";
  }
  if (trimmed.includes("://")) {
    const schemeSeparator = trimmed.indexOf("://");
    if (!hasValidPromptOutcomeUrlAuthority(trimmed.slice(schemeSeparator + 3))) return "";
    const parsed = safeUrlParse(trimmed);
    return parsed?.hostname && (parsed.protocol === "http:" || parsed.protocol === "https:")
      ? normalizeHost(parsed.hostname)
      : "";
  }

  // A parsed non-authority URI (for example mailto:) is not a host value. Do
  // not reinterpret its opaque payload as a URL authority. The host:port form
  // is the one accepted bare-authority exception.
  const isBareHostPort = /^[^/:?#\s]+:\d+(?:[/?#].*)?$/.test(trimmed);
  if ((trimmed.includes("@") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)) && !isBareHostPort) {
    return "";
  }

  // Bare hostnames, host:port values, and IPv6 literals are accepted for
  // backward compatibility with existing producers and backups. A value with
  // an explicit URI scheme but no authority is intentionally rejected above.
  const authority = safeUrlParse(`https://${hostForUrl(trimmed)}`);
  return authority?.hostname ? normalizeHost(authority.hostname) : "";
}

/**
 * Validate raw text that is meant to be a URL authority before allowing
 * WHATWG URL to parse it. URL's special-scheme parser treats slash/backslash
 * and ASCII control whitespace as delimiters, which can otherwise turn a
 * malformed route token into the parsed hostname.
 */
function hasValidPromptOutcomeUrlAuthority(value: string): boolean {
  const authorityEnd = value.search(/[/?#]/);
  const authority = authorityEnd === -1 ? value : value.slice(0, authorityEnd);
  return authority.length > 0 && !/[\\\s]/.test(authority) && !hasPromptOutcomeControlCharacter(authority);
}

function hasPromptOutcomeControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

export type PromptOutcomeStorageMessage =
  | { type: "ns-prompt-outcome-append"; entry: PromptOutcomeEntry }
  | { type: "ns-prompt-outcome-clear" }
  | { type: "ns-prompt-outcome-reset-adaptive" }
  | { type: "ns-prompt-outcome-replace"; outcomes: PromptOutcomeEntry[] };

type PromptOutcomeStorageResponse =
  | { ok: true }
  | { ok: false; error: string; code?: "unauthorized" };

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((v) => typeof v === "string"));
}

// Cap and string-filter a reason/factor code list. Returns the (possibly empty)
// array when the input is an array, else undefined (so callers can omit it).
// Keeps the writer and the verify-step validator in agreement so a record is
// never written-then-filtered-then-silently-dropped.
function sanitizeCodeList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is string => typeof v === "string")
    .map((s) => (s.length > MAX_REASON_CODE_LEN ? s.slice(0, MAX_REASON_CODE_LEN) : s))
    .slice(0, MAX_REASON_CODES);
}

/**
 * Bound the content of a (shape-valid) imported EventLogEntry so a crafted backup cannot exhaust
 * the shared chrome.storage.local quota (#299). Mirrors the re-sanitization the PromptOutcome
 * import path already does (buildPromptOutcomeRecord): caps the string fields, reuses
 * sanitizeCodeList for reasons, and drops an oversized/unserializable `extra`. Import-only — the
 * live-append path (buildEventLogEntry) is fed by trusted internal code, not user-supplied JSON.
 */
function sanitizeImportedEventLogEntry(e: EventLogEntry): EventLogEntry {
  // Caps by UTF-16 code-unit count (not bytes); a percent-encoded tail could be sliced mid-sequence,
  // but the stored strings are display-only (no caller parses them via new URL/decodeURIComponent), so
  // a truncated tail is at worst cosmetic. (#299 R2)
  const cap = (s: string): string => (s.length > MAX_EVENT_STRING_LEN ? s.slice(0, MAX_EVENT_STRING_LEN) : s);
  const out: EventLogEntry = { id: cap(e.id), ts: e.ts, kind: e.kind };
  if (e.site !== undefined) out.site = cap(e.site);
  if (e.url !== undefined) out.url = cap(minimizeEventUrl(e.url));
  if (e.destHost !== undefined) out.destHost = cap(e.destHost);
  if (e.score !== undefined) out.score = e.score;
  // reasons elements are already strings here (isEventLogEntry pre-filtered them in
  // normalizeEventLog); sanitizeCodeList only applies the count (32) + per-string-length (80) caps.
  const reasons = sanitizeCodeList(e.reasons);
  if (reasons !== undefined) out.reasons = reasons;
  if (e.extra !== undefined) {
    try {
      if (JSON.stringify(e.extra).length <= MAX_EVENT_EXTRA_BYTES) out.extra = e.extra;
      // else: drop the oversized extra (fail closed) — keep the entry, shed the bloat.
    } catch {
      // Unserializable extra (cycles, etc.) — drop it.
    }
  }
  return out;
}

// A non-negative, finite dimension within a sane magnitude bound.
function isDim(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_CLICK_CONTEXT_DIM;
}

function sanitizeRectHint(value: unknown): { w: number; h: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (!isDim(r.w) || !isDim(r.h)) return undefined;
  return { w: r.w, h: r.h };
}

function clampStr(value: unknown): string | undefined {
  return typeof value === "string" ? value.slice(0, MAX_REASON_CODE_LEN) : undefined;
}

// Whitelist the known ElementHint scalar fields. Defends the persisted record
// against unexpected/oversized shapes and guarantees JSON-safety for replay.
function sanitizeElementHint(value: unknown): ElementHint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const e = value as Record<string, unknown>;
  if (typeof e.tag !== "string") return undefined;
  const out: ElementHint = { tag: e.tag.slice(0, MAX_REASON_CODE_LEN) };
  const role = clampStr(e.role); if (role !== undefined) out.role = role;
  if (typeof e.hasOnClick === "boolean") out.hasOnClick = e.hasOnClick;
  // Drop custom `cursor: url(...)` values — they can embed a page-controlled URL
  // or data-URI. Replay only cares whether the cursor is "pointer", so keyword
  // cursors are kept and a url() cursor (never "pointer") is safely omitted.
  const cursor = clampStr(e.cursor);
  if (cursor !== undefined && !/url\(/i.test(cursor)) out.cursor = cursor;
  if (typeof e.textLength === "number" && Number.isFinite(e.textLength)) out.textLength = e.textLength;
  if (typeof e.ariaLabelLength === "number" && Number.isFinite(e.ariaLabelLength)) out.ariaLabelLength = e.ariaLabelLength;
  if (typeof e.titleLength === "number" && Number.isFinite(e.titleLength)) out.titleLength = e.titleLength;
  if (typeof e.targetBlank === "boolean") out.targetBlank = e.targetBlank;
  const rect = sanitizeRectHint(e.rect); if (rect) out.rect = rect;
  if (typeof e.opacity === "number" && Number.isFinite(e.opacity)) out.opacity = e.opacity;
  const visibility = clampStr(e.visibility); if (visibility !== undefined) out.visibility = visibility;
  const display = clampStr(e.display); if (display !== undefined) out.display = display;
  const pointerEvents = clampStr(e.pointerEvents); if (pointerEvents !== undefined) out.pointerEvents = pointerEvents;
  const position = clampStr(e.position); if (position !== undefined) out.position = position;
  if (typeof e.zIndex === "number" && Number.isFinite(e.zIndex)) out.zIndex = e.zIndex;
  return out;
}

// Rebuild a JSON-safe, bounded ClickContext from arbitrary input (the live
// ctx is already clean, but this keeps the persisted schema stable and guards
// imports). Returns undefined when there is no usable top-element hint.
function sanitizeClickContext(value: unknown): ClickContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const c = value as Record<string, unknown>;
  const top = sanitizeElementHint(c.top);
  if (!top) return undefined;
  const vp = c.viewport && typeof c.viewport === "object" ? (c.viewport as Record<string, unknown>) : undefined;
  const viewport = {
    w: isDim(vp?.w) ? vp!.w : 0,
    h: isDim(vp?.h) ? vp!.h : 0,
  };
  const out: ClickContext = { viewport, input: c.input === "keyboard" ? "keyboard" : "pointer", top };
  const underlying = sanitizeElementHint(c.underlying);
  if (underlying) out.underlying = underlying;
  if (typeof c.retargeted === "boolean") out.retargeted = c.retargeted;
  if (typeof c.explicitNewTabIntent === "boolean") out.explicitNewTabIntent = c.explicitNewTabIntent;
  if (typeof c.isLegitModalBackdrop === "boolean") out.isLegitModalBackdrop = c.isLegitModalBackdrop;
  return out;
}

function isPromptOutcomeEntry(value: unknown): value is PromptOutcomeEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  const type = entry.type;
  const outcome = entry.outcome;
  return typeof entry.id === "string" &&
    typeof entry.ts === "number" &&
    Number.isFinite(entry.ts) &&
    typeof entry.domain === "string" &&
    (entry.destDomain === undefined || typeof entry.destDomain === "string") &&
    (type === "nav" || type === "cred") &&
    typeof entry.score === "number" &&
    Number.isFinite(entry.score) &&
    (
      outcome === "allow" ||
      outcome === "allow_once" ||
      outcome === "always_allow" ||
      outcome === "block" ||
      outcome === "trust" ||
      outcome === "dismiss" ||
      outcome === "cancel"
    ) &&
    isOptionalStringArray(entry.reasons) &&
    // Enriched replay fields (P5-C1) — all optional; validate shape so the
    // verify-step never rejects a record the (sanitized) writer produced.
    isOptionalFiniteNumber(entry.cds) &&
    isOptionalFiniteNumber(entry.navAnomalyScore) &&
    isOptionalFiniteNumber(entry.adaptiveAdj) &&
    isOptionalFiniteNumber(entry.thresholdUsed) &&
    isOptionalStringArray(entry.nrsFactors) &&
    (entry.elementContext === undefined || (typeof entry.elementContext === "object" && entry.elementContext !== null));
}

function normalizePromptOutcomeLog(value: unknown): PromptOutcomeEntry[] {
  if (!Array.isArray(value)) return [];
  const normalized: PromptOutcomeEntry[] = [];
  for (const entry of value) {
    if (!isPromptOutcomeEntry(entry)) continue;
    const record = buildPromptOutcomeRecord(entry);
    if (record) normalized.push(record);
  }
  return normalized;
}

function boundPromptOutcomeLog(value: unknown): PromptOutcomeEntry[] {
  return normalizePromptOutcomeLog(value).slice(-PROMPT_OUTCOMES_LIMIT);
}

export function isPromptOutcomeStorageMessage(message: unknown): message is PromptOutcomeStorageMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Record<string, unknown>;
  if (candidate.type === "ns-prompt-outcome-clear") return true;
  if (candidate.type === "ns-prompt-outcome-reset-adaptive") return true;
  if (candidate.type === "ns-prompt-outcome-append") return isPromptOutcomeEntry(candidate.entry);
  if (candidate.type === "ns-prompt-outcome-replace") return Array.isArray(candidate.outcomes);
  return false;
}

function isExtensionServiceWorkerContext(): boolean {
  const scope = globalThis as { clients?: unknown; document?: unknown; registration?: unknown };
  return typeof scope.document === "undefined" &&
    typeof scope.clients !== "undefined" &&
    typeof scope.registration !== "undefined";
}

/** @internal True when this context must delegate writes to the worker. Exported for `behavioural_reset.ts`. */
export function shouldDelegatePromptOutcomeWrite(): boolean {
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  return !isExtensionServiceWorkerContext() && typeof runtime?.sendMessage === "function";
}

type PromptOutcomeBarrierStorage = Pick<chrome.storage.StorageArea, "get" | "set">;

// The reset barrier persists the cutoff to chrome.storage.session so it survives
// SW restarts. On engines without storage.session (Firefox MV3), this returns
// null and the cutoff is in-memory only — a clear/import followed by a
// background restart followed by a delayed append could then resurrect stale
// data. Wiring this through `storageSessionShim` (browser.ts), whose own doc
// defers "wiring the real consumers" to FF-03, is tracked as part of the FF-03
// session_state compatibility slice; on Chrome the behavior is unaffected.
function getPromptOutcomeBarrierStorage(): PromptOutcomeBarrierStorage | null {
  const storage = (globalThis as { chrome?: { storage?: { session?: PromptOutcomeBarrierStorage } } })
    .chrome?.storage?.session;
  return typeof storage?.get === "function" && typeof storage.set === "function" ? storage : null;
}

function normalizeResetCutoff(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function hydratePromptOutcomeResetCutoff(): Promise<void> {
  if (promptOutcomeResetHydrate) return promptOutcomeResetHydrate;
  const hydrate = (async () => {
    const session = getPromptOutcomeBarrierStorage();
    if (!session) return;
    try {
      const res = await session.get(PROMPT_OUTCOME_RESET_TS_KEY);
      promptOutcomeResetCutoffTs = Math.max(
        promptOutcomeResetCutoffTs,
        normalizeResetCutoff(res[PROMPT_OUTCOME_RESET_TS_KEY])
      );
    } catch (err) {
      console.warn("[NavSentinel] prompt outcome reset barrier hydration failed:", err);
      throw err;
    }
  })();
  promptOutcomeResetHydrate = hydrate;
  // A rejected hydration must not poison the next trusted control retry. The
  // browser-owned session store may become available again after a transient
  // storage failure, and proceeding without its cutoff could resurrect data.
  void hydrate.catch(() => {
    if (promptOutcomeResetHydrate === hydrate) promptOutcomeResetHydrate = null;
  });
  return hydrate;
}

async function setPromptOutcomeResetCutoff(ts = Date.now()): Promise<void> {
  promptOutcomeResetCutoffTs = Math.max(promptOutcomeResetCutoffTs, ts);
  const session = getPromptOutcomeBarrierStorage();
  if (!session) return;
  try {
    await session.set({ [PROMPT_OUTCOME_RESET_TS_KEY]: promptOutcomeResetCutoffTs });
  } catch (err) {
    console.warn("[NavSentinel] prompt outcome reset barrier persist failed:", err);
    throw err;
  }
}

// Distinguishes a transport failure (no receiving end, SW cold-start race,
// context invalidation) — which is retryable and safe to fall back from — from
// a deliberate `{ ok: false }` refusal by the service worker (e.g. an
// unauthorized clear/replace), which must NOT be retried or fallen back from.
// A retryable failure: the SW is momentarily unreachable (cold-start "no
// receiving end" race, a transient SW-side storage error, or a thrown channel).
class PromptOutcomeRetryableError extends Error {}
// A definitive refusal by the SW (the sender is not authorized). Never retried.
class PromptOutcomeUnauthorizedError extends Error {}
// A user-initiated control op (clear/replace) whose delegation exhausted retries
// with the SW persistently unreachable. Surfaced to the caller (options UI) so a
// bulk op is never reported as a phantom success (#188). Append never throws this.
// Exported so the options import handler can distinguish a delivery failure (the
// rest of a non-atomic import did apply) from a total failure.
export class PromptOutcomeDeliveryError extends Error {}

function sendSuiteImportMessage(payload: unknown): Promise<ImportAllResult> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: "ns-suite-import", payload } satisfies SuiteImportMessage,
        (response?: SuiteImportResponse) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            // A lost whole-import response is ambiguous: the worker may have
            // committed the import already. Never retry or replay it here.
            reject(new Error("Suite import not confirmed: " + (lastError.message ?? "runtime.sendMessage failed")));
            return;
          }
          if (response?.ok) {
            resolve(response.result);
            return;
          }
          if (response?.code === "partial") {
            reject(new PromptOutcomeDeliveryError(response.error));
            return;
          }
          reject(new Error(response?.error ?? "Suite import failed"));
        }
      );
    } catch (err) {
      // A synchronous channel failure is just as ambiguous as a lost callback.
      reject(new Error("Suite import not confirmed: " + (err instanceof Error ? err.message : String(err))));
    }
  });
}

function sendPromptOutcomeStorageMessage(message: PromptOutcomeStorageMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response?: PromptOutcomeStorageResponse) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new PromptOutcomeRetryableError(lastError.message ?? "runtime.sendMessage failed"));
          return;
        }
        if (response?.ok) {
          resolve();
          return;
        }
        if (response?.code === "unauthorized") {
          // The SW deliberately refused (sender not authorized) — not retryable.
          reject(new PromptOutcomeUnauthorizedError(response.error));
          return;
        }
        // A genuine SW-side failure (e.g. a transient storage error) — retryable.
        reject(new PromptOutcomeRetryableError(response?.error ?? "Prompt outcome storage write failed"));
      });
    } catch (err) {
      // Synchronous throw === the messaging channel is gone (context invalidated).
      reject(new PromptOutcomeRetryableError(err instanceof Error ? err.message : String(err)));
    }
  });
}

/** @internal Exported for `behavioural_reset.ts` so both share one retry schedule. */
export function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delegate a prompt-outcome write to the service worker, which is the single
 * serialized writer. On a retryable failure (SW waking from cold start, a
 * momentary "no receiving end", or a transient SW-side error) retry a bounded
 * number of times. An unauthorized refusal is rethrown immediately (no retry).
 *
 * If every attempt fails the SW is persistently unreachable — in MV3 that means
 * the extension is being reloaded/updated and this context is itself about to be
 * torn down. We do NOT fall back to a direct content-script write: that would
 * bypass the SW's serialization, cannot read the SW-side reset barrier from a
 * content script on Chrome (risking resurrection of cleared data), and could
 * race a concurrent SW write. Prompt outcomes are best-effort adaptive-scoring
 * input, so we surface the loss loudly instead of corrupting state silently.
 *
 * @param options.throwOnExhaustion when true (a user-initiated clear/replace),
 * reject with PromptOutcomeDeliveryError on exhaustion instead of dropping, so
 * the caller can surface the failure in the UI (#188). The append path leaves it
 * unset and keeps the fire-and-forget drop + log contract.
 */
async function delegatePromptOutcomeWrite(
  message: PromptOutcomeStorageMessage,
  options?: { throwOnExhaustion?: boolean }
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= STORAGE_DELEGATE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await sendPromptOutcomeStorageMessage(message);
      return;
    } catch (err) {
      if (err instanceof PromptOutcomeUnauthorizedError) throw err;
      lastErr = err;
      const delay = STORAGE_DELEGATE_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await delayMs(delay);
    }
  }
  // Persistently unreachable. A user-initiated control op rejects so the options
  // UI can surface the failure; a best-effort append drops + logs (its loss is
  // bounded adaptive-scoring input) (#188).
  if (options?.throwOnExhaustion) {
    // Preserve the underlying transport error as the cause — the append path logs
    // it via console.warn, so the control-op reject should carry the same
    // diagnostic for the user-initiated ops where it matters most.
    throw new PromptOutcomeDeliveryError(
      `Prompt outcome ${message.type} not delivered — service worker unreachable after retries`,
      { cause: lastErr }
    );
  }
  console.warn(
    "[NavSentinel] prompt outcome dropped — service worker unreachable after retries:",
    message.type,
    lastErr
  );
}

function queuePromptOutcomeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = promptOutcomePending.then(operation);
  promptOutcomePending = next.catch((err) => {
    console.warn("[NavSentinel] prompt outcome serialization error:", err);
  });
  return next;
}

async function persistPromptOutcome(entry: PromptOutcomeEntry): Promise<void> {
  // Keep the intended snapshot across retries so a clobbered verify does not
  // become the new baseline on the next attempt.
  const requiredEntries = new Map<string, PromptOutcomeEntry>();

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await chrome.storage.local.get(PROMPT_OUTCOMES_KEY);
    const cur = boundPromptOutcomeLog(res[PROMPT_OUTCOMES_KEY]);
    const mergedEntries = new Map<string, PromptOutcomeEntry>();
    for (const item of requiredEntries.values()) mergedEntries.set(item.id, item);
    for (const item of cur) {
      if (typeof item?.id === "string") mergedEntries.set(item.id, item);
    }
    mergedEntries.delete(entry.id);
    const next = [...mergedEntries.values(), entry].slice(-PROMPT_OUTCOMES_LIMIT);
    const settings = await getNavSettings();
    const threshold = settings.defaultMode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD;
    requiredEntries.clear();
    for (const item of next) requiredEntries.set(item.id, item);
    const expectedLength = next.length;
    const expectedIds = new Set(next.map((item) => item.id));
    // A prompt outcome and the adaptive cache derived from the exact same
    // snapshot must land together. Content scripts never write the cache
    // directly, so the worker queue makes a later clear/import reset win.
    await chrome.storage.local.set({
      [PROMPT_OUTCOMES_KEY]: next,
      [ADAPTIVE_SCORES_KEY]: computeAdaptiveScoreMap(next, threshold),
    });

    const verify = await chrome.storage.local.get(PROMPT_OUTCOMES_KEY);
    const verifyLog = normalizePromptOutcomeLog(verify[PROMPT_OUTCOMES_KEY]);
    const verifyIds = new Set(verifyLog.map((item) => item.id));
    if (
      verifyIds.has(entry.id) &&
      verifyLog.length >= expectedLength &&
      [...expectedIds].every((id) => verifyIds.has(id))
    ) {
      return;
    }
  }
  console.warn("[NavSentinel] appendPromptOutcome: failed to persist after 3 attempts, id:", entry.id);
}

function appendPromptOutcomeDirect(entry: PromptOutcomeEntry): Promise<void> {
  return queuePromptOutcomeWrite(async () => {
    await hydratePromptOutcomeResetCutoff();
    // The `<=` boundary deliberately drops an append whose ts equals a
    // clear/import cutoff: not-resurrecting-stale-data is prioritized over the
    // rare case of a genuinely-new outcome created in the same millisecond as a
    // user-initiated wipe. Impact is bounded to that one-ms wipe boundary; the
    // in-process queue already orders an append issued after a clear strictly
    // after it, so this only affects a delayed/cross-message append.
    if (entry.ts <= promptOutcomeResetCutoffTs) return;
    await persistPromptOutcome(entry);
  });
}

// Build a fully sanitized, bounded PromptOutcomeEntry from a partial. Used by
// BOTH the live append path and the import/replace path so they apply identical
// privacy + size guarantees (enriched fields don't bypass sanitization on
// import). Keeping the writer and the verify-step validator (isPromptOutcomeEntry,
// which requires Number.isFinite) in agreement prevents a record being
// written, filtered out on verify, then silently dropped after burning retries.
function buildPromptOutcomeRecord(
  partial: Omit<PromptOutcomeEntry, "id" | "ts"> & { id?: string; ts?: number }
): PromptOutcomeEntry | undefined {
  const domain = normalizePromptOutcomeHost(partial.domain);
  if (!domain) return undefined;
  const destDomain = normalizePromptOutcomeHost(partial.destDomain);
  const reasons = sanitizeCodeList(partial.reasons);
  const nrsFactors = sanitizeCodeList(partial.nrsFactors);
  const elementContext = sanitizeClickContext(partial.elementContext);
  return {
    id: partial.id ?? makeId(),
    ts: Number.isFinite(partial.ts) ? (partial.ts as number) : Date.now(),
    domain,
    ...(destDomain ? { destDomain } : {}),
    type: partial.type,
    score: Number.isFinite(partial.score) ? partial.score : 0,
    outcome: partial.outcome,
    ...(reasons !== undefined ? { reasons } : {}),
    ...(nrsFactors !== undefined && nrsFactors.length > 0 ? { nrsFactors } : {}),
    ...(Number.isFinite(partial.cds) ? { cds: partial.cds } : {}),
    ...(Number.isFinite(partial.navAnomalyScore) ? { navAnomalyScore: partial.navAnomalyScore } : {}),
    ...(Number.isFinite(partial.adaptiveAdj) ? { adaptiveAdj: partial.adaptiveAdj } : {}),
    ...(Number.isFinite(partial.thresholdUsed) ? { thresholdUsed: partial.thresholdUsed } : {}),
    ...(elementContext !== undefined ? { elementContext } : {})
  };
}

export function appendPromptOutcome(
  partial: Omit<PromptOutcomeEntry, "id" | "ts"> & { id?: string; ts?: number }
): Promise<void> {
  const entry = buildPromptOutcomeRecord(partial);
  // Prompt outcomes are best-effort adaptive-scoring input. A malformed
  // caller-supplied domain is dropped rather than stored verbatim or allowed to
  // surface in exports.
  if (!entry) return Promise.resolve();
  if (shouldDelegatePromptOutcomeWrite()) {
    return delegatePromptOutcomeWrite({ type: "ns-prompt-outcome-append", entry });
  }
  return appendPromptOutcomeDirect(entry);
}

/** @internal Serialized prompt-outcome clear lane. Exported for `behavioural_reset.ts`. */
export function clearPromptOutcomesDirect(progressMarker?: Record<string, unknown>): Promise<void> {
  return queuePromptOutcomeWrite(async () => {
    await hydratePromptOutcomeResetCutoff();
    const resetTs = Date.now();
    await setPromptOutcomeResetCutoff(resetTs);
    // Persist the restart-surviving barrier before the destructive local write.
    // chrome.storage has no cross-area transaction, so a barrier failure leaves
    // the log intact and is surfaced to the trusted control caller.
    // Commit the narrowed crash marker with the destructive lane write. The
    // session barrier stays before this commit, as it protects delayed appends.
    await chrome.storage.local.set({ ...progressMarker, [PROMPT_OUTCOMES_KEY]: [] });
  });
}

export function clearPromptOutcomes(): Promise<void> {
  if (shouldDelegatePromptOutcomeWrite()) {
    return delegatePromptOutcomeWrite({ type: "ns-prompt-outcome-clear" }, { throwOnExhaustion: true });
  }
  return clearPromptOutcomesDirect();
}

/**
 * Serialized adaptive-score clear lane, backing the standalone "Clear stats"
 * control. Module-private: the unified reset uses
 * `resyncPromptOutcomeAdaptiveScoresDirect` below, which cannot strand an
 * outcome row without its derived score.
 */
function clearPromptOutcomeAdaptiveScoresDirect(): Promise<void> {
  return queuePromptOutcomeWrite(async () => {
    await clearAdaptiveScoresDirect();
  });
}

/**
 * @internal The unified reset's adaptive lane. Rewrites the cache as the
 * derivative of whatever outcomes are stored RIGHT NOW, inside one queued op.
 *
 * The reset clears outcomes and their cache as two lanes, so an append can land
 * between them: it writes the row and its score atomically, and a blind
 * adaptive-only clear would then drop the score while keeping the row, leaving
 * threshold adjustment inconsistent until something recomputed it. Recomputing
 * instead of blind-clearing keeps the invariant "cache == derivative of the
 * stored outcomes" in both cases — with no outcomes this is exactly `{}`, the
 * previous behaviour. Deliberately NOT re-clearing the outcomes here: on a
 * resumed reset this lane can run alone, and wiping rows written after the
 * outcomes lane already completed would be the data loss finding (2) is about.
 */
export function resyncPromptOutcomeAdaptiveScoresDirect(progressMarker?: Record<string, unknown>): Promise<void> {
  return queuePromptOutcomeWrite(async () => {
    const res = await chrome.storage.local.get(PROMPT_OUTCOMES_KEY);
    const outcomes = boundPromptOutcomeLog(res[PROMPT_OUTCOMES_KEY]);
    if (outcomes.length === 0) {
      await chrome.storage.local.set({ ...progressMarker, [ADAPTIVE_SCORES_KEY]: {} });
      return;
    }
    const settings = await getNavSettings();
    const threshold = settings.defaultMode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD;
    await chrome.storage.local.set({
      ...progressMarker,
      [ADAPTIVE_SCORES_KEY]: computeAdaptiveScoreMap(outcomes, threshold),
    });
  });
}

/**
 * Clear the direct derivative of prompt outcomes through the same worker lane
 * as outcome migrations and replacements. This intentionally leaves every
 * other data store alone; it is not a unified clear-all control.
 */
export function clearAdaptiveScores(): Promise<void> {
  if (shouldDelegatePromptOutcomeWrite()) {
    return delegatePromptOutcomeWrite({ type: "ns-prompt-outcome-reset-adaptive" }, { throwOnExhaustion: true });
  }
  return clearPromptOutcomeAdaptiveScoresDirect();
}

async function replacePromptOutcomesDirect(outcomes: PromptOutcomeEntry[]): Promise<void> {
  // Rebuild every imported row so backups retain only declared bounded replay
  // fields and host-only source/destination identifiers.
  const importedOutcomes = boundPromptOutcomeLog(outcomes);
  await queuePromptOutcomeWrite(async () => {
    await hydratePromptOutcomeResetCutoff();
    const resetTs = Date.now();
    await setPromptOutcomeResetCutoff(resetTs);
    const settings = await getNavSettings();
    const threshold = settings.defaultMode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD;
    await chrome.storage.local.set({
      [PROMPT_OUTCOMES_KEY]: importedOutcomes,
      [ADAPTIVE_SCORES_KEY]: computeAdaptiveScoreMap(importedOutcomes, threshold),
    });
  });
}

// A user-initiated import/clear delegates with { throwOnExhaustion: true }:
// unlike the best-effort append path (drop + log), a control op REJECTS if the
// SW is persistently unreachable, so the options page surfaces the failure
// instead of reporting a phantom success (#188). The append contract is
// unchanged. NOTE: importAll runs this LAST and is non-atomic, so a rejection
// here leaves the already-committed settings/allowlist/trustedDomains/eventLog
// in place; the options import handler distinguishes this delivery failure
// (PromptOutcomeDeliveryError) and reports a partial result rather than a flat
// "Import failed." (#188 R1).
async function replacePromptOutcomes(outcomes: PromptOutcomeEntry[]): Promise<void> {
  const boundedOutcomes = boundPromptOutcomeLog(outcomes);
  if (shouldDelegatePromptOutcomeWrite()) {
    return delegatePromptOutcomeWrite(
      { type: "ns-prompt-outcome-replace", outcomes: boundedOutcomes },
      { throwOnExhaustion: true }
    );
  }
  return replacePromptOutcomesDirect(boundedOutcomes);
}

function promptOutcomeLogMatchesStored(value: unknown[], normalized: PromptOutcomeEntry[]): boolean {
  try {
    return JSON.stringify(value) === JSON.stringify(normalized);
  } catch {
    return false;
  }
}

/**
 * Rewrite legacy prompt outcomes through the serialized worker lane. This
 * removes obsolete URL-shaped domain values and undeclared fields from both
 * on-disk storage and the adaptive-score derivative.
 */
export function migrateStoredPromptOutcomes(): Promise<void> {
  return queuePromptOutcomeWrite(async () => {
    const res = await chrome.storage.local.get(PROMPT_OUTCOMES_KEY);
    const stored = res[PROMPT_OUTCOMES_KEY];
    if (!Array.isArray(stored)) return;

    const normalized = boundPromptOutcomeLog(stored);
    if (promptOutcomeLogMatchesStored(stored, normalized)) return;

    // One write keeps the canonical source rows and their direct derivative in
    // sync. The queued reset-adaptive control runs after migration, so a user
    // clear/import cannot have stale scores resurrected by this startup task.
    const settings = await getNavSettings();
    const threshold = settings.defaultMode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD;
    await chrome.storage.local.set({
      [PROMPT_OUTCOMES_KEY]: normalized,
      [ADAPTIVE_SCORES_KEY]: computeAdaptiveScoreMap(normalized, threshold),
    });
  });
}

/**
 * A clear/replace wipes or overwrites the entire prompt-outcome history (and the
 * replace path recomputes adaptive scores), so those operations are restricted
 * to trusted extension-page senders — the options/popup pages. Content scripts
 * are injected on <all_urls> and always carry `sender.tab`; they may only
 * append. We additionally require the sender to be this extension's own origin.
 *
 * @internal Also exported for `behavioural_reset.ts`, which applies the same
 * trusted-sender rule to the clear-all message.
 */
export function isTrustedExtensionPageSender(sender?: chrome.runtime.MessageSender): boolean {
  if (!sender) return false;
  // Options pages opened in a normal Chrome tab also carry sender.tab, so the
  // tab field alone cannot distinguish them from content scripts. Require a
  // tab-bearing sender to prove this extension's own origin instead.
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (sender.id && runtime?.id && sender.id !== runtime.id) return false;
  const base = runtime?.getURL?.("");
  const isOwnExtensionUrl = Boolean(base && sender.url?.startsWith(base));
  if (sender.tab !== undefined && !isOwnExtensionUrl) return false;
  if (base && sender.url && !isOwnExtensionUrl) return false;
  return true;
}

export async function handlePromptOutcomeStorageMessage(
  message: PromptOutcomeStorageMessage,
  sender?: chrome.runtime.MessageSender
): Promise<PromptOutcomeStorageResponse> {
  if (
    (
      message.type === "ns-prompt-outcome-clear" ||
      message.type === "ns-prompt-outcome-reset-adaptive" ||
      message.type === "ns-prompt-outcome-replace"
    ) &&
    !isTrustedExtensionPageSender(sender)
  ) {
    return {
      ok: false,
      error: "Unauthorized prompt-outcome mutation from untrusted sender",
      code: "unauthorized",
    };
  }
  try {
    if (message.type === "ns-prompt-outcome-append") {
      const entry = buildPromptOutcomeRecord(message.entry);
      if (!entry) return { ok: false, error: "Invalid prompt-outcome domain" };
      await appendPromptOutcomeDirect(entry);
    } else if (message.type === "ns-prompt-outcome-clear") {
      await clearPromptOutcomesDirect();
    } else if (message.type === "ns-prompt-outcome-reset-adaptive") {
      await clearPromptOutcomeAdaptiveScoresDirect();
    } else {
      await replacePromptOutcomesDirect(message.outcomes);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function exportAll(): Promise<{
  exportedAt: string;
  settings: SuiteSettings;
  allowlist: Allowlist;
  trustedDomains: string[];
  eventLog: EventLogEntry[];
  promptOutcomes: PromptOutcomeEntry[];
  adaptiveScores: Record<string, DomainAdjustment>;
}> {
  const settings = await getSuiteSettings();
  const exportedAt = Date.now();
  const allowlist = await getAllowlist();
  const trustedDomains = await getTrustedDomains();
  // RI-06: minimize every event-log URL on the way out (drop query+fragment) so
  // already-stored LEGACY full URLs — persisted before the append-path change —
  // are also reduced in exports, matching what new entries now store.
  const eventLog = (await getEventLog()).map((entry) => {
    if (entry.url === undefined) return entry;
    const minimized = minimizeEventUrl(entry.url);
    return minimized === entry.url ? entry : { ...entry, url: minimized };
  });
  const promptOutcomes = await getPromptOutcomes();
  // A dormant or newly-started worker may not have completed legacy migration
  // yet. Export derives this cache from host-canonical outcomes instead of
  // emitting an old URL-shaped storage key.
  const threshold = settings.nav.defaultMode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD;
  const adaptiveScores = computeAdaptiveScoreMap(promptOutcomes, threshold, () => exportedAt);
  return {
    exportedAt: new Date(exportedAt).toISOString(),
    settings,
    allowlist,
    trustedDomains,
    eventLog,
    promptOutcomes,
    adaptiveScores,
  };
}

let bulkDataPending: Promise<unknown> = Promise.resolve();

/**
 * Serialize whole-store bulk operations against each other: a suite import and
 * the unified behavioural reset (`behavioural_reset.ts`).
 *
 * Neither operation is a single write. `importAll` commits its core sections
 * through the event-log lane and REPLACES prompt outcomes through a second lane
 * afterwards; the reset walks four lanes. Each lane is individually serialized,
 * but nothing stopped a reset from slotting between an import's two phases —
 * the reset could clear outcomes, clear the imported event log, and then have
 * the import's final prompt phase restore outcomes and adaptive scores while
 * every lane still reported cleared. This is one more queue over the WHOLE
 * operations, not a new per-write concurrency scheme: the existing per-lane
 * chains (and the #180/#182 fixes in them) are untouched.
 *
 * Scope: per JS context. Both controls live on the options page, so its module
 * instance serializes them end to end, including across the worker delegation
 * each awaits inside the queue. Two extension pages driving one bulk operation
 * each are still not ordered against one another — documented residual.
 */
export function queueBulkDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = bulkDataPending.then(operation);
  bulkDataPending = next.catch((err) => {
    console.warn("[NavSentinel] bulk data serialization error:", err);
  });
  return next;
}

export function importAll(payload: unknown): Promise<ImportAllResult> {
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (!isExtensionServiceWorkerContext() && typeof runtime?.sendMessage === "function") {
    // The whole import must cross the worker boundary as one operation. Sending
    // core and prompt phases separately lets another Options context reset
    // between them; the worker owns ordering across all callers.
    return queueBulkDataOperation(() => sendSuiteImportMessage(payload));
  }
  return queueBulkDataOperation(() => importAllDirect(payload));
}

export async function handleSuiteImportMessage(
  message: SuiteImportMessage,
  sender?: chrome.runtime.MessageSender
): Promise<SuiteImportResponse> {
  if (!isTrustedExtensionPageSender(sender)) {
    return {
      ok: false,
      error: "Unauthorized suite import from untrusted sender",
      code: "unauthorized",
    };
  }
  try {
    // Do not call public importAll here: that would enqueue a second operation
    // on the same queue and deadlock. The worker owns this queue entry directly.
    const result = await queueBulkDataOperation(() => importAllDirect(message.payload));
    return { ok: true, result };
  } catch (err) {
    if (err instanceof PromptOutcomeDeliveryError) {
      return { ok: false, error: err.message, code: "partial" };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function importAllDirect(payload: unknown): Promise<ImportAllResult> {
  if (!payload || typeof payload !== "object") throw new Error("Invalid import payload");
  const p = payload as Record<string, unknown>;
  let importLogLimit = DEFAULT_SUITE_SETTINGS.logLimit;
  let eventLogDropped = 0;

  // --- Phase 1: validate & build EVERY storage.local section payload before any
  // write. This was previously a sequence of independent awaited set() calls, so a
  // mid-sequence failure (invalid payload, quota rejection, transient error) left a
  // partially-applied config — e.g. a new allowlist paired with the old event log.
  // chrome.storage.local.set applies all keys in ONE operation, so committing the
  // core sections together makes the security-relevant allowlist/trusted-domains
  // replacement atomic with settings/event-log: an invalid payload or a failed
  // write now leaves storage unchanged instead of half-applied. (#203)
  //
  // Prompt outcomes are deliberately kept as a separate LAST step: the path may be
  // SW-delegated and rejects on exhaustion, and the options UI already distinguishes
  // that delivery failure to report a precise partial result (#188).
  const writes: Record<string, unknown> = {};

  if (p.settings && typeof p.settings === "object") {
    const merged = mergeSuiteSettings(
      structuredClone(DEFAULT_SUITE_SETTINGS),
      p.settings as SuiteSettingsPatch
    );
    importLogLimit = merged.logLimit;
    writes[SUITE_SETTINGS_KEY] = merged;
  }

  if (p.allowlist && typeof p.allowlist === "object") {
    writes[ALLOWLIST_KEY] = normalizeAllowlist(p.allowlist);
  }

  if (Array.isArray(p.trustedDomains)) {
    writes[TRUSTED_DOMAINS_KEY] = normalizeDomainList(p.trustedDomains);
  }

  if (Array.isArray(p.eventLog)) {
    const boundedLogLimit = clampInt(importLogLimit, 50, 5000, DEFAULT_SUITE_SETTINGS.logLimit);
    // Route the cap through trimEventLog (same as appendEvent) for consistency: it
    // normalizes invalid rows and evicts silent-decision kinds first, so an oversized
    // import preserves loud/protected entries instead of a blind tail slice. (#252)
    // Normalize (shape-validate) then re-sanitize each entry to bound per-entry content size so a
    // crafted backup can't exhaust the shared storage quota (#299); trimValidEventLog then applies
    // the silent-eviction cap without re-normalizing (#299 R1). The total-quota residual (N entries
    // each at the per-entry cap) is fail-closed by importAll's single atomic set (#270), which
    // rejects on quota-exceeded and leaves storage unchanged.
    const normalized = normalizeEventLogWithMetadata(p.eventLog);
    eventLogDropped = normalized.eventLogDropped;
    writes[EVENT_LOG_KEY] = trimValidEventLog(
      normalized.entries.map(sanitizeImportedEventLogEntry),
      boundedLogLimit
    );
  }

  const hasPromptOutcomes = Array.isArray(p.promptOutcomes);
  if (!hasPromptOutcomes) {
    // Intentional: any import without valid outcomes resets adaptive scores
    // to prevent stale data. adaptiveScores from payload are ignored —
    // they are recomputed from outcomes to prevent injection. Folded into the
    // atomic core write below. (When outcomes ARE present, replacePromptOutcomes
    // recomputes adaptive scores itself, so it is omitted here.)
    writes[ADAPTIVE_SCORES_KEY] = {};
  }

  // --- Phase 2: commit the core sections in a single atomic set ---
  let coreCommitted = false;
  if (Object.keys(writes).length > 0) {
    if (EVENT_LOG_KEY in writes) {
      // The append/migration lane is authoritative for every event-log mutation.
      // Delegating the COMPLETE core object keeps importAll's existing one-set
      // atomicity while preventing a cross-context clear/import from overwriting
      // an append that already read the old log.
      if (shouldDelegateEventLogWrite()) {
        await delegateEventLogControl({ type: "ns-event-log-import-core", writes });
      } else {
        await importEventLogCoreDirect(writes);
      }
    } else {
      await chrome.storage.local.set(writes);
    }
    coreCommitted = true;
  }

  // --- Phase 3: prompt outcomes LAST (separate by design; recomputes adaptive
  // scores; may be SW-delegated and reject on exhaustion → surfaced as a partial
  // import by the options UI). The core sections above are already consistent. ---
  try {
    if (hasPromptOutcomes) {
      await replacePromptOutcomes(p.promptOutcomes as PromptOutcomeEntry[]);
    } else {
      // Keep the phase-2 atomic clear above, then queue an idempotent barrier so
      // an already-running startup migration cannot restore a stale derivative.
      await clearAdaptiveScores();
    }
  } catch (err) {
    if (coreCommitted && !(err instanceof PromptOutcomeDeliveryError)) {
      throw new PromptOutcomeDeliveryError(
        "Prompt-related import data was not fully updated after the core import committed",
        { cause: err }
      );
    }
    throw err;
  }
  return { eventLogDropped };
}
