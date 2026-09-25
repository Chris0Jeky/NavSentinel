import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Message = { type: string; [key: string]: unknown };
type Sender = { tab: { id: number } };

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

function createChromeMock() {
  const onMessage = createEvent<(message: Message, sender: Sender, respond: () => void) => unknown>();
  const onCreated = createEvent<(tab: { id: number; openerTabId: number }) => void>();
  const onRemoved = createEvent<(tabId: number) => void>();
  return {
    runtime: {
      id: "mock-id", lastError: undefined as { message: string } | undefined,
      getURL: (name: string) => `chrome-extension://mock-id/${name}`,
      onMessage, onInstalled: createEvent(), onStartup: createEvent(),
    },
    storage: { local: storageArea(), session: storageArea(), onChanged: createEvent() },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    },
    webNavigation: {
      onBeforeNavigate: createEvent(), onCommitted: createEvent(), onErrorOccurred: createEvent(),
      getAllFrames: vi.fn().mockResolvedValue([]),
    },
    tabs: {
      onCreated, onRemoved, onUpdated: createEvent(),
      create: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn((_tabId: number, _message: Message, callback?: () => void) => { callback?.(); }),
    },
  };
}

beforeEach(() => { vi.resetModules(); });
afterEach(async () => {
  // Let the real pending-decision cleanup finish before retiring the browser mock.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function setup() {
  const browser = createChromeMock();
  vi.stubGlobal("chrome", browser);
  await import("../extension/src/sw/sw");
  const { swState } = await import("../extension/src/shared/session_state");
  await swState.hydrate();
  browser.tabs.onCreated.emit({ id: 20, openerTabId: 10 });
  browser.tabs.onCreated.emit({ id: 21, openerTabId: 11 });
  const forward = (tabId: number) => browser.runtime.onMessage.emit(
    { type: "ns-dblclick-opener-nav", url: "https://destination.example/fixture", ts: Date.now() },
    { tab: { id: tabId } }, () => {},
  );
  forward(20);
  expect(swState.childWindowByTab.get(20)?.openerNavObserved).toBe(true);
  browser.tabs.sendMessage.mockClear();
  return { browser, swState, forward };
}

function forwardedOpenerIds(browser: ReturnType<typeof createChromeMock>) {
  return browser.tabs.sendMessage.mock.calls
    .filter(([, message]) => message.type === "ns-dblclick-opener-nav-from-child")
    .map(([tabId]) => tabId);
}

describe("tab removal preserves early child invalidation (#804)", () => {
  it("retires the closed child before a synchronous close-notification failure", async () => {
    const { browser, swState, forward } = await setup();
    browser.tabs.sendMessage.mockImplementationOnce(() => {
      throw new Error("injected close-notification failure");
    });
    // Preserve the original error behavior, not just a no-throw assertion.
    expect(() => browser.tabs.onRemoved.emit(20)).toThrow("injected close-notification failure");
    expect(swState.childWindowByTab.has(20)).toBe(false);
    expect(swState.childWindowByTab.has(21)).toBe(true);
    browser.tabs.sendMessage.mockClear();
    forward(20);
    forward(21);
    expect(forwardedOpenerIds(browser)).toEqual([11]);
  });

  it.each([false, true])("keeps successful cleanup with callback error=%s", async (callbackError) => {
    const { browser, swState, forward } = await setup();
    browser.runtime.lastError = callbackError ? { message: "receiver unavailable" } : undefined;
    browser.tabs.onRemoved.emit(20);
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(10,
      expect.objectContaining({ type: "ns-dblclick-child-closed", childTabId: 20 }), expect.any(Function));
    expect(swState.childWindowByTab.has(20)).toBe(false);
    browser.runtime.lastError = undefined;
    browser.tabs.sendMessage.mockClear();
    forward(20);
    forward(21);
    expect(forwardedOpenerIds(browser)).toEqual([11]);
  });
});
