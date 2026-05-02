import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNRS,
} from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

// --- NRS helpers ---

function baseCds(cds = 0, reasonCodes: string[] = []): ScoreResult {
  return { cds, reasonCodes };
}

function baseNav(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return {
    isNewTabOrWindow: false,
    isCrossSite: false,
    ...overrides,
  };
}

// --- Chrome mock for SW tests ---

type RuntimeMessage = Record<string, unknown>;
type RuntimeSender = { tab?: { id?: number }; frameId?: number };
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

  return {
    chrome: {
      runtime: {
        onMessage: runtimeOnMessage,
        onInstalled: runtimeOnInstalled,
        onStartup: runtimeOnStartup,
        lastError: null as { message?: string } | null,
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
        onChanged: storageOnChanged,
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
              ...(options ? { options } : {}),
            });
            done?.();
          }
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
    sentMessages,
  };
}

// --- NRS scoring tests for redirect chain factors ---

describe("NRS redirect chain scoring", () => {
  describe("redirectChainDepth factor", () => {
    it("does not add points when depth is undefined", () => {
      const result = computeNRS(baseCds(0), baseNav());
      expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    });

    it("does not add points when depth is 0", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 0 }));
      expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    });

    it("does not add points when depth is 1", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 1 }));
      expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    });

    it("does not add points when depth is 2", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 2 }));
      expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
    });

    it("adds +5 for 3-hop chain", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 3 }));
      expect(result.nrs).toBe(5);
      expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
    });

    it("adds +10 for 4-hop chain", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 4 }));
      expect(result.nrs).toBe(10);
      expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
    });

    it("adds +15 for 5-hop chain", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 5 }));
      expect(result.nrs).toBe(15);
    });

    it("caps at +25 for 7-hop chain", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 7 }));
      expect(result.nrs).toBe(25);
    });

    it("caps at +25 for 10-hop chain (beyond cap)", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectChainDepth: 10 }));
      expect(result.nrs).toBe(25);
    });
  });

  describe("redirectViaKnownRedirector factor", () => {
    it("does not add points when undefined", () => {
      const result = computeNRS(baseCds(0), baseNav());
      expect(result.nrsFactors).not.toContain("nrs_known_redirector");
    });

    it("adds +15 for known redirector", () => {
      const result = computeNRS(baseCds(0), baseNav({ redirectViaKnownRedirector: true }));
      expect(result.nrs).toBe(15);
      expect(result.nrsFactors).toContain("nrs_known_redirector");
    });
  });

  describe("combined redirect chain scoring", () => {
    it("combines chain depth + known redirector", () => {
      const result = computeNRS(
        baseCds(0),
        baseNav({ redirectChainDepth: 5, redirectViaKnownRedirector: true })
      );
      // 15 (chain depth: 3 hops over 2) + 15 (known redirector) = 30
      expect(result.nrs).toBe(30);
      expect(result.nrsFactors).toContain("nrs_redirect_chain_depth");
      expect(result.nrsFactors).toContain("nrs_known_redirector");
    });

    it("combines chain depth + cross-site + new tab", () => {
      const result = computeNRS(
        baseCds(10),
        baseNav({
          redirectChainDepth: 4,
          isCrossSite: true,
          isNewTabOrWindow: true,
        })
      );
      // 10 (CDS) + 20 (new tab) + 20 (cross-site) + 10 (chain: 2 hops over 2)
      expect(result.nrs).toBe(60);
    });

    it("chain depth + known redirector + cross-site exceeds block threshold", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({
          redirectChainDepth: 5,
          redirectViaKnownRedirector: true,
          isCrossSite: true,
        })
      );
      // 20 (CDS) + 20 (cross-site) + 15 (chain: 3 hops over 2) + 15 (redirector) = 70
      expect(result.nrs).toBe(70);
      expect(result.nrs).toBeGreaterThanOrEqual(70);
    });
  });
});

// --- Service worker redirect chain tracking tests ---

describe("SW redirect chain tracking", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("builds a chain from sequential redirect navigations", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    // Hop 1: initial typed navigation (not a redirect, starts no chain)
    mock.emitCommitted({
      tabId: 100,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    // Hop 2: redirect
    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 100,
      frameId: 0,
      url: "https://hop1.test/redir",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    // Hop 3: another redirect
    vi.setSystemTime(new Date("2026-05-02T12:00:02.000Z"));
    mock.emitCommitted({
      tabId: 100,
      frameId: 0,
      url: "https://hop2.test/redir",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"],
    });

    // Hop 4: yet another redirect
    vi.setSystemTime(new Date("2026-05-02T12:00:03.000Z"));
    mock.emitCommitted({
      tabId: 100,
      frameId: 0,
      url: "https://final.test/landing",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 100 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(3);
    expect(resp.viaKnownRedirector).toBe(false);
  });

  it("resets chain when gap exceeds 10 seconds", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 101,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 101,
      frameId: 0,
      url: "https://hop1.test/redir",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    // 11 seconds later -- exceeds the 10s window
    vi.setSystemTime(new Date("2026-05-02T12:00:12.000Z"));
    mock.emitCommitted({
      tabId: 101,
      frameId: 0,
      url: "https://hop2.test/late",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"],
    });

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 101 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    // Gap resets: the late hop starts a new chain of depth 1
    expect(resp.depth).toBe(1);
  });

  it("detects known URL shortener in chain", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 102,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 102,
      frameId: 0,
      url: "https://bit.ly/abc123",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:02.000Z"));
    mock.emitCommitted({
      tabId: 102,
      frameId: 0,
      url: "https://final.test/landing",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 102 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(2);
    expect(resp.viaKnownRedirector).toBe(true);
  });

  it("detects known ad redirector (doubleclick.net) in chain", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 103,
      frameId: 0,
      url: "https://example.test/article",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:00.500Z"));
    mock.emitCommitted({
      tabId: 103,
      frameId: 0,
      url: "https://ad.doubleclick.net/ddm/clk/123",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 103,
      frameId: 0,
      url: "https://landing.test/offer",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 103 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(2);
    expect(resp.viaKnownRedirector).toBe(true);
  });

  it("caps chain at 10 hops", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 104,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    // Emit 12 redirect hops, each 500ms apart
    for (let i = 1; i <= 12; i++) {
      vi.setSystemTime(new Date(`2026-05-02T12:00:0${Math.floor(i / 2)}.${(i % 2) * 500}00Z`));
      mock.emitCommitted({
        tabId: 104,
        frameId: 0,
        url: `https://hop${i}.test/redir`,
        transitionType: "link",
        transitionQualifiers: ["server_redirect"],
      });
    }

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 104 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(10);
  });

  it("prunes chains older than 30 seconds", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    // Build a chain on tab 105
    mock.emitCommitted({
      tabId: 105,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 105,
      frameId: 0,
      url: "https://hop1.test/redir",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    // Jump 31 seconds into the future
    vi.setSystemTime(new Date("2026-05-02T12:00:32.000Z"));

    // Trigger pruning by committing on a different tab
    mock.emitCommitted({
      tabId: 106,
      frameId: 0,
      url: "https://other.test/page",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    // The chain on tab 105 should have been pruned
    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 105 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(0);
  });

  it("resets chain on non-redirect navigation", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 107,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 107,
      frameId: 0,
      url: "https://hop1.test/redir",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    // Non-redirect navigation breaks the chain
    vi.setSystemTime(new Date("2026-05-02T12:00:02.000Z"));
    mock.emitCommitted({
      tabId: 107,
      frameId: 0,
      url: "https://new-page.test/clean",
      transitionType: "link",
      transitionQualifiers: [],
    });

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 107 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(0);
  });

  it("clears chain state when tab is removed", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 108,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 108,
      frameId: 0,
      url: "https://hop1.test/redir",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    mock.emitTabRemoved(108);

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 108 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(0);
  });

  it("returns depth 0 for unknown tab", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 999 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(0);
    expect(resp.viaKnownRedirector).toBe(false);
  });

  it("returns depth 0 when sender has no tab id", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      {}
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(0);
    expect(resp.viaKnownRedirector).toBe(false);
  });

  it("ignores sub-frame commits for chain tracking", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 109,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 109,
      frameId: 0,
      url: "https://hop1.test/redir",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    // Sub-frame redirect should not affect chain
    vi.setSystemTime(new Date("2026-05-02T12:00:02.000Z"));
    mock.emitCommitted({
      tabId: 109,
      frameId: 1,
      url: "https://iframe.test/redir",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 109 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    // Only the top-frame redirect should count
    expect(resp.depth).toBe(1);
  });

  it("detects subdomain of known redirector (e.g. sub.doubleclick.net)", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 110,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 110,
      frameId: 0,
      url: "https://tracker.googleadservices.com/pagead/aclk?sa=L",
      transitionType: "link",
      transitionQualifiers: ["server_redirect"],
    });

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 110 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.viaKnownRedirector).toBe(true);
  });

  it("handles client_redirect transition type", async () => {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", mock.chrome as unknown as typeof globalThis.chrome);
    await import("../extension/src/sw/sw");

    mock.emitCommitted({
      tabId: 111,
      frameId: 0,
      url: "https://example.test/start",
      transitionType: "typed",
      transitionQualifiers: [],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:01.000Z"));
    mock.emitCommitted({
      tabId: 111,
      frameId: 0,
      url: "https://hop1.test/redir",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"],
    });

    vi.setSystemTime(new Date("2026-05-02T12:00:02.000Z"));
    mock.emitCommitted({
      tabId: 111,
      frameId: 0,
      url: "https://hop2.test/redir",
      transitionType: "link",
      transitionQualifiers: ["client_redirect"],
    });

    const resp = mock.dispatchRuntimeMessage(
      { type: "ns-get-redirect-chain" },
      { tab: { id: 111 } }
    ) as { depth: number; viaKnownRedirector: boolean };

    expect(resp.depth).toBe(2);
  });
});

// --- NRS integration: chain depth + known redirector combined scoring ---

describe("NRS integration with redirect chain context", () => {
  it("3-hop chain with known redirector scores 20", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({ redirectChainDepth: 3, redirectViaKnownRedirector: true })
    );
    // 5 (depth: 1 hop over 2) + 15 (known redirector) = 20
    expect(result.nrs).toBe(20);
  });

  it("5-hop chain through bit.ly with cross-site reaches block threshold on moderate CDS", () => {
    const result = computeNRS(
      baseCds(20),
      baseNav({
        redirectChainDepth: 5,
        redirectViaKnownRedirector: true,
        isCrossSite: true,
      })
    );
    // 20 + 20 + 15 + 15 = 70
    expect(result.nrs).toBeGreaterThanOrEqual(70);
  });

  it("single-hop redirect does not elevate NRS", () => {
    const result = computeNRS(
      baseCds(10),
      baseNav({ redirectChainDepth: 1 })
    );
    expect(result.nrs).toBe(10);
    expect(result.nrsFactors).not.toContain("nrs_redirect_chain_depth");
  });

  it("allowlist still dominates even with large redirect chain", () => {
    const result = computeNRS(
      baseCds(0),
      baseNav({
        redirectChainDepth: 7,
        redirectViaKnownRedirector: true,
        destinationAllowlisted: true,
      })
    );
    // 25 + 15 - 100 = -60 -> clamped to 0
    expect(result.nrs).toBe(0);
  });
});
