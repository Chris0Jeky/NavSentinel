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

// All document instances delegate mutations, including TTL pruning, to the
// worker. Only that worker's queue may read-modify-write this shared key (#976).
// A rejected write reaches its caller without poisoning subsequent operations.
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
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > now) {
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

  return mutateCooldowns({ type: "ns-smart-default-cooldown", op: "prune" });
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
  await mutateCooldowns({ type: "ns-smart-default-cooldown", op: "set", sourceDomain, destDomain });
}

/**
 * Remove the cooldown for a domain pair (called when user accepts "Always Allow").
 */
export async function clearCooldown(
  sourceDomain: string,
  destDomain: string
): Promise<void> {
  await mutateCooldowns({ type: "ns-smart-default-cooldown", op: "clear", sourceDomain, destDomain });
}

type CooldownMutation =
  | { type: "ns-smart-default-cooldown"; op: "prune" }
  | { type: "ns-smart-default-cooldown"; op: "set" | "clear"; sourceDomain: string; destDomain: string };

type CooldownMutationResponse =
  | { ok: true; cooldowns: CooldownMap }
  | { ok: false; error: string };

async function mutateCooldowns(message: CooldownMutation): Promise<CooldownMap> {
  if (typeof document === "undefined") return applyCooldownMutation(message);
  const response = await chrome.runtime.sendMessage(message) as CooldownMutationResponse | undefined;
  if (!response?.ok) throw new Error(response?.error ?? "Cooldown update was not confirmed");
  if (!response.cooldowns || typeof response.cooldowns !== "object" || Array.isArray(response.cooldowns)) {
    throw new Error("Cooldown update returned an invalid map");
  }
  return response.cooldowns;
}

// This entry point is private: document callers cannot opt out of delegation.
function applyCooldownMutation(message: CooldownMutation): Promise<CooldownMap> {
  return queueCooldownWrite(async () => {
    const { pruned, changed } = await readCooldowns();
    if (message.op === "set") {
      pruned[pairKey(message.sourceDomain, message.destDomain)] = Date.now() + SMART_DEFAULT_COOLDOWN_MS;
    } else if (message.op === "clear") {
      delete pruned[pairKey(message.sourceDomain, message.destDomain)];
    }
    const bounded = capCooldowns(pruned);
    if (message.op !== "prune" || changed || bounded !== pruned) {
      await chrome.storage.local.set({ [SMART_DEFAULT_COOLDOWNS_KEY]: bounded });
    }
    return bounded;
  });
}

/** Authenticated worker admission. Cooldowns never grant navigation authority. */
export async function handleSmartDefaultCooldownMessage(
  value: unknown,
  sender?: chrome.runtime.MessageSender,
): Promise<CooldownMutationResponse> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Invalid cooldown update" };
  }
  const message = value as Record<string, unknown>;
  if (message.type !== "ns-smart-default-cooldown" ||
      (message.op !== "set" && message.op !== "clear" && message.op !== "prune")) {
    return { ok: false, error: "Invalid cooldown operation" };
  }
  const runtime = chrome.runtime;
  const base = runtime.getURL("");
  const ownPage = !!base && !!sender?.url?.startsWith(base);
  const ownContent = Number.isSafeInteger(sender?.tab?.id) && (sender?.tab?.id ?? -1) >= 0 &&
    Number.isSafeInteger(sender?.frameId) && (sender?.frameId ?? -1) >= 0 &&
    typeof sender?.documentId === "string" && sender.documentId.length > 0;
  if (!runtime.id || sender?.id !== runtime.id || (!ownPage && !ownContent)) {
    return { ok: false, error: "Unauthorized cooldown update" };
  }
  const validDomain = (domain: unknown): domain is string =>
    typeof domain === "string" && domain.length > 0 && domain.length <= 253 &&
    domain.trim() === domain && !/[|\s]/u.test(domain);
  if (message.op !== "prune" && (!validDomain(message.sourceDomain) || !validDomain(message.destDomain))) {
    return { ok: false, error: "Invalid cooldown pair" };
  }
  try {
    const cooldowns = await applyCooldownMutation(message as CooldownMutation);
    return { ok: true, cooldowns };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
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
