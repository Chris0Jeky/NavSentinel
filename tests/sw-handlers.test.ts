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
      // Seed a pending rollback for tab 5 in session storage. (Full lastCommitted shape, as
      // onCommittedHandler always writes it — the #339 restore validator requires it.)
      mock.chrome.storage.session._store["ns_sw:lastCommitted"] = {
        "5": {
          url: "https://cur.test/",
          prevUrl: "https://prev.test/",
          transitionType: "link",
          qualifiers: [],
          ts: 1000,
          allowedAtCommit: false,
        },
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
          // Full RedirectHop shape ({ url, ts, transitionType }) — the #339 restore validator requires it.
          hops: [
            { url: "https://a.test/", ts: 1, transitionType: "link" },
            { url: "https://b.test/", ts: 2, transitionType: "link" },
          ],
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

    it("removes the completed flow from the map and session storage instead of leaking it (#366)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      await vi.runAllTimersAsync();
      const oauthStore = () =>
        (mock.chrome.storage.session._store["ns_sw:oauthFlow"] ?? {}) as Record<string, unknown>;

      const authUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp.com%2Fcb&response_type=code";
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: authUrl });
      mock.emitCommitted({ tabId: 10, frameId: 0, url: authUrl, transitionType: "link" });
      expect(oauthStore()["10"]).toBeTruthy(); // resident while active

      // The callback commit (OAuth response params) completes the flow.
      mock.emitBeforeNavigate({ tabId: 10, frameId: 0, url: "https://app.com/cb?code=done" });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://app.com/cb?code=done",
        transitionType: "link",
        transitionQualifiers: ["client_redirect"],
      });

      // Pre-fix: the entry lingered as phase:'complete'. Post-fix: it is deleted.
      expect(oauthStore()["10"]).toBeUndefined();
      // The terminal 'complete' update is still delivered to the content script.
      const completeMsg = mock.sentMessages.find(
        (m) =>
          (m.message as { type: string }).type === "ns-oauth-flow-update" &&
          (m.message as { flow: { phase: string } }).flow.phase === "complete",
      );
      expect(completeMsg).toBeDefined();
    });

    it("prunes stale flows during an in-place update, not only on new-flow creation (#366)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      await vi.runAllTimersAsync();
      const oauthStore = () =>
        (mock.chrome.storage.session._store["ns_sw:oauthFlow"] ?? {}) as Record<string, unknown>;

      // Tab 10 starts a flow at T0.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp-a.com%2Fcb&response_type=code",
      });
      // +40s: tab 20 starts a flow (tab 10 still fresh at 40s < 60s max age).
      vi.setSystemTime(new Date("2026-03-17T12:00:40.000Z"));
      mock.emitCommitted({
        tabId: 20,
        frameId: 0,
        transitionType: "link",
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp-b.com%2Fcb&response_type=code",
      });
      expect(oauthStore()["10"]).toBeTruthy();
      expect(oauthStore()["20"]).toBeTruthy();

      // +30s more: tab 10 is now 70s old (stale); tab 20 is 30s (fresh). Tab 20 gets a
      // SECOND authorize → the IN-PLACE update path. Pre-fix that branch never pruned,
      // so tab 10's stale flow lingered; post-fix the prune-before-branch drops the OTHER
      // tab's stale entry while the updating tab is excluded from pruning.
      vi.setSystemTime(new Date("2026-03-17T12:01:10.000Z"));
      mock.emitCommitted({
        tabId: 20,
        frameId: 0,
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp-b.com%2Fcb&response_type=code&prompt=consent",
      });

      expect(oauthStore()["10"]).toBeUndefined(); // other tab's stale flow pruned
      expect(oauthStore()["20"]).toBeTruthy(); // the updating tab is never pruned
    });

    it("never prunes the active tab's own flow during an in-place update, preserving its callback domain (#366)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // Tab 10 starts a flow with redirect_uri -> expectedCallbackDomain = app-a.com.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp-a.com%2Fcb&response_type=code",
      });

      // The user lingers on consent for 70s (> 60s max age), THEN the page does an
      // in-place authorize hop WITHOUT a redirect_uri (the #324 case). The flow is past
      // max-age, but as the active tab it must NOT be pruned — otherwise it would restart
      // as a fresh flow with expectedCallbackDomain "" and lose redirect-mismatch coverage.
      vi.setSystemTime(new Date("2026-03-17T12:01:10.000Z"));
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
        url: "https://login.live.com/oauth20_authorize.srf?client_id=x&response_type=code&scope=openid",
      });

      const flowMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-flow-update" && m.tabId === 10,
      );
      const flow = (flowMsg?.message as { flow: { phase: string; expectedCallbackDomain: string } } | undefined)?.flow;
      expect(flow?.phase).toBe("consent"); // updated in place, not restarted as 'redirect'
      expect(flow?.expectedCallbackDomain).toBe("app-a.com"); // preserved (pre-bug-fix: "")
    });

    it("excludes the active tab from SIZE-CAP pruning, preserving its callback domain (#366 R2)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      await vi.runAllTimersAsync();
      const oauthStore = () =>
        (mock.chrome.storage.session._store["ns_sw:oauthFlow"] ?? {}) as Record<string, unknown>;

      // Tab 10 starts the OLDEST flow (redirect_uri -> expectedCallbackDomain app-a.com).
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp-a.com%2Fcb&response_type=code",
      });
      // Fill to 51 entries total (> OAUTH_FLOW_PRUNE_LIMIT of 50), all fresh (no age prune).
      for (let t = 11; t <= 60; t++) {
        mock.emitCommitted({
          tabId: t,
          frameId: 0,
          transitionType: "link",
          url: `https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fapp-${t}.com%2Fcb&response_type=code`,
        });
      }
      expect(Object.keys(oauthStore()).length).toBe(51); // over the 50 cap, none aged out

      // Tab 10 (the OLDEST entry, and the active tab) does an in-place authorize hop WITHOUT
      // a redirect_uri. The size cap fires (51 > 50) and would, without the active-tab
      // filter, evict tab 10 as the oldest — losing expectedCallbackDomain. The filter must
      // protect it and drop the oldest OTHER entry instead.
      vi.setSystemTime(new Date("2026-03-17T12:00:50.000Z")); // still < 60s for every flow
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
        url: "https://login.live.com/oauth20_authorize.srf?client_id=x&response_type=code&scope=openid",
      });

      const flowMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-flow-update" && m.tabId === 10,
      );
      const flow = (flowMsg?.message as { flow: { phase: string; expectedCallbackDomain: string } } | undefined)?.flow;
      expect(flow?.phase).toBe("consent"); // updated in place, not restarted
      expect(flow?.expectedCallbackDomain).toBe("app-a.com"); // preserved under size-cap pruning
      expect(oauthStore()["10"]).toBeTruthy(); // active tab survived the cap
      expect(Object.keys(oauthStore()).length).toBe(50); // exactly one OTHER entry pruned
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

    it("preserves expectedCallbackDomain when a second OAuth URL has no redirect_uri (disc#4)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // 1. Authorization request with redirect_uri -> flow created (redirect phase),
      //    expectedCallbackDomain = app.contoso.com.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp.contoso.com%2Fcb&response_type=code",
      });
      // 2. Second authorization URL (with redirect_uri) -> advances to consent phase.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp.contoso.com%2Fcb&response_type=code&prompt=consent",
      });
      mock.sentMessages.length = 0;
      // 3. Injected second OAuth URL WITHOUT a redirect_uri (the attack): must NOT
      //    wipe the expectedCallbackDomain established by the active flow.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        url: "https://login.live.com/oauth20_authorize.srf?client_id=x&response_type=code&scope=openid",
      });

      const flowMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-flow-update" && m.tabId === 10,
      );
      // Pre-fix: the consent-phase flow was overwritten by a fresh redirect-phase flow
      // with expectedCallbackDomain "" (then isUnexpectedCallback passes anything).
      // Post-fix: the flow is updated in place and the domain is preserved.
      expect(
        (flowMsg?.message as { flow: { expectedCallbackDomain: string } } | undefined)?.flow
          .expectedCallbackDomain,
      ).toBe("app.contoso.com");
    });

    it("updates expectedCallbackDomain when a second OAuth URL in consent carries a new redirect_uri (disc#4)", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // redirect -> consent, expectedCallbackDomain = app-a.com.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp-a.com%2Fcb&response_type=code",
      });
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp-a.com%2Fcb&response_type=code&prompt=consent",
      });
      mock.sentMessages.length = 0;
      // Second authorization URL (consent phase) WITH a new redirect_uri -> domain updates to app-b.com.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fapp-b.com%2Fcb&response_type=code",
      });
      const flowMsg = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-flow-update" && m.tabId === 10,
      );
      expect(
        (flowMsg?.message as { flow: { expectedCallbackDomain: string } } | undefined)?.flow
          .expectedCallbackDomain,
      ).toBe("app-b.com");

      // The updated domain is enforced: a callback to the OLD domain (different registrable) mismatches.
      mock.sentMessages.length = 0;
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
        url: "https://app-a.com/cb?code=abc&state=xyz",
      });
      const mismatch = mock.sentMessages.find(
        (m) => (m.message as { type: string }).type === "ns-oauth-redirect-mismatch",
      );
      expect(mismatch).toBeDefined();
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

    it("retries the mode read after a transient storage failure, avoiding a false green badge (#362)", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mock = createChromeMock();
      // Persisted mode is "off", but the FIRST cachedDefaultMode read rejects (a transient
      // storage failure). The retry must recover "off" so the badge does not flash green.
      let localGetCalls = 0;
      mock.chrome.storage.local.get = (async () => {
        localGetCalls++;
        if (localGetCalls === 1) throw new Error("transient storage failure");
        return { [SUITE_SETTINGS_KEY]: { nav: { defaultMode: "off" } } };
      }) as unknown as typeof mock.chrome.storage.local.get;

      await loadSw(mock);
      await vi.runAllTimersAsync();

      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://example.com/",
        transitionType: "link",
      });
      await vi.runAllTimersAsync();

      // The failure was surfaced (no longer a silent catch) and the retry ran.
      expect(
        warnSpy.mock.calls.some((c) => String(c[0]).includes("cachedDefaultMode read failed")),
      ).toBe(true);
      expect(localGetCalls).toBeGreaterThanOrEqual(2); // initial read + retry
      // mode "off" => gray badge; pre-fix the swallowed failure left "smart" => green.
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, color: "#16a34a" }),
      );
      warnSpy.mockRestore();
    });

    it("does not let a slow startup read clobber a newer onChanged mode (race) (#362)", async () => {
      const mock = createChromeMock();
      // Startup mode read is SLOW and returns the OLD mode ("smart" => green).
      let releaseLocal!: () => void;
      const localGate = new Promise<void>((r) => { releaseLocal = r; });
      mock.chrome.storage.local.get = (async () => {
        await localGate;
        return { [SUITE_SETTINGS_KEY]: { nav: { defaultMode: "smart" } } };
      }) as unknown as typeof mock.chrome.storage.local.get;

      await loadSw(mock);

      // While the startup read is in flight, the user switches to "off" -> onChanged delivers it.
      mock.emitStorageChanged(
        {
          [SUITE_SETTINGS_KEY]: {
            oldValue: { nav: { defaultMode: "smart" } },
            newValue: { nav: { defaultMode: "off" } },
          },
        },
        "local",
      );

      // Now let the slow startup read resolve with the now-STALE "smart".
      releaseLocal();
      await vi.runAllTimersAsync();

      // The newer "off" from onChanged must win -> a fresh commit paints gray, not green.
      // Pre-fix the late startup read overwrote "off" with "smart" => green badge.
      mock.emitCommitted({
        tabId: 10,
        frameId: 0,
        url: "https://example.com/",
        transitionType: "link",
      });
      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 10, color: "#16a34a" }),
      );
    });

    it("the deferred wake-up navigation waits for the mode read before painting (#303)", async () => {
      const mock = createChromeMock();
      // Gate BOTH reads so the worker is un-hydrated AND the mode is unread when the
      // waking navigation arrives -> it defers on hydration; once hydrated, the handler
      // runs and the icon paint awaits the mode read before choosing the badge color.
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
      // Handler is deferred on hydration -> nothing painted for this tab yet.
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

    it("runs the nav state machine on hydration but defers ONLY the icon paint until the mode read (#327)", async () => {
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

      mock.emitCommitted({
        tabId: 11,
        frameId: 0,
        url: "https://example.com/",
        transitionType: "link",
      });
      await vi.runAllTimersAsync();

      // #327: the nav state machine runs as soon as the session maps are hydrated -- the
      // handler did NOT defer on the mode read (the pre-#327 startupSettled gate would
      // have). Observable: it recorded lastUrl for the tab.
      const lastUrl = (mock.chrome.storage.session._store["ns_sw:lastUrl"] ?? {}) as Record<
        string,
        string
      >;
      expect(lastUrl["11"]).toBe("https://example.com/");

      // ...but ONLY the icon paint is deferred on the still-pending mode read, so no badge
      // has been painted for this tab yet -- in particular not a stale-"smart" green.
      expect(mock.chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 11, text: "" });
      expect(mock.chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 11, text: "✓" });
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 11 }),
      );

      // Release the mode read; the icon now paints with the restored "off" mode (gray).
      releaseLocal();
      await vi.runAllTimersAsync();
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 11, text: "" });
      // And green/"✓" must NEVER have reached tab 11 at any point — no stale-"smart" flash.
      expect(mock.chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 11, text: "✓" });
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 11, color: "#16a34a" }),
      );
      // The gray paint is definitively the LAST write for the tab (no trailing green flash).
      const tab11Texts = (mock.chrome.action.setBadgeText as unknown as {
        mock: { calls: Array<[{ tabId: number; text: string }]> };
      }).mock.calls.filter((c) => c[0].tabId === 11);
      expect(tab11Texts[tab11Texts.length - 1]?.[0]).toEqual({ tabId: 11, text: "" });
    });

    it("with the mode read settled first, the nav still defers on hydration, then paints gray (#327 local-first)", async () => {
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

      // Opposite ordering from the test above: the mode read (local) resolves FIRST while
      // session hydration is still pending.
      releaseLocal();
      await vi.runAllTimersAsync();

      // A nav in this window must STILL defer -- the handler gates on swState.hydrated,
      // which is not yet true even though the mode is already read.
      mock.emitCommitted({
        tabId: 12,
        frameId: 0,
        url: "https://example.com/",
        transitionType: "link",
      });
      await vi.runAllTimersAsync();
      const lastUrlPending = (mock.chrome.storage.session._store["ns_sw:lastUrl"] ?? {}) as Record<
        string,
        string
      >;
      expect(lastUrlPending["12"]).toBeUndefined();
      expect(mock.chrome.action.setBadgeText).not.toHaveBeenCalledWith({ tabId: 12, text: "" });

      // Release hydration; the deferred handler runs and the icon paints gray immediately
      // (cachedModeReady already settled, so the .then enqueues without further waiting).
      releaseSession();
      await vi.runAllTimersAsync();
      const lastUrl = (mock.chrome.storage.session._store["ns_sw:lastUrl"] ?? {}) as Record<
        string,
        string
      >;
      expect(lastUrl["12"]).toBe("https://example.com/");
      expect(mock.chrome.action.setBadgeText).toHaveBeenCalledWith({ tabId: 12, text: "" });
      expect(mock.chrome.action.setBadgeBackgroundColor).not.toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 12, color: "#16a34a" }),
      );
    });

    it("a threat escalation in the mode-pending window survives the deferred baseline reset (#327)", async () => {
      const mock = createChromeMock();
      let releaseLocal!: () => void;
      let releaseSession!: () => void;
      const localGate = new Promise<void>((r) => { releaseLocal = r; });
      const sessionGate = new Promise<void>((r) => { releaseSession = r; });

      // Mode is "smart" (on) -> the baseline reset would paint GREEN. The escalation paints
      // red; with a naive deferred paint the late green would overwrite the red and hide the
      // threat. The chain-anchored reset must be ordered BEFORE the escalation so red wins.
      mock.chrome.storage.local.get = (async () => {
        await localGate;
        return { [SUITE_SETTINGS_KEY]: { nav: { defaultMode: "smart" } } };
      }) as unknown as typeof mock.chrome.storage.local.get;

      const origSessionGet = mock.chrome.storage.session.get.bind(mock.chrome.storage.session);
      mock.chrome.storage.session.get = (async (keys?: string | string[]) => {
        await sessionGate;
        return origSessionGet(keys);
      }) as typeof mock.chrome.storage.session.get;

      await loadSw(mock);
      releaseSession(); // hydrated; mode read still pending
      await vi.runAllTimersAsync();

      // Fresh top-frame nav reserves the baseline-reset chain slot (color deferred on mode).
      mock.emitCommitted({ tabId: 13, frameId: 0, url: "https://example.com/", transitionType: "link" });
      await vi.runAllTimersAsync();

      // The content script detects a threat and escalates to red BEFORE the mode read resolves.
      (mock.chrome.runtime.onMessage as unknown as {
        emit: (m: unknown, s: unknown, r: (v?: unknown) => void) => void;
      }).emit({ type: "ns-tab-risk-update", state: "red", blockCount: 0 }, { tab: { id: 13 } }, () => {});
      await vi.runAllTimersAsync();

      // Mode read resolves: the green reset runs, then the escalation — red is the final state.
      releaseLocal();
      await vi.runAllTimersAsync();

      const colorCalls = (mock.chrome.action.setBadgeBackgroundColor as unknown as {
        mock: { calls: Array<[{ tabId: number; color: string }]> };
      }).mock.calls.filter((c) => c[0].tabId === 13);
      const textCalls = (mock.chrome.action.setBadgeText as unknown as {
        mock: { calls: Array<[{ tabId: number; text: string }]> };
      }).mock.calls.filter((c) => c[0].tabId === 13);
      // Final badge is red (✕ / #dc2626), NOT green (✓ / #16a34a). Pre-fix: the late green
      // overwrote the red -> last write would be green.
      expect(colorCalls[colorCalls.length - 1]?.[0].color).toBe("#dc2626");
      expect(textCalls[textCalls.length - 1]?.[0].text).toBe("✕");
    });
  });

  describe("rollback-suppress window cleared on new navigation (disc#1)", () => {
    it("a second suspicious URL within the suppress window still triggers a rollback", async () => {
      const mock = createChromeMock();
      await loadSw(mock);
      await vi.runAllTimersAsync(); // hydration + mode read

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
      // pendingForward just needs to exist (preserveForwardOffer requires !!forward);
      // its url is NOT compared -- only rollbackReturn.url === details.url is matched.
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

  describe("rollback/forward send-race hardening (#323)", () => {
    // Defer sendMessage callbacks (real Chrome is async) so the first send's
    // callback does not run before the second event, exposing the races.
    function deferSends(mock: ReturnType<typeof createChromeMock>) {
      const rollbackSends: number[] = [];
      const forwardSends: number[] = [];
      const captured: Array<() => void> = [];
      mock.chrome.tabs.sendMessage = ((
        tabId: number,
        message: unknown,
        optOrCb?: { frameId?: number } | (() => void),
        cb?: () => void,
      ) => {
        const done = typeof optOrCb === "function" ? optOrCb : cb;
        const type = (message as { type?: string }).type;
        if (type === "ns-rollback") rollbackSends.push(tabId);
        if (type === "ns-forward-offer") forwardSends.push(tabId);
        if (done) captured.push(done);
      }) as typeof mock.chrome.tabs.sendMessage;
      return { rollbackSends, forwardSends, captured };
    }

    it("does not double-send a rollback when onUpdated fires twice (disc#3)", async () => {
      const mock = createChromeMock();
      const { rollbackSends } = deferSends(mock);
      mock.chrome.storage.session._store["ns_sw:pendingRollback"] = {
        "10": { url: "https://evil.com/", qualifiers: [] },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [10];
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // Two rapid onUpdated events (url change, then status=complete) both pass the guard.
      mock.emitTabUpdated(10, { url: "https://evil.com/" }, { url: "https://evil.com/" });
      mock.emitTabUpdated(10, { status: "complete" }, { url: "https://evil.com/" });

      // Pre-fix (no in-flight guard): the deferred first callback hasn't resolved the
      // entry, so the second onUpdated re-reads it and re-sends -> [10, 10]. Post-fix:
      // trySendRollback adds tabId to rollbackSendInFlight synchronously, so the second
      // onUpdated sees the set populated and returns early -> [10].
      expect(rollbackSends).toEqual([10]);
    });

    it("does not double-send a forward offer when onUpdated fires twice (disc#3)", async () => {
      const mock = createChromeMock();
      const { forwardSends } = deferSends(mock);
      mock.chrome.storage.session._store["ns_sw:pendingForward"] = {
        "13": { url: "https://evil.com/", ts: Date.now() },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [13];
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // Two rapid onUpdated to a different URL on a ready tab both pass the forward guard.
      mock.emitTabUpdated(13, { url: "https://current.com/" }, { url: "https://current.com/" });
      mock.emitTabUpdated(13, { status: "complete" }, { url: "https://current.com/" });

      // Pre-fix: two forward-offer sends. Post-fix: forwardSendInFlight blocks the second.
      expect(forwardSends).toEqual([13]);
    });

    it("does not double-send when onCommitted send is in flight and onUpdated fires (disc#3 cross-path)", async () => {
      const mock = createChromeMock();
      const { rollbackSends } = deferSends(mock);
      // Tab NOT ready at commit: onCommitted queues the rollback (no send yet).
      await loadSw(mock);
      await vi.runAllTimersAsync();
      // First navigation A then a suspicious B (different reg, no gesture) on tab 14.
      mock.emitCommitted({ tabId: 14, frameId: 0, url: "https://a.com/", transitionType: "link" });
      mock.emitBeforeNavigate({ tabId: 14, frameId: 0, url: "https://b.com/" });
      mock.emitCommitted({ tabId: 14, frameId: 0, url: "https://b.com/", transitionType: "link" });
      // Content becomes ready -> ns-ready flushes the queued rollback (send dispatched, callback deferred).
      (mock.chrome.runtime.onMessage as unknown as {
        emit: (m: unknown, s: unknown, r: (v?: unknown) => void) => void;
      }).emit({ type: "ns-ready" }, { tab: { id: 14 } }, () => {});
      await vi.runAllTimersAsync();
      // Now an onUpdated fires while that send is still in flight.
      mock.emitTabUpdated(14, { status: "complete" }, { url: "https://b.com/" });

      // The in-flight guard must prevent the onUpdated from re-sending the same rollback.
      expect(rollbackSends).toEqual([14]);
    });

    it("does not re-queue a rollback for a tab removed during the send (disc#7)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      mock.chrome.storage.session._store["ns_sw:pendingRollback"] = {
        "11": { url: "https://evil.com/", qualifiers: [] },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [11];
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // Send is dispatched (callback captured, not yet fired).
      mock.emitTabUpdated(11, { status: "complete" }, { url: "https://evil.com/" });
      // Tab closes mid-send, then the send callback fires with lastError (tab gone).
      mock.emitTabRemoved(11);
      mock.setLastError({ message: "No tab with id: 11." });
      captured.forEach((cb) => cb());
      mock.setLastError(undefined);
      await vi.runAllTimersAsync();

      // Pre-fix: the callback re-queued -> zombie entry for the dead tab.
      const stored = (mock.chrome.storage.session._store["ns_sw:pendingRollback"] ?? {}) as Record<
        string,
        unknown
      >;
      expect(stored["11"]).toBeUndefined();
    });

    it("does not re-queue a forward offer for a tab removed during the send (disc#7, forward)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      mock.chrome.storage.session._store["ns_sw:pendingForward"] = {
        "12": { url: "https://evil.com/", ts: Date.now() },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [12];
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // A commit to a different URL on a ready tab dispatches the forward offer.
      mock.emitTabUpdated(12, { status: "complete" }, { url: "https://current.com/" });
      mock.emitTabRemoved(12);
      mock.setLastError({ message: "No tab with id: 12." });
      captured.forEach((cb) => cb());
      mock.setLastError(undefined);
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingForward"] ?? {}) as Record<
        string,
        unknown
      >;
      expect(stored["12"]).toBeUndefined();
    });

    it("does not clobber a newer queued rollback when a stale in-flight send errors (disc#5)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      // Tab 11 is NOT ready and has a stale rollback seeded in storage. onUpdatedHandler
      // flushes that seeded entry (dispatches the stale send; callback deferred below).
      mock.chrome.storage.session._store["ns_sw:pendingRollback"] = {
        "11": { url: "https://stale-evil.com/", qualifiers: [] },
      };
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // Establish a prevUrl for tab 11 so the later cross-site commit is suspicious.
      mock.emitCommitted({ tabId: 11, frameId: 0, url: "https://a.com/", transitionType: "link" });
      // onUpdated dispatches the seeded (now stale) rollback; its callback is deferred.
      mock.emitTabUpdated(11, { status: "complete" }, { url: "https://a.com/" });
      // During the async send gap a NEWER suspicious commit (tab still not ready) writes a
      // fresh entry into pendingRollbackByTab, overwriting the map slot with the newer URL.
      mock.emitBeforeNavigate({ tabId: 11, frameId: 0, url: "https://newer-evil.com/" });
      mock.emitCommitted({ tabId: 11, frameId: 0, url: "https://newer-evil.com/", transitionType: "link" });
      await vi.runAllTimersAsync();

      // The stale send now fails (e.g. tab busy / port gone). Its error callback must
      // leave the map untouched, not resurrect the captured stale `pending`.
      mock.setLastError({ message: "Could not establish connection." });
      captured.forEach((cb) => cb());
      mock.setLastError(undefined);
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingRollback"] ?? {}) as Record<
        string,
        { url: string }
      >;
      // Pre-fix (main): the stale error callback re-inserted "stale-evil.com", clobbering
      // the newer entry. Post-fix: the error callback leaves the map, so the newer entry
      // of record survives.
      expect(stored["11"]?.url).toBe("https://newer-evil.com/");
    });

    it("does not clobber a newer forward offer when a stale in-flight send errors (disc#6)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      mock.chrome.storage.session._store["ns_sw:pendingForward"] = {
        "12": { url: "https://offer-1.com/", ts: Date.now() },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [12];
      await loadSw(mock);
      await vi.runAllTimersAsync();

      // A commit to a different URL on a ready tab dispatches the (now stale) forward
      // offer; the callback is deferred.
      mock.emitTabUpdated(12, { status: "complete" }, { url: "https://current.com/" });
      // During the send gap the content script stores a NEWER forward offer. The stale
      // offer-1.com entry is still in pendingForwardByTab (the send did not pre-delete it),
      // so ns-store-forward OVERWRITES the slot from offer-1.com to offer-2.com.
      (mock.chrome.runtime.onMessage as unknown as {
        emit: (m: unknown, s: unknown, r: (v?: unknown) => void) => void;
      }).emit({ type: "ns-store-forward", url: "https://offer-2.com/" }, { tab: { id: 12 } }, () => {});
      await vi.runAllTimersAsync();

      // The stale forward send fails; its error callback must leave the (newer) map entry.
      mock.setLastError({ message: "Could not establish connection." });
      captured.forEach((cb) => cb());
      mock.setLastError(undefined);
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingForward"] ?? {}) as Record<
        string,
        { url: string }
      >;
      // Pre-fix (main): stale "offer-1.com" clobbers the newer offer. Post-fix: newer survives.
      expect(stored["12"]?.url).toBe("https://offer-2.com/");
    });

    it("a stale rollback SUCCESS callback does not delete a newer queued rollback (disc#5 success)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      // Seed a stale rollback for a NOT-ready tab; onUpdated flushes it (deferred send).
      mock.chrome.storage.session._store["ns_sw:pendingRollback"] = {
        "21": { url: "https://stale-evil.com/", qualifiers: [] },
      };
      await loadSw(mock);
      await vi.runAllTimersAsync();
      mock.emitCommitted({ tabId: 21, frameId: 0, url: "https://a.com/", transitionType: "link" });
      mock.emitTabUpdated(21, { status: "complete" }, { url: "https://a.com/" });
      // During the gap a newer suspicious commit overwrites the slot.
      mock.emitBeforeNavigate({ tabId: 21, frameId: 0, url: "https://newer-evil.com/" });
      mock.emitCommitted({ tabId: 21, frameId: 0, url: "https://newer-evil.com/", transitionType: "link" });
      await vi.runAllTimersAsync();

      // The stale send now SUCCEEDS (no lastError). The success callback must delete ONLY
      // the exact entry it sent (identity), not the newer entry now occupying the slot.
      captured.forEach((cb) => cb());
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingRollback"] ?? {}) as Record<
        string,
        { url: string }
      >;
      // Pre-fix (main): the success branch unconditionally deleted the slot, dropping the
      // newer rollback. Post-fix (identity guard): the newer entry survives.
      expect(stored["21"]?.url).toBe("https://newer-evil.com/");
    });

    it("a stale forward SUCCESS callback does not delete a newer ns-store-forward offer (disc#6 success)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      mock.chrome.storage.session._store["ns_sw:pendingForward"] = {
        "22": { url: "https://offer-1.com/", ts: Date.now() },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [22];
      await loadSw(mock);
      await vi.runAllTimersAsync();
      mock.emitTabUpdated(22, { status: "complete" }, { url: "https://current.com/" });
      // Newer offer overwrites the slot during the in-flight gap.
      (mock.chrome.runtime.onMessage as unknown as {
        emit: (m: unknown, s: unknown, r: (v?: unknown) => void) => void;
      }).emit({ type: "ns-store-forward", url: "https://offer-2.com/" }, { tab: { id: 22 } }, () => {});
      await vi.runAllTimersAsync();

      // The stale forward send SUCCEEDS; the success callback must not delete the newer offer.
      captured.forEach((cb) => cb());
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingForward"] ?? {}) as Record<
        string,
        { url: string }
      >;
      // Pre-fix (main): unconditional delete dropped offer-2. Post-fix: it survives.
      expect(stored["22"]?.url).toBe("https://offer-2.com/");
    });

    it("a stale rollback error callback does not resurrect an entry onBeforeNavigate cleared mid-flight", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      // Seed a rollback for tab 23; onUpdated dispatches it (deferred send).
      mock.chrome.storage.session._store["ns_sw:pendingRollback"] = {
        "23": { url: "https://evil.com/", qualifiers: [] },
      };
      await loadSw(mock);
      await vi.runAllTimersAsync();
      mock.emitTabUpdated(23, { status: "complete" }, { url: "https://evil.com/" });
      // A new top-frame navigation begins: onBeforeNavigate clears pendingRollbackByTab.
      mock.emitBeforeNavigate({ tabId: 23, frameId: 0, url: "https://legit-next.com/" });
      await vi.runAllTimersAsync();

      // The send for the superseded navigation now fails (port closed by the new nav).
      mock.setLastError({ message: "Could not establish connection." });
      captured.forEach((cb) => cb());
      mock.setLastError(undefined);
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingRollback"] ?? {}) as Record<
        string,
        unknown
      >;
      // Pre-fix (main / the interim !has guard): the empty slot let the stale value be
      // re-inserted → a zombie that fires a false rollback on the legitimate next page.
      // Post-fix: the error callback leaves the cleared slot empty.
      expect(stored["23"]).toBeUndefined();
    });

    it("a stale forward error callback does not resurrect an offer onBeforeNavigate cleared mid-flight", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      mock.chrome.storage.session._store["ns_sw:pendingForward"] = {
        "24": { url: "https://offer.com/", ts: Date.now() },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [24];
      await loadSw(mock);
      await vi.runAllTimersAsync();
      mock.emitTabUpdated(24, { status: "complete" }, { url: "https://current.com/" });
      // A genuine new navigation clears the forward offer (no rollback-return preserve).
      mock.emitBeforeNavigate({ tabId: 24, frameId: 0, url: "https://legit-next.com/" });
      await vi.runAllTimersAsync();

      mock.setLastError({ message: "Could not establish connection." });
      captured.forEach((cb) => cb());
      mock.setLastError(undefined);
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingForward"] ?? {}) as Record<
        string,
        unknown
      >;
      // Post-fix: the cleared forward slot stays empty (no zombie offer on the next page).
      expect(stored["24"]).toBeUndefined();
    });

    it("still retries a rollback on a transient send error because the entry stays queued (no regression)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      // Tab 16 is ready: the suspicious commit stores the rollback AND sends it (the
      // store-then-send invariant). A transient send failure must leave it queued.
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [16];
      await loadSw(mock);
      await vi.runAllTimersAsync();

      mock.emitCommitted({ tabId: 16, frameId: 0, url: "https://a.com/", transitionType: "link" });
      mock.emitBeforeNavigate({ tabId: 16, frameId: 0, url: "https://evil.com/" });
      mock.emitCommitted({ tabId: 16, frameId: 0, url: "https://evil.com/", transitionType: "link" });
      await vi.runAllTimersAsync();

      // The send fails transiently; the entry was stored before dispatch and nothing
      // superseded it, so it must remain queued for the next onUpdated retry.
      mock.setLastError({ message: "Could not establish connection." });
      captured.forEach((cb) => cb());
      mock.setLastError(undefined);
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingRollback"] ?? {}) as Record<
        string,
        { url: string }
      >;
      expect(stored["16"]?.url).toBe("https://evil.com/");
    });

    it("deletes the delivered rollback on a clean success (positive identity match)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      // The real delivery path: a queued rollback is dispatched by onUpdated and the send
      // succeeds with no competing write. The success branch's identity check must hold
      // (get === sent) and delete the delivered entry. (The ready-tab onCommitted
      // direct-send is a rare edge — onBeforeNavigate clears readyTabs for the new page —
      // so the queue-then-deliver-on-onUpdated/ns-ready path is the common one.)
      mock.chrome.storage.session._store["ns_sw:pendingRollback"] = {
        "40": { url: "https://evil.com/", qualifiers: [] },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [40];
      await loadSw(mock);
      await vi.runAllTimersAsync();
      mock.emitTabUpdated(40, { status: "complete" }, { url: "https://evil.com/" });
      // No competing navigation; release the deferred success callback.
      captured.forEach((cb) => cb());
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingRollback"] ?? {}) as Record<
        string,
        unknown
      >;
      expect(stored["40"]).toBeUndefined();
    });

    it("deletes the delivered forward offer on a clean success (positive identity match)", async () => {
      const mock = createChromeMock();
      const { captured } = deferSends(mock);
      mock.chrome.storage.session._store["ns_sw:pendingForward"] = {
        "41": { url: "https://offer.com/", ts: Date.now() },
      };
      mock.chrome.storage.session._store["ns_sw:readyTabs"] = [41];
      await loadSw(mock);
      await vi.runAllTimersAsync();
      mock.emitTabUpdated(41, { status: "complete" }, { url: "https://current.com/" });
      captured.forEach((cb) => cb());
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingForward"] ?? {}) as Record<
        string,
        unknown
      >;
      expect(stored["41"]).toBeUndefined();
    });

    it("persists the rollback at commit time even when the tab is not ready (always-store durability)", async () => {
      const mock = createChromeMock();
      deferSends(mock);
      await loadSw(mock);
      await vi.runAllTimersAsync();
      // A suspicious commit on a NOT-ready tab (onBeforeNavigate cleared readyTabs for the
      // new page) must still PERSIST the rollback so a worker death before the content
      // script announces ns-ready re-delivers it on restart, instead of dropping it.
      mock.emitCommitted({ tabId: 42, frameId: 0, url: "https://a.com/", transitionType: "link" });
      mock.emitBeforeNavigate({ tabId: 42, frameId: 0, url: "https://evil.com/" });
      mock.emitCommitted({ tabId: 42, frameId: 0, url: "https://evil.com/", transitionType: "link" });
      await vi.runAllTimersAsync();

      const stored = (mock.chrome.storage.session._store["ns_sw:pendingRollback"] ?? {}) as Record<
        string,
        { url: string }
      >;
      expect(stored["42"]?.url).toBe("https://evil.com/");
    });
  });
});
