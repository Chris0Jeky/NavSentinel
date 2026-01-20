import { getSettings, SETTINGS_KEY } from "../shared/storage";

const BASELINE_RULESET_ID = "baseline";
const NAV_ALLOW_TTL_MS = 1500;
const ROLLBACK_SUPPRESS_MS = 6000;

const allowUntilByTab = new Map<number, number>();
const suppressUntilByTab = new Map<number, number>();

async function syncDnrRulesets(): Promise<void> {
  try {
    const settings = await getSettings();
    const enable = settings.dnrEnabled ? [BASELINE_RULESET_ID] : [];
    const disable = settings.dnrEnabled ? [] : [BASELINE_RULESET_ID];
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable,
      disableRulesetIds: disable
    });
  } catch (err) {
    // eslint-disable-next-line no-console
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
  if (!changes[SETTINGS_KEY]) return;
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
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const qualifiers = details.transitionQualifiers ?? [];
  const isRedirect =
    qualifiers.includes("client_redirect") || qualifiers.includes("server_redirect");

  if (!isRedirect) return;

  const now = Date.now();
  const allowUntil = allowUntilByTab.get(details.tabId) ?? 0;
  if (now <= allowUntil) return;

  const suppressUntil = suppressUntilByTab.get(details.tabId) ?? 0;
  if (now <= suppressUntil) return;

  suppressUntilByTab.set(details.tabId, now + ROLLBACK_SUPPRESS_MS);
  chrome.tabs.sendMessage(details.tabId, {
    type: "ns-rollback",
    url: details.url,
    qualifiers
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  allowUntilByTab.delete(tabId);
  suppressUntilByTab.delete(tabId);
});
