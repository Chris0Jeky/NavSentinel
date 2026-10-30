import { afterEach, beforeEach, expect, it, vi } from "vitest";

// #1244: the service worker answers "is PiP open in this tab?" by asking every
// frame Chrome currently lists for the sender's tab, so a removed frame cannot
// leave the tab stuck and a frame created after PiP opened is still asked.

type Listener = (message: unknown, sender: { tab?: { id: number } }, respond: (open: unknown) => void) => unknown;

function createEvent() {
  const listeners: Array<(...args: never[]) => unknown> = [];
  return {
    listeners,
    addListener(listener: (...args: never[]) => unknown) { listeners.push(listener); },
  };
}

const storageArea = () => ({
  get: async () => ({}), set: async () => {}, remove: async () => {},
});

let frames: Array<{ frameId: number }>;
let answers: Map<number, () => Promise<unknown>>;
let browser: ReturnType<typeof makeBrowser>;

function makeBrowser() {
  return {
    runtime: {
      id: "mock-id", lastError: undefined,
      getURL: (name: string) => `chrome-extension://mock-id/${name}`,
      onMessage: createEvent(), onInstalled: createEvent(), onStartup: createEvent(),
    },
    storage: { local: storageArea(), session: storageArea(), onChanged: createEvent() },
    action: { setBadgeText: vi.fn().mockResolvedValue(undefined), setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined) },
    webNavigation: {
      onBeforeNavigate: createEvent(), onCommitted: createEvent(), onErrorOccurred: createEvent(),
      onCreatedNavigationTarget: createEvent(),
      getAllFrames: vi.fn(async () => frames),
    },
    tabs: {
      onCreated: createEvent(), onRemoved: createEvent(), onUpdated: createEvent(), onActivated: createEvent(),
      create: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue({}), query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn((_tabId: number, _message: unknown, options?: { frameId: number }) =>
        answers.get(options?.frameId ?? -1)?.() ?? Promise.reject(new Error("Could not establish connection."))),
    },
    windows: { onFocusChanged: createEvent() },
  };
}

/** Sends ns-pip as a content script would and resolves with the worker's reply. */
function ask(sender: { tab?: { id: number } } = { tab: { id: 7 } }): Promise<{ kept: boolean; reply: unknown }> {
  return new Promise((resolve) => {
    let kept = false;
    const respond = (reply: unknown) => resolve({ kept, reply });
    for (const listener of browser.runtime.onMessage.listeners as Listener[]) {
      if (listener({ type: "ns-pip" }, sender, respond) === true) kept = true;
    }
    if (!kept) resolve({ kept, reply: undefined });
  });
}

beforeEach(async () => {
  vi.resetModules();
  frames = [{ frameId: 0 }, { frameId: 3 }];
  answers = new Map([[0, async () => false], [3, async () => false]]);
  browser = makeBrowser();
  vi.stubGlobal("chrome", browser);
  await import("../extension/src/sw/sw");
});
afterEach(() => { vi.unstubAllGlobals(); });

it("asks every listed frame of the sender's tab and answers closed when all say closed", async () => {
  expect(await ask()).toEqual({ kept: true, reply: false });
  expect(browser.webNavigation.getAllFrames).toHaveBeenCalledWith({ tabId: 7 });
  expect(browser.tabs.sendMessage.mock.calls).toEqual([
    [7, { type: "ns-pip", any: true }, {}],
    [7, { type: "ns-pip" }, { frameId: 0 }],
    [7, { type: "ns-pip" }, { frameId: 3 }],
  ]);
});

it("answers open when only the tab-wide broadcast is claimed, by a literal true (#1249)", async () => {
  // A sandboxed blob: frame is not listed; only it replies to the broadcast.
  answers.set(-1, async () => true);
  expect((await ask()).reply).toBe(true);
  answers.set(-1, async () => "yes");
  expect((await ask()).reply).toBe(false);
  answers.set(-1, async () => undefined);
  expect((await ask()).reply).toBe(false);
});

it("answers open when any frame says open, counting only a literal true", async () => {
  answers.set(3, async () => true);
  expect((await ask()).reply).toBe(true);
  answers.set(3, async () => "yes");
  expect((await ask()).reply).toBe(false);
});

it("asks a frame created after PiP opened, and forgets a removed one (#1244 items 3 and 4)", async () => {
  frames = [{ frameId: 0 }, { frameId: 9 }];
  answers.set(3, async () => true); // Removed: no longer listed, so never asked.
  answers.set(9, async () => true);
  expect((await ask()).reply).toBe(true);
  frames = [{ frameId: 0 }];
  expect((await ask()).reply).toBe(false);
  expect(browser.tabs.sendMessage.mock.calls.map(([, , options]) => options?.frameId)).toEqual([undefined, 0, 9, undefined, 0]);
});

it("counts a frame that cannot answer as closed", async () => {
  answers.delete(3);
  expect((await ask()).reply).toBe(false);
});

it("answers open when the tab's frames cannot be listed", async () => {
  browser.webNavigation.getAllFrames.mockRejectedValueOnce(new Error("No tab with id: 7."));
  expect((await ask()).reply).toBe(true);
});

it("answers open for a null or empty frame list", async () => {
  frames = null as unknown as typeof frames;
  expect((await ask()).reply).toBe(true);
  frames = [];
  expect((await ask()).reply).toBe(true);
});

it("does not answer a sender without a tab", async () => {
  expect(await ask({})).toEqual({ kept: false, reply: undefined });
  expect(browser.webNavigation.getAllFrames).not.toHaveBeenCalled();
});
