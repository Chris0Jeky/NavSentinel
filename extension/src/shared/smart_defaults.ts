// extension/src/shared/smart_defaults.ts
//
// Pattern detection for "smart defaults that learn" (P3-03).
// Analyzes prompt telemetry to detect when a user repeatedly allows the same
// source->destination domain pair, then suggests adding it to the allowlist.

import type { PromptOutcomeEntry } from "./storage";

/** Number of consecutive allows before suggesting an allowlist addition. */
export const SMART_DEFAULT_THRESHOLD = 3;

/** How long (ms) after a user dismisses a suggestion before we re-suggest. */
export const SMART_DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Storage key for cooldown timestamps. */
export const SMART_DEFAULT_COOLDOWNS_KEY = "sentinelsuite:smart_default_cooldowns_v1";

/**
 * Upper bound on the number of cooldown entries persisted at once. getCooldowns
 * already prunes expired entries on read, but within the 24h TTL window a user
 * who dismisses suggestions for many distinct pairs could accumulate unbounded
 * entries. This cap mirrors the existing PROMPT_OUTCOMES_LIMIT / event-log caps:
 * when exceeded, the soonest-to-expire entries are dropped first (they would
 * lapse next anyway), keeping the most recently set cooldowns. (#308)
 */
export const SMART_DEFAULT_COOLDOWNS_LIMIT = 200;

export interface SmartDefaultSuggestion {
  sourceDomain: string;
  destDomain: string;
  allowCount: number;
  suggestion: "add_to_allowlist";
}

/** Composite key for a source->destination pair. */
export function pairKey(source: string, dest: string): string {
  return `${source.toLowerCase()}|${dest.toLowerCase()}`;
}

/**
 * Cooldown record: maps pair keys to the timestamp when the cooldown expires.
 * Only pairs whose cooldown has not yet expired should be present.
 */
export type CooldownMap = Record<string, number>;

/**
 * Analyze prompt outcomes for a specific domain pair to determine whether we
 * should suggest an allowlist addition.
 *
 * Returns a suggestion if the user has allowed navigations from `sourceDomain`
 * to `destDomain` at least `SMART_DEFAULT_THRESHOLD` consecutive times
 * (counting from the most recent outcome backwards, with no block/dismiss
 * interrupting the streak).
 *
 * Does NOT check cooldowns -- the caller should check separately via
 * `isPairOnCooldown`.
 */
export function analyzeOutcomesForPair(
  outcomes: PromptOutcomeEntry[],
  sourceDomain: string,
  destDomain: string
): SmartDefaultSuggestion | null {
  const src = sourceDomain.toLowerCase();
  const dest = destDomain.toLowerCase();

  // Filter to nav-type outcomes for this specific pair
  const pairOutcomes = outcomes.filter(
    (o) =>
      o.type === "nav" &&
      o.domain.toLowerCase() === src &&
      (o.destDomain ?? "").toLowerCase() === dest
  );

  if (pairOutcomes.length < SMART_DEFAULT_THRESHOLD) return null;

  // Sort by timestamp descending (most recent first)
  const sorted = [...pairOutcomes].sort((a, b) => b.ts - a.ts);

  // Count consecutive allows from the most recent entry
  let consecutiveAllows = 0;
  for (const entry of sorted) {
    if (entry.outcome === "allow" || entry.outcome === "allow_once") {
      consecutiveAllows++;
    } else {
      break;
    }
  }

  if (consecutiveAllows >= SMART_DEFAULT_THRESHOLD) {
    return {
      sourceDomain: src,
      destDomain: dest,
      allowCount: consecutiveAllows,
      suggestion: "add_to_allowlist",
    };
  }

  return null;
}

/**
 * Get the cooldown map from storage.
 * Prunes expired entries on read.
 */
export async function getCooldowns(): Promise<CooldownMap> {
  const res = await chrome.storage.local.get(SMART_DEFAULT_COOLDOWNS_KEY);
  const raw = res[SMART_DEFAULT_COOLDOWNS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const map = raw as CooldownMap;
  const now = Date.now();
  const pruned: CooldownMap = {};
  let changed = false;

  for (const [key, expiresAt] of Object.entries(map)) {
    if (typeof expiresAt === "number" && expiresAt > now) {
      pruned[key] = expiresAt;
    } else {
      changed = true;
    }
  }

  // Persist pruned map if we removed stale entries
  if (changed) {
    await chrome.storage.local.set({ [SMART_DEFAULT_COOLDOWNS_KEY]: pruned });
  }

  return pruned;
}

/**
 * Check whether a domain pair is currently on cooldown.
 */
export async function isPairOnCooldown(
  sourceDomain: string,
  destDomain: string
): Promise<boolean> {
  const cooldowns = await getCooldowns();
  const key = pairKey(sourceDomain, destDomain);
  const expiresAt = cooldowns[key];
  if (typeof expiresAt !== "number") return false;
  return expiresAt > Date.now();
}

/**
 * Cap a cooldown map to at most `limit` entries, evicting the soonest-to-expire
 * entries first (they would lapse next anyway). Pure helper for testability.
 * Returns the original map unchanged when already within the limit.
 */
export function capCooldownMap(
  cooldowns: CooldownMap,
  limit: number = SMART_DEFAULT_COOLDOWNS_LIMIT
): CooldownMap {
  const entries = Object.entries(cooldowns);
  if (entries.length <= limit) return cooldowns;
  // Sort by expiry descending so the latest-expiring (most recently set) survive.
  entries.sort((a, b) => b[1] - a[1]);
  const kept: CooldownMap = {};
  for (const [key, expiresAt] of entries.slice(0, limit)) {
    kept[key] = expiresAt;
  }
  return kept;
}

/**
 * Set a cooldown for a domain pair (called when user dismisses the suggestion).
 */
export async function setCooldown(
  sourceDomain: string,
  destDomain: string
): Promise<void> {
  const cooldowns = await getCooldowns();
  cooldowns[pairKey(sourceDomain, destDomain)] = Date.now() + SMART_DEFAULT_COOLDOWN_MS;
  await chrome.storage.local.set({
    [SMART_DEFAULT_COOLDOWNS_KEY]: capCooldownMap(cooldowns),
  });
}

/**
 * Remove the cooldown for a domain pair (called when user accepts "Always Allow").
 */
export async function clearCooldown(
  sourceDomain: string,
  destDomain: string
): Promise<void> {
  const cooldowns = await getCooldowns();
  delete cooldowns[pairKey(sourceDomain, destDomain)];
  await chrome.storage.local.set({ [SMART_DEFAULT_COOLDOWNS_KEY]: cooldowns });
}

/**
 * Pure helper for tests: check a pair against a provided cooldown map and
 * current time, without touching storage.
 */
export function isPairOnCooldownPure(
  cooldowns: CooldownMap,
  sourceDomain: string,
  destDomain: string,
  now: number
): boolean {
  const key = pairKey(sourceDomain, destDomain);
  const expiresAt = cooldowns[key];
  if (typeof expiresAt !== "number") return false;
  return expiresAt > now;
}
