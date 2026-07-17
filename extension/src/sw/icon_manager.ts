export type IconState = "green" | "yellow" | "red" | "gray";

const BADGE_CONFIG: Record<IconState, { text: string; color: string } | null> = {
  green: { text: "✓", color: "#16a34a" },
  yellow: { text: "!", color: "#ca8a04" },
  red: { text: "✕", color: "#dc2626" },
  gray: null,
};

const tabState = new Map<number, { icon: IconState; blocks: number }>();

// Per-tab serialization chain. updateTabIcon appends each update to its tab's chain
// so two same-tab updates never interleave their setBadge* calls — without this, the
// background-color write from one invocation and the text write from another could
// resolve out of order and leave a torn badge (e.g. red background + green check),
// while the synchronous cache recorded whichever ran last. (#229)
const tabUpdateChains = new Map<number, Promise<void>>();

// Monotonic counter bumped by clearTabIcon / setAllTabsGray. An in-flight applyTabIcon
// captures it before its awaits and skips its cache write if it changed meanwhile, so a
// clear/reset that races an in-flight update is not silently UNDONE by the later
// cache write (the old code wrote the cache synchronously BEFORE the awaits, so a clear
// won; caching after the awaits would otherwise resurrect the entry). Tradeoff: a clear
// of one tab also skips the cache write of an unrelated in-flight update — harmless and
// self-healing (the badge writes already applied; the next update re-renders + re-caches),
// and getTabIconState has no production consumer. (#229)
let resetGeneration = 0;

// Cap tabState size to prevent unbounded memory growth in long-lived SW.
// Other per-tab Maps in the SW use similar pruning (e.g. DBLCLICK_CHILD_PRUNE_LIMIT).
const TAB_STATE_MAX = 200;

function pruneTabState(): void {
  if (tabState.size <= TAB_STATE_MAX) return;
  const excess = tabState.size - TAB_STATE_MAX;
  let removed = 0;
  for (const key of tabState.keys()) {
    if (removed >= excess) break;
    tabState.delete(key);
    removed++;
  }
}

export function updateTabIcon(
  tabId: number,
  state: IconState,
  blockCount = 0,
): Promise<void> {
  // Snapshot the reset generation NOW (at schedule time), not when applyTabIcon later runs
  // in the .then microtask. clearTabIcon / setAllTabsGray bump resetGeneration SYNCHRONOUSLY,
  // so a clear called after this returns but before the queued apply would otherwise be
  // captured by applyTabIcon's apply-time default — making its post-write guard compare
  // against the already-bumped value, pass, and resurrect a ghost cache entry for the cleared
  // tab. Capturing here (like updateTabIconWhen) lets that guard detect the racing clear and
  // skip the cache write. (#394, mirrors #327)
  const genAtEnqueue = resetGeneration;
  // Append to the tab's chain so same-tab updates apply strictly in order
  // (last-write-wins). The .catch keeps one failed/cancelled update from breaking
  // the chain for the next one; applyTabIcon never rejects, so the chain is stable.
  const prev = tabUpdateChains.get(tabId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => applyTabIcon(tabId, state, blockCount, genAtEnqueue));
  tabUpdateChains.set(tabId, next);
  // Drop the chain entry once it drains, but only if no newer update has replaced it
  // (otherwise we would orphan the in-flight tail).
  void next.finally(() => {
    if (tabUpdateChains.get(tabId) === next) tabUpdateChains.delete(tabId);
  });
  return next;
}

/**
 * Like updateTabIcon, but the paint waits for `ready` to settle and the icon state is
 * computed from `state()` at paint time. The tab's chain slot is reserved SYNCHRONOUSLY at
 * call time, so any updateTabIcon for the same tab enqueued LATER (e.g. a content-script
 * threat escalation) is ordered strictly after this paint and can never be overwritten by
 * it — even when `ready` resolves much later. Used for the onCommitted baseline reset, whose
 * green/gray color depends on the async cachedDefaultMode read but which must still be
 * ordered before the page's own escalation. (#327)
 */
export function updateTabIconWhen(
  tabId: number,
  ready: Promise<unknown>,
  state: () => IconState,
  blockCount = 0,
): Promise<void> {
  // Snapshot the reset generation NOW, before awaiting `ready`. If a clearTabIcon /
  // setAllTabsGray bumps it during the await, applyTabIcon's post-write guard (which
  // compares against this snapshot) skips the cache write, so this deferred reset cannot
  // leave a ghost cache entry for a cleared/removed tab. The badge writes still occur but
  // are superseded by the chained blank/gray that the clear enqueued after us. (#327)
  const genAtEnqueue = resetGeneration;
  const prev = tabUpdateChains.get(tabId) ?? Promise.resolve();
  // ready.catch keeps a rejected readiness promise from breaking the chain; applyTabIcon
  // never rejects, so the chain stays stable.
  const next = prev
    .catch(() => {})
    .then(() => ready.catch(() => {}))
    .then(() => applyTabIcon(tabId, state(), blockCount, genAtEnqueue));
  tabUpdateChains.set(tabId, next);
  void next.finally(() => {
    if (tabUpdateChains.get(tabId) === next) tabUpdateChains.delete(tabId);
  });
  return next;
}

async function applyTabIcon(
  tabId: number,
  state: IconState,
  blockCount: number,
  // Generation captured at SCHEDULE time by the caller. Both updateTabIcon and
  // updateTabIconWhen now pass their pre-await snapshot so a clearTabIcon / setAllTabsGray
  // that races the chain drain (or the `ready` await) is detected by the post-write guard
  // below — otherwise the deferred apply would write a ghost cache entry for a tab that was
  // just cleared. The default is a defensive fallback for any direct caller. (#327 / #229 / #394)
  startGeneration: number = resetGeneration,
): Promise<void> {
  // Dedup is evaluated HERE (at apply time), not before queueing: a synchronous
  // top-level dedup against the cache would wrongly skip a needed update when an
  // in-flight update is moving the badge to a different state. By the time this runs,
  // the cache reflects the immediately-preceding applied state for this tab.
  const current = tabState.get(tabId);
  if (current && current.icon === state && current.blocks === blockCount) return;

  try {
    const config = BADGE_CONFIG[state];
    if (!config) {
      await chrome.action.setBadgeText({ tabId, text: "" });
    } else {
      const text = blockCount > 0 ? String(blockCount) : config.text;
      await chrome.action.setBadgeBackgroundColor({ tabId, color: config.color });
      await chrome.action.setBadgeText({ tabId, text });
    }
    // A clearTabIcon / setAllTabsGray ran while we awaited — do NOT resurrect the cache
    // it just erased. (#229)
    if (resetGeneration !== startGeneration) return;
    // Cache the state ONLY after the badge writes resolve, so getTabIconState never
    // claims a state the badge never reached. delete+set re-inserts this tab at the
    // END of the Map so pruneTabState (which evicts oldest-inserted) can never
    // immediately evict the entry we just wrote — which would make the next
    // apply-time dedup miss and re-render. This also makes pruneTabState behave as
    // LRU-by-last-render (a frequently-rendered tab survives) rather than
    // FIFO-by-first-insertion. (#324/disc#8)
    tabState.delete(tabId);
    tabState.set(tabId, { icon: state, blocks: blockCount });
    pruneTabState();
  } catch {
    // Tab closed or extension context invalidated. Deliberately do NOT cache the
    // unapplied state: leaving the prior cache means the apply-time dedup above
    // cannot suppress a later corrective re-render to this same state. (#229)
  }
}

// Append a badge-blank to the tab's update chain so it is ordered strictly AFTER any
// in-flight applyTabIcon for that tab. A fire-and-forget blank (the old behavior) could
// race the in-flight setBadge* writes — which complete after their resetGeneration
// capture — and leave the badge NON-EMPTY (the in-flight update's colour/text) even
// though the cache was cleared. Routing the blank through the chain makes last-write-wins
// hold for clears too. (#272)
function blankBadgeOrdered(tabId: number): Promise<void> {
  const prev = tabUpdateChains.get(tabId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try {
      await chrome.action.setBadgeText({ tabId, text: "" });
    } catch {
      // Tab closed or extension context invalidated — nothing to blank.
    }
  });
  tabUpdateChains.set(tabId, next);
  void next.finally(() => {
    if (tabUpdateChains.get(tabId) === next) tabUpdateChains.delete(tabId);
  });
  return next;
}

export function clearTabIcon(tabId: number): Promise<void> {
  tabState.delete(tabId);
  resetGeneration++;
  // Do NOT drop the chain here: blankBadgeOrdered appends to it so the blank runs after
  // any in-flight update for this tab (the finally in blankBadgeOrdered prunes it). (#272)
  return blankBadgeOrdered(tabId);
}

export function getTabIconState(tabId: number): IconState {
  return tabState.get(tabId)?.icon ?? "gray";
}

export async function setAllTabsGray(): Promise<void> {
  tabState.clear();
  resetGeneration++;
  // Order each tab's blank after its in-flight update. Do NOT clear the chains: each
  // blankBadgeOrdered appends to (and self-prunes) its tab's chain, so an in-flight
  // update can no longer land its setBadge* writes after our blank. (#272)
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? Promise.resolve() : blankBadgeOrdered(tab.id))),
  );
}

/** Exposed for testing only. */
export function _getTabStateMap(): Map<number, { icon: IconState; blocks: number }> {
  return tabState;
}

/**
 * Reset ALL module-level state for test isolation. The plain `_getTabStateMap().clear()`
 * left `resetGeneration` monotonically elevated and `tabUpdateChains` populated across
 * tests, which is harmless today (tests rely on generation CHANGES, not absolute values)
 * but fragile under reordering/parallelism. Exposed for testing only.
 */
export function _resetForTesting(): void {
  tabState.clear();
  tabUpdateChains.clear();
  resetGeneration = 0;
}
