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
 * Upper bound on the number of active cooldown entries kept in storage. setCooldown
 * adds one entry per dismissed source->dest pair, and getCooldowns only prunes
 * TTL-expired entries — so within the 24h window a stream of distinct dismissals (or
 * an adversarial site forcing many suggestion toasts) could grow the map unbounded.
 * Mirrors the bounds on the prompt-outcome log (500) and event log. When the cap is
 * exceeded the soonest-to-expire entries are dropped first (they would lapse next
 * anyway, at worst re-showing a suggestion slightly early). (#308)
 */
export const SMART_DEFAULT_COOLDOWN_LIMIT = 200;

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

  // Count consecutive allows from the most recent entry. `always_allow` is a
  // positive trust signal (the user clicked "Always allow") and must extend the
  // streak, not break it -- otherwise a prior always-allow record sitting in the
  // history (e.g. after the pair was removed from the allowlist) truncates an
  // otherwise-continuous run of allows and suppresses the re-suggestion. This
  // matches the positive-outcome set in adaptive_scoring.ts; `trust` is a
  // credential-guard outcome that never appears on nav-type entries (filtered
  // above), so it is intentionally omitted here. (#307)
  let consecutiveAllows = 0;
  for (const entry of sorted) {
    if (
      entry.outcome === "allow" ||
      entry.outcome === "allow_once" ||
      entry.outcome === "always_allow"
    ) {
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

// In-process FIFO write queue mirroring the repo read-modify-write pattern
// (createStorageWriteQueue in storage_impl.ts, enqueueAllowlistWrite in
// allowlist.ts). Every cooldown mutation reads the stored map then writes a
// derived map; without a queue, two concurrent calls both read the same base
// and the second write silently clobbers the first -- a lost dismissal or a
// prune wiping a just-added cooldown. The chain survives rejections so one
// failed mutation never stalls later ones; the rejection still reaches the
// caller. Queued operations must use readCooldowns() directly -- calling the
// public getCooldowns() from inside the queue would enqueue a second operation
// on the same queue and deadlock (same rule as importAllDirect).
let cooldownWriteQueue: Promise<unknown> = Promise.resolve();

function queueCooldownWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = cooldownWriteQueue.then(operation);
  cooldownWriteQueue = next.catch((err) => {
    console.warn("[NavSentinel] smart-default cooldown serialization error:", err);
  });
  return next;
}

/** Read the stored map and compute the TTL-pruned view, without writing. */
async function readCooldowns(): Promise<{ pruned: CooldownMap; changed: boolean }> {
  const res = await chrome.storage.local.get(SMART_DEFAULT_COOLDOWNS_KEY);
  const raw = res[SMART_DEFAULT_COOLDOWNS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { pruned: {}, changed: false };

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

  return { pruned, changed };
}

/**
 * Get the cooldown map from storage.
 * Prunes expired entries on read.
 */
export async function getCooldowns(): Promise<CooldownMap> {
  const { pruned, changed } = await readCooldowns();
  if (!changed) return pruned;

  // Persist the pruned map through the write queue, re-reading under the lock:
  // a setCooldown/clearCooldown that landed after our read must not be clobbered
  // by this stale prune snapshot.
  return queueCooldownWrite(async () => {
    const fresh = await readCooldowns();
    if (fresh.changed) {
      await chrome.storage.local.set({ [SMART_DEFAULT_COOLDOWNS_KEY]: fresh.pruned });
    }
    return fresh.pruned;
  });
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
 * Pure helper: bound a cooldown map to at most `limit` entries, keeping the entries
 * with the latest expiry (most future cooldowns) and dropping the soonest-to-expire.
 * Returns the same object reference when already within the limit so callers can skip
 * a redundant write. (#308)
 */
export function capCooldowns(
  cooldowns: CooldownMap,
  limit: number = SMART_DEFAULT_COOLDOWN_LIMIT
): CooldownMap {
  const keys = Object.keys(cooldowns);
  if (keys.length <= limit) return cooldowns;
  // Sort by expiry descending (latest first) and keep the first `limit`.
  keys.sort((a, b) => (cooldowns[b] ?? 0) - (cooldowns[a] ?? 0));
  const kept: CooldownMap = {};
  for (let i = 0; i < limit; i++) {
    const key = keys[i]!;
    kept[key] = cooldowns[key]!;
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
  return queueCooldownWrite(async () => {
    const { pruned } = await readCooldowns();
    pruned[pairKey(sourceDomain, destDomain)] = Date.now() + SMART_DEFAULT_COOLDOWN_MS;
    await chrome.storage.local.set({
      [SMART_DEFAULT_COOLDOWNS_KEY]: capCooldowns(pruned)
    });
  });
}

/**
 * Remove the cooldown for a domain pair (called when user accepts "Always Allow").
 */
export async function clearCooldown(
  sourceDomain: string,
  destDomain: string
): Promise<void> {
  return queueCooldownWrite(async () => {
    const { pruned } = await readCooldowns();
    delete pruned[pairKey(sourceDomain, destDomain)];
    await chrome.storage.local.set({ [SMART_DEFAULT_COOLDOWNS_KEY]: pruned });
  });
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
