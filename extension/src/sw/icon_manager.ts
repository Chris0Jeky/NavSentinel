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
  // Append to the tab's chain so same-tab updates apply strictly in order
  // (last-write-wins). The .catch keeps one failed/cancelled update from breaking
  // the chain for the next one; applyTabIcon never rejects, so the chain is stable.
  const prev = tabUpdateChains.get(tabId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => applyTabIcon(tabId, state, blockCount));
  tabUpdateChains.set(tabId, next);
  // Drop the chain entry once it drains, but only if no newer update has replaced it
  // (otherwise we would orphan the in-flight tail).
  void next.finally(() => {
    if (tabUpdateChains.get(tabId) === next) tabUpdateChains.delete(tabId);
  });
  return next;
}

async function applyTabIcon(
  tabId: number,
  state: IconState,
  blockCount: number,
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
    // Cache the state ONLY after the badge writes resolve, so getTabIconState never
    // claims a state the badge never reached.
    tabState.set(tabId, { icon: state, blocks: blockCount });
    pruneTabState();
  } catch {
    // Tab closed or extension context invalidated. Deliberately do NOT cache the
    // unapplied state: leaving the prior cache means the apply-time dedup above
    // cannot suppress a later corrective re-render to this same state. (#229)
  }
}

export function clearTabIcon(tabId: number): void {
  tabState.delete(tabId);
  tabUpdateChains.delete(tabId);
  try {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  } catch {
    // ignore
  }
}

export function getTabIconState(tabId: number): IconState {
  return tabState.get(tabId)?.icon ?? "gray";
}

export async function setAllTabsGray(): Promise<void> {
  tabState.clear();
  tabUpdateChains.clear();
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => {
      if (tab.id === undefined) return Promise.resolve();
      return chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {});
    }),
  );
}

/** Exposed for testing only. */
export function _getTabStateMap(): Map<number, { icon: IconState; blocks: number }> {
  return tabState;
}
