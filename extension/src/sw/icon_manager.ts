export type IconState = "green" | "yellow" | "red" | "gray";

const BADGE_CONFIG: Record<IconState, { text: string; color: string } | null> = {
  green: { text: "✓", color: "#16a34a" },
  yellow: { text: "!", color: "#ca8a04" },
  red: { text: "✕", color: "#dc2626" },
  gray: null,
};

const tabState = new Map<number, { icon: IconState; blocks: number }>();

export async function updateTabIcon(
  tabId: number,
  state: IconState,
  blockCount = 0,
): Promise<void> {
  const current = tabState.get(tabId);
  if (current && current.icon === state && current.blocks === blockCount) return;
  tabState.set(tabId, { icon: state, blocks: blockCount });

  try {
    const config = BADGE_CONFIG[state];
    if (!config) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      return;
    }

    const text = blockCount > 0 ? String(blockCount) : config.text;
    await chrome.action.setBadgeBackgroundColor({ tabId, color: config.color });
    await chrome.action.setBadgeText({ tabId, text });
  } catch {
    // Tab may have closed or extension context invalidated
  }
}

export function clearTabIcon(tabId: number): void {
  tabState.delete(tabId);
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
  const ids = [...tabState.keys()];
  tabState.clear();
  await Promise.all(
    ids.map((tabId) => {
      try {
        return chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
      } catch {
        return Promise.resolve();
      }
    }),
  );
}

/** Exposed for testing only. */
export function _getTabStateMap(): Map<number, { icon: IconState; blocks: number }> {
  return tabState;
}
