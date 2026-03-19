import { getNavSettings, SUITE_SETTINGS_KEY } from "../shared/storage";

const BASELINE_RULESET_ID = "baseline";
const NAV_ALLOW_TTL_MS = 1500;
const NAV_GESTURE_TTL_MS = 1500;
const NAV_TARGET_ALLOW_TTL_MS = 10000;
const ROLLBACK_SUPPRESS_MS = 6000;

const allowUntilByTab = new Map<number, number>();
const gestureUntilByTab = new Map<number, number>();
const allowStartedByTab = new Map<number, string>();
const allowTargetByTab = new Map<number, { url: string; expiresAt: number }>();
const suppressUntilByTab = new Map<number, number>();
const readyTabs = new Set<number>();
const pendingRollbackByTab = new Map<number, { url: string; prevUrl?: string; qualifiers: string[] }>();
const pendingForwardByTab = new Map<number, { url: string; ts: number }>();
const lastUrlByTab = new Map<number, string>();
const lastCommittedByTab = new Map<
  number,
  {
    url: string;
    prevUrl?: string;
    transitionType: string;
    qualifiers: string[];
    ts: number;
    allowedAtCommit: boolean;
  }
>();

async function syncDnrRulesets(): Promise<void> {
  try {
    const settings = await getNavSettings();
    const enable = settings.dnrEnabled ? [BASELINE_RULESET_ID] : [];
    const disable = settings.dnrEnabled ? [] : [BASELINE_RULESET_ID];
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable,
      disableRulesetIds: disable
    });
  } catch (err) {
    console.warn("[NavSentinel] Failed to sync DNR rulesets", err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void syncDnrRulesets();
});

chrome.runtime.onStartup.addListener(() => {
  void syncDnrRulesets();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes[SUITE_SETTINGS_KEY]) return;
  void syncDnrRulesets();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "ns-allow-nav") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const ttl = typeof message.ttlMs === "number" ? message.ttlMs : NAV_ALLOW_TTL_MS;
      allowUntilByTab.set(tabId, Date.now() + ttl);
    }
    sendResponse?.({ ok: true });
  }

  if (message.type === "ns-nav-gesture") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const ttl = typeof message.ttlMs === "number" ? message.ttlMs : NAV_GESTURE_TTL_MS;
      gestureUntilByTab.set(tabId, Date.now() + ttl);
    }
    sendResponse?.({ ok: true });
  }

  if (message.type === "ns-allow-target-nav") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && typeof message.url === "string" && message.url) {
      const ttl = typeof message.ttlMs === "number" ? message.ttlMs : NAV_TARGET_ALLOW_TTL_MS;
      allowTargetByTab.set(tabId, {
        url: message.url,
        expiresAt: Date.now() + ttl
      });
    }
    sendResponse?.({ ok: true });
  }

  if (message.type === "ns-ready") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      readyTabs.add(tabId);
      const pending = pendingRollbackByTab.get(tabId);
      if (pending) {
        pendingRollbackByTab.delete(tabId);
        chrome.tabs.sendMessage(tabId, {
          type: "ns-rollback",
          url: pending.url,
          ...(pending.prevUrl !== undefined ? { prevUrl: pending.prevUrl } : {}),
          qualifiers: pending.qualifiers
        });
      }
    }
  }

  if (message.type === "ns-check-rollback") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const entry = lastCommittedByTab.get(tabId);
      sendResponse?.({
        shouldRollback: !!entry && !entry.allowedAtCommit,
        entry,
        prevUrl: entry?.prevUrl
      });
    }
  }

  if (message.type === "ns-store-forward") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && typeof message.url === "string") {
      pendingForwardByTab.set(tabId, { url: message.url, ts: Date.now() });
    }
  }

  if (message.type === "ns-check-forward") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const forward = pendingForwardByTab.get(tabId);
      const currentUrl = typeof message.currentUrl === "string" ? message.currentUrl : "";
      if (forward && currentUrl && forward.url === currentUrl) {
        sendResponse?.({ url: "" });
        return;
      }
      if (forward) pendingForwardByTab.delete(tabId);
      sendResponse?.({ url: forward?.url });
    }
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  readyTabs.delete(details.tabId);
  allowStartedByTab.delete(details.tabId);
  const now = Date.now();
  const allowUntil = allowUntilByTab.get(details.tabId) ?? 0;
  const gestureUntil = gestureUntilByTab.get(details.tabId) ?? 0;
  if (now > allowUntil && now > gestureUntil) return;
  allowStartedByTab.set(details.tabId, details.url);
  if (now <= gestureUntil) {
    gestureUntilByTab.delete(details.tabId);
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const now = Date.now();
  const targetAllowance = allowTargetByTab.get(details.tabId);
  const targetAllowed =
    !!targetAllowance &&
    now <= targetAllowance.expiresAt &&
    targetAllowance.url === details.url;
  if (targetAllowance) {
    allowTargetByTab.delete(details.tabId);
  }
  const prevUrl = lastUrlByTab.get(details.tabId);
  lastUrlByTab.set(details.tabId, details.url);

  const qualifiers = details.transitionQualifiers ?? [];
  const isRedirect =
    qualifiers.includes("client_redirect") || qualifiers.includes("server_redirect");
  const isUserTyped =
    details.transitionType === "typed" ||
    details.transitionType === "auto_bookmark" ||
    qualifiers.includes("from_address_bar");
  const isLinkish = details.transitionType === "link";

  if (isUserTyped) return;
  if (!isRedirect && !isLinkish) return;

  const allowUntil = allowUntilByTab.get(details.tabId) ?? 0;
  const startedUrl = allowStartedByTab.get(details.tabId);
  const startedAllowed = startedUrl === details.url;
  const allowedAtCommit = now <= allowUntil || startedAllowed || targetAllowed;
  allowStartedByTab.delete(details.tabId);
  lastCommittedByTab.set(details.tabId, {
    url: details.url,
    ...(prevUrl !== undefined ? { prevUrl } : {}),
    transitionType: details.transitionType,
    qualifiers,
    ts: now,
    allowedAtCommit
  });

  if (allowedAtCommit) return;

  const suppressUntil = suppressUntilByTab.get(details.tabId) ?? 0;
  if (now <= suppressUntil) return;

  pendingForwardByTab.set(details.tabId, { url: details.url, ts: now });
  suppressUntilByTab.set(details.tabId, now + ROLLBACK_SUPPRESS_MS);

  if (readyTabs.has(details.tabId)) {
    chrome.tabs.sendMessage(details.tabId, {
      type: "ns-rollback",
      url: details.url,
      ...(prevUrl !== undefined ? { prevUrl } : {}),
      qualifiers
    });
  } else {
    pendingRollbackByTab.set(details.tabId, {
      url: details.url,
      ...(prevUrl !== undefined ? { prevUrl } : {}),
      qualifiers
    });
  }
});

chrome.webNavigation.onErrorOccurred?.addListener((details) => {
  if (details.frameId !== 0) return;
  readyTabs.delete(details.tabId);
  allowStartedByTab.delete(details.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  allowUntilByTab.delete(tabId);
  gestureUntilByTab.delete(tabId);
  allowStartedByTab.delete(tabId);
  allowTargetByTab.delete(tabId);
  suppressUntilByTab.delete(tabId);
  readyTabs.delete(tabId);
  pendingRollbackByTab.delete(tabId);
  pendingForwardByTab.delete(tabId);
  lastCommittedByTab.delete(tabId);
  lastUrlByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const forward = pendingForwardByTab.get(tabId);
  if (!forward) return;
  if (changeInfo.status !== "complete" && !changeInfo.url) return;
  const currentUrl = tab.url ?? changeInfo.url ?? "";
  if (!currentUrl || currentUrl === forward.url) return;
  pendingForwardByTab.delete(tabId);
  chrome.tabs.sendMessage(tabId, { type: "ns-forward-offer", url: forward.url });
});
