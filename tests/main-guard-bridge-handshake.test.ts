// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Integration suite driving the REAL main_guard bridge listener (#wave2-slice2-B2).
 * bridge-race.test.ts self-documents as a behavioral model with one known gap:
 * it cannot prove the superseded port is CLOSED (it models that as a
 * challenge mismatch). This suite closes that gap: it imports the real
 * main_guard module, delivers real MessageEvents to its real window "message"
 * listener, and speaks the real port protocol (challenge echo, session pin,
 * relay) over real MessageChannels.
 *
 * happy-dom fidelity bridges (documented, minimal — all NavSentinel decision
 * logic under test is real production code):
 * - happy-dom drops postMessage transfer ports and never sets source=window,
 *   so the init is delivered as a real dispatched MessageEvent with the port
 *   attached — exactly what a browser would deliver to the listener.
 * - happy-dom ports fail `instanceof MessagePort` (distinct class identity),
 *   so the file installs a Symbol.hasInstance bridge admitting genuine
 *   happy-dom ports while still rejecting garbage (pinned by the last test).
 * - happy-dom lacks document.execCommand, which main_guard binds at import;
 *   a no-op polyfill stands in (copy interception is not under test here).
 *
 * Tests are state-ordered (one module import per file): handshake, verified
 * pin, same-session reset, stale-port close, handshake timeout, guard sanity.
 */

const NS_SOURCE = "__navsentinel__";
const BRIDGE_INIT_TYPE = "ns-port-init";
const S1 = "s1-main-guard-suite";
const S2 = "s2-main-guard-suite";

interface BridgeMessage {
  source?: string;
  type?: string;
  v?: number;
  session?: string;
  challenge?: string;
  [key: string]: unknown;
}

/** One side of a MessageChannel pair, playing the isolated world. */
class Peer {
  readonly channel = new MessageChannel();
  readonly received: BridgeMessage[] = [];

  constructor() {
    this.channel.port1.onmessage = (event: MessageEvent): void => {
      this.received.push(event.data as BridgeMessage);
    };
    this.channel.port1.start?.();
    this.channel.port2.start?.();
  }

  /** The end handed to main_guard inside the init event. */
  guardPort(): MessagePort {
    return this.channel.port2;
  }

  send(message: BridgeMessage): void {
    this.channel.port1.postMessage(message);
  }

  types(): string[] {
    return this.received.map((m) => m.type ?? "");
  }

  challenge(): string | undefined {
    return this.received.find((m) => m.type === "ns-challenge")?.challenge;
  }

  close(): void {
    this.channel.port1.close();
    this.channel.port2.close();
  }
}

const peers: Peer[] = [];

function makePeer(): Peer {
  const peer = new Peer();
  peers.push(peer);
  return peer;
}

function postInit(session: string, port: unknown): void {
  const event = new MessageEvent("message", {
    data: { source: NS_SOURCE, type: BRIDGE_INIT_TYPE, v: 1, session },
    source: window,
  });
  Object.defineProperty(event, "ports", { value: [port] });
  window.dispatchEvent(event);
}

async function waitFor(condition: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (condition()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function settle(ms = 150): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const realHasInstance = Function.prototype[Symbol.hasInstance] as (
  this: unknown,
  value: unknown,
) => boolean;

function installPortInstanceBridge(): void {
  const admitted = Object.getPrototypeOf(new MessageChannel().port1);
  Object.defineProperty(MessagePort, Symbol.hasInstance, {
    configurable: true,
    value: (value: unknown): boolean =>
      realHasInstance.call(MessagePort, value) || Object.getPrototypeOf(value) === admitted,
  });
}

function uninstallPortInstanceBridge(): void {
  delete (MessagePort as unknown as Record<symbol, unknown>)[Symbol.hasInstance];
}

beforeAll(async () => {
  if (typeof document.execCommand !== "function") {
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
  }
  installPortInstanceBridge();
  await import("../extension/src/content/main_guard");
});

afterAll(() => {
  for (const peer of peers) peer.close();
  uninstallPortInstanceBridge();
});

describe("main_guard bridge handshake (real listener)", () => {
  it("completes the challenge handshake and flushes the pre-verify buffer", async () => {
    const peer = makePeer();
    postInit(S1, peer.guardPort());

    await waitFor(() => peer.challenge() !== undefined, "ns-challenge");
    const challenge = peer.challenge()!;
    expect(typeof challenge).toBe("string");
    expect(challenge.length).toBeGreaterThan(0);

    peer.send({ source: NS_SOURCE, type: "ns-challenge-response", v: 1, session: S1, challenge });
    await waitFor(() => peer.types().includes("ns-bridge-ready"), "ns-bridge-ready");

    // The import-time ns-main-guard-ready buffered before verification flushes now.
    expect(peer.types()).toContain("ns-main-guard-ready");
    const ready = peer.received.find((m) => m.type === "ns-bridge-ready")!;
    expect(ready.session).toBe(S1);
  });

  it("a verified bridge rejects a different-session init (no post-verify hijack)", async () => {
    const attacker = makePeer();
    postInit("s-attacker", attacker.guardPort());
    await settle();
    expect(attacker.received).toEqual([]);
  });

  it("a same-session re-init resets verification (documented #186 behavior)", async () => {
    const peer = makePeer();
    postInit(S1, peer.guardPort());
    await waitFor(() => peer.challenge() !== undefined, "re-init ns-challenge");

    // Unverified: ordinary relay messages are ignored until the echo.
    peer.send({ source: NS_SOURCE, type: "ns-ping", v: 1, session: S1 });
    await settle();
    expect(peer.types()).not.toContain("ns-pong");

    const rechallenge = peer.challenge()!;
    peer.send({
      source: NS_SOURCE,
      type: "ns-challenge-response",
      v: 1,
      session: S1,
      challenge: rechallenge,
    });
    await waitFor(() => peer.types().includes("ns-bridge-ready"), "re-verify ns-bridge-ready");
  });

  it("a superseded port is CLOSED: no relay through the stale port", async () => {
    // Peer C holds the currently verified bridge (from the previous test).
    const stale = peers[peers.length - 1]!;
    const current = makePeer();
    postInit(S1, current.guardPort());
    await waitFor(() => current.challenge() !== undefined, "supersede ns-challenge");
    const supersedeChallenge = current.challenge()!;
    current.send({
      source: NS_SOURCE,
      type: "ns-challenge-response",
      v: 1,
      session: S1,
      challenge: supersedeChallenge,
    });
    await waitFor(() => current.types().includes("ns-bridge-ready"), "supersede ns-bridge-ready");
    current.received.length = 0;

    // A relay message injected via the STALE port must go nowhere: the
    // superseding init closed it. (Without the close, the stale port's
    // onmessage — now handleBridgeMessage after verification — would relay
    // this ping and a pong would arrive on the current port.)
    stale.send({ source: NS_SOURCE, type: "ns-ping", v: 1, session: S1 });
    await settle();
    expect(current.types()).not.toContain("ns-pong");

    // Positive control: the live port relays.
    current.send({ source: NS_SOURCE, type: "ns-ping", v: 1, session: S1 });
    await waitFor(() => current.types().includes("ns-pong"), "ns-pong on live port");
  });

  it("the handshake timeout releases a half-open bridge for a fresh init", async () => {
    const stalled = makePeer();
    postInit(S1, stalled.guardPort());
    await waitFor(() => stalled.challenge() !== undefined, "stalled ns-challenge");
    const staleChallenge = stalled.challenge()!;

    // Past BRIDGE_HANDSHAKE_TIMEOUT_MS (3000): the half-open state is torn
    // down and the stalled port closed.
    await new Promise((resolve) => setTimeout(resolve, 3300));

    // The stale echo now goes nowhere (port closed, challenge forgotten).
    stalled.send({
      source: NS_SOURCE,
      type: "ns-challenge-response",
      v: 1,
      session: S1,
      challenge: staleChallenge,
    });
    await settle();
    expect(stalled.types()).not.toContain("ns-bridge-ready");

    // A fresh session establishes cleanly on the released bridge.
    const fresh = makePeer();
    postInit(S2, fresh.guardPort());
    await waitFor(() => fresh.challenge() !== undefined, "fresh ns-challenge");
    const freshChallenge = fresh.challenge()!;
    fresh.send({
      source: NS_SOURCE,
      type: "ns-challenge-response",
      v: 1,
      session: S2,
      challenge: freshChallenge,
    });
    await waitFor(() => fresh.types().includes("ns-bridge-ready"), "fresh ns-bridge-ready");
  }, 15000);

  it("the port type-guard still rejects non-port inits (bridge is not neutered)", async () => {
    const fake = { postMessage: vi.fn() };
    postInit("s-garbage", fake);
    await settle(100);
    expect(fake.postMessage).not.toHaveBeenCalled();

    // The verified bridge is undisturbed by the rejected init.
    const live = peers[peers.length - 1]!;
    live.send({ source: NS_SOURCE, type: "ns-ping", v: 1, session: S2 });
    await waitFor(() => live.types().includes("ns-pong"), "ns-pong after garbage init");
  });
});
