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
 * form.submit / form.requestSubmit in a tight synchronous loop, and every blocked
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
  const pruned = timestamps.filter((ts) => ts >= cutoff);
  // A non-positive cap means "keep nothing". Guard it explicitly: slice(-cap) with
  // cap === 0 is slice(-0), and -0 normalizes to +0 under ToIntegerOrInfinity, so
  // slice(0) would return the WHOLE array — the opposite of a zero cap. A negative
  // cap would also mis-slice from the front. Dormant today (the only caller passes
  // PUSHSTATE_RAPID_CAP = 8) but a latent footgun in a DoS-cap helper. (#401)
  if (cap <= 0) return [];
  if (pruned.length > cap) return pruned.slice(-cap);
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

/**
 * Upper bound on `domain_like_path_after_gesture` (gesture-branch) pushstate alerts that
 * can be emitted within one gesture window (#377/F1). That branch only fires for pushState
 * events BELOW the rapid threshold (at or above it, the rapid branch + its cooldown handle
 * the flood), so it is inherently rate-limited: at most `rapidThreshold - 1` events per
 * `rapidWindowMs`, sustained across `gestureWindowMs`. The result must stay well under the
 * priority OutboundQueue's scarce-signal capacity, or a future constant change could let
 * this scarce signal itself flood the buffer. Enforced by a unit test on the production
 * constants; keep that test in sync with the PUSHSTATE_* constants in main_guard.ts.
 */
export function gestureBranchEmissionBound(
  gestureWindowMs: number,
  rapidWindowMs: number,
  rapidThreshold: number,
): number {
  // Events strictly below the rapid threshold per rapid window (at/above it the rapid
  // branch + cooldown take over). A threshold of 1 leaves zero below-threshold events,
  // so the gesture branch can never fire.
  const belowThresholdPerWindow = Math.max(0, rapidThreshold - 1);
  if (!Number.isFinite(rapidWindowMs) || rapidWindowMs <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil((gestureWindowMs * belowThresholdPerWindow) / rapidWindowMs);
}

/**
 * The browsing-context name a form submission targets, resolved the way the
 * HTML "get an element's target" steps do: the submitter's `formtarget`
 * attribute when present (only `requestSubmit(submitter)` has a submitter),
 * else the form's `target` attribute, else the first `<base target>` in the
 * form's document, else the empty string (this browsing context). Attribute
 * PRESENCE decides, so an explicitly empty value still overrides. (#865)
 */
export function effectiveFormTarget(form: HTMLFormElement, submitter?: Element | null): string {
  const fromSubmitter = submitter?.getAttribute("formtarget");
  if (typeof fromSubmitter === "string") return fromSubmitter;
  const fromForm = form.getAttribute("target");
  if (fromForm !== null) return fromForm;
  return form.ownerDocument?.querySelector("base[target]")?.getAttribute("target") ?? "";
}

/**
 * Upper bound on how many direct child navigables {@link targetsChildNavigable}
 * compares by identity. A page can replace `window.length` (it is
 * [Replaceable]); callers read the native getter, and this cap bounds the loop
 * even if they cannot.
 */
export const MAX_CHILD_NAVIGABLE_SCAN = 256;

/** What {@link targetsChildNavigable} reads from the current window. */
export interface ChildNavigableView {
  /** This browsing context's own current name. */
  selfName: string;
  /**
   * The browser's named-property lookup for `name` on this window: the child
   * navigable's WindowProxy when a direct child currently has that target
   * name, else an element, a collection, or undefined.
   */
  namedObject(name: string): unknown;
  /** Number of direct child navigables. */
  childCount: number;
  /** The WindowProxy of direct child navigable `index`. */
  child(index: number): unknown;
}

/**
 * True when a navigation targeting `target` lands in a DIRECT child navigable
 * of this document, which cannot navigate this tab (#865). Hidden-iframe
 * uploads, SSO keep-alive posts, 3-D Secure challenge frames and analytics
 * beacons all post into a named iframe of their own page.
 *
 * Mirrors Chromium's name resolution for the cases it answers `true`:
 *   - `_self`, `_top`, `_parent`, `_blank` and the empty name keep their
 *     keyword meaning (case-insensitive), so they never count;
 *   - the browser checks THIS context's own name before its children, so a
 *     name this context also carries navigates this context, not a child;
 *   - the named lookup reflects a child's CURRENT name, cross-origin children
 *     included, so a child that renamed itself no longer answers to its old
 *     `<iframe name>`;
 *   - a name nothing answers to opens a new window, so it does not count.
 * The candidate must be identical to one of the indexed child WindowProxies,
 * so an element with that id or name, or a page global aliasing some other
 * window, is not accepted. Descendants deeper than one level are not searched;
 * such a target keeps the existing gate (a false positive, never a bypass).
 */
export function targetsChildNavigable(target: string, view: ChildNavigableView): boolean {
  if (!target) return false;
  const keyword = target.toLowerCase();
  if (keyword === "_self" || keyword === "_top" || keyword === "_parent" || keyword === "_blank") {
    return false;
  }
  if (target === view.selfName) return false;
  const candidate = view.namedObject(target);
  if (candidate === null || candidate === undefined) return false;
  const count = Math.min(view.childCount, MAX_CHILD_NAVIGABLE_SCAN);
  for (let index = 0; index < count; index += 1) {
    if (view.child(index) === candidate) return true;
  }
  return false;
}
