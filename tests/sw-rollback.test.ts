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

  it("consumes a target allowance after a different top-frame commit", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.dispatchRuntimeMessage(
      {
        type: "ns-allow-target-nav",
        url: "https://example.test/allowed-target",
        ttlMs: 10_000
      },
      { tab: { id: 15 } }
    );

    vi.setSystemTime(new Date("2026-03-17T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 15,
      frameId: 0,
      url: "https://example.test/other",
      transitionType: "link",
      transitionQualifiers: []
    });

    vi.setSystemTime(new Date("2026-03-17T12:00:11.000Z"));
    mock.emitCommitted({
      tabId: 15,
      frameId: 0,
      url: "https://example.test/allowed-target",
      transitionType: "link",
      transitionQualifiers: []
    });

    const response = mock.dispatchRuntimeMessage({ type: "ns-check-rollback" }, { tab: { id: 15 } }) as {
      shouldRollback: boolean;
      entry?: { allowedAtCommit?: boolean; url?: string };
    };

    expect(response.shouldRollback).toBe(true);
    expect(response.entry?.allowedAtCommit).toBe(false);
    expect(response.entry?.url).toBe("https://example.test/allowed-target");
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
      url: "https://example.test/redirected",
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
      url: "https://example.test/redirected"
    });
    mock.emitCommitted({
      tabId: 23,
      frameId: 0,
      url: "https://example.test/redirected",
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
          url: "https://example.test/redirected",
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
      url: "https://example.test/redirected",
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
    expect(forward.url).toBe("https://example.test/redirected");

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
      url: "https://example.test/redirected",
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
    expect(queuedForward.url).toBe("https://example.test/redirected");
    expect(mock.sentMessages).toEqual([]);
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
      url: "https://example.test/redirected",
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
      url: "https://example.test/redirected"
    });

    const forward = mock.dispatchRuntimeMessage(
      { type: "ns-check-forward", currentUrl: "https://example.test/origin" },
      { tab: { id: 29 } }
    ) as { status?: string; url?: string };

    expect(forward.status).toBe("offer");
    expect(forward.url).toBe("https://example.test/redirected");
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
      url: "https://example.test/redirected",
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
      url: "https://example.test/redirected",
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
      url: "https://example.test/redirected",
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
      { type: "ns-check-forward", currentUrl: "https://example.test/redirected" },
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

    vi.setSystemTime(new Date("2026-03-17T12:00:00.300Z"));
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
});
