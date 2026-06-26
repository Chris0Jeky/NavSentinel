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
 * remove within the 5s window — without a cap the Map grows unbounded.
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

/** Decision returned by {@link shouldEmitRapidPushState}. */
export interface RapidPushStateDecision {
  /** Whether to emit a `rapid_pushstate` alert for this call. */
  emit: boolean;
  /** The new value of the caller's "already emitted for this burst" flag. */
  emitted: boolean;
}

/**
 * Decide whether a pushState/replaceState call should emit a `rapid_pushstate`
 * alert, deduplicating to the RISING EDGE of a burst (#302).
 *
 * The old code returned `rapid_pushstate` on EVERY call once the windowed count
 * reached the threshold, so a tight pushState loop emitted one priority bridge
 * message per call. Before the bridge handshake completes those buffer into the
 * 32-slot priority OutboundQueue; ~32 duplicate alerts fill it and a subsequent
 * (also-priority) `ns-nav-blocked` is silently dropped — losing detection for a
 * real blocked navigation. Emitting once per burst keeps the queue from
 * saturating on duplicates.
 *
 * @param recentCount   pushState timestamps within the rapid window (after prune)
 * @param threshold     PUSHSTATE_RAPID_THRESHOLD
 * @param alreadyEmitted caller's flag: did this sustained burst already alert?
 */
export function shouldEmitRapidPushState(
  recentCount: number,
  threshold: number,
  alreadyEmitted: boolean,
): RapidPushStateDecision {
  if (recentCount >= threshold) {
    // Emit only on the rising edge; suppress for the rest of the sustained burst.
    return { emit: !alreadyEmitted, emitted: true };
  }
  // Below threshold: the burst has subsided, so re-arm for the next one.
  return { emit: false, emitted: false };
}
