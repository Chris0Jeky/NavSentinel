/**
 * Pure helpers extracted from main_guard.ts so the DoS-hardening logic can be
 * unit-tested directly (main_guard patches MAIN-world prototypes at import time,
 * so it is not unit-importable). The MAIN-world wiring that calls these is
 * covered by the Gym/E2E pushstate fixtures. (#301, #302)
 */

/**
 * Evict the oldest entries from `map` until its size is at most `maxSize`.
 * Map iteration is insertion-ordered, so the first key is the oldest. Returns
 * the number of entries evicted.
 *
 * Used to bound `blockedActions` (#301): a page can call window.open /
 * location.assign / form.submit in a tight synchronous loop, and every blocked
 * call inserts a live closure-bearing entry that the TTL-only prune cannot
 * remove within the 5s window — without a cap the Map grows unbounded. Called
 * after every insert, so the Map is at most one over the cap and the loop runs
 * once; an evicted entry's allow-closure is gone, but the ns-allow-action
 * handler degrades gracefully (missing id → no-op).
 */
export function enforceMapSizeCap<K, V>(map: Map<K, V>, maxSize: number): number {
  if (maxSize < 0) maxSize = 0;
  let evicted = 0;
  while (map.size > maxSize) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
    evicted++;
  }
  return evicted;
}

/**
 * Prune a timestamp list to entries within `[now - windowMs, now]` and cap its
 * length to the `cap` most-recent. The cap is the load-bearing part for #302:
 * in a tight SYNCHRONOUS pushState loop every timestamp equals `now`, so the
 * window filter removes nothing and the array would grow unbounded (and re-filter
 * O(n) each call). We only ever need to know whether the count reached the rapid
 * threshold, so a small cap bounds memory and CPU without losing that signal.
 */
export function pruneTimestampWindow(
  timestamps: number[],
  now: number,
  windowMs: number,
  cap: number,
): number[] {
  const cutoff = now - windowMs;
  let pruned = timestamps.filter((ts) => ts >= cutoff);
  if (pruned.length > cap) pruned = pruned.slice(-cap);
  return pruned;
}

/** Decision returned by {@link shouldEmitRapidPushState}. */
export interface RapidPushStateDecision {
  /** Whether to emit a `rapid_pushstate` alert now. */
  emit: boolean;
  /** The new value of the caller's "last emitted at" timestamp. */
  lastEmitAt: number;
}

/**
 * Cooldown gate for `rapid_pushstate` alerts (#302). The caller invokes this only
 * once the windowed pushState count has reached the rapid threshold; this then
 * allows at most ONE alert per `cooldownMs`.
 *
 * The old code emitted on EVERY call past the threshold, so a tight pushState loop
 * produced one priority bridge message per call. Before the bridge handshake those
 * buffer into the 32-slot priority OutboundQueue; ~32 duplicates fill it and a later
 * (also-priority) `ns-nav-blocked` is silently dropped — detection lost for a real
 * blocked navigation. A per-window cooldown keeps a sustained flood to a few alerts
 * (re-alerting, unlike a one-shot flag) while leaving the queue room for `ns-nav-blocked`.
 */
export function shouldEmitRapidPushState(
  now: number,
  lastEmitAt: number,
  cooldownMs: number,
): RapidPushStateDecision {
  if (lastEmitAt === 0 || now - lastEmitAt >= cooldownMs) {
    return { emit: true, lastEmitAt: now };
  }
  return { emit: false, lastEmitAt };
}
