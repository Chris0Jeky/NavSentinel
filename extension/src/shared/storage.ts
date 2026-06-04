import type { Mode } from "./types";
import { ALLOWLIST_KEY, getAllowlist, normalizeAllowlist, type Allowlist } from "./allowlist";
import { getRegistrableDomain, normalizeHost, safeUrlParse } from "./domain";
import {
  ADAPTIVE_SCORES_KEY,
  getAdaptiveScores,
  updateAdaptiveScores,
  type DomainAdjustment,
} from "./adaptive_scoring";
import { NRS_BLOCK_THRESHOLD, NRS_STRICT_BLOCK_THRESHOLD } from "./nrs";

export type CredMode = "off" | "smart" | "strict";

export interface NavSettings {
  defaultMode: Mode;
  debug: boolean;
  dnrEnabled: boolean;
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
  reasons?: string[];
}

const DEFAULT_SUITE_SETTINGS: SuiteSettings = {
  nav: {
    defaultMode: "smart",
    debug: false,
    dnrEnabled: false
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

function mergeSuiteSettings(cur: SuiteSettings, partial: SuiteSettingsPatch): SuiteSettings {
  const next: SuiteSettings = {
    ...cur,
    ...partial,
    nav: { ...cur.nav, ...(partial.nav ?? {}) },
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

export async function updateSuiteSettings(partial: SuiteSettingsPatch): Promise<SuiteSettings> {
  const cur = await getSuiteSettings();
  const next = mergeSuiteSettings(cur, partial);
  await chrome.storage.local.set({ [SUITE_SETTINGS_KEY]: next });
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
    (trimmed.includes("://") ? null : safeUrlParse(`https://${trimmed}`));
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

export async function addTrustedDomainWithResult(
  domain: string
): Promise<TrustedDomainAddResult | null> {
  const d = normalizeTrustedDomain(domain);
  if (!d) return null;
  const cur = await getTrustedDomains();
  if (cur.includes(d)) {
    return { domains: cur, normalized: d, added: false };
  }
  const next = [...cur, d].sort();
  await chrome.storage.local.set({ [TRUSTED_DOMAINS_KEY]: next });
  return { domains: next, normalized: d, added: true };
}

export async function addTrustedDomain(domain: string): Promise<string[]> {
  const result = await addTrustedDomainWithResult(domain);
  return result ? result.domains : getTrustedDomains();
}

export async function removeTrustedDomain(domain: string): Promise<string[]> {
  const d = normalizeTrustedDomain(domain);
  const cur = await getTrustedDomains();
  const next = cur.filter((x) => x !== d);
  await chrome.storage.local.set({ [TRUSTED_DOMAINS_KEY]: next });
  return next;
}

export async function clearTrustedDomains(): Promise<void> {
  await chrome.storage.local.set({ [TRUSTED_DOMAINS_KEY]: [] });
}

export type EventKind =
  | "nav_blank_prompt"
  | "nav_click_block"
  | "nav_rollback"
  | "nav_allowlist_add"
  | "nav_allowlist_remove"
  | "cred_submit_prompt"
  | "cred_submit_allow_once"
  | "cred_trust_domain"
  | "cred_untrust_domain"
  | "cred_paste_warn"
  | "suite_config_update"
  | "clickfix_detected"
  | "dblclickjack_detected"
  | "nav_reputation_late_warn"
  | "mutation_alert"
  | "pushstate_abuse"
  | "bridge_buffer_overflow";

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

function makeId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function getEventLog(): Promise<EventLogEntry[]> {
  const res = await chrome.storage.local.get(EVENT_LOG_KEY);
  const log = res[EVENT_LOG_KEY];
  if (!Array.isArray(log)) return [];
  return log.slice(-5000) as EventLogEntry[];
}

export async function appendEvent(
  partial: Omit<EventLogEntry, "id" | "ts"> & { id?: string; ts?: number }
): Promise<void> {
  const settings = await getSuiteSettings();
  const limit = clampInt(settings.logLimit, 50, 5000, DEFAULT_SUITE_SETTINGS.logLimit);
  const entry: EventLogEntry = {
    id: partial.id ?? makeId(),
    ts: partial.ts ?? Date.now(),
    kind: partial.kind,
    ...(partial.site !== undefined ? { site: partial.site } : {}),
    ...(partial.url !== undefined ? { url: partial.url } : {}),
    ...(partial.destHost !== undefined ? { destHost: partial.destHost } : {}),
    ...(partial.score !== undefined ? { score: partial.score } : {}),
    ...(partial.reasons !== undefined ? { reasons: partial.reasons } : {}),
    ...(partial.extra !== undefined ? { extra: partial.extra } : {})
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await chrome.storage.local.get(EVENT_LOG_KEY);
    const cur = Array.isArray(res[EVENT_LOG_KEY]) ? (res[EVENT_LOG_KEY] as EventLogEntry[]) : [];
    const next = [...cur.filter((item) => item?.id !== entry.id), entry].slice(-limit);
    await chrome.storage.local.set({ [EVENT_LOG_KEY]: next });

    const verify = await chrome.storage.local.get(EVENT_LOG_KEY);
    const verifyLog = Array.isArray(verify[EVENT_LOG_KEY])
      ? (verify[EVENT_LOG_KEY] as EventLogEntry[])
      : [];
    if (verifyLog.some((item) => item?.id === entry.id)) {
      return;
    }
  }
  console.warn("[NavSentinel] appendEvent: failed to persist after 3 attempts, id:", entry.id);
}

export async function clearEventLog(): Promise<void> {
  await chrome.storage.local.set({ [EVENT_LOG_KEY]: [] });
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

export type PromptOutcomeStorageMessage =
  | { type: "ns-prompt-outcome-append"; entry: PromptOutcomeEntry }
  | { type: "ns-prompt-outcome-clear" }
  | { type: "ns-prompt-outcome-replace"; outcomes: PromptOutcomeEntry[] };

type PromptOutcomeStorageResponse =
  | { ok: true }
  | { ok: false; error: string; code?: "unauthorized" };

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
    (entry.reasons === undefined || (Array.isArray(entry.reasons) && entry.reasons.every((reason) => typeof reason === "string")));
}

function normalizePromptOutcomeLog(value: unknown): PromptOutcomeEntry[] {
  return Array.isArray(value) ? value.filter(isPromptOutcomeEntry) : [];
}

function boundPromptOutcomeLog(value: unknown): PromptOutcomeEntry[] {
  return normalizePromptOutcomeLog(value).slice(-PROMPT_OUTCOMES_LIMIT);
}

export function isPromptOutcomeStorageMessage(message: unknown): message is PromptOutcomeStorageMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Record<string, unknown>;
  if (candidate.type === "ns-prompt-outcome-clear") return true;
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

function shouldDelegatePromptOutcomeWrite(): boolean {
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
  promptOutcomeResetHydrate = (async () => {
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
    }
  })();
  return promptOutcomeResetHydrate;
}

async function setPromptOutcomeResetCutoff(ts = Date.now()): Promise<void> {
  promptOutcomeResetCutoffTs = Math.max(promptOutcomeResetCutoffTs, ts);
  const session = getPromptOutcomeBarrierStorage();
  if (!session) return;
  try {
    await session.set({ [PROMPT_OUTCOME_RESET_TS_KEY]: promptOutcomeResetCutoffTs });
  } catch (err) {
    console.warn("[NavSentinel] prompt outcome reset barrier persist failed:", err);
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

const PROMPT_OUTCOME_DELEGATE_RETRY_DELAYS_MS = [50, 150, 400];

function delayMs(ms: number): Promise<void> {
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
 */
async function delegatePromptOutcomeWrite(message: PromptOutcomeStorageMessage): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= PROMPT_OUTCOME_DELEGATE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await sendPromptOutcomeStorageMessage(message);
      return;
    } catch (err) {
      if (err instanceof PromptOutcomeUnauthorizedError) throw err;
      lastErr = err;
      const delay = PROMPT_OUTCOME_DELEGATE_RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) await delayMs(delay);
    }
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
    requiredEntries.clear();
    for (const item of next) requiredEntries.set(item.id, item);
    const expectedLength = next.length;
    const expectedIds = new Set(next.map((item) => item.id));
    await chrome.storage.local.set({ [PROMPT_OUTCOMES_KEY]: next });

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

export function appendPromptOutcome(
  partial: Omit<PromptOutcomeEntry, "id" | "ts"> & { id?: string; ts?: number }
): Promise<void> {
  // Sanitize ts/score so the writer and the verify-step validator
  // (isPromptOutcomeEntry, which requires Number.isFinite) agree. A non-finite
  // value would otherwise be written, filtered out on verify, and silently
  // dropped after burning all retries.
  const entry: PromptOutcomeEntry = {
    id: partial.id ?? makeId(),
    ts: Number.isFinite(partial.ts) ? (partial.ts as number) : Date.now(),
    domain: partial.domain,
    ...(partial.destDomain !== undefined ? { destDomain: partial.destDomain } : {}),
    type: partial.type,
    score: Number.isFinite(partial.score) ? partial.score : 0,
    outcome: partial.outcome,
    ...(partial.reasons !== undefined ? { reasons: partial.reasons } : {})
  };

  if (shouldDelegatePromptOutcomeWrite()) {
    return delegatePromptOutcomeWrite({ type: "ns-prompt-outcome-append", entry });
  }
  return appendPromptOutcomeDirect(entry);
}

function clearPromptOutcomesDirect(): Promise<void> {
  return queuePromptOutcomeWrite(async () => {
    const resetTs = Date.now();
    // Non-transactional: the log is emptied, then the reset cutoff is persisted.
    // A crash between the two leaves the log cleared but the barrier
    // unpersisted — the safe direction (no stale resurrection; a subsequent
    // clear re-establishes the barrier). chrome.storage has no multi-key
    // transaction, so this window is inherent.
    await chrome.storage.local.set({ [PROMPT_OUTCOMES_KEY]: [] });
    await setPromptOutcomeResetCutoff(resetTs);
  });
}

export function clearPromptOutcomes(): Promise<void> {
  if (shouldDelegatePromptOutcomeWrite()) {
    return delegatePromptOutcomeWrite({ type: "ns-prompt-outcome-clear" });
  }
  return clearPromptOutcomesDirect();
}

async function replacePromptOutcomesDirect(outcomes: PromptOutcomeEntry[]): Promise<void> {
  const importedOutcomes = boundPromptOutcomeLog(outcomes);
  await queuePromptOutcomeWrite(async () => {
    const resetTs = Date.now();
    await chrome.storage.local.set({ [PROMPT_OUTCOMES_KEY]: importedOutcomes });
    await setPromptOutcomeResetCutoff(resetTs);
    const settings = await getNavSettings();
    const threshold = settings.defaultMode === "strict" ? NRS_STRICT_BLOCK_THRESHOLD : NRS_BLOCK_THRESHOLD;
    await updateAdaptiveScores(importedOutcomes, threshold);
  });
}

// NOTE: a user-initiated import goes through delegatePromptOutcomeWrite, which
// (by design) drops + logs rather than rejecting if the SW is persistently
// unreachable. For an import that means a silent no-op the options page may
// report as success. Surfacing delegation failure in the import UI is
// options-layer work tracked as a follow-up issue (see #188).
async function replacePromptOutcomes(outcomes: PromptOutcomeEntry[]): Promise<void> {
  const boundedOutcomes = boundPromptOutcomeLog(outcomes);
  if (shouldDelegatePromptOutcomeWrite()) {
    return delegatePromptOutcomeWrite({ type: "ns-prompt-outcome-replace", outcomes: boundedOutcomes });
  }
  return replacePromptOutcomesDirect(boundedOutcomes);
}

/**
 * A clear/replace wipes or overwrites the entire prompt-outcome history (and the
 * replace path recomputes adaptive scores), so those operations are restricted
 * to trusted extension-page senders — the options/popup pages. Content scripts
 * are injected on <all_urls> and always carry `sender.tab`; they may only
 * append. We additionally require the sender to be this extension's own origin.
 */
function isTrustedExtensionPageSender(sender?: chrome.runtime.MessageSender): boolean {
  if (!sender) return false;
  // Primary boundary: content scripts (injected on <all_urls>) always carry
  // sender.tab; extension pages (options/popup) do not.
  if (sender.tab !== undefined) return false;
  // Defense-in-depth: when we can identify our own extension origin, require the
  // sender to match it. These checks only constrain when the info is available;
  // they do not fail-closed if getURL/id are absent (e.g. some test runtimes).
  const runtime = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (sender.id && runtime?.id && sender.id !== runtime.id) return false;
  const base = runtime?.getURL?.("");
  if (base && sender.url && !sender.url.startsWith(base)) return false;
  return true;
}

export async function handlePromptOutcomeStorageMessage(
  message: PromptOutcomeStorageMessage,
  sender?: chrome.runtime.MessageSender
): Promise<PromptOutcomeStorageResponse> {
  if (
    (message.type === "ns-prompt-outcome-clear" || message.type === "ns-prompt-outcome-replace") &&
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
      await appendPromptOutcomeDirect(message.entry);
    } else if (message.type === "ns-prompt-outcome-clear") {
      await clearPromptOutcomesDirect();
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
  const allowlist = await getAllowlist();
  const trustedDomains = await getTrustedDomains();
  const eventLog = await getEventLog();
  const promptOutcomes = await getPromptOutcomes();
  const adaptiveScores = await getAdaptiveScores();
  return {
    exportedAt: new Date().toISOString(),
    settings,
    allowlist,
    trustedDomains,
    eventLog,
    promptOutcomes,
    adaptiveScores,
  };
}

export async function importAll(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") throw new Error("Invalid import payload");
  const p = payload as Record<string, unknown>;
  let importLogLimit = DEFAULT_SUITE_SETTINGS.logLimit;

  if (p.settings && typeof p.settings === "object") {
    const merged = mergeSuiteSettings(
      structuredClone(DEFAULT_SUITE_SETTINGS),
      p.settings as SuiteSettingsPatch
    );
    importLogLimit = merged.logLimit;
    await chrome.storage.local.set({ [SUITE_SETTINGS_KEY]: merged });
  }

  if (p.allowlist && typeof p.allowlist === "object") {
    await chrome.storage.local.set({ [ALLOWLIST_KEY]: normalizeAllowlist(p.allowlist) });
  }

  if (Array.isArray(p.trustedDomains)) {
    await chrome.storage.local.set({
      [TRUSTED_DOMAINS_KEY]: normalizeDomainList(p.trustedDomains)
    });
  }

  if (Array.isArray(p.eventLog)) {
    const boundedLogLimit = clampInt(importLogLimit, 50, 5000, DEFAULT_SUITE_SETTINGS.logLimit);
    await chrome.storage.local.set({
      [EVENT_LOG_KEY]: (p.eventLog as EventLogEntry[]).slice(-boundedLogLimit)
    });
  }

  if (Array.isArray(p.promptOutcomes)) {
    await replacePromptOutcomes(p.promptOutcomes as PromptOutcomeEntry[]);
  } else {
    // Intentional: any import without valid outcomes resets adaptive scores
    // to prevent stale data. adaptiveScores from payload are ignored —
    // they are recomputed from outcomes to prevent injection.
    await chrome.storage.local.set({ [ADAPTIVE_SCORES_KEY]: {} });
  }
}
