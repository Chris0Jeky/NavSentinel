import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reverse tabnabbing (#1172): the SW records a hidden opener whose location a known child
// wrote, then warns on activation when the registrable domain changed.

type Message = { type: string; [key: string]: unknown };
type TabInfo = { url?: string; active?: boolean; status?: string; windowId?: number };

function createEvent<T extends (...args: never[]) => unknown>() {
  const listeners: T[] = [];
  return {
    addListener(listener: T) { listeners.push(listener); },
    emit(...args: Parameters<T>) { return listeners.map((listener) => listener(...args)); },
  };
}

function storageArea() {
  const data: Record<string, unknown> = {};
  return {
    async get(keys?: string | string[]) {
      if (keys === undefined) return { ...data };
      return Object.fromEntries((typeof keys === "string" ? [keys] : keys)
        .filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(items: Record<string, unknown>) { Object.assign(data, items); },
    async remove(keys: string | string[]) {
      for (const key of typeof keys === "string" ? [keys] : keys) delete data[key];
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ORIGINAL = "https://login.bank.example/";
const SWAPPED = "https://login.bank-example.test/";

async function setup(
  opener: TabInfo = { url: ORIGINAL, active: false },
  { lastUrl }: { lastUrl?: string } = {},
) {
  const tabs = new Map<number, TabInfo>([[10, opener], [20, { url: "https://child.example/", active: true }]]);
  const browser = {
    runtime: {
      id: "mock-id", lastError: undefined as { message: string } | undefined,
      getURL: (name: string) => `chrome-extension://mock-id/${name}`,
      onMessage: createEvent<(message: Message, sender: { tab: { id: number; windowId?: number | undefined } }, respond: () => void) => unknown>(),
      onInstalled: createEvent(), onStartup: createEvent(),
    },
    storage: { local: storageArea(), session: storageArea(), onChanged: createEvent() },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    },
    webNavigation: {
      onBeforeNavigate: createEvent(), onCommitted: createEvent(), onErrorOccurred: createEvent(),
      onCreatedNavigationTarget: createEvent(),
      getAllFrames: vi.fn().mockResolvedValue([]),
    },
    tabs: {
      onCreated: createEvent<(tab: { id: number; openerTabId: number }) => void>(),
      onRemoved: createEvent<(tabId: number) => void>(),
      onUpdated: createEvent<(tabId: number, change: { status?: string }, tab: { id: number; active: boolean; url?: string }) => void>(),
      onActivated: createEvent<(info: { tabId: number }) => void>(),
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn(async (id: number) => ({ id, ...tabs.get(id) })),
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn((_tabId: number, _message: Message, callback?: () => void) => { callback?.(); }),
    },
    windows: { onFocusChanged: createEvent<(windowId: number) => void>() },
  };
  vi.stubGlobal("chrome", browser);
  await import("../extension/src/sw/sw");
  const { swState } = await import("../extension/src/shared/session_state");
  await swState.hydrate();
  if (lastUrl) swState.lastUrlByTab.set(10, lastUrl);
  browser.tabs.onCreated.emit({ id: 20, openerTabId: 10 });
  await flush();
  const swap = async (childTabId = 20, writeUrl: string = SWAPPED, childWindowId?: number) => {
    tabs.get(10)!.url = SWAPPED;
    browser.runtime.onMessage.emit(
      { type: "ns-dblclick-opener-nav", url: writeUrl, ts: Date.now() }, { tab: { id: childTabId, windowId: childWindowId } }, () => {});
    await flush();
  };
  const activate = async (tabId = 10) => {
    browser.tabs.onActivated.emit({ tabId });
    await flush();
  };
  const warnings = () => browser.tabs.sendMessage.mock.calls.filter(([, m]) => m.type === "ns-tabnab-warning");
  return { browser, swState, swap, activate, warnings, tabs };
}

beforeEach(() => { vi.resetModules(); });
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reverse tabnabbing warning (#1172)", () => {
  it("records the opener's original domain at child creation", async () => {
    const { swState } = await setup();
    expect(swState.childWindowByTab.get(20)?.openerReg).toBe("bank.example");
  });

  it("records a pending entry only for a known child and an inactive opener", async () => {
    const hidden = await setup();
    await hidden.swap(99);
    expect(hidden.swState.tabnabPendingByTab.size).toBe(0);
    await hidden.swap(20);
    expect(hidden.swState.tabnabPendingByTab.get(10)).toMatchObject({ origReg: "bank.example" });
  });

  it("does not record when the opener is the active tab", async () => {
    const { swState, swap } = await setup({ url: ORIGINAL, active: true });
    await swap();
    expect(swState.tabnabPendingByTab.size).toBe(0);
  });

  it("records an active opener under a popup window and warns when its window regains focus (#1205)", async () => {
    const { browser, swState, swap, warnings } = await setup({ url: ORIGINAL, active: true, windowId: 1 });
    await swap(20, SWAPPED, 2);
    expect(swState.tabnabPendingByTab.get(10)).toMatchObject({ origReg: "bank.example" });
    // The swapped opener finishes loading while the user is still in the popup (Codex P2 on #1211).
    browser.tabs.onUpdated.emit(10, { status: "complete" }, { id: 10, active: true, url: SWAPPED });
    browser.windows.onFocusChanged.emit(-1);
    browser.tabs.query.mockImplementation(async ({ windowId }: { windowId: number }) =>
      windowId === 1 ? [{ id: 10 }] : [{ id: 20 }]);
    browser.windows.onFocusChanged.emit(2);
    await flush();
    await flush();
    expect(warnings()).toHaveLength(0);
    expect(swState.tabnabPendingByTab.has(10)).toBe(true);
    browser.windows.onFocusChanged.emit(1);
    await flush();
    await flush();
    expect(warnings()).toEqual([[10, { type: "ns-tabnab-warning", from: "bank.example" }, expect.any(Function)]]);
    expect(swState.tabnabPendingByTab.has(10)).toBe(false);
  });

  it("does not record an active opener in the same window as the child", async () => {
    const { swState, swap } = await setup({ url: ORIGINAL, active: true, windowId: 1 });
    await swap(20, SWAPPED, 1);
    expect(swState.tabnabPendingByTab.size).toBe(0);
  });

  it("warns on activation when the registrable domain changed, once", async () => {
    const { swap, activate, warnings, swState } = await setup();
    await swap();
    await activate();
    expect(warnings()).toEqual([[10, { type: "ns-tabnab-warning", from: "bank.example" }, expect.any(Function)]]);
    expect(swState.tabnabPendingByTab.has(10)).toBe(false);
    await activate();
    expect(warnings()).toHaveLength(1);
  });

  it("stays quiet when the opener only moved within the same registrable domain", async () => {
    const { swap, activate, warnings, tabs } = await setup();
    await swap();
    tabs.get(10)!.url = "https://www.bank.example/account";
    await activate();
    expect(warnings()).toHaveLength(0);
  });

  it("stays quiet when the opener is no longer an http(s) page", async () => {
    const { swap, activate, warnings, tabs } = await setup();
    await swap();
    tabs.get(10)!.url = "about:blank";
    await activate();
    expect(warnings()).toHaveLength(0);
  });

  it("stays quiet after the 30 minute window", async () => {
    const { swap, activate, warnings, swState } = await setup();
    await swap();
    swState.tabnabPendingByTab.get(10)!.ts -= 31 * 60_000;
    await activate();
    expect(warnings()).toHaveLength(0);
  });

  it("drops the pending entry when the opener tab is removed", async () => {
    const { browser, swap, activate, warnings, swState } = await setup();
    await swap();
    browser.tabs.onRemoved.emit(10);
    expect(swState.tabnabPendingByTab.has(10)).toBe(false);
    await activate();
    expect(warnings()).toHaveLength(0);
  });

  it("takes the opener domain synchronously from the last committed URL", async () => {
    const { browser, swState, swap } = await setup(undefined, { lastUrl: ORIGINAL });
    // Creation needed no tabs.get, so a write right after creation cannot lose that race.
    expect(browser.tabs.get).not.toHaveBeenCalled();
    expect(swState.childWindowByTab.get(20)?.openerReg).toBe("bank.example");
    await swap();
    expect(swState.tabnabPendingByTab.get(10)).toMatchObject({ origReg: "bank.example" });
  });

  it("does not record a same-site write such as an SSO start", async () => {
    const { swState, swap } = await setup();
    await swap(20, "https://login.bank.example/sso/start");
    expect(swState.tabnabPendingByTab.size).toBe(0);
  });

  it.each(["", "not a url"])("records when the write URL is empty or unparseable (%j)", async (writeUrl) => {
    const { swState, swap } = await setup();
    await swap(20, writeUrl);
    expect(swState.tabnabPendingByTab.has(10)).toBe(true);
  });

  it("keeps the entry while the tab is loading and delivers on onUpdated complete", async () => {
    const { browser, swap, activate, warnings, swState, tabs } = await setup();
    await swap();
    tabs.get(10)!.status = "loading";
    await activate();
    expect(warnings()).toHaveLength(0);
    expect(swState.tabnabPendingByTab.has(10)).toBe(true);
    tabs.get(10)!.status = "complete";
    browser.tabs.onUpdated.emit(10, { status: "complete" }, { id: 10, active: true, url: SWAPPED });
    await flush();
    expect(warnings()).toHaveLength(1);
    expect(swState.tabnabPendingByTab.has(10)).toBe(false);
  });

  it("keeps the entry when delivery fails and clears it once a send succeeds", async () => {
    const { browser, swap, activate, warnings, swState } = await setup();
    await swap();
    browser.runtime.lastError = { message: "Receiving end does not exist" };
    await activate();
    browser.runtime.lastError = undefined;
    expect(warnings()).toHaveLength(1);
    expect(swState.tabnabPendingByTab.has(10)).toBe(true);
    await activate();
    expect(warnings()).toHaveLength(2);
    expect(swState.tabnabPendingByTab.has(10)).toBe(false);
  });

  it("treats an unanswered but delivered message as delivered (no repeat toast)", async () => {
    const { browser, swap, activate, warnings, swState } = await setup();
    await swap();
    browser.runtime.lastError = { message: "The message port closed before a response was received." };
    await activate();
    browser.runtime.lastError = undefined;
    expect(warnings()).toHaveLength(1);
    expect(swState.tabnabPendingByTab.has(10)).toBe(false);
  });
});
