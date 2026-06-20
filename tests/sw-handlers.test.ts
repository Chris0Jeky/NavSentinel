import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUITE_SETTINGS_KEY } from "../extension/src/shared/storage";

type RuntimeMessage = Record<string, unknown>;
type RuntimeSender = { tab?: { id?: number; windowId?: number }; frameId?: number };
type SendResponse = (response?: unknown) => void;

function createEvent<T extends (...args: never[]) => void>() {
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

  describe("hydration gating of session-backed handlers (#228.1)", () => {
    it("defers ns-check-rollback until hydration so it reflects restored state", async () => {
      const mock = createChromeMock();
      // Seed a pending rollback for tab 5 in session storage.
      mock.chrome.storage.session._store["ns_sw:lastCommitted"] = {
        "5": { allowedAtCommit: false, prevUrl: "https://prev.test/" },
      };
      // Gate the hydrate read so the message arrives BEFORE hydration completes.
      let releaseGet!: () => void;
      const gate = new Promise<void>((r) => { releaseGet = r; });
      const origGet = mock.chrome.storage.session.get.bind(mock.chrome.storage.session);
      mock.chrome.storage.session.get = (async (keys?: string | string[]) => {
        await gate;
        return origGet(keys);
      }) as typeof mock.chrome.storage.session.get;

      await loadSw(mock);

      // Pre-hydrate: dispatch a session-backed read handler.
      let response: unknown;
      (mock.chrome.runtime.onMessage as unknown as {
        emit: (m: unknown, s: unknown, r: (v?: unknown) => void) => void;
      }).emit({ type: "ns-check-rollback" }, { tab: { id: 5 } }, (v) => { response = v; });

      // The handler must NOT respond yet -- it is deferred until hydration.
      expect(response).toBeUndefined();

      // Complete hydration; the deferred body then runs and responds with the
      // restored rollback entry (rather than the empty pre-hydrate map).
      releaseGet();
      await vi.runAllTimersAsync();

      expect(response).toEqual(
        expect.objectContaining({ shouldRollback: true, prevUrl: "https://prev.test/" }),
      );

      // A different tab with no restored entry must report no rollback -- proves
      // the deferred handler reads the actual hydrated map, not a constant (R1-6).
      let response2: unknown;
      (mock.chrome.runtime.onMessage as unknown as {
        emit: (m: unknown, s: unknown, r: (v?: unknown) => void) => void;
      }).emit({ type: "ns-check-rollback" }, { tab: { id: 6 } }, (v) => { response2 = v; });
      await vi.runAllTimersAsync();
      expect(response2).toEqual(expect.objectContaining({ shouldRollback: false }));
    });

    it("defers a WRITE handler (ns-allow-nav) so the mutation persists after hydration (R1-4)", async () => {
      const mock = createChromeMock();
      let releaseGet!: () => void;
      const gate = new Promise<void>((r) => { releaseGet = r; });
      const origGet = mock.chrome.storage.session.get.bind(mock.chrome.storage.session);
      mock.chrome.storage.session.get = (async (keys?: string | string[]) => {
        await gate;
        return origGet(keys);
      }) as typeof mock.chrome.storage.session.get;

      await loadSw(mock);

      let response: unknown;
      (mock.chrome.runtime.onMessage as unknown as {
        emit: (m: unknown, s: unknown, r: (v?: unknown) => void) => void;
      }).emit({ type: "ns-allow-nav", ttlMs: 8000 }, { tab: { id: 5 } }, (v) => { response = v; });

      // Pre-hydrate: deferred -- no response and no persisted write yet.
      expect(response).toBeUndefined();
      expect(mock.chrome.storage.session._store["ns_sw:allowUntil"]).toBeUndefined();

      releaseGet();
      await vi.runAllTimersAsync();

      expect(response).toEqual({ ok: true });
      // persistMap fired post-hydrate with the tab's allow entry.
      expect(mock.chrome.storage.session._store["ns_sw:allowUntil"]).toEqual(
        expect.objectContaining({ "5": expect.any(Number) }),
      );
    });

    it("defers ns-get-chain-info until hydration so it reflects restored chains (R1-1)", async () => {
      const mock = createChromeMock();
      mock.chrome.storage.session._store["ns_sw:redirectChains"] = {
        "5": {
          hops: [{ url: "https://a.test/" }, { url: "https://b.test/" }],
          startedAt: 1,
        },
      };
      let releaseGet!: () => void;
      const gate = new Promise<void>((r) => { releaseGet = r; });
      const origGet = mock.chrome.storage.session.get.bind(mock.chrome.storage.session);
      mock.chrome.storage.session.get = (async (keys?: string | string[]) => {
        await gate;
        return origGet(keys);
      }) as typeof mock.chrome.storage.session.get;

      await loadSw(mock);

      let response: unknown;
      (mock.chrome.runtime.onMessage as unknown as {
        emit: (m: unknown, s: unknown, r: (v?: unknown) => void) => void;
      }).emit({ type: "ns-get-chain-info" }, { tab: { id: 5 } }, (v) => { response = v; });

      // Pre-hydrate: deferred (without the gate it would synchronously return the
      // empty depth:0 default).
      expect(response).toBeUndefined();

      releaseGet();
      await vi.runAllTimersAsync();

      // Full RedirectChainInfo contract (seeded a.test/b.test are non-redirectors).
      expect(response).toEqual({ depth: 2, viaKnownRedirector: false, knownRedirectorHops: 0 });
    });
  });

  describe("ns-tab-risk-update", () => {
    it("accepts valid risk states and updates icon with correct tabId", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "red", blockCount: 2 },
        { tab: { id: 10 } },
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, text: "2" }),
      );
      expect(mock.chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, color: "#dc2626" }),
      );
    });

    it("sets empty badge text for gray state", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.chrome.action.setBadgeText.mockClear();

      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "gray", blockCount: 0 },
        { tab: { id: 10 } },
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, text: "" }),
      );
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

    it("clamps non-finite blockCount to 0 and renders check mark", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.chrome.action.setBadgeText.mockClear();

      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "red", blockCount: NaN },
        { tab: { id: 10 } },
      );

      await vi.runAllTimersAsync();
      // blockCount clamped to 0 → icon_manager renders the state's default text
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10 }),
      );
      const call = mock.chrome.action.setBadgeText.mock.calls.find(
        (c: unknown[]) => (c[0] as { tabId: number }).tabId === 10,
      );
      expect(call).toBeDefined();
      // With blockCount=0, red state renders "✕" (not a negative number)
      expect((call![0] as { text: string }).text).toBe("✕");
    });

    it("clamps negative blockCount to 0 and renders check mark", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.chrome.action.setBadgeText.mockClear();

      mock.dispatchRuntimeMessage(
        { type: "ns-tab-risk-update", state: "yellow", blockCount: -5 },
        { tab: { id: 10 } },
      );

      await vi.runAllTimersAsync();
      const call = mock.chrome.action.setBadgeText.mock.calls.find(
        (c: unknown[]) => (c[0] as { tabId: number }).tabId === 10,
      );
      expect(call).toBeDefined();
      // blockCount clamped to 0 → yellow state renders "!" (not "-5")
      expect((call![0] as { text: string }).text).toBe("!");
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

    it("throttles to 3 captures per tab and drops the 4th safely", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      const sender = { tab: { id: 42, windowId: 1 } };

      for (let i = 0; i < 3; i++) {
        const ok = mock.dispatchRuntimeMessage(
          { type: "ns-capture-viewport" },
          sender,
        ) as { dataUrl: string | null };
        expect(ok.dataUrl).toBe("data:image/png;base64,mockdata");
      }

      // 4th within the window is dropped: returns null without capturing.
      const dropped = mock.dispatchRuntimeMessage(
        { type: "ns-capture-viewport" },
        sender,
      ) as { dataUrl: string | null };
      expect(dropped.dataUrl).toBeNull();
      expect(mock.chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(3);

      // A different tab has its own independent budget.
      const otherTab = mock.dispatchRuntimeMessage(
        { type: "ns-capture-viewport" },
        { tab: { id: 99, windowId: 1 } },
      ) as { dataUrl: string | null };
      expect(otherTab.dataUrl).toBe("data:image/png;base64,mockdata");
    });

    it("honors the persisted per-tab count after a restart (D-SWRATE: limit survives recycle)", async () => {
      const mock = createChromeMock();
      const now = Date.now();
      // A prior worker used all 3 captures this window; the counts were persisted
      // to session storage. A restarted worker hydrates them, and (because the
      // handler gates on hydration) the next capture is denied — recycling the
      // worker mid-window cannot reset the counter.
      (mock.chrome.storage.session as unknown as { _store: Record<string, unknown> })._store[
        "ns_sw:captureTimestamps"
      ] = { "42": [now - 3000, now - 2000, now - 1000] };
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage(
        { type: "ns-capture-viewport" },
        { tab: { id: 42, windowId: 1 } },
      ) as { dataUrl: string | null };
      expect(res.dataUrl).toBeNull();
      expect(mock.chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    });

    it("defers the capture decision until hydration when the worker is not yet hydrated", async () => {
      const mock = createChromeMock();
      const now = Date.now();
      const session = mock.chrome.storage.session as unknown as {
        _store: Record<string, unknown>;
        get: (keys?: string | string[]) => Promise<Record<string, unknown>>;
      };
      // Persisted counts already at the cap for tab 42.
      session._store["ns_sw:captureTimestamps"] = { "42": [now - 3000, now - 2000, now - 1000] };

      // Block hydration so the handler must take the deferred (!hydrated) branch.
      let releaseHydration!: () => void;
      const gate = new Promise<void>((r) => { releaseHydration = r; });
      const realGet = session.get.bind(mock.chrome.storage.session);
      session.get = async (keys?: string | string[]) => {
        await gate;
        return realGet(keys);
      };

      await loadSw(mock);

      let captured: unknown = "NOT_CALLED";
      mock.chrome.runtime.onMessage.emit(
        { type: "ns-capture-viewport" },
        { tab: { id: 42, windowId: 1 } },
        (v: unknown) => { captured = v; },
      );

      // Pre-hydrate: the handler returned true and has NOT responded or captured.
      expect(captured).toBe("NOT_CALLED");
      expect(mock.chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();

      // Release hydration; the deferred capture now decides against the restored
      // 3-timestamp count and is denied (no recycle bypass).
      releaseHydration();
      for (let i = 0; i < 12; i++) await Promise.resolve();

      expect(captured).toEqual({ dataUrl: null });
      expect(mock.chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    });

    it("prunes safely over a corrupt non-array entry without throwing/hanging the port", async () => {
      const mock = createChromeMock();
      const now = Date.now();
      const session = mock.chrome.storage.session as unknown as { _store: Record<string, unknown> };
      const counts: Record<string, unknown> = {};
      // Exceed CAPTURE_RATE_PRUNE_LIMIT (200) so the prune loop runs, including a
      // corrupt non-array entry that must not throw out of the synchronous handler.
      for (let i = 0; i < 205; i++) counts[String(i)] = [now - 1000];
      counts["999"] = "corrupt-not-an-array";
      session._store["ns_sw:captureTimestamps"] = counts;
      await loadSw(mock);

      const res = mock.dispatchRuntimeMessage(
        { type: "ns-capture-viewport" },
        { tab: { id: 4242, windowId: 1 } },
      ) as { dataUrl: string | null };

      // Reached a normal decision (not a thrown/hung port) and captured.
      expect(res.dataUrl).toBe("data:image/png;base64,mockdata");
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

    it("rejects opener nav after child tab is removed (tab ID reuse safety)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });
      mock.emitTabRemoved(20);

      // Same tab ID reused — should be rejected since entry was deleted
      mock.sentMessages.length = 0;
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish", ts: Date.now() },
        { tab: { id: 20 } },
      );

      const fwdMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-opener-nav-from-child",
      );
      expect(fwdMsg).toBeUndefined();
    });

    it("does not send ns-oauth-opener-manipulation when flow is complete", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Start and complete an OAuth flow on opener tab
      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.com%2Fcb&response_type=code";
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: oauthUrl });
      mock.emitCommitted({ tabId: 10, frameId: 0, url: oauthUrl, transitionType: "link" });

      // Complete the flow by navigating to callback
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://app.com/cb?code=done",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://app.com/cb?code=done",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      // Register child and send opener nav
      mock.emitTabCreated({ id: 20, openerTabId: 10 });
      mock.sentMessages.length = 0;

      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/steal", ts: Date.now() },
        { tab: { id: 20 } },
      );

      // Should forward the opener nav but NOT send oauth-opener-manipulation
      const oauthMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-opener-manipulation",
      );
      expect(oauthMsg).toBeUndefined();

      const fwdMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-opener-nav-from-child",
      );
      expect(fwdMsg).toBeDefined();
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

  describe("onCreated hydration deferral", () => {
    it("persists a pre-hydration onCreated child entry after hydration (survives a later restart)", async () => {
      // Genuine regression guard. Because _restoreMap MERGES (never clears) and
      // persistMap early-returns while !hydrated, the *in-memory* map ends as
      // {20,30} either way — so an in-memory/behavioral assertion does NOT detect
      // the bug. The real defect is durability: pre-fix the synchronous set(20)'s
      // persistMap is skipped (!hydrated) and the empty .then never re-persists,
      // so STORAGE stays {30} and tab 20 is lost on the next SW restart. Post-fix
      // the deferred onCreatedHandler runs persistMap AFTER hydration → STORAGE
      // holds {20,30}. Hydration itself never persists, so storage distinguishes.
      const mock = createChromeMock();
      const now = Date.now();
      mock.chrome.storage.session._store["ns_sw:childWindow"] = {
        "30": { openerTabId: 40, createdAt: now, openerNavObserved: false },
      };

      // Gate the first session.get (the hydrate read) so hydration stays pending.
      let releaseHydration!: () => void;
      const gate = new Promise<void>((r) => {
        releaseHydration = r;
      });
      const session = mock.chrome.storage.session;
      const realGet = session.get.bind(session);
      let gated = true;
      session.get = (async (keys?: string | string[]) => {
        if (gated) {
          gated = false;
          await gate;
        }
        return realGet(keys);
      }) as typeof session.get;

      await loadSw(mock); // module imported; hydrate() is pending on the gate

      // onCreated fires BEFORE hydration completes — must be deferred, not run
      // synchronously against the un-hydrated Map (where its persist is dropped).
      mock.emitTabCreated({ id: 20, openerTabId: 10 });

      releaseHydration();
      for (let i = 0; i < 20; i++) await Promise.resolve();

      // The deferred entry must be PERSISTED (this is what fails pre-fix), and the
      // hydrated entry retained.
      const stored = mock.chrome.storage.session._store["ns_sw:childWindow"] as
        | Record<string, unknown>
        | undefined;
      expect(stored, "childWindow persisted after hydration").toBeDefined();
      expect(stored, "deferred onCreated entry (20) persisted post-hydration").toHaveProperty("20");
      expect(stored, "hydrated entry (30) retained").toHaveProperty("30");

      // Sanity: both children are tracked in memory (opener-nav maps correctly).
      mock.sentMessages.length = 0;
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/a", ts: Date.now() },
        { tab: { id: 20 } },
      );
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/b", ts: Date.now() },
        { tab: { id: 30 } },
      );
      const toOpener = (openerId: number) =>
        mock.sentMessages.find(
          (m) =>
            (m.message as { type: string }).type === "ns-dblclick-opener-nav-from-child" &&
            m.tabId === openerId,
        );
      expect(toOpener(10), "deferred onCreated child (20->10) tracked").toBeDefined();
      expect(toOpener(40), "hydrated child (30->40) tracked").toBeDefined();
    });
  });

  describe("onUpdated hydration deferral (#266)", () => {
    it("defers a pending-rollback send until hydration so the restored offer is not dropped", async () => {
      // Pre-fix: onUpdated fires before _doHydrate resolves, reads the still-empty
      // pendingRollbackByTab map, finds nothing, and the restored rollback offer is
      // silently dropped (same FN class as #228.1). Post-fix: the handler is deferred
      // until hydration, reads the restored entry, and sends ns-rollback. The send is
      // the only observable signal, so it distinguishes the two code paths.
      const mock = createChromeMock();
      mock.chrome.storage.session._store["ns_sw:pendingRollback"] = {
        "7": {
          url: "https://safe.test/landing",
          prevUrl: "https://safe.test/home",
          qualifiers: ["client_redirect"],
        },
      };

      // Gate only the hydrate read so onUpdated fires BEFORE hydration completes.
      let releaseGet!: () => void;
      const gate = new Promise<void>((r) => {
        releaseGet = r;
      });
      const origGet = mock.chrome.storage.session.get.bind(mock.chrome.storage.session);
      let gated = true;
      mock.chrome.storage.session.get = (async (keys?: string | string[]) => {
        if (gated) {
          gated = false;
          await gate;
        }
        return origGet(keys);
      }) as typeof mock.chrome.storage.session.get;

      await loadSw(mock);

      const rollbackMsg = () =>
        mock.sentMessages.find(
          (m) => (m.message as { type: string }).type === "ns-rollback" && m.tabId === 7,
        );

      // onUpdated fires pre-hydration. This negative assertion is a setup sanity-check:
      // pre-fix the ungated handler also reads the still-empty in-memory map and sends
      // nothing, so it cannot by itself distinguish deferral from an empty read. The
      // DISCRIMINATOR is the post-hydration positive assertion below, which fails on
      // pre-fix sw.ts (verified) because the dropped event never re-fires. (#266 R2)
      mock.sentMessages.length = 0;
      mock.emitTabUpdated(7, { status: "complete" }, { url: "https://safe.test/landing" });
      expect(rollbackMsg(), "rollback must NOT be sent before hydration").toBeUndefined();

      // Complete hydration; the deferred handler reads the restored entry and sends.
      releaseGet();
      await vi.runAllTimersAsync();

      const sent = rollbackMsg();
      expect(sent, "rollback sent after hydration from the restored map").toBeDefined();
      // Assert the FULL restored entry round-tripped, not just the url (R1).
      expect(sent!.message).toEqual(
        expect.objectContaining({
          type: "ns-rollback",
          url: "https://safe.test/landing",
          prevUrl: "https://safe.test/home",
          qualifiers: ["client_redirect"],
        }),
      );
    });

    it("defers a pending-forward send until hydration so the restored offer is not dropped", async () => {
      // Symmetric guard for the second session-backed path in onUpdatedHandler
      // (pendingForwardByTab + readyTabs), which the rollback test does not exercise
      // (R1). Pre-fix the pre-hydration read sees empty maps and the forward offer is
      // dropped; post-fix it is deferred, reads the restored entry + readyTabs, and sends.
      const mock = createChromeMock();
      mock.chrome.storage.session._store["ns_sw:pendingForward"] = {
        "8": { url: "https://safe.test/forward-target", ts: Date.now() },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [8];

      let releaseGet!: () => void;
      const gate = new Promise<void>((r) => {
        releaseGet = r;
      });
      const origGet = mock.chrome.storage.session.get.bind(mock.chrome.storage.session);
      let gated = true;
      mock.chrome.storage.session.get = (async (keys?: string | string[]) => {
        if (gated) {
          gated = false;
          await gate;
        }
        return origGet(keys);
      }) as typeof mock.chrome.storage.session.get;

      await loadSw(mock);

      const forwardMsg = () =>
        mock.sentMessages.find(
          (m) => (m.message as { type: string }).type === "ns-forward-offer" && m.tabId === 8,
        );

      // currentUrl differs from forward.url, so the forward branch proceeds once it runs.
      // (Negative assertion is a sanity-check; the post-hydration positive assertion is the
      // discriminator that fails on pre-fix sw.ts — same rationale as the rollback test.)
      mock.sentMessages.length = 0;
      mock.emitTabUpdated(8, { status: "complete" }, { url: "https://safe.test/current" });
      expect(forwardMsg(), "forward offer must NOT be sent before hydration").toBeUndefined();

      releaseGet();
      await vi.runAllTimersAsync();

      const sent = forwardMsg();
      expect(sent, "forward offer sent after hydration from the restored map").toBeDefined();
      expect(sent!.message).toEqual(
        expect.objectContaining({ type: "ns-forward-offer", url: "https://safe.test/forward-target" }),
      );
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

    it("sends ns-dblclick-child-closed at exactly max age boundary (5000ms)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });

      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish", ts: Date.now() },
        { tab: { id: 20 } },
      );

      // age === DBLCLICK_CHILD_MAX_AGE_MS (5000ms) — condition is <=, should fire
      vi.advanceTimersByTime(5000);
      mock.sentMessages.length = 0;
      mock.emitTabRemoved(20);

      const closedMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-child-closed",
      );
      expect(closedMsg).toBeDefined();
    });

    it("does NOT send ns-dblclick-child-closed 1ms past max age (5001ms)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });

      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/phish", ts: Date.now() },
        { tab: { id: 20 } },
      );

      // age === 5001ms, condition is <= 5000, should NOT fire
      vi.advanceTimersByTime(5001);
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

      // Verify a middle entry (tab 125) also survived
      mock.sentMessages.length = 0;
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://test.test", ts: Date.now() },
        { tab: { id: 125 } },
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

    it("a non-OAuth commit WITHOUT OAuth response params is not treated as the callback (no false mismatch) (#207)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Start OAuth flow with redirect_uri to app.com
      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.com%2Fcb&response_type=code";
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: oauthUrl });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: oauthUrl,
        transitionType: "link",
      });

      // An intermediate same-provider step with no OAuth RESPONSE params (authuser
      // switch). Previously this was unconditionally treated as the callback and
      // fired a false redirect-mismatch (accounts.google.com != app.com). It must
      // not now.
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

      // No mismatch, and the flow is NOT completed (the non-callback commit returns early).
      const mismatchMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatchMsg).toBeUndefined();
      const completeMsg = mock.sentMessages.find(
        (m) =>
          (m.message as { type: string }).type === "ns-oauth-flow-update" &&
          (m.message as { flow: { phase: string } }).flow.phase === "complete",
      );
      expect(completeMsg).toBeUndefined();
    });

    it("a genuine cross-domain provider hop (no response params) does not fire a redirect-mismatch (#207)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Microsoft flow; redirect_uri -> app.contoso.com
      const consentUrl =
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp.contoso.com%2Fcb&response_type=code&scope=openid";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: consentUrl, transitionType: "link" });

      // Genuine Microsoft hop on a DIFFERENT registrable domain, carrying an
      // authorization REQUEST (client_id/response_type/state) but no response payload.
      mock.sentMessages.length = 0;
      const hopUrl =
        "https://login.live.com/oauth20_authorize.srf?client_id=x&response_type=code&scope=openid&state=abc";
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: hopUrl,
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
      });

      const mismatchMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatchMsg).toBeUndefined();
    });

    it("navigating away mid-consent (user cancel) does not fire a redirect-mismatch (#207)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.com%2Fcb&response_type=code";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: oauthUrl, transitionType: "link" });

      // User clicks a bookmark to an unrelated site.
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://gmail.com/",
        transitionType: "auto_bookmark",
      });

      const mismatchMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatchMsg).toBeUndefined();
    });

    it("records the initiating page (not the consent URL) as initiatorUrl (#207)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // The page that initiates the sign-in commits first.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://app.example/start",
        transitionType: "link",
      });

      // Then the OAuth consent navigation.
      mock.sentMessages.length = 0;
      const consentUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&response_type=code&scope=openid";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: consentUrl, transitionType: "link" });

      const flowMsg = mock.sentMessages.find(
        (m) =>
          (m.message as { type: string }).type === "ns-oauth-flow-update" && m.tabId === 10,
      );
      expect(flowMsg).toBeDefined();
      const flow = (flowMsg!.message as { flow: { initiatorUrl: string; consentUrl: string } }).flow;
      expect(flow.initiatorUrl).toBe("https://app.example/start");
      expect(flow.consentUrl).toBe(consentUrl);
    });

    it("a typed/bookmarked cross-domain page carrying a generic ?code= does not fire a redirect-mismatch (#207 R1)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const consentUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&response_type=code&scope=openid";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: consentUrl, transitionType: "link" });

      // User abandons consent and TYPES a different-domain URL that happens to carry
      // a generic ?code= (e.g. a coupon). Not redirect-driven -> not a callback.
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://shop.example/item?code=BLACKFRIDAY",
        transitionType: "typed",
      });

      const mismatch = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatch).toBeUndefined();
    });

    it("keeps the flow alive across a paramless redirect hop and still flags the real cross-domain callback (#207 R1)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const consentUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&response_type=code&scope=openid";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: consentUrl, transitionType: "link" });

      // Intermediate provider hop: redirect-driven, no OAuth response params -> the
      // flow must NOT be consumed/stranded.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://login.live.com/oauth20_authorize.srf?client_id=x&response_type=code&state=abc",
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
      });

      // The REAL callback then arrives via redirect on an unexpected domain.
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://evil.example/cb?code=authcode&state=abc",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      const mismatch = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatch).toBeDefined();
    });

    it("flags an attacker callback that ALSO matches isOAuthUrl during an active flow (#222)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Start the flow; redirect_uri -> app.example.com (the expected callback host).
      const consentUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&response_type=code&scope=openid";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: consentUrl, transitionType: "link" });

      // A second authorization hop (isOAuthUrl, no response params) advances the flow
      // into the "consent" phase — the exact state in which the bypass manifested.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://accounts.google.com/signin/oauth/consent?client_id=x&scope=openid&state=abc",
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
      });

      // The attacker callback is crafted to ALSO satisfy isOAuthUrl: an oauth-keyword
      // path segment ("/oauth/") + an OAuth request param ("scope"), on top of the
      // `code` response param. Before #222 this skipped the callback branch (because
      // isOAuthUrl was true) and fell through to fresh-flow creation, so no mismatch
      // fired. It lands on evil.example, a different registrable domain than the
      // recorded redirect_uri host, so it MUST now flag.
      mock.sentMessages.length = 0;
      const attackerCallback =
        "https://evil.example/oauth/cb?scope=openid&code=stolenauthcode&state=abc";
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: attackerCallback,
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      const mismatch = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatch).toBeDefined();
      expect((mismatch!.message as { callbackUrl: string }).callbackUrl).toBe(attackerCallback);
      const complete = mock.sentMessages.find(
        (m) =>
          (m.message as { type: string }).type === "ns-oauth-flow-update" &&
          (m.message as { flow: { phase: string } }).flow.phase === "complete",
      );
      expect(complete).toBeDefined();
    });

    it("does NOT fire a mismatch for an isOAuthUrl-matching callback to the EXPECTED domain (#222 no-FP)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const consentUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&response_type=code&scope=openid";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: consentUrl, transitionType: "link" });

      // A legitimate callback to the EXPECTED domain that happens to also match
      // isOAuthUrl (oauth path keyword + scope) must still complete with NO mismatch —
      // the hoisted callback check only fires the +30 on a registrable-domain change.
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://app.example.com/oauth/cb?scope=openid&code=authcode&state=abc",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      const mismatch = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatch).toBeUndefined();
      const complete = mock.sentMessages.find(
        (m) =>
          (m.message as { type: string }).type === "ns-oauth-flow-update" &&
          (m.message as { flow: { phase: string } }).flow.phase === "complete",
      );
      expect(complete).toBeDefined();
    });

    it("flags a LINK-CLICK callback to an unexpected domain (no redirect qualifier) (#207 R2)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const consentUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&response_type=code&scope=openid";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: consentUrl, transitionType: "link" });

      // The malicious callback is delivered via a victim-clicked link (transitionType
      // "link", NO client_redirect/server_redirect qualifier). It still carries code
      // and lands on an unexpected domain, so it must still be flagged — the gate
      // excludes only user-typed/bookmarked navigations, not link clicks.
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://evil.example/cb?code=authcode",
        transitionType: "link",
      });

      const mismatch = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatch).toBeDefined();
    });

    it("does NOT fire a redirect-mismatch for a legit callback to the EXPECTED domain (#207 R2)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      const consentUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb&response_type=code&scope=openid";
      mock.emitCommitted({ tabId: 10, frameId: 0, url: consentUrl, transitionType: "link" });

      // Legit callback to the EXPECTED domain via redirect, carrying code -> completes
      // with NO mismatch (the primary no-false-positive guarantee).
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://app.example.com/cb?code=authcode&state=abc",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      const mismatch = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatch).toBeUndefined();
      const complete = mock.sentMessages.find(
        (m) =>
          (m.message as { type: string }).type === "ns-oauth-flow-update" &&
          (m.message as { flow: { phase: string } }).flow.phase === "complete",
      );
      expect(complete).toBeDefined();
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

      // Start OAuth flow with redirect_uri pointing to myapp.com
      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fmyapp.com%2Fcb&response_type=code";
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: oauthUrl });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: oauthUrl,
        transitionType: "link",
      });

      // Navigate to evil.com instead of myapp.com (domain mismatch)
      mock.sentMessages.length = 0;
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://evil.com/steal?code=authcode123",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://evil.com/steal?code=authcode123",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      const mismatchMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatchMsg).toBeDefined();
      expect(mismatchMsg!.tabId).toBe(10);
      expect((mismatchMsg!.message as { callbackUrl: string }).callbackUrl).toBe(
        "https://evil.com/steal?code=authcode123",
      );
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
        { ["sentinelsuite:settings_v1"]: { oldValue: {}, newValue: { nav: { defaultMode: "off" } } } },
        "session",
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.declarativeNetRequest.updateEnabledRulesets).not.toHaveBeenCalled();
    });

    it("storage.onChanged syncs DNR on local settings change", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.chrome.declarativeNetRequest.updateEnabledRulesets.mockClear();

      mock.emitStorageChanged(
        { ["sentinelsuite:settings_v1"]: { oldValue: {}, newValue: { nav: { defaultMode: "smart" } } } },
        "local",
      );

      await vi.runAllTimersAsync();
      expect(mock.chrome.declarativeNetRequest.updateEnabledRulesets).toHaveBeenCalled();
    });

    it("storage.onChanged ignores local changes to unrelated keys", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.chrome.declarativeNetRequest.updateEnabledRulesets.mockClear();

      mock.emitStorageChanged(
        { someOtherKey: { oldValue: null, newValue: "something" } },
        "local",
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

    it("clears oauthFlowByTab on tab removal", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      // Start OAuth flow on tab 10
      const oauthUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.com%2Fcb&response_type=code";
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: oauthUrl });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: oauthUrl,
        transitionType: "link",
      });

      // Remove the tab
      mock.emitTabRemoved(10);

      // Navigate tab 10 to callback — flow should be gone, no completion msg
      mock.sentMessages.length = 0;
      mock.emitBeforeNavigate({
        tabId: 10,
        frameId: 0,
        url: "https://app.com/cb?code=test",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://app.com/cb?code=test",
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

    it("clears childWindowByTab on tab removal", async () => {
      const mock = createChromeMock();
      await loadSw(mock);

      mock.emitTabCreated({ id: 20, openerTabId: 10 });
      mock.emitTabRemoved(20);

      // Opener nav from removed child should be rejected
      mock.sentMessages.length = 0;
      mock.dispatchRuntimeMessage(
        { type: "ns-dblclick-opener-nav", url: "https://evil.test/x", ts: Date.now() },
        { tab: { id: 20 } },
      );

      const fwdMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-dblclick-opener-nav-from-child",
      );
      expect(fwdMsg).toBeUndefined();
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
      await vi.runAllTimersAsync(); // clearTabIcon's blank is now chain-ordered + async (#272)

      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, text: "" }),
      );
    });
  });

  describe("cachedDefaultMode refresh on worker start (#303)", () => {
    it("paints a fresh top-frame nav gray when persisted mode is 'off' after a mid-session restart", async () => {
      const mock = createChromeMock();
      // Persisted mode is "off". loadSw simulates a mid-session MV3 restart: the
      // worker module is imported (woken by an event) but onInstalled/onStartup
      // do NOT fire, so the only refresh of cachedDefaultMode is the eager one.
      mock.chrome.storage.local.get = (async () => ({
        [SUITE_SETTINGS_KEY]: { nav: { defaultMode: "off" } },
      })) as unknown as typeof mock.chrome.storage.local.get;

      await loadSw(mock);
      // Let hydration and the eager cachedDefaultMode refresh settle.
      await vi.runAllTimersAsync();

      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://example.com/",
        transitionType: "link",
      });
      await vi.runAllTimersAsync();

      // mode "off" => gray badge (BADGE_CONFIG.gray is null: empty text, no color).
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 10, text: "" });
      // Pre-fix the cache stayed "smart" => green badge would set the green color
      // and the "✓" text; assert neither appears.
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, color: "#16a34a" }),
      );
      expect(mock.chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 10, text: "✓" });
    });

    it("the deferred wake-up navigation waits for the mode read before painting (#303)", async () => {
      const mock = createChromeMock();
      // Gate BOTH reads so the worker is un-hydrated AND the mode is unread when
      // the waking navigation arrives -> it must take the deferred path and wait
      // on startupReady (hydration + mode) before choosing the badge color.
      let releaseLocal!: () => void;
      let releaseSession!: () => void;
      const localGate = new Promise<void>((r) => { releaseLocal = r; });
      const sessionGate = new Promise<void>((r) => { releaseSession = r; });

      mock.chrome.storage.local.get = (async () => {
        await localGate;
        return { [SUITE_SETTINGS_KEY]: { nav: { defaultMode: "off" } } };
      }) as unknown as typeof mock.chrome.storage.local.get;

      const origSessionGet = mock.chrome.storage.session.get.bind(mock.chrome.storage.session);
      mock.chrome.storage.session.get = (async (keys?: string | string[]) => {
        await sessionGate;
        return origSessionGet(keys);
      }) as typeof mock.chrome.storage.session.get;

      await loadSw(mock);

      // Waking navigation arrives before hydration / mode read complete.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://example.com/",
        transitionType: "link",
      });
      // Handler is deferred on startupReady -> nothing painted for this tab yet.
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10 }),
      );

      // Release hydration + the mode read; the deferred handler now runs with "off".
      releaseSession();
      releaseLocal();
      await vi.runAllTimersAsync();

      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 10, text: "" });
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, color: "#16a34a" }),
      );
    });

    it("a nav after hydration but before the mode read still defers (session-before-local window) (#303)", async () => {
      const mock = createChromeMock();
      let releaseLocal!: () => void;
      let releaseSession!: () => void;
      const localGate = new Promise<void>((r) => { releaseLocal = r; });
      const sessionGate = new Promise<void>((r) => { releaseSession = r; });

      mock.chrome.storage.local.get = (async () => {
        await localGate;
        return { [SUITE_SETTINGS_KEY]: { nav: { defaultMode: "off" } } };
      }) as unknown as typeof mock.chrome.storage.local.get;

      const origSessionGet = mock.chrome.storage.session.get.bind(mock.chrome.storage.session);
      mock.chrome.storage.session.get = (async (keys?: string | string[]) => {
        await sessionGate;
        return origSessionGet(keys);
      }) as typeof mock.chrome.storage.session.get;

      await loadSw(mock);

      // Hydration completes (session resolves -> swState.hydrated becomes true) but
      // the cachedDefaultMode read (local) is still pending.
      releaseSession();
      await vi.runAllTimersAsync();

      // A nav in this window must STILL defer -- the guard is startupSettled, not
      // swState.hydrated. With the old swState.hydrated guard it would take the
      // synchronous path and paint green from the stale "smart" default.
      mock.emitCommitted({
        tabId: 11,
        frameId: 0,
        url: "https://example.com/",
        transitionType: "link",
      });
      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 11, text: "✓" });
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 11, color: "#16a34a" }),
      );

      // Release the mode read; the deferred handler now runs with mode "off".
      releaseLocal();
      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 11, text: "" });
    });
  });

  describe("rollback-suppress window cleared on new navigation (disc#1)", () => {
    it("a second suspicious URL within the suppress window still triggers a rollback", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      await vi.runAllTimersAsync(); // hydration + startupSettled

      const TAB = 30; // not in readyTabs -> rollbacks queue into pendingRollbackByTab

      // 1. First commit establishes prevUrl (no rollback: prevUrl was undefined).
      mock.emitCommitted({ tabId: TAB, frameId: 0, url: "https://a.com/", transitionType: "link" });
      // 2. Suspicious commit B (different registrable, no gesture) -> rollback + suppress set.
      mock.emitBeforeNavigate({ tabId: TAB, frameId: 0, url: "https://b.com/" });
      mock.emitCommitted({ tabId: TAB, frameId: 0, url: "https://b.com/", transitionType: "link" });
      // 3. A DIFFERENT suspicious URL C within the 6s suppress window.
      mock.emitBeforeNavigate({ tabId: TAB, frameId: 0, url: "https://c.com/" });
      mock.emitCommitted({ tabId: TAB, frameId: 0, url: "https://c.com/", transitionType: "link" });
      await vi.runAllTimersAsync();

      const pending = (mock.chrome.storage.session._store["ns_sw:pendingRollback"] ?? {}) as Record<
        string,
        { url: string }
      >;
      // Pre-fix: the suppress window from B's rollback survived the navigation to C,
      // so onCommitted(C) returned early -> no rollback queued for C (undefined).
      // Post-fix: onBeforeNavigate(C) cleared the suppress window -> C rolls back.
      expect(pending[String(TAB)]?.url).toBe("https://c.com/");
    });

    it("keeps the suppress window for the rollback-return nav but clears it for any other (disc#1)", async () => {
      const TAB = 50;
      const future = Date.now() + 60_000;
      // Seed a rollback-return state: suppress active, a matching rollbackReturn,
      // and a pending forward offer (so preserveForwardOffer can evaluate true).
      const mock = createChromeMock();
      mock.chrome.storage.session._store["ns_sw:suppressUntil"] = { [TAB]: future };
      mock.chrome.storage.session._store["ns_sw:rollbackReturn"] = {
        [TAB]: { url: "https://safe.com/", expiresAt: future },
      };
      mock.chrome.storage.session._store["ns_sw:pendingForward"] = {
        [TAB]: { url: "https://evil.com/", ts: Date.now() },
      };
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // 1. The rollback-return navigation (url matches rollbackReturn) must KEEP suppress.
      mock.emitBeforeNavigate({ tabId: TAB, frameId: 0, url: "https://safe.com/" });
      await vi.runAllTimersAsync();
      const afterReturn = (mock.chrome.storage.session._store["ns_sw:suppressUntil"] ?? {}) as Record<string, number>;
      expect(afterReturn[String(TAB)], "suppress must survive the rollback-return nav").toBeDefined();

      // 2. A genuine different navigation must CLEAR suppress.
      mock.emitBeforeNavigate({ tabId: TAB, frameId: 0, url: "https://other.com/" });
      await vi.runAllTimersAsync();
      const afterOther = (mock.chrome.storage.session._store["ns_sw:suppressUntil"] ?? {}) as Record<string, number>;
      // Pre-fix: suppress was never cleared on any onBeforeNavigate, so it survives here too.
      expect(afterOther[String(TAB)], "suppress must be cleared by a non-return nav").toBeUndefined();
    });
  });
});
