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
 * Redirect (form-submit) allowance for the MAIN-world guard (#864).
 *
 * The isolated world decides every trusted click and, when it allows one,
 * sends `ns-allow` over the bridge MessagePort. That message is delivered a
 * task later, so a page that submits its own form synchronously or in a
 * microtask from its click handler used to find no allowance, while the same
 * submit deferred by one task passed. The MAIN world therefore arms the SAME
 * allowance for the click's own task from a document-capture listener that runs
 * after the isolated world's window-capture decision. Every trusted click that
 * world allows arms it, as the deferred grant always did; only a click that
 * world stops (its interceptBlank/blockSameTab branches call
 * stopImmediatePropagation) never reaches the listener. The isolated message
 * stays the authority for everything after that task.
 *
 * Invariant: this never grants more than the one-task-deferred submit already
 * got. The same-task arm has the isolated grant's scope (unrestricted in the
 * top frame, the declared submit action in a child frame), is cleared by the
 * next timer tick and in any case within the grant TTL (a delayed timer cannot
 * stretch it further), and shares the per-gesture budget: the isolated follow-up for an armed
 * click keeps the redirects already spent instead of resetting them. The
 * follow-up is recognised by the click's `event.timeStamp`, which both worlds
 * read from the same Event (measured identical on Chromium).
 */
export interface RedirectAllowanceState {
  /** End of the window granted by the isolated world's `ns-allow`; 0 = none. */
  until: number;
  restrict: boolean;
  target: string;
  /** Same-task allowance armed by this world's trusted-click listener. */
  sameTaskArmed: boolean;
  sameTaskArmedAt: number;
  sameTaskRestrict: boolean;
  sameTaskTarget: string;
  /** Redirects spent in the current gesture, shared by both allowances. */
  count: number;
  /** `event.timeStamp` of armed clicks whose isolated grant has not arrived. */
  pendingFollowUps: number[];
}

export interface RedirectAllowanceLimits {
  /** Lifetime of an isolated grant, and the outer bound of a same-task arm. */
  ttlMs: number;
  /** Redirects one gesture may spend across both allowances. */
  maxPerGesture: number;
  /** Bound on remembered same-task arms awaiting their follow-up. */
  maxPendingFollowUps: number;
}

/** Where a redirect allowance may be spent. */
export interface RedirectAllowanceScope {
  /** When true, only `target` (an exact action URL) may be spent. */
  restrict: boolean;
  target: string;
}

export function createRedirectAllowance(): RedirectAllowanceState {
  return {
    until: 0,
    restrict: false,
    target: "",
    sameTaskArmed: false,
    sameTaskArmedAt: 0,
    sameTaskRestrict: false,
    sameTaskTarget: "",
    count: 0,
    pendingFollowUps: [],
  };
}

/**
 * Arm the allowance for the current task after a trusted click that the
 * isolated world did not block. Starts the gesture's budget, as the isolated
 * grant for the same click would one task later.
 */
export function armSameTaskRedirect(
  state: RedirectAllowanceState,
  now: number,
  gestureTs: number,
  scope: RedirectAllowanceScope,
  limits: RedirectAllowanceLimits,
): void {
  state.count = 0;
  state.sameTaskArmed = true;
  state.sameTaskArmedAt = now;
  state.sameTaskRestrict = scope.restrict;
  state.sameTaskTarget = scope.target;
  state.pendingFollowUps.push(gestureTs);
  if (state.pendingFollowUps.length > limits.maxPendingFollowUps) state.pendingFollowUps.shift();
}

/** End the same-task arm; called from the next task. */
export function endSameTaskRedirect(state: RedirectAllowanceState): void {
  state.sameTaskArmed = false;
}

/**
 * Apply an isolated-world `ns-allow` grant. When it carries the `gestureTs` of
 * a click this world already armed, it is that click's follow-up and the
 * gesture's spent redirects carry over; any grant without a matching click
 * (a rollback grant, a click this world never saw) restarts the budget exactly
 * as before #864. Grants arrive in click order over one port, so armed clicks
 * older than the matched one never received a grant and are dropped.
 */
export function applyIsolatedRedirectAllowance(
  state: RedirectAllowanceState,
  now: number,
  grant: RedirectAllowanceScope & { allowRedirect: boolean; gestureTs?: number },
  limits: RedirectAllowanceLimits,
): void {
  const pending = state.pendingFollowUps;
  const match = grant.gestureTs === undefined ? -1 : pending.indexOf(grant.gestureTs);
  if (match >= 0) {
    pending.splice(0, match + 1);
  } else {
    state.count = 0;
  }
  state.until = grant.allowRedirect ? now + limits.ttlMs : 0;
  state.restrict = grant.restrict;
  state.target = grant.target;
}

/**
 * Spend one redirect for a submission to `actionUrl` if either allowance
 * covers it and the gesture budget is not exhausted.
 */
export function consumeRedirect(
  state: RedirectAllowanceState,
  now: number,
  actionUrl: string | undefined,
  limits: RedirectAllowanceLimits,
): boolean {
  if (state.count >= limits.maxPerGesture) return false;
  const inScope = (restrict: boolean, target: string) =>
    !restrict || (actionUrl !== undefined && actionUrl !== "" && actionUrl === target);
  const isolated = state.until > 0 && now <= state.until && inScope(state.restrict, state.target);
  const sameTask =
    state.sameTaskArmed &&
    now - state.sameTaskArmedAt <= limits.ttlMs &&
    inScope(state.sameTaskRestrict, state.sameTaskTarget);
  if (!isolated && !sameTask) return false;
  state.count += 1;
  return true;
}

/**
 * #943: a declared new-tab link whose click the page cancels and replaces with
 * its own `window.open()`. YouTube's embedded player does this for "Watch on
 * YouTube", and so do many share and "open in new tab" widgets. The native
 * click would have opened the link's own href in a new tab; the page's
 * `window.open()` of that same destination adds no authority, so a trusted
 * click on such a link arms a one-shot allowance bound to the link's origin and
 * path. A different destination, a target that could navigate an existing
 * browsing context (`_top`, `_self`, `_parent`, or a name), or an open after
 * the short lifetime stays gated.
 */
export interface AnchorOpenIntent {
  origin: string;
  pathname: string;
  until: number;
}

export function anchorOpenIntentFor(href: string, now: number, ttlMs: number): AnchorOpenIntent | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return { origin: parsed.origin, pathname: parsed.pathname, until: now + ttlMs };
}

export function matchesAnchorOpenIntent(
  intent: AnchorOpenIntent | null,
  now: number,
  url: string | undefined,
  target: string | undefined,
  baseHref: string,
): boolean {
  if (!intent || now > intent.until) return false;
  const normalizedTarget = (target ?? "").trim().toLowerCase();
  if (normalizedTarget !== "" && normalizedTarget !== "_blank") return false;
  if (url === undefined || url.trim() === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(url, baseHref);
  } catch {
    return false;
  }
  return parsed.origin === intent.origin && parsed.pathname === intent.pathname;
}
