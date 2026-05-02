import { getRegistrableDomain } from "../shared/domain";
import { initReputation, isKnownBadDomain, reputationReady } from "../shared/reputation";
import { getNavSettings, SUITE_SETTINGS_KEY } from "../shared/storage";

const BASELINE_RULESET_ID = "baseline";

/** Maximum .bin file size we will read (2 MB + 16-byte header, matching MAX_FILTER_BITS). */
const MAX_REPUTATION_FILE_BYTES = 2 * 1024 * 1024 + 16;

/** Load the bloom filter into SW memory so child frames can query via message. */
async function loadReputationFilter(): Promise<void> {
  try {
    const url = chrome.runtime.getURL("reputation_data.bin");
    const response = await fetch(url);
    if (!response.ok) return;
    const cl = response.headers.get("content-length");
    if (cl && Number(cl) > MAX_REPUTATION_FILE_BYTES) return;
    const data = await response.arrayBuffer();
    if (data.byteLength > MAX_REPUTATION_FILE_BYTES) return;
    initReputation(data);
  } catch {
    // Graceful degradation: reputation checks via SW will return false
  }
}

void loadReputationFilter();
const NAV_ALLOW_TTL_MS = 1500;
const NAV_GESTURE_TTL_MS = 1500;
const NAV_TARGET_ALLOW_TTL_MS = 10000;
const ROLLBACK_SUPPRESS_MS = 6000;
const ROLLBACK_RETURN_TTL_MS = 5000;
const TYPED_ORIGIN_TTL_MS = 5_000;
const TYPED_ORIGIN_MAX_MS = 15_000;
const DBLCLICK_CHILD_MAX_AGE_MS = 5_000;
const DBLCLICK_CHILD_PRUNE_LIMIT = 50;

const allowUntilByTab = new Map<number, number>();
const gestureUntilByTab = new Map<number, number>();
const allowStartedByTab = new Map<number, string>();
const allowTargetByTab = new Map<number, { url: string; expiresAt: number }>();
const suppressUntilByTab = new Map<number, number>();
const typedOriginByTab = new Map<number, { ts: number; deadline: number }>();
const readyTabs = new Set<number>();
const pendingRollbackByTab = new Map<number, { url: string; prevUrl?: string; qualifiers: string[] }>();
const pendingForwardByTab = new Map<number, { url: string; ts: number; returnUrl?: string }>();
const rollbackReturnByTab = new Map<number, { url: string; expiresAt: number }>();
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

// --- DoubleClickjacking: track child windows opened by tabs ---
// Maps child tabId -> { openerTabId, createdAt, openerNavObserved }
// openerNavObserved is set when the child tab sends ns-dblclick-opener-nav,
// confirming it wrote to opener.location.
const childWindowByTab = new Map<number, { openerTabId: number; createdAt: number; openerNavObserved: boolean }>();

function pruneStaleChildWindows(): void {
  const now = Date.now();
  // Always prune entries older than 2x the max age to prevent stale
  // correlations from tab ID reuse, regardless of map size.
  for (const [tabId, entry] of childWindowByTab) {
    if (now - entry.createdAt > DBLCLICK_CHILD_MAX_AGE_MS * 2) {
      childWindowByTab.delete(tabId);
    }
  }
  // Hard cap: if still over limit after age-based pruning, drop oldest entries.
  if (childWindowByTab.size > DBLCLICK_CHILD_PRUNE_LIMIT) {
    const sorted = [...childWindowByTab.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const excess = childWindowByTab.size - DBLCLICK_CHILD_PRUNE_LIMIT;
    for (let i = 0; i < excess; i++) {
      childWindowByTab.delete(sorted[i]![0]);
    }
  }
}

function clearPendingTabState(
  tabId: number,
  options: { preserveForwardOffer?: boolean } = {}
): void {
  readyTabs.delete(tabId);
  pendingRollbackByTab.delete(tabId);
  if (!options.preserveForwardOffer) {
    pendingForwardByTab.delete(tabId);
  }
  lastCommittedByTab.delete(tabId);
}

function trySendRollback(
  tabId: number,
  pending: { url: string; prevUrl?: string; qualifiers: string[] }
): void {
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "ns-rollback",
      url: pending.url,
      ...(pending.prevUrl !== undefined ? { prevUrl: pending.prevUrl } : {}),
      qualifiers: pending.qualifiers
    },
    () => {
      if (chrome.runtime.lastError) {
        pendingRollbackByTab.set(tabId, pending);
        readyTabs.delete(tabId);
      } else {
        pendingRollbackByTab.delete(tabId);
      }
    }
  );
}

function trySendForwardOffer(
  tabId: number,
  forward: { url: string; ts: number; returnUrl?: string }
): void {
  chrome.tabs.sendMessage(tabId, { type: "ns-forward-offer", url: forward.url }, () => {
    if (chrome.runtime.lastError) {
      pendingForwardByTab.set(tabId, forward);
      readyTabs.delete(tabId);
    } else {
      pendingForwardByTab.delete(tabId);
    }
  });
}

function getActiveRollbackReturn(tabId: number): { url: string; expiresAt: number } | null {
  const entry = rollbackReturnByTab.get(tabId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    rollbackReturnByTab.delete(tabId);
    return null;
  }
  return entry;
}

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

  if (message.type === "ns-reputation-check") {
    const domain = typeof message.domain === "string" ? message.domain : "";
    sendResponse?.({
      knownBad: domain ? isKnownBadDomain(domain) : false,
      filterReady: reputationReady(),
    });
    return;
  }

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
        trySendRollback(tabId, pending);
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
      pendingForwardByTab.set(tabId, {
        url: message.url,
        ts: Date.now(),
        ...(typeof message.returnUrl === "string" && message.returnUrl
          ? { returnUrl: message.returnUrl }
          : {})
      });
    }
  }

  if (message.type === "ns-begin-rollback") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && typeof message.returnUrl === "string" && message.returnUrl) {
      rollbackReturnByTab.set(tabId, {
        url: message.returnUrl,
        expiresAt: Date.now() + ROLLBACK_RETURN_TTL_MS
      });
    }
    sendResponse?.({ ok: true });
  }

  if (message.type === "ns-check-forward") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const forward = pendingForwardByTab.get(tabId);
      const currentUrl = typeof message.currentUrl === "string" ? message.currentUrl : "";
      if (forward && currentUrl && forward.url === currentUrl) {
        sendResponse?.({ status: "already_on_forward", url: "" });
        return;
      }
      if (forward && currentUrl && forward.returnUrl === currentUrl) {
        pendingForwardByTab.delete(tabId);
        sendResponse?.({ status: "offer", url: forward.url });
        return;
      }
      if (forward) {
        pendingForwardByTab.delete(tabId);
        sendResponse?.({ status: "offer", url: forward.url });
        return;
      }
      sendResponse?.({ status: "none", url: "" });
    }
  }

  // DoubleClickjacking: forward opener.location write from child to opener tab.
  // Only forward if the sender tab is a known child window to prevent
  // malicious pages from injecting false opener-nav signals.
  if (message.type === "ns-dblclick-opener-nav") {
    const childTabId = sender.tab?.id;
    if (typeof childTabId !== "number") return;
    const childEntry = childWindowByTab.get(childTabId);
    if (!childEntry) return;
    // Mark that this child performed an opener.location write so the
    // child-close signal is only sent for confirmed attack scenarios.
    childEntry.openerNavObserved = true;
    chrome.tabs.sendMessage(
      childEntry.openerTabId,
      {
        type: "ns-dblclick-opener-nav-from-child",
        url: typeof message.url === "string" ? message.url : "",
        ts: typeof message.ts === "number" ? message.ts : Date.now(),
      },
      () => {
        if (chrome.runtime.lastError) { /* opener may have navigated away */ }
      }
    );
    sendResponse?.({ ok: true });
  }
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  const forward = pendingForwardByTab.get(details.tabId);
  const rollbackReturn = getActiveRollbackReturn(details.tabId);
  const preserveForwardOffer =
    !!forward && !!rollbackReturn && rollbackReturn.url === details.url;
  clearPendingTabState(details.tabId, { preserveForwardOffer });
  if (!preserveForwardOffer) {
    rollbackReturnByTab.delete(details.tabId);
  }
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
  rollbackReturnByTab.delete(details.tabId);
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

  const typedOriginEntry = typedOriginByTab.get(details.tabId);

  if (isUserTyped && !isRedirect) {
    typedOriginByTab.set(details.tabId, { ts: now, deadline: now + TYPED_ORIGIN_MAX_MS });
  } else if (!isRedirect) {
    typedOriginByTab.delete(details.tabId);
  }

  if (isUserTyped) return;
  if (!isRedirect && !isLinkish) return;

  const inTypedOriginWindow = typedOriginEntry != null
    && now - typedOriginEntry.ts < TYPED_ORIGIN_TTL_MS
    && now < typedOriginEntry.deadline;
  if (inTypedOriginWindow) {
    if (isRedirect) {
      typedOriginByTab.set(details.tabId, { ts: now, deadline: typedOriginEntry.deadline });
    }
    return;
  }

  if (prevUrl) {
    try {
      const prevUrlObj = new URL(prevUrl);
      const curUrlObj = new URL(details.url);
      const isHttp = (p: string) => p === "http:" || p === "https:";
      if (isHttp(prevUrlObj.protocol) && isHttp(curUrlObj.protocol)) {
        const prevReg = getRegistrableDomain(prevUrlObj.hostname.toLowerCase());
        const curReg = getRegistrableDomain(curUrlObj.hostname.toLowerCase());
        if (prevReg && curReg && prevReg === curReg) return;
      }
    } catch (err) {
      console.warn("[NavSentinel] same-domain check failed", err);
    }
  }

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
    trySendRollback(details.tabId, {
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
  const forward = pendingForwardByTab.get(details.tabId);
  const rollbackReturn = getActiveRollbackReturn(details.tabId);
  const preserveForwardOffer =
    !!forward && !!rollbackReturn && !!details.url && forward.url === details.url;
  clearPendingTabState(details.tabId, { preserveForwardOffer });
  rollbackReturnByTab.delete(details.tabId);
  allowStartedByTab.delete(details.tabId);
  typedOriginByTab.delete(details.tabId);
});

// --- DoubleClickjacking: track tab creation with opener ---
chrome.tabs.onCreated.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  if (typeof tab.openerTabId !== "number") return;
  pruneStaleChildWindows();
  childWindowByTab.set(tab.id, {
    openerTabId: tab.openerTabId,
    createdAt: Date.now(),
    openerNavObserved: false
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // --- DoubleClickjacking: detect child-window close ---
  const childEntry = childWindowByTab.get(tabId);
  if (childEntry) {
    childWindowByTab.delete(tabId);
    const age = Date.now() - childEntry.createdAt;
    // Only notify the opener if the child actually wrote to opener.location.
    // Without this gate, benign popups (OAuth, help windows) that open and
    // self-close quickly would cause false positives.
    if (age <= DBLCLICK_CHILD_MAX_AGE_MS && childEntry.openerNavObserved) {
      // Child window closed quickly after opener.location write -- notify the opener tab.
      chrome.tabs.sendMessage(
        childEntry.openerTabId,
        { type: "ns-dblclick-child-closed", childTabId: tabId, ageMs: age },
        () => {
          // Ignore errors if the opener tab's content script isn't ready.
          if (chrome.runtime.lastError) { /* expected if tab navigated away */ }
        }
      );
    }
  }

  allowUntilByTab.delete(tabId);
  gestureUntilByTab.delete(tabId);
  allowStartedByTab.delete(tabId);
  allowTargetByTab.delete(tabId);
  suppressUntilByTab.delete(tabId);
  rollbackReturnByTab.delete(tabId);
  typedOriginByTab.delete(tabId);
  clearPendingTabState(tabId);
  lastUrlByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const forward = pendingForwardByTab.get(tabId);
  if (!forward) return;
  if (changeInfo.status !== "complete" && !changeInfo.url) return;
  const currentUrl = tab.url ?? changeInfo.url ?? "";
  if (!currentUrl) return;
  if (currentUrl === forward.url) return;
  if (forward.returnUrl && currentUrl === forward.returnUrl) return;
  if (!readyTabs.has(tabId)) return;
  trySendForwardOffer(tabId, forward);
});
