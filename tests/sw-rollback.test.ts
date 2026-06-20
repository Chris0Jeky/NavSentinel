import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_LOG_KEY, type EventLogEntry } from "../extension/src/shared/storage";

type RuntimeMessage = Record<string, unknown>;
type RuntimeSender = { tab?: { id?: number }; frameId?: number };
type SendResponse = (response?: unknown) => void;

type _ChromeMock = ReturnType<typeof createChromeMock>;

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
    }
  };
}

function createChromeMock() {
  const runtimeOnMessage = createEvent<
    (message: RuntimeMessage, sender: RuntimeSender, sendResponse: SendResponse) => void
  >();
  const runtimeOnInstalled = createEvent<() => void>();
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
  const localStore: Record<string, unknown> = {};

  return {
    chrome: {
      runtime: {
        onMessage: runtimeOnMessage,
        onInstalled: runtimeOnInstalled,
        onStartup: runtimeOnStartup
      },
      storage: {
        local: {
          async get(keys?: string | string[]) {
            if (keys === undefined) return { ...localStore };
            if (typeof keys === "string") return { [keys]: localStore[keys] };
            return Object.fromEntries(keys.map((key) => [key, localStore[key]]));
          },
          async set(items: Record<string, unknown>) {
            Object.assign(localStore, items);
          },
          async remove(keys: string | string[]) {
            const keyList = typeof keys === "string" ? [keys] : keys;
            for (const key of keyList) {
              delete localStore[key];
            }
          }
        },
        session: {
          _store: {} as Record<string, unknown>,
          async get(keys?: string | string[]) {
            if (keys === undefined) return { ...this._store };
            if (typeof keys === "string") {
              return { [keys]: this._store[keys] };
            }
            const result: Record<string, unknown> = {};
            for (const key of keys) {
              result[key] = this._store[key];
            }
            return result;
          },
          async set(items: Record<string, unknown>) {
            Object.assign(this._store, items);
          },
          async remove(keys: string | string[]) {
            const keyList = typeof keys === "string" ? [keys] : keys;
            for (const key of keyList) {
              delete this._store[key];
            }
          }
        },
        onChanged: storageOnChanged
      },
      action: {
        setBadgeText: vi.fn().mockResolvedValue(undefined),
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
      },
      declarativeNetRequest: {
        updateEnabledRulesets: vi.fn().mockResolvedValue(undefined)
      },
      webNavigation: {
        onBeforeNavigate: beforeNavigate,
        onCommitted: committed,
        onErrorOccurred: errorOccurred
      },
      tabs: {
        onCreated: tabCreated,
        onRemoved: tabRemoved,
        onUpdated: tabUpdated,
        sendMessage: vi.fn(
          (
            tabId: number,
            message: unknown,
            optionsOrCallback?: { frameId?: number } | (() => void),
            callback?: () => void
          ) => {
            const options =
              typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
            const done = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
            sentMessages.push({
              tabId,
              message,
              ...(options ? { options } : {})
            });
            done?.();
          }
        )
      }
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
    emitErrorOccurred(details: { tabId: number; frameId: number; url?: string }) {
      errorOccurred.emit(details);
    },
    emitTabUpdated(
      tabId: number,
      changeInfo: { status?: string; url?: string },
      tab: { url?: string } = {}
    ) {
      tabUpdated.emit(tabId, changeInfo, tab);
    },
    emitTabRemoved(tabId: number) {
      tabRemoved.emit(tabId);
    },
    dispatchRuntimeMessage(message: RuntimeMessage, sender: RuntimeSender = {}) {
      let response: unknown;
      runtimeOnMessage.emit(message, sender, (value) => {
        response = value;
      });
      return response;
    },
    sentMessages,
    localStore
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe("service worker rollback gating", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("allows a same-tab navigation that starts during a fresh gesture window", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage({ type: "ns-nav-gesture", ttlMs: 1200 }, { tab: { id: 7 } });
    vi.setSystemTime(new Date("2026-03-17T12:00:00.200Z"));
    mock.emitBeforeNavigate({
      tabId: 7,
      frameId: 0,
      url: "https://example.test/destination"
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:02.800Z"));
    mock.emitCommitted({
      tabId: 7,
      frameId: 0,
      url: "https://example.test/destination",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 7 } }) as {
      shouldRollback: boolean;
      entry?: { allowedAtCommit?: boolean };
    };

    expect(response.shouldRollback).toBe(false);
    expect(response.entry?.allowedAtCommit).toBe(true);
    expect(mock.sentMessages).toEqual([]);
  });

  it("keeps rolling back a delayed same-tab navigation that starts after the gesture window", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage(
      { type: "ns-nav-gesture", ttlMs: 800, url: "https://example.test/origin" },
      { tab: { id: 11 } }
    );
    vi.setSystemTime(new Date("2026-03-17T12:00:02.200Z"));
    mock.emitBeforeNavigate({
      tabId: 11,
      frameId: 0,
      url: "https://example.test/late"
    });
    mock.emitCommitted({
      tabId: 11,
      frameId: 0,
      url: "https://example.test/late",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 11 } }) as {
      shouldRollback: boolean;
      entry?: { allowedAtCommit?: boolean; url?: string };
    };

    expect(response.shouldRollback).toBe(true);
    expect(response.entry?.allowedAtCommit).toBe(false);
    expect(response.entry?.url).toBe("https://example.test/late");
  });

  it("keeps rolling back a delayed same-domain navigation after a prior page commit", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 12,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    mock.dispatchRuntimeMessage({ type: "ns-nav-gesture", ttlMs: 800 }, { tab: { id: 12 } });
    vi.setSystemTime(new Date("2026-03-17T12:00:02.200Z"));
    mock.emitBeforeNavigate({
      tabId: 12,
      frameId: 0,
      url: "https://example.test/late"
    });
    mock.emitCommitted({
      tabId: 12,
      frameId: 0,
      url: "https://example.test/late",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 12 } }) as {
      shouldRollback: boolean;
      entry?: { allowedAtCommit?: boolean; prevUrl?: string; url?: string };
    };

    expect(response.shouldRollback).toBe(true);
    expect(response.entry?.allowedAtCommit).toBe(false);
    expect(response.entry?.prevUrl).toBe("https://example.test/origin");
    expect(response.entry?.url).toBe("https://example.test/late");
  });

  it("allows an exact same-tab target that was pre-approved before a slow commit", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage(
      {
        type: "ns-allow-target-nav",
        url: "https://example.test/slow",
        ttlMs: 10_000
      },
      { tab: { id: 13 } }
    );

    vi.setSystemTime(new Date("2026-03-17T12:00:03.500Z"));
    mock.emitCommitted({
      tabId: 13,
      frameId: 0,
      url: "https://example.test/slow",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 13 } }) as {
      shouldRollback: boolean;
      entry?: { allowedAtCommit?: boolean };
    };

    expect(response.shouldRollback).toBe(false);
    expect(response.entry?.allowedAtCommit).toBe(true);
  });

  it("persists a same-tab silent allow only after its approved target commits", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    const silentEvent: EventLogEntry = {
      id: "silent-commit-1",
      ts: Date.now(),
      kind: "nav_silent_allow",
      site: "origin.test",
      destHost: "example.test",
      score: 18,
      reasons: ["nrs_host_mismatch"],
      extra: { threshold: 60 }
    };

    mock.dispatchRuntimeMessage(
      {
        type: "ns-allow-target-nav",
        url: "https://example.test/slow",
        ttlMs: 10_000,
        silentEvent
      },
      { tab: { id: 113 } }
    );
    await flushMicrotasks();
    expect(mock.localStore[EVENT_LOG_KEY]).toBeUndefined();

    vi.setSystemTime(new Date("2026-03-17T12:00:03.500Z"));
    mock.emitCommitted({
      tabId: 113,
      frameId: 0,
      url: "https://example.test/slow",
      transitionType: "link",
      transitionQualifiers: []
    });
    await flushMicrotasks();

    expect(mock.localStore[EVENT_LOG_KEY]).toEqual([silentEvent]);
  });

  it("persists a GET-form silent allow when the committed URL adds a serialized query", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    const silentEvent: EventLogEntry = {
      id: "silent-get-form-1",
      ts: Date.now(),
      kind: "nav_silent_allow",
      site: "origin.test",
      destHost: "example.test",
      score: 8,
      reasons: ["nrs_form_submit"]
    };

    mock.dispatchRuntimeMessage(
      {
        type: "ns-allow-target-nav",
        url: "https://example.test/search",
        ttlMs: 10_000,
        matchQueryPrefix: true,
        silentEvent
      },
      { tab: { id: 115 } }
    );

    vi.setSystemTime(new Date("2026-03-17T12:00:03.500Z"));
    mock.emitCommitted({
      tabId: 115,
      frameId: 0,
      url: "https://example.test/search?q=navsentinel",
      transitionType: "form_submit",
      transitionQualifiers: []
    });
    await flushMicrotasks();

    expect(mock.localStore[EVENT_LOG_KEY]).toEqual([silentEvent]);
  });

  it("keeps exact target matching by default for non-form allowances", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    const silentEvent: EventLogEntry = {
      id: "silent-exact-only",
      ts: Date.now(),
      kind: "nav_silent_allow",
      site: "origin.test",
      destHost: "example.test",
      score: 8,
      reasons: ["nrs_link"]
    };

    mock.dispatchRuntimeMessage(
      {
        type: "ns-allow-target-nav",
        url: "https://example.test/search",
        ttlMs: 10_000,
        silentEvent
      },
      { tab: { id: 116 } }
    );

    vi.setSystemTime(new Date("2026-03-17T12:00:03.500Z"));
    mock.emitCommitted({
      tabId: 116,
      frameId: 0,
      url: "https://example.test/search?q=navsentinel",
      transitionType: "link",
      transitionQualifiers: []
    });
    await flushMicrotasks();

    expect(mock.localStore[EVENT_LOG_KEY]).toBeUndefined();
  });

  it("does not persist a same-tab silent allow when a different URL commits", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    const silentEvent: EventLogEntry = {
      id: "silent-commit-2",
      ts: Date.now(),
      kind: "nav_silent_allow",
      site: "origin.test",
      destHost: "example.test",
      score: 18,
      reasons: ["nrs_host_mismatch"]
    };

    mock.dispatchRuntimeMessage(
      {
        type: "ns-allow-target-nav",
        url: "https://example.test/slow",
        ttlMs: 10_000,
        silentEvent
      },
      { tab: { id: 114 } }
    );

    vi.setSystemTime(new Date("2026-03-17T12:00:03.500Z"));
    mock.emitCommitted({
      tabId: 114,
      frameId: 0,
      url: "https://other.test/page",
      transitionType: "link",
      transitionQualifiers: []
    });
    await flushMicrotasks();

    expect(mock.localStore[EVENT_LOG_KEY]).toBeUndefined();
  });

  it("does not treat a newly opened child tab's first commit as same-tab rollback", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.chrome.tabs.onCreated.emit({ id: 16, openerTabId: 7 });
    mock.emitCommitted({
      tabId: 16,
      frameId: 0,
      url: "https://example.test/popup",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 16 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
    expect(mock.sentMessages).toEqual([]);
  });

  it("consumes a target allowance after a different top-frame commit", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage(
      {
        type: "ns-allow-target-nav",
        url: "https://target.test/allowed",
        ttlMs: 10_000
      },
      { tab: { id: 15 } }
    );

    vi.setSystemTime(new Date("2026-03-17T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 15,
      frameId: 0,
      url: "https://other.test/page",
      transitionType: "link",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 15,
      frameId: 0,
      url: "https://target.test/allowed",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 15 } }) as {
      shouldRollback: boolean;
      entry?: { allowedAtCommit?: boolean; url?: string };
    };

    expect(response.shouldRollback).toBe(true);
    expect(response.entry?.allowedAtCommit).toBe(false);
    expect(response.entry?.url).toBe("https://target.test/allowed");
  });

  it("retains the previous top-frame URL from a typed commit for later rollback", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 19,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 19,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 19 } }) as {
      shouldRollback: boolean;
      prevUrl?: string;
      entry?: { prevUrl?: string; allowedAtCommit?: boolean };
    };

    expect(response.shouldRollback).toBe(true);
    expect(response.prevUrl).toBe("https://example.test/origin");
    expect(response.entry?.prevUrl).toBe("https://example.test/origin");
    expect(response.entry?.allowedAtCommit).toBe(false);
  });

  it("clears stale ready state on a new top-frame navigation and waits for the next ready signal", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage({ type: "ns-ready" }, { tab: { id: 23 } });
    mock.emitCommitted({
      tabId: 23,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitBeforeNavigate({
      tabId: 23,
      frameId: 0,
      url: "https://evil.test/redirected"
    });
    mock.emitCommitted({
      tabId: 23,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    expect(mock.sentMessages).toEqual([]);

    mock.dispatchRuntimeMessage({ type: "ns-ready" }, { tab: { id: 23 } });

    expect(mock.sentMessages).toEqual([
      {
        tabId: 23,
        message: {
          type: "ns-rollback",
          url: "https://evil.test/redirected",
          prevUrl: "https://example.test/origin",
          qualifiers: ["client_redirect"]
        }
      }
    ]);
  });

  it("retries queued rollback when tab completion wins the ready-message race", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage({ type: "ns-ready" }, { tab: { id: 28 } });
    mock.emitCommitted({
      tabId: 28,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitBeforeNavigate({
      tabId: 28,
      frameId: 0,
      url: "https://evil.test/redirected"
    });
    mock.emitCommitted({
      tabId: 28,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    expect(mock.sentMessages).toEqual([]);

    mock.emitTabUpdated(
      28,
      { status: "complete" },
      { url: "https://evil.test/redirected" }
    );

    expect(mock.sentMessages).toEqual([
      {
        tabId: 28,
        message: {
          type: "ns-rollback",
          url: "https://evil.test/redirected",
          prevUrl: "https://example.test/origin",
          qualifiers: ["client_redirect"]
        }
      }
    ]);
  });

  it("preserves the forward offer while rolling back to the prior top-frame URL", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 24,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 24,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });
    mock.dispatchRuntimeMessage(
      { type: "ns-begin-rollback", returnUrl: "https://example.test/origin" },
      { tab: { id: 24 } }
    );

    mock.emitBeforeNavigate({
      tabId: 24,
      frameId: 0,
      url: "https://example.test/origin"
    });

    const rollback = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 24 } }) as {
      shouldRollback: boolean;
    };
    const forward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/origin" },
      { tab: { id: 24 } }
    ) as { status?: string; url?: string };

    expect(rollback.shouldRollback).toBe(false);
    expect(forward.status).toBe("offer");
    expect(forward.url).toBe("https://evil.test/redirected");

    const consumedForward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/origin" },
      { tab: { id: 24 } }
    ) as { status?: string; url?: string };
    expect(consumedForward.status).toBe("none");
    expect(consumedForward.url).toBe("");
  });

  it("keeps the forward offer queued until the rolled-back page is ready", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 27,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 27,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });
    mock.dispatchRuntimeMessage(
      { type: "ns-begin-rollback", returnUrl: "https://example.test/origin" },
      { tab: { id: 27 } }
    );

    mock.emitBeforeNavigate({
      tabId: 27,
      frameId: 0,
      url: "https://example.test/origin"
    });

    mock.emitTabUpdated(27, { status: "complete", url: "https://example.test/origin" }, {});

    const queuedForward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/origin" },
      { tab: { id: 27 } }
    ) as { status?: string; url?: string };

    expect(queuedForward.status).toBe("offer");
    expect(queuedForward.url).toBe("https://evil.test/redirected");
    expect(mock.sentMessages).toEqual([]);
  });

  it("sends the forward offer when the rollback return page completes after ready", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 30,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 30,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });
    mock.dispatchRuntimeMessage(
      { type: "ns-begin-rollback", returnUrl: "https://example.test/origin" },
      { tab: { id: 30 } }
    );

    mock.emitBeforeNavigate({
      tabId: 30,
      frameId: 0,
      url: "https://example.test/origin"
    });
    mock.dispatchRuntimeMessage({ type: "ns-ready" }, { tab: { id: 30 } });
    mock.emitTabUpdated(30, { status: "complete" }, { url: "https://example.test/origin" });

    expect(mock.sentMessages).toContainEqual({
      tabId: 30,
      message: {
        type: "ns-forward-offer",
        url: "https://evil.test/redirected"
      }
    });
  });

  it("preserves the forward offer when the blocked destination aborts during rollback", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 29,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 29,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });
    mock.dispatchRuntimeMessage(
      { type: "ns-begin-rollback", returnUrl: "https://example.test/origin" },
      { tab: { id: 29 } }
    );

    mock.emitBeforeNavigate({
      tabId: 29,
      frameId: 0,
      url: "https://example.test/origin"
    });
    mock.emitErrorOccurred({
      tabId: 29,
      frameId: 0,
      url: "https://evil.test/redirected"
    });

    const forward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/origin" },
      { tab: { id: 29 } }
    ) as { status?: string; url?: string };

    expect(forward.status).toBe("offer");
    expect(forward.url).toBe("https://evil.test/redirected");
  });

  it("keeps the forward offer alive across a repeated abort during rollback (#339)", async () => {
    // onErrorOccurredHandler used to delete rollbackReturnByTab UNCONDITIONALLY even when it
    // preserved the forward offer. The offer is meaningless without its rollbackReturn
    // companion: a SUBSEQUENT event re-evaluates preserveForwardOffer (= forward && rollbackReturn
    // && forward.url===url), finds rollbackReturn gone, and drops the offer. This reproduces that
    // by firing a second abort of the blocked destination.
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 31, frameId: 0, url: "https://example.test/origin",
      transitionType: "typed", transitionQualifiers: []
    });
    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 31, frameId: 0, url: "https://evil.test/redirected",
      transitionType: "link", transitionQualifiers: ["client_redirect"]
    });
    mock.dispatchRuntimeMessage(
      { type: "ns-begin-rollback", returnUrl: "https://example.test/origin" },
      { tab: { id: 31 } }
    );
    mock.emitBeforeNavigate({ tabId: 31, frameId: 0, url: "https://example.test/origin" });

    // First abort of the blocked destination (forward.url) -> preserveForwardOffer=true.
    mock.emitErrorOccurred({ tabId: 31, frameId: 0, url: "https://evil.test/redirected" });
    // Second abort re-evaluates preserveForwardOffer. Pre-fix the first abort already deleted
    // rollbackReturnByTab, so this evaluates false and clearPendingTabState drops the offer.
    mock.emitErrorOccurred({ tabId: 31, frameId: 0, url: "https://evil.test/redirected" });

    const forward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/origin" },
      { tab: { id: 31 } }
    ) as { status?: string; url?: string };

    expect(forward.status).toBe("offer");
    expect(forward.url).toBe("https://evil.test/redirected");
  });

  it("does not surface a forward offer while already on the forward URL", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage(
      { type: "ns-store-forward", url: "https://example.test/redirected" },
      { tab: { id: 28 } }
    );

    mock.emitTabUpdated(28, { status: "complete", url: "https://example.test/redirected" }, {});

    const forward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/redirected" },
      { tab: { id: 28 } }
    ) as { status?: string; url?: string };

    expect(forward.status).toBe("already_on_forward");
    expect(forward.url).toBe("");

    const repeatedForward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/redirected" },
      { tab: { id: 28 } }
    ) as { status?: string; url?: string };

    expect(repeatedForward.status).toBe("already_on_forward");
    expect(repeatedForward.url).toBe("");
  });

  it("clears queued rollback and forward state when an unrelated top-frame navigation starts", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 26,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 26,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    mock.emitBeforeNavigate({
      tabId: 26,
      frameId: 0,
      url: "https://example.test/fresh"
    });

    const rollback = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 26 } }) as {
      shouldRollback: boolean;
    };
    const forward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/fresh" },
      { tab: { id: 26 } }
    ) as { status?: string; url?: string };

    expect(rollback.shouldRollback).toBe(false);
    expect(forward.status).toBe("none");
    expect(forward.url).toBe("");

    mock.dispatchRuntimeMessage({ type: "ns-ready" }, { tab: { id: 26 } });
    expect(mock.sentMessages).toEqual([]);
  });

  it("does not preserve a forward offer when the user later revisits the prior URL", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 30,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 30,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    mock.emitBeforeNavigate({
      tabId: 30,
      frameId: 0,
      url: "https://example.test/origin"
    });

    const rollback = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 30 } }) as {
      shouldRollback: boolean;
    };
    const forward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/origin" },
      { tab: { id: 30 } }
    ) as { status?: string; url?: string };

    expect(rollback.shouldRollback).toBe(false);
    expect(forward.status).toBe("none");
    expect(forward.url).toBe("");
  });

  it("clears queued rollback and forward state after a top-frame navigation error", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 25,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 25,
      frameId: 0,
      url: "https://evil.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    mock.emitErrorOccurred({
      tabId: 25,
      frameId: 0,
      url: "https://example.test/fresh"
    });

    const rollback = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 25 } }) as {
      shouldRollback: boolean;
    };
    const forward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://evil.test/redirected" },
      { tab: { id: 25 } }
    ) as { status?: string; url?: string };

    expect(rollback.shouldRollback).toBe(false);
    expect(forward.status).toBe("none");
    expect(forward.url).toBe("");

    mock.dispatchRuntimeMessage({ type: "ns-ready" }, { tab: { id: 25 } });
    expect(mock.sentMessages).toEqual([]);
  });

  it("clears a stale allowed-start entry when a later navigation begins outside the gesture window", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage(
      { type: "ns-nav-gesture", ttlMs: 800, url: "https://example.test/origin" },
      { tab: { id: 17 } }
    );
    vi.setSystemTime(new Date("2026-03-17T12:00:00.300Z"));
    mock.emitBeforeNavigate({
      tabId: 17,
      frameId: 0,
      url: "https://example.test/allowed-start"
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:02.500Z"));
    mock.emitBeforeNavigate({
      tabId: 17,
      frameId: 0,
      url: "https://example.test/late"
    });
    mock.emitCommitted({
      tabId: 17,
      frameId: 0,
      url: "https://example.test/late",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 17 } }) as {
      shouldRollback: boolean;
      entry?: { allowedAtCommit?: boolean; url?: string };
    };

    expect(response.shouldRollback).toBe(true);
    expect(response.entry?.allowedAtCommit).toBe(false);
    expect(response.entry?.url).toBe("https://example.test/late");
  });

  it("does not roll back a server redirect that follows a typed navigation", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 40,
      frameId: 0,
      url: "https://live.com",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.200Z"));
    mock.emitCommitted({
      tabId: 40,
      frameId: 0,
      url: "https://login.live.com/",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 40 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("does not roll back a client redirect that follows a typed navigation within TTL", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 41,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.200Z"));
    mock.emitCommitted({
      tabId: 41,
      frameId: 0,
      url: "https://example.test/redirected",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 41 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("rolls back a client redirect after the typed-origin TTL expires", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 44,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 44,
      frameId: 0,
      url: "https://evil.test/delayed-client",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 44 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(true);
  });

  it("rolls back a server redirect after the typed-origin TTL expires", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 42,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:06.000Z"));
    mock.emitCommitted({
      tabId: 42,
      frameId: 0,
      url: "https://evil.test/delayed",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 42 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(true);
  });

  it("clears typed origin when a non-redirect link navigation commits", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 43,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:03.000Z"));
    mock.emitCommitted({
      tabId: 43,
      frameId: 0,
      url: "https://example.test/clicked-link",
      transitionType: "link",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:04.000Z"));
    mock.emitCommitted({
      tabId: 43,
      frameId: 0,
      url: "https://evil.test/redirect-after-click",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 43 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(true);
  });

  it("treats auto_bookmark the same as typed for typed-origin tracking", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 50,
      frameId: 0,
      url: "https://bookmarked.test/",
      transitionType: "auto_bookmark",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.300Z"));
    mock.emitCommitted({
      tabId: 50,
      frameId: 0,
      url: "https://bookmarked.test/landing",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 50 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("clears typed-origin state when a tab is removed", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 51,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    mock.emitTabRemoved(51);

    mock.emitCommitted({
      tabId: 51,
      frameId: 0,
      url: "https://example.test/new-tab",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 51,
      frameId: 0,
      url: "https://evil.test/reuse-tab-id",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 51 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(true);
  });

  it("ignores sub-frame commits for typed-origin tracking", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 52,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    mock.emitCommitted({
      tabId: 52,
      frameId: 1,
      url: "https://other.test/iframe",
      transitionType: "link",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.300Z"));
    mock.emitCommitted({
      tabId: 52,
      frameId: 0,
      url: "https://example.test/redirect-target",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 52 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("preserves typed origin across chained redirects within TTL", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 53,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.100Z"));
    mock.emitCommitted({
      tabId: 53,
      frameId: 0,
      url: "https://example.test/hop1",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.200Z"));
    mock.emitCommitted({
      tabId: 53,
      frameId: 0,
      url: "https://example.test/hop2",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"]
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.400Z"));
    mock.emitCommitted({
      tabId: 53,
      frameId: 0,
      url: "https://example.test/final",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 53 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("clears typed origin on navigation error so subsequent redirects are checked", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 54,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.200Z"));
    mock.emitErrorOccurred({ tabId: 54, frameId: 0, url: "https://example.test/error" });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.400Z"));
    mock.emitCommitted({
      tabId: 54,
      frameId: 0,
      url: "https://evil.test/after-error",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 54 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(true);
  });

  it("does not roll back same-registrable-domain navigations (e.g. amazon.com login redirect)", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 60,
      frameId: 0,
      url: "https://www.amazon.com/",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 60,
      frameId: 0,
      url: "https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.com",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 60 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("allows link-classified navigations within typed-origin window (e.g. live.com SSO chain)", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 61,
      frameId: 0,
      url: "https://live.com",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.200Z"));
    mock.emitCommitted({
      tabId: 61,
      frameId: 0,
      url: "https://login.live.com/",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:00.500Z"));
    mock.emitCommitted({
      tabId: 61,
      frameId: 0,
      url: "https://outlook.live.com/mail/",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:01.500Z"));
    mock.emitCommitted({
      tabId: 61,
      frameId: 0,
      url: "https://www.microsoft.com/en-gb/outlook",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 61 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("refreshes typed-origin clock on redirect chain hops", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 62,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:04.500Z"));
    mock.emitCommitted({
      tabId: 62,
      frameId: 0,
      url: "https://hop1.test/redirect",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:09.000Z"));
    mock.emitCommitted({
      tabId: 62,
      frameId: 0,
      url: "https://hop2.test/final",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 62 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("still rolls back cross-domain navigations outside typed-origin window", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 63,
      frameId: 0,
      url: "https://example.test/origin",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 63,
      frameId: 0,
      url: "https://evil.test/phish",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 63 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(true);
  });

  it("enforces absolute deadline cap on long redirect chains (15s max)", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 64,
      frameId: 0,
      url: "https://example.test/typed",
      transitionType: "typed",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:04.500Z"));
    mock.emitCommitted({
      tabId: 64,
      frameId: 0,
      url: "https://hop1.test/redirect",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:09.000Z"));
    mock.emitCommitted({
      tabId: 64,
      frameId: 0,
      url: "https://hop2.test/redirect",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:13.500Z"));
    mock.emitCommitted({
      tabId: 64,
      frameId: 0,
      url: "https://hop3.test/redirect",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    // T=18s: within 5s sliding window of hop3 (T=13.5s) but past 15s absolute deadline
    vi.setSystemTime(new Date("2026-03-17T12:00:18.000Z"));
    mock.emitCommitted({
      tabId: 64,
      frameId: 0,
      url: "https://evil.test/final",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 64 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(true);
  });

  it("exempts same-domain redirect with expired gesture (registrable-domain check)", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 65,
      frameId: 0,
      url: "https://www.example.test/home",
      transitionType: "typed",
      transitionQualifiers: []
    });

    // Well past typed-origin window (11s > 5s TTL)
    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 65,
      frameId: 0,
      url: "https://www.example.test/login",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 65 } }) as {
      shouldRollback: boolean;
    };

    expect(response.shouldRollback).toBe(false);
  });

  it("clears user navigation context when a tab is removed (prevents tab-ID reuse leak)", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    // Establish user nav context via gesture + allowed commit
    mock.dispatchRuntimeMessage(
      { type: "ns-nav-gesture", ttlMs: 1500, url: "https://example.test/origin" },
      { tab: { id: 70 } }
    );
    mock.emitBeforeNavigate({
      tabId: 70,
      frameId: 0,
      url: "https://example.test/page"
    });
    mock.emitCommitted({
      tabId: 70,
      frameId: 0,
      url: "https://example.test/page",
      transitionType: "link",
      transitionQualifiers: []
    });

    // Tab removed
    mock.emitTabRemoved(70);

    // Tab ID reused by a new tab — typed commit to establish prevUrl
    mock.emitCommitted({
      tabId: 70,
      frameId: 0,
      url: "https://safe.test/new-tab",
      transitionType: "typed",
      transitionQualifiers: []
    });

    // Same-domain redirect after typed-origin expired — should be exempted
    // by the registrable-domain check, NOT blocked by stale user nav context
    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 70,
      frameId: 0,
      url: "https://safe.test/login",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"]
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 70 } }) as {
      shouldRollback: boolean;
    };

    // Without the fix, stale userNavContextUntilByTab would suppress
    // the same-domain exemption, causing a false-positive rollback
    expect(response.shouldRollback).toBe(false);
  });

  it("does not offer a forward to an unrelated page when returnUrl is set", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    // Store a forward offer with a specific returnUrl
    mock.dispatchRuntimeMessage(
      { type: "ns-store-forward", url: "https://evil.test/redirected", returnUrl: "https://example.test/origin" },
      { tab: { id: 71 } }
    );

    // An unrelated page checks for forward offers — should not consume it
    const unrelated = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://other.test/unrelated" },
      { tab: { id: 71 } }
    ) as { status?: string; url?: string };

    expect(unrelated.status).toBe("none");
    expect(unrelated.url).toBe("");

    // The correct return page checks — should get the offer
    const correct = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/origin" },
      { tab: { id: 71 } }
    ) as { status?: string; url?: string };

    expect(correct.status).toBe("offer");
    expect(correct.url).toBe("https://evil.test/redirected");
  });

  describe("TTL clamping", () => {
    it("clamps ttlMs above MAX_TTL_MS (30s) — target expired after 30s", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      mock.dispatchRuntimeMessage(
        { type: "ns-allow-nav", ttlMs: 1200 },
        { tab: { id: 80 } }
      );
      vi.setSystemTime(new Date("2026-03-17T12:00:00.100Z"));
      mock.emitCommitted({
        tabId: 80, frameId: 0,
        url: "https://origin.test/page",
        transitionType: "link", transitionQualifiers: []
      });

      mock.dispatchRuntimeMessage(
        { type: "ns-allow-target-nav", url: "https://evil.test/slow", ttlMs: 120_000 },
        { tab: { id: 80 } }
      );

      // Intermediate: at T+15s the clamped allowance (30s) is still active
      // Use a separate tab to avoid consuming the target allowance on tab 80
      mock.dispatchRuntimeMessage(
        { type: "ns-allow-nav", ttlMs: 1200 },
        { tab: { id: 180 } }
      );
      vi.setSystemTime(new Date("2026-03-17T12:00:00.100Z"));
      mock.emitCommitted({
        tabId: 180, frameId: 0,
        url: "https://origin.test/page",
        transitionType: "link", transitionQualifiers: []
      });
      mock.dispatchRuntimeMessage(
        { type: "ns-allow-target-nav", url: "https://evil.test/slow", ttlMs: 120_000 },
        { tab: { id: 180 } }
      );
      vi.setSystemTime(new Date("2026-03-17T12:00:15.000Z"));
      mock.emitCommitted({
        tabId: 180, frameId: 0,
        url: "https://evil.test/slow",
        transitionType: "link", transitionQualifiers: []
      });
      const midResponse = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        { tab: { id: 180 } }
      ) as { shouldRollback: boolean };
      expect(midResponse.shouldRollback).toBe(false);

      // At T+31s the clamped TTL (30s, not 120s) has expired on tab 80
      vi.setSystemTime(new Date("2026-03-17T12:00:31.000Z"));
      mock.emitCommitted({
        tabId: 80, frameId: 0,
        url: "https://evil.test/slow",
        transitionType: "link", transitionQualifiers: []
      });

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        { tab: { id: 80 } }
      ) as { shouldRollback: boolean };

      expect(response.shouldRollback).toBe(true);
    });

    it("falls back to default TTL for NaN ttlMs", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      mock.dispatchRuntimeMessage(
        { type: "ns-allow-target-nav", url: "https://example.test/nan", ttlMs: NaN },
        { tab: { id: 81 } }
      );

      vi.setSystemTime(new Date("2026-03-17T12:00:03.500Z"));
      mock.emitCommitted({
        tabId: 81, frameId: 0,
        url: "https://example.test/nan",
        transitionType: "link", transitionQualifiers: []
      });

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        { tab: { id: 81 } }
      ) as { shouldRollback: boolean; entry?: { allowedAtCommit?: boolean } };

      expect(response.shouldRollback).toBe(false);
      expect(response.entry?.allowedAtCommit).toBe(true);
    });

    it("falls back to default TTL for negative ttlMs", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      mock.dispatchRuntimeMessage(
        { type: "ns-allow-target-nav", url: "https://example.test/neg", ttlMs: -1 },
        { tab: { id: 82 } }
      );

      vi.setSystemTime(new Date("2026-03-17T12:00:03.500Z"));
      mock.emitCommitted({
        tabId: 82, frameId: 0,
        url: "https://example.test/neg",
        transitionType: "link", transitionQualifiers: []
      });

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        { tab: { id: 82 } }
      ) as { shouldRollback: boolean; entry?: { allowedAtCommit?: boolean } };

      expect(response.shouldRollback).toBe(false);
      expect(response.entry?.allowedAtCommit).toBe(true);
    });
  });

  describe("URL protocol validation", () => {
    it("rejects javascript: URLs in ns-allow-target-nav", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      mock.dispatchRuntimeMessage(
        { type: "ns-allow-nav", ttlMs: 1200 },
        { tab: { id: 83 } }
      );
      vi.setSystemTime(new Date("2026-03-17T12:00:00.100Z"));
      mock.emitCommitted({
        tabId: 83, frameId: 0,
        url: "https://origin.test/page",
        transitionType: "link", transitionQualifiers: []
      });

      mock.dispatchRuntimeMessage(
        { type: "ns-allow-target-nav", url: "javascript:alert(1)", ttlMs: 10_000 },
        { tab: { id: 83 } }
      );

      vi.setSystemTime(new Date("2026-03-17T12:00:02.000Z"));
      mock.emitCommitted({
        tabId: 83, frameId: 0,
        url: "https://evil.test/redirected",
        transitionType: "link", transitionQualifiers: []
      });

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        { tab: { id: 83 } }
      ) as { shouldRollback: boolean };

      expect(response.shouldRollback).toBe(true);
    });

    it("rejects data: URLs in ns-allow-target-nav", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      mock.dispatchRuntimeMessage(
        { type: "ns-allow-nav", ttlMs: 1200 },
        { tab: { id: 84 } }
      );
      vi.setSystemTime(new Date("2026-03-17T12:00:00.100Z"));
      mock.emitCommitted({
        tabId: 84, frameId: 0,
        url: "https://origin.test/page",
        transitionType: "link", transitionQualifiers: []
      });

      mock.dispatchRuntimeMessage(
        { type: "ns-allow-target-nav", url: "data:text/html,<h1>pwned</h1>", ttlMs: 10_000 },
        { tab: { id: 84 } }
      );

      vi.setSystemTime(new Date("2026-03-17T12:00:02.000Z"));
      mock.emitCommitted({
        tabId: 84, frameId: 0,
        url: "https://evil.test/redirected",
        transitionType: "link", transitionQualifiers: []
      });

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        { tab: { id: 84 } }
      ) as { shouldRollback: boolean };

      expect(response.shouldRollback).toBe(true);
    });
  });

  describe("defensive sendResponse for undefined tabId", () => {
    it("ns-check-rollback responds with shouldRollback:false when sender has no tab", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        {}
      ) as { shouldRollback: boolean } | undefined;

      expect(response).toBeDefined();
      expect(response!.shouldRollback).toBe(false);
    });

    it("ns-check-rollback responds with shouldRollback:false when sender.tab.id is undefined", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-rollback" },
        { tab: {} }
      ) as { shouldRollback: boolean } | undefined;

      expect(response).toBeDefined();
      expect(response!.shouldRollback).toBe(false);
    });

    it("ns-check-forward responds with status:none when sender has no tab", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-forward", currentUrl: "https://example.test/" },
        {}
      ) as { status: string; url: string } | undefined;

      expect(response).toBeDefined();
      expect(response!.status).toBe("none");
      expect(response!.url).toBe("");
    });

    it("ns-check-forward responds with status:none when sender.tab.id is undefined", async () => {
      const mock = createChromeMock();
      vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
      await import("../extension/src/sw/sw");

      const response = mock.dispatchRuntimeMessage(
        { type: "ns-check-forward", currentUrl: "https://example.test/" },
        { tab: {} }
      ) as { status: string; url: string } | undefined;

      expect(response).toBeDefined();
      expect(response!.status).toBe("none");
      expect(response!.url).toBe("");
    });
  });
});
