import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeMessage = Record<string, unknown>;
type RuntimeSender = { tab?: { id?: number }; frameId?: number };
type SendResponse = (response?: unknown) => void;

type ChromeMock = ReturnType<typeof createChromeMock>;

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
  const tabRemoved = createEvent<(tabId: number) => void>();
  const tabUpdated = createEvent<
    (tabId: number, changeInfo: { status?: string; url?: string }, tab: { url?: string }) => void
  >();
  const sentMessages: Array<{
    tabId: number;
    message: unknown;
    options?: { frameId?: number };
  }> = [];

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
            if (keys === undefined) return {};
            if (typeof keys === "string") return {};
            return Object.fromEntries(keys.map((key) => [key, undefined]));
          },
          async set() {
            // not needed in these tests
          },
          async remove() {
            // not needed in these tests
          }
        },
        onChanged: storageOnChanged
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
        onRemoved: tabRemoved,
        onUpdated: tabUpdated,
        sendMessage: vi.fn((tabId: number, message: unknown, options?: { frameId?: number }) => {
          sentMessages.push({
            tabId,
            message,
            ...(options ? { options } : {})
          });
        })
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
    sentMessages
  };
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

    mock.dispatchRuntimeMessage({ type: "ns-nav-gesture", ttlMs: 800 }, { tab: { id: 11 } });
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

  it("clears a stale allowed-start entry when a later navigation begins outside the gesture window", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage({ type: "ns-nav-gesture", ttlMs: 800 }, { tab: { id: 17 } });
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

  it("relays bridge messages back to the same frame", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage(
      {
        type: "ns-bridge-to-main",
        payload: {
          source: "__navsentinel__",
          type: "ns-ping",
          v: 1
        }
      },
      { tab: { id: 21 }, frameId: 3 }
    );

    expect(mock.sentMessages).toEqual([
      {
        tabId: 21,
        message: {
          type: "ns-bridge-main",
          payload: {
            source: "__navsentinel__",
            type: "ns-ping",
            v: 1
          }
        },
        options: { frameId: 3 }
      }
    ]);
  });
});
