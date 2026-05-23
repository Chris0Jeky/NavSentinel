import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeMessage = Record<string, unknown>;
type RuntimeSender = { tab?: { id?: number; windowId?: number }; frameId?: number };
type SendResponse = (response?: unknown) => void;

function createEvent<T extends (...args: any[]) => void>() {
  const listeners: T[] = [];
  return {
    addListener(listener: T) {
      listeners.push(listener);
    },
    emit(...args: Parameters<T>) {
      for (const listener of listeners) {
        listener(...args);
      }
    },
  };
}

function createChromeMock() {
  const runtimeOnMessage = createEvent<
    (message: RuntimeMessage, sender: RuntimeSender, sendResponse: SendResponse) => void
  >();
  const runtimeOnInstalled = createEvent<(details: { reason: string }) => void>();
  const runtimeOnStartup = createEvent<() => void>();
  const storageOnChanged = createEvent<
    (changes: Record<string, { oldValue: unknown; newValue: unknown }>, areaName: string) => void
  >();
  const beforeNavigate = createEvent<
    (details: { tabId: number; frameId: number; url: string }) => void
  >();
  const errorOccurred = createEvent<
    (details: { tabId: number; frameId: number; url?: string }) => void
  >();
  const committed = createEvent<
    (details: {
      tabId: number;
      frameId: number;
      url: string;
      transitionType: string;
      transitionQualifiers?: string[];
    }) => void
  >();
  const tabCreated = createEvent<(tab: { id?: number; openerTabId?: number }) => void>();
  const tabRemoved = createEvent<(tabId: number) => void>();
  const tabUpdated = createEvent<
    (tabId: number, changeInfo: { status?: string; url?: string }, tab: { url?: string }) => void
  >();

  const sentMessages: Array<{
    tabId: number;
    message: unknown;
    options?: { frameId?: number };
  }> = [];

  let lastErrorValue: { message: string } | undefined;

  return {
    chrome: {
      runtime: {
        onMessage: runtimeOnMessage,
        onInstalled: runtimeOnInstalled,
        onStartup: runtimeOnStartup,
        getURL: (path: string) => `chrome-extension://mock-id/${path}`,
        get lastError() {
          return lastErrorValue;
        },
      },
      storage: {
        local: {
          async get(keys?: string | string[]) {
            if (keys === undefined) return {};
            if (typeof keys === "string") return {};
            return Object.fromEntries(keys.map((key) => [key, undefined]));
          },
          async set() {},
          async remove() {},
        },
        session: {
          _store: {} as Record<string, unknown>,
          async get(keys?: string | string[]) {
            if (keys === undefined) return { ...this._store };
            if (typeof keys === "string") return { [keys]: this._store[keys] };
            const result: Record<string, unknown> = {};
            for (const key of keys) result[key] = this._store[key];
            return result;
          },
          async set(items: Record<string, unknown>) {
            Object.assign(this._store, items);
          },
          async remove(keys: string | string[]) {
            const keyList = typeof keys === "string" ? [keys] : keys;
            for (const key of keyList) delete this._store[key];
          },
        },
        onChanged: storageOnChanged,
      },
      action: {
        setBadgeText: vi.fn().mockResolvedValue(undefined),
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      },
      declarativeNetRequest: {
        updateEnabledRulesets: vi.fn().mockResolvedValue(undefined),
      },
      webNavigation: {
        onBeforeNavigate: beforeNavigate,
        onCommitted: committed,
        onErrorOccurred: errorOccurred,
      },
      tabs: {
        onCreated: tabCreated,
        onRemoved: tabRemoved,
        onUpdated: tabUpdated,
        create: vi.fn().mockResolvedValue({}),
        captureVisibleTab: vi.fn(
          (_windowId: number, _options: unknown, callback: (dataUrl?: string) => void) => {
            callback("data:image/png;base64,mockdata");
          },
        ),
        query: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn(
          (
            tabId: number,
            message: unknown,
            optionsOrCallback?: { frameId?: number } | (() => void),
            callback?: () => void,
          ) => {
            const options =
              typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
            const done = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
            sentMessages.push({
              tabId,
              message,
              ...(options ? { options } : {}),
            });
            done?.();
          },
        ),
      },
    },
    emitBeforeNavigate(details: { tabId: number; frameId: number; url: string }) {
      beforeNavigate.emit(details);
    },
    emitCommitted(details: {
      tabId: number;
      frameId: number;
      url: string;
      transitionType: string;
      transitionQualifiers?: string[];
    }) {
      committed.emit(details);
    },
    emitTabCreated(tab: { id?: number; openerTabId?: number }) {
      tabCreated.emit(tab);
    },
    emitTabRemoved(tabId: number) {
      tabRemoved.emit(tabId);
    },
    emitTabUpdated(
      tabId: number,
      changeInfo: { status?: string; url?: string },
      tab: { url?: string } = {},
    ) {
      tabUpdated.emit(tabId, changeInfo, tab);
    },
    emitInstalled(reason = "install") {
      runtimeOnInstalled.emit({ reason });
    },
    emitStartup() {
      runtimeOnStartup.emit();
    },
    emitStorageChanged(
      changes: Record<string, { oldValue: unknown; newValue: unknown }>,
      areaName: string,
    ) {
      storageOnChanged.emit(changes, areaName);
    },
    dispatchRuntimeMessage(message: RuntimeMessage, sender: RuntimeSender = {}) {
      let response: unknown;
      runtimeOnMessage.emit(message, sender, (value) => {
        response = value;
      });
      return response;
    },
    setLastError(err: { message: string } | undefined) {
      lastErrorValue = err;
    },
    sentMessages,
  };
}

async function loadSw(mock: ReturnType<typeof createChromeMock>) {
  vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("fetch not available in tests")),
  );
  await import("../extension/src/sw/sw");
}

describe("service worker handlers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("ns-reputation-check", () => {
    it("returns knownBad: false and filterReady status when filter is not loaded", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage(
        { type: "ns-reputation-check", domain: "example.com" },
        {},
      ) as { knownBad: boolean; filterReady: boolean };

      expect(res.knownBad).toBe(false);
      expect(res.filterReady).toBe(false);
    });

    it("returns knownBad: false for empty domain string", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage(
        { type: "ns-reputation-check", domain: "" },
        {},
      ) as { knownBad: boolean; filterReady: boolean };

      expect(res.knownBad).toBe(false);
    });

    it("returns knownBad: false for non-string domain", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage(
        { type: "ns-reputation-check", domain: 42 },
        {},
      ) as { knownBad: boolean; filterReady: boolean };

      expect(res.knownBad).toBe(false);
    });
  });

  describe("ns-tab-risk-update", () => {
    it("accepts valid risk states and updates icon", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      for (const state of ["green", "yellow", "red", "gray"]) {
        mock.dispatchRuntimeMessage(
          { type: "ns-tab-risk-update", state, blockCount: 0 },
          { tab: { id: 10 } },
        );
      }

      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalled();
    });

    it("ignores invalid risk states", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.chrome.action.setBadgeText.mockClear();
      mock.chrome.action.setBadgeBackgroundColor.mockClear();

      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "purple", blockCount: 0 },
        { tab: { id: 10 } },
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    it("ignores messages without tab context", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.chrome.action.setBadgeText.mockClear();

      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "red", blockCount: 1 },
        {},
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).not.toHaveBeenCalled();
    });

    it("clamps non-finite blockCount to 0", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "red", blockCount: NaN },
        { tab: { id: 10 } },
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalled();
    });

    it("clamps negative blockCount to 0", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "yellow", blockCount: -5 },
        { tab: { id: 10 } },
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalled();
    });
  });

  describe("ns-get-chain-info", () => {
    it("returns default chain info for tab with no redirect chain", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage(
        { type: "ns-get-chain-info" },
        { tab: { id: 10 } },
      ) as { depth: number; viaKnownRedirector: boolean; knownRedirectorHops: number };

      expect(res).toEqual({ depth: 0, viaKnownRedirector: false, knownRedirectorHops: 0 });
    });

    it("returns default chain info when no tab context (popup/devtools)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage({ type: "ns-get-chain-info" }, {}) as {
        depth: number;
      };

      expect(res.depth).toBe(0);
    });
  });

  describe("ns-capture-viewport", () => {
    it("returns dataUrl on successful capture", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage(
        { type: "ns-capture-viewport" },
        { tab: { id: 10, windowId: 1 } },
      ) as { dataUrl: string | null };

      expect(res.dataUrl).toBe("data:image/png;base64,mockdata");
    });

    it("returns null dataUrl when no tab context", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage({ type: "ns-capture-viewport" }, {}) as {
        dataUrl: string | null;
      };

      expect(res.dataUrl).toBeNull();
    });

    it("returns null dataUrl when captureVisibleTab errors", async () => {
      const mock = createChromeMock();
      mock.chrome.tabs.captureVisibleTab = vi.fn(
        (_windowId: number, _options: unknown, callback: (dataUrl?: string) => void) => {
          mock.setLastError({ message: "tab is not active" });
          callback(undefined);
          mock.setLastError(undefined);
        },
      );
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage(
        { type: "ns-capture-viewport" },
        { tab: { id: 10, windowId: 1 } },
      ) as { dataUrl: string | null };

      expect(res.dataUrl).toBeNull();
    });
  });

  describe("ns-dblclick-opener-nav (security-critical)", () => {
    it("forwards opener nav to opener tab for registered child", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });
      mock.sentMessages.length = 0;

      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish", ts: Date.now() },
        { tab: { id: 20 } },
      );

      const openerMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-opener-nav-from-child",
      );
      expect(openerMsg).toBeDefined();
      expect(openerMsg!.tabId).toBe(10);
      expect((openerMsg!.message as { url: string }).url).toBe("https://evil.test/phish");
    });

    it("rejects opener nav from unregistered tab (security gate)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      mock.sentMessages.length = 0;

      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish", ts: Date.now() },
        { tab: { id: 99 } },
      );

      expect(mock.sentMessages).toHaveLength(0);
    });

    it("rejects opener nav without tab context", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      mock.sentMessages.length = 0;

      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish" },
        {},
      );

      expect(mock.sentMessages).toHaveLength(0);
    });

    it("sets openerNavObserved = true on the child entry", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });

      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish", ts: Date.now() },
        { tab: { id: 20 } },
      );

      // Closing the child quickly should now trigger the ns-dblclick-child-closed alert
      mock.sentMessages.length = 0;
      mock.emitTabRemoved(20);

      const closedMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-child-closed",
      );
      expect(closedMsg).toBeDefined();
      expect(closedMsg!.tabId).toBe(10);
    });

    it("sends ns-oauth-opener-manipulation when opener has active OAuth flow", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Simulate an OAuth flow on the opener tab by navigating to an OAuth URL
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=https%3A%2F%2Fapp.test%2Fcallback&response_type=code",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=https%3A%2F%2Fapp.test%2Fcallback&response_type=code",
        transitionType: "link",
      });

      // Register child tab
      mock.emitTabCreated({ id: 20, openerTabId: 10 });
      mock.sentMessages.length = 0;

      // Child sends opener nav
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/steal", ts: Date.now() },
        { tab: { id: 20 } },
      );

      const oauthMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-opener-manipulation",
      );
      expect(oauthMsg).toBeDefined();
      expect(oauthMsg!.tabId).toBe(10);
    });
  });

  describe("dblclick child window lifecycle", () => {
    it("tracks child tab creation with openerTabId", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });

      // Verify tracking by sending opener nav from the child
      mock.sentMessages.length = 0;
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://test.test", ts: Date.now() },
        { tab: { id: 20 } },
      );
      expect(mock.sentMessages.length).toBeGreaterThan(0);
    });

    it("ignores tab creation without openerTabId", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20 });

      // Tab 20 should not be tracked as a child window
      mock.sentMessages.length = 0;
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://test.test", ts: Date.now() },
        { tab: { id: 20 } },
      );
      expect(mock.sentMessages).toHaveLength(0);
    });

    it("sends ns-dblclick-child-closed when child closes quickly after opener nav", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });

      // Child writes to opener.location
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish", ts: Date.now() },
        { tab: { id: 20 } },
      );

      // Child closes within DBLCLICK_CHILD_MAX_AGE_MS (5s)
      vi.advanceTimersByTime(2000);
      mock.sentMessages.length = 0;
      mock.emitTabRemoved(20);

      const closedMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-child-closed",
      );
      expect(closedMsg).toBeDefined();
      expect(closedMsg!.tabId).toBe(10);
      expect((closedMsg!.message as { ageMs: number }).ageMs).toBe(2000);
    });

    it("does NOT send ns-dblclick-child-closed for benign popup (no openerNavObserved)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });

      // Child closes quickly but NEVER wrote to opener.location
      vi.advanceTimersByTime(1000);
      mock.sentMessages.length = 0;
      mock.emitTabRemoved(20);

      const closedMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-child-closed",
      );
      expect(closedMsg).toBeUndefined();
    });

    it("does NOT send ns-dblclick-child-closed if child is older than max age", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });

      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish", ts: Date.now() },
        { tab: { id: 20 } },
      );

      // Child closes after max age (5s)
      vi.advanceTimersByTime(6000);
      mock.sentMessages.length = 0;
      mock.emitTabRemoved(20);

      const closedMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-child-closed",
      );
      expect(closedMsg).toBeUndefined();
    });

    it("prunes stale child windows by age (2x max)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });
      vi.advanceTimersByTime(11_000); // > 2 * DBLCLICK_CHILD_MAX_AGE_MS (10s)

      // Creating a new child triggers pruning
      mock.emitTabCreated({ id: 30, openerTabId: 10 });

      // Old child (tab 20) should be pruned — opener nav should be rejected
      mock.sentMessages.length = 0;
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://test.test", ts: Date.now() },
        { tab: { id: 20 } },
      );
      expect(mock.sentMessages).toHaveLength(0);

      // New child (tab 30) should still be tracked
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://test.test", ts: Date.now() },
        { tab: { id: 30 } },
      );
      expect(mock.sentMessages.length).toBeGreaterThan(0);
    });

    it("prunes excess child windows beyond hard cap (50)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Create 52 child windows with distinct createdAt timestamps.
      // Pruning runs before adding each new entry, so 52nd creation
      // triggers hard cap (map has 51 entries > limit of 50).
      for (let i = 0; i < 52; i++) {
        mock.emitTabCreated({ id: 100 + i, openerTabId: 10 });
        vi.advanceTimersByTime(10);
      }

      // The first child (tab 100) should be pruned since it's the oldest
      mock.sentMessages.length = 0;
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://test.test", ts: Date.now() },
        { tab: { id: 100 } },
      );
      expect(mock.sentMessages).toHaveLength(0);

      // A recent child should still be tracked
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://test.test", ts: Date.now() },
        { tab: { id: 151 } },
      );
      expect(mock.sentMessages.length).toBeGreaterThan(0);
    });
  });

  describe("OAuth flow tracking via navigation", () => {
    it("starts a new OAuth flow when navigating to an OAuth URL", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
        transitionType: "link",
      });

      // Should have sent ns-oauth-flow-update
      const flowMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-flow-update",
      );
      expect(flowMsg).toBeDefined();
      expect(flowMsg!.tabId).toBe(10);
      const flow = (flowMsg!.message as { flow: { phase: string } }).flow;
      expect(flow.phase).toBe("redirect");
    });

    it("transitions to consent on second OAuth URL with OAuth params", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // First OAuth URL -> redirect phase
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
        transitionType: "link",
      });

      // Second OAuth URL with OAuth params (consent step) -> consent phase
      mock.sentMessages.length = 0;
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/signin/oauth/consent?client_id=x&scope=openid",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/signin/oauth/consent?client_id=x&scope=openid",
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
      });

      const flowMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-flow-update",
      );
      expect(flowMsg).toBeDefined();
      const flow = (flowMsg!.message as { flow: { phase: string } }).flow;
      expect(flow.phase).toBe("consent");
    });

    it("transitions non-OAuth consent page through callback to complete", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Start OAuth flow
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code",
        transitionType: "link",
      });

      // Non-OAuth consent page (no OAuth query params) triggers callback→complete
      mock.sentMessages.length = 0;
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/signin/oauth/consent?authuser=0",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/signin/oauth/consent?authuser=0",
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
      });

      const flowMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-flow-update",
      );
      expect(flowMsg).toBeDefined();
      const flow = (flowMsg!.message as { flow: { phase: string } }).flow;
      expect(flow.phase).toBe("complete");
    });

    it("completes flow and sends ns-oauth-flow-update when navigating to callback", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Start OAuth flow
      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code";
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: oauthUrl });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: oauthUrl,
        transitionType: "link",
      });

      // Navigate to non-OAuth callback URL
      mock.sentMessages.length = 0;
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://app.test/cb?code=authcode123",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://app.test/cb?code=authcode123",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      const flowMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-flow-update",
      );
      expect(flowMsg).toBeDefined();
      const flow = (flowMsg!.message as { flow: { phase: string } }).flow;
      expect(flow.phase).toBe("complete");
    });

    it("sends ns-oauth-redirect-mismatch for unexpected callback domain", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Start OAuth flow with redirect_uri to app.test
      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code";
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: oauthUrl });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: oauthUrl,
        transitionType: "link",
      });

      // Navigate to a DIFFERENT domain as callback (unexpected)
      mock.sentMessages.length = 0;
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://evil.test/steal?code=authcode123",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://evil.test/steal?code=authcode123",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      const mismatchMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatchMsg).toBeDefined();
      expect(mismatchMsg!.tabId).toBe(10);
    });

    it("prunes stale OAuth flows older than max age", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Start a flow
      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&response_type=code";
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: oauthUrl });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: oauthUrl,
        transitionType: "link",
      });

      // Advance past OAUTH_FLOW_MAX_AGE_MS (60s)
      vi.advanceTimersByTime(61_000);

      // Start another flow (triggers pruneStaleOAuthFlows)
      mock.sentMessages.length = 0;
      mock.emitBeforeNavigate({
        tabId: 20,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=y&redirect_uri=https%3A%2F%2Fother.test%2Fcb&response_type=code",
      });
      mock.emitCommitted({
        tabId: 20,
        frameId: 0,
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=y&redirect_uri=https%3A%2F%2Fother.test%2Fcb&response_type=code",
        transitionType: "link",
      });

      // Now try to complete the old flow — it should be pruned, so no callback/complete msg
      mock.sentMessages.length = 0;
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://app.test/cb?code=oldcode",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://app.test/cb?code=oldcode",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      const flowMsg = mock.sentMessages.find(
        (m) =>
          (m.message as { type: string }).type === "ns-oauth-flow-update" &&
          m.tabId === 10,
      );
      expect(flowMsg).toBeUndefined();
    });
  });

  describe("lifecycle handlers", () => {
    it("onInstalled opens onboarding tab on install reason", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitInstalled("install");
      await vi.runAllTimersAsync();

      expect(mock.chrome.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("onboarding"),
        }),
      );
    });

    it("onInstalled does NOT open onboarding on update reason", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitInstalled("update");
      await vi.runAllTimersAsync();

      expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
    });

    it("onInstalled syncs DNR rulesets", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitInstalled("install");
      await vi.runAllTimersAsync();

      expect(mock.chrome.declarativeNetRequest.updateEnabledRulesets).toHaveBeenCalled();
    });

    it("onStartup syncs DNR rulesets", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitStartup();
      await vi.runAllTimersAsync();

      expect(mock.chrome.declarativeNetRequest.updateEnabledRulesets).toHaveBeenCalled();
    });

    it("storage.onChanged ignores non-local area changes", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.chrome.declarativeNetRequest.updateEnabledRulesets.mockClear();

      mock.emitStorageChanged(
        { navSentinelSettings: { oldValue: {}, newValue: { nav: { defaultMode: "off" } } } },
        "session",
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.declarativeNetRequest.updateEnabledRulesets).not.toHaveBeenCalled();
    });
  });

  describe("tab removal cleanup", () => {
    it("clears all per-tab state on tab removal", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Set up state for tab 10
      mock.dispatchRuntimeMessage(
        { type: "ns-allow-nav", ttlMs: 1500 },
        { tab: { id: 10 } },
      );
      mock.dispatchRuntimeMessage(
        { type: "ns-nav-gesture", ttlMs: 1500 },
        { tab: { id: 10 } },
      );

      // Remove the tab
      mock.emitTabRemoved(10);

      // Verify rollback check returns nothing for removed tab
      const res = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        { tab: { id: 10 } },
      ) as { shouldRollback: boolean; entry: unknown };

      expect(res.shouldRollback).toBe(false);
      expect(res.entry).toBeUndefined();
    });

    it("clears icon on tab removal", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Set icon state
      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "red", blockCount: 3 },
        { tab: { id: 10 } },
      );
      await vi.runAllTimersAsync();

      mock.chrome.action.setBadgeText.mockClear();
      mock.emitTabRemoved(10);

      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, text: "" }),
      );
    });
  });
});
