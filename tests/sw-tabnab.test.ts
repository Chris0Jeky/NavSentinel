import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reverse tabnabbing (#1172): the SW records a hidden opener whose location a known child
// wrote, then warns on activation when the registrable domain changed.

type Message = { type: string; [key: string]: unknown };
type TabInfo = { url?: string; active?: boolean };

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

async function setup(opener: TabInfo = { url: ORIGINAL, active: false }) {
  const tabs = new Map<number, TabInfo>([[10, opener], [20, { url: "https://child.example/", active: true }]]);
  const browser = {
    runtime: {
      id: "mock-id", lastError: undefined as { message: string } | undefined,
      getURL: (name: string) => `chrome-extension://mock-id/${name}`,
      onMessage: createEvent<(message: Message, sender: { tab: { id: number } }, respond: () => void) => unknown>(),
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
      onUpdated: createEvent(),
      onActivated: createEvent<(info: { tabId: number }) => void>(),
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn(async (id: number) => ({ id, ...tabs.get(id) })),
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn((_tabId: number, _message: Message, callback?: () => void) => { callback?.(); }),
    },
  };
  vi.stubGlobal("chrome", browser);
  await import("../extension/src/sw/sw");
  const { swState } = await import("../extension/src/shared/session_state");
  await swState.hydrate();
  browser.tabs.onCreated.emit({ id: 20, openerTabId: 10 });
  await flush();
  const swap = async (childTabId = 20) => {
    tabs.get(10)!.url = SWAPPED;
    browser.runtime.onMessage.emit(
      { type: "ns-dblclick-opener-nav", url: SWAPPED, ts: Date.now() }, { tab: { id: childTabId } }, () => {});
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
});
