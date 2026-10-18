// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Integration suite for the REAL capture_isolated retry generation
 * (#wave2-slice2-B2): exponential-backoff re-inits while the MAIN side stays
 * silent, stale-port close on supersede (a challenge on a superseded port
 * goes nowhere; without the close it would be answered on the LIVE port),
 * and the 10s give-up (warn, port cleanup, permanent silence). The test
 * withholds the MAIN side entirely, then challenges selected attempts.
 *
 * Same happy-dom fidelity bridge as capture-bridge-handshake.test.ts: the
 * transferred port is captured from the real postMessage call arguments.
 * Fake timers drive the backoff deterministically; port delivery needs a few
 * 10ms advances (see flushUntil).
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

function responses(): BridgeMessage[] {
  return [...taps.values()].flat().filter((m) => m.type === "ns-challenge-response");
}

/** Advance fake timers in small steps until the condition holds or budget spent. */
async function flushUntil(condition: () => boolean, budgetMs: number, stepMs = 10): Promise<boolean> {
  let spent = 0;
  while (!condition() && spent < budgetMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    spent += stepMs;
  }
  return condition();
}

beforeAll(async () => {
  installChrome();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.useFakeTimers();
  realPostMessage = window.postMessage.bind(window);
  window.postMessage = ((data: unknown, origin: string, transfer?: unknown[]) => {
    posted.push({ data: data as BridgeMessage, ports: transfer ?? [] });
    return realPostMessage(data, origin);
  }) as typeof window.postMessage;
  await import("../extension/src/content/capture_isolated");
  await vi.advanceTimersByTimeAsync(0);
  tapAll();
});

afterAll(() => {
  window.postMessage = realPostMessage;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("capture_isolated bridge retry (real client)", () => {
  it("re-inits on exponential backoff capped at 1s while MAIN stays silent", async () => {
    // Attempts land at t=0,100,300,700,1500,2500,3500 (delays 100,200,400,800,
    // then capped 1000,1000 — without the cap the 6th attempt would be at 3100).
    expect(inits()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(inits()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(inits()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(inits()).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(800);
    expect(inits()).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(inits()).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(1000);
    expect(inits()).toHaveLength(7);

    const sessions = new Set(inits().map((i) => i.data.session));
    expect(sessions.size).toBe(1);
    const ports = new Set(inits().map((i) => i.ports[0]));
    expect(ports.size).toBe(7);
    expect(document.documentElement.getAttribute("data-navsentinel-bridge-ready")).toBeNull();
  });

  it("a challenge on a superseded port goes nowhere (stale generation closed)", async () => {
    // Now at virtual t=3500; the next attempt is at 4500, so 200ms flushes
    // cannot disturb the schedule.
    tapAll();
    const attempts = inits();
    const session = attempts[0]!.data.session!;
    const stalePort = initPort(attempts[0]!);
    const livePort = initPort(attempts[attempts.length - 1]!);

    stalePort.postMessage({
      source: NS_SOURCE,
      type: "ns-challenge",
      v: 1,
      session,
      challenge: "ch-stale",
    });
    const answered = await flushUntil(() => responses().length > 0, 200);
    // Without the supersede close, the stale port's handler would still fire
    // and the echo would be posted on the CURRENT bridge port — observable here.
    expect(answered).toBe(false);
    expect(responses()).toEqual([]);

    // Positive control: the live generation answers on its own port.
    tapAll();
    livePort.postMessage({
      source: NS_SOURCE,
      type: "ns-challenge",
      v: 1,
      session,
      challenge: "ch-live",
    });
    const liveAnswered = await flushUntil(() => responses().length > 0, 200);
    expect(liveAnswered).toBe(true);
    expect(responses()).toHaveLength(1);
    expect(responses()[0]).toMatchObject({ session, challenge: "ch-live" });
    expect(taps.get(livePort)).toHaveLength(1);
  });

  it("gives up after 10s: warns, never marks ready, stays silent", async () => {
    const gaveUp = await flushUntil(
      () =>
        warn.mock.calls.some((call: unknown[]) =>
          String(call[0]).includes("Bridge init timed out"),
        ),
      15000,
      500,
    );
    expect(gaveUp).toBe(true);
    expect(document.documentElement.getAttribute("data-navsentinel-bridge-ready")).toBeNull();

    const count = inits().length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(inits().length).toBe(count);
  });
});
