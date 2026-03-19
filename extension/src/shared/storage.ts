import type { Mode } from "./types";
import { ALLOWLIST_KEY, getAllowlist, normalizeAllowlist, type Allowlist } from "./allowlist";
import { getRegistrableDomain, normalizeHost, safeUrlParse } from "./domain";

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
  credential?: Partial<CredentialSettings> & {
    similarity?: Partial<CredentialSettings["similarity"]>;
  };
};

export const SUITE_SETTINGS_KEY = "sentinelsuite:settings_v1";
export const TRUSTED_DOMAINS_KEY = "sentinelsuite:trusted_domains_v1";
export const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";
const LEGACY_SETTINGS_KEY = "navsentinel:settings";

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

export async function setSuiteSettings(next: SuiteSettings): Promise<void> {
  const merged = mergeSuiteSettings(structuredClone(DEFAULT_SUITE_SETTINGS), next);
  await chrome.storage.local.set({ [SUITE_SETTINGS_KEY]: merged });
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

export async function setNavSettings(nav: NavSettings): Promise<void> {
  await updateSuiteSettings({ nav });
}

export function onNavSettingsChange(cb: (s: NavSettings) => void): void {
  onSuiteSettingsChange((s) => cb(s.nav));
}

export async function getCredentialSettings(): Promise<CredentialSettings> {
  const s = await getSuiteSettings();
  return s.credential;
}

export async function setCredentialSettings(credential: CredentialSettings): Promise<void> {
  await updateSuiteSettings({ credential });
}

export function onCredentialSettingsChange(cb: (s: CredentialSettings) => void): void {
  onSuiteSettingsChange((s) => cb(s.credential));
}

export function normalizeTrustedDomain(value: unknown): string {
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

export async function addTrustedDomain(domain: string): Promise<string[]> {
  const d = normalizeTrustedDomain(domain);
  if (!d) return getTrustedDomains();
  const cur = await getTrustedDomains();
  if (cur.includes(d)) return cur;
  const next = [...cur, d].sort();
  await chrome.storage.local.set({ [TRUSTED_DOMAINS_KEY]: next });
  return next;
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
  | "suite_config_update";

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
}

export async function clearEventLog(): Promise<void> {
  await chrome.storage.local.set({ [EVENT_LOG_KEY]: [] });
}

export async function exportAll(): Promise<{
  exportedAt: string;
  settings: SuiteSettings;
  allowlist: Allowlist;
  trustedDomains: string[];
  eventLog: EventLogEntry[];
}> {
  const settings = await getSuiteSettings();
  const allowlist = await getAllowlist();
  const trustedDomains = await getTrustedDomains();
  const eventLog = await getEventLog();
  return {
    exportedAt: new Date().toISOString(),
    settings,
    allowlist,
    trustedDomains,
    eventLog
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
    const boundedLogLimit = Math.max(0, Math.min(importLogLimit, 5000));
    await chrome.storage.local.set({
      [EVENT_LOG_KEY]: (p.eventLog as EventLogEntry[]).slice(-boundedLogLimit)
    });
  }
}
