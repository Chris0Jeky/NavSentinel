// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Integration suite driving the REAL capture_isolated bridge client
 * (#wave2-slice2-B2): challenge echo, session match, ready handling,
 * pre-ready flush, and retry cancellation. The test plays the MAIN side of
 * the protocol (the real MAIN side is covered against the real main_guard in
 * main-guard-bridge-handshake.test.ts).
 *
 * happy-dom fidelity bridge (documented, minimal): happy-dom drops
 * postMessage transfer ports, so the file wraps window.postMessage to capture
 * the transferred port argument — the production channel creation, port
 * wiring, and postMessage call are 100% real; only the browser's port
 * transfer plumbing (which happy-dom lacks) is bridged. All challenge,
 * session, retry, and flush logic under test is real production code.
 */

const NS_SOURCE = "__navsentinel__";

vi.mock("../extension/src/shared/storage", async (original) => {
  const mod = await original<typeof import("../extension/src/shared/storage")>();
  return {
    ...mod,
    getNavSettings: async () => ({ defaultMode: "off", debug: false, autoDismissOverlays: false }),
    onNavSettingsChange: () => {},
    appendEvent: vi.fn(async () => {}),
    appendPromptOutcome: vi.fn(async () => {}),
  };
});
vi.mock("../extension/src/shared/allowlist", async (original) => {
  const mod = await original<typeof import("../extension/src/shared/allowlist")>();
  return { ...mod, getAllowlist: async () => ({}), onAllowlistChange: () => {} };
});
vi.mock("../extension/src/shared/adaptive_scoring", async (original) => {
  const mod = await original<typeof import("../extension/src/shared/adaptive_scoring")>();
  return { ...mod, getEffectiveThresholdAdjustment: async () => 0 };
});
vi.mock("../extension/src/content/chain_info_cache", async (original) => {
  const mod = await original<typeof import("../extension/src/content/chain_info_cache")>();
  return {
    ...mod,
    primeChainInfoCache: () => {},
    getFreshChainInfo: () => null,
    handleChainInfoPageShow: () => {},
  };
});

interface BridgeMessage {
  source?: string;
  type?: string;
  v?: number;
  session?: string;
  challenge?: string;
  [key: string]: unknown;
}

interface CapturedPost {
  data: BridgeMessage;
  ports: unknown[];
}

const posted: CapturedPost[] = [];
const taps = new Map<MessagePort, BridgeMessage[]>();
let realPostMessage!: typeof window.postMessage;
let warn: ReturnType<typeof vi.spyOn>;

function installChrome(): void {
  const sendMessage = (...args: unknown[]): unknown => {
    // Callback-style (rollback/forward polling): never respond — the polls
    // stall without scheduling follow-ups. Promise-style: resolve.
    if (typeof args[args.length - 1] === "function") return undefined;
    return Promise.resolve({});
  };
  vi.stubGlobal("chrome", {
    storage: {
      onChanged: { addListener: () => {} },
      local: { get: async () => ({}), set: async () => {} },
    },
    runtime: {
      sendMessage,
      onMessage: { addListener: () => {} },
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getManifest: () => ({ version: "test" }),
      id: "test-id",
      lastError: undefined,
    },
  });
}

function inits(): CapturedPost[] {
  return posted.filter((p) => p.data.type === "ns-port-init");
}

function initPort(init: CapturedPost): MessagePort {
  return init.ports[0] as MessagePort;
}

/** Attach a collector to every init port seen so far (test plays MAIN). */
function tapAll(): void {
  for (const init of inits()) {
    const port = initPort(init);
    if (!taps.has(port)) {
      const received: BridgeMessage[] = [];
      taps.set(port, received);
      port.onmessage = (event: MessageEvent): void => {
        received.push(event.data as BridgeMessage);
      };
    }
  }
}

function allReceived(): BridgeMessage[] {
  return [...taps.values()].flat();
}

function send(port: MessagePort, message: BridgeMessage): void {
  port.postMessage(message);
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (condition()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function settle(ms = 100): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  installChrome();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  realPostMessage = window.postMessage.bind(window);
  window.postMessage = ((data: unknown, origin: string, transfer?: unknown[]) => {
    posted.push({ data: data as BridgeMessage, ports: transfer ?? [] });
    return realPostMessage(data, origin);
  }) as typeof window.postMessage;
  await import("../extension/src/content/capture_isolated");
  // initSettings() runs ensureBridge() synchronously at import, so the first
  // init is already captured; a retry may follow on real-timer tests.
  tapAll();
});

afterAll(() => {
  window.postMessage = realPostMessage;
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("capture_isolated bridge handshake (real client)", () => {
  it("posts a bridge init carrying session and transfer port", () => {
    expect(inits().length).toBeGreaterThanOrEqual(1);
    const first = inits()[0]!;
    expect(typeof first.data.session).toBe("string");
    expect(first.data.session!.length).toBeGreaterThan(0);
    expect(first.ports).toHaveLength(1);
    // Retries keep the session, mint a fresh port each attempt.
    for (const init of inits()) {
      expect(init.data.session).toBe(first.data.session);
    }
    const ports = new Set(inits().map((i) => i.ports[0]));
    expect(ports.size).toBe(inits().length);
  });

  it("echoes the challenge only for the matching session", async () => {
    tapAll();
    const init = inits()[inits().length - 1]!;
    const session = init.data.session!;
    const port = initPort(init);

    send(port, { source: NS_SOURCE, type: "ns-challenge", v: 1, session: "wrong-session", challenge: "ch-wrong" });
    await settle();
    tapAll();
    expect(allReceived().filter((m) => m.type === "ns-challenge-response")).toEqual([]);

    // Positive control on the latest port (a retry may have superseded it).
    tapAll();
    const latest = inits()[inits().length - 1]!;
    const latestPort = initPort(latest);
    send(latestPort, { source: NS_SOURCE, type: "ns-challenge", v: 1, session, challenge: "ch-1" });
    await waitFor(
      () => allReceived().some((m) => m.type === "ns-challenge-response"),
      "ns-challenge-response",
    );
    const echo = allReceived().find((m) => m.type === "ns-challenge-response")!;
    expect(echo.challenge).toBe("ch-1");
    expect(echo.session).toBe(session);
  });

  it("marks ready on ns-bridge-ready, flushes buffered config, stops retrying", async () => {
    tapAll();
    const latest = inits()[inits().length - 1]!;
    const session = latest.data.session!;
    send(initPort(latest), { source: NS_SOURCE, type: "ns-bridge-ready", v: 1, session });

    await waitFor(
      () => document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1",
      "bridge-ready attribute",
    );
    tapAll();
    // initSettings() buffered ns-config + ns-ping before the bridge was
    // ready; the ready transition flushes them over the live port.
    await waitFor(
      () =>
        allReceived().some((m) => m.type === "ns-config") &&
        allReceived().some((m) => m.type === "ns-ping"),
      "flushed ns-config + ns-ping",
    );
    for (const flushed of allReceived().filter((m) => m.type === "ns-config" || m.type === "ns-ping")) {
      expect(flushed.session).toBe(session);
    }

    // Retry generation cancelled: no further inits across retry boundaries.
    const count = inits().length;
    await settle(400);
    expect(inits().length).toBe(count);
  });
});
