// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression coverage for the half-open bridge handshake release.
 *
 * Reproduction: init the bridge with session A, stall past
 * BRIDGE_HANDSHAKE_TIMEOUT_MS (3000ms) without echoing the challenge, then
 * init session B. The second init must be accepted and the bridge must be
 * able to verify (ns-bridge-ready for session B).
 *
 * Sensitivity: if failBridgeHandshake() stops clearing bridgePort /
 * bridgeSession / bridgeChallenge (or stops closing the stalled port), the
 * stale echo below verifies the stalled handshake instead of going nowhere,
 * so the `not.toContain("ns-bridge-ready")` assertion fails. With the
 * clearing in place the stale echo goes nowhere and the fresh init verifies.
 * pendingOutbound is intentionally untouched by the teardown, so the
 * import-time ns-main-guard-ready still flushes to the fresh peer.
 *
 * Happy-dom fidelity bridges (same as
 * tests/main-guard-bridge-handshake.test.ts): happy-dom drops postMessage
 * transfer ports and never sets source=window, so the init is delivered as a
 * real dispatched MessageEvent with the port attached; happy-dom ports fail
 * `instanceof MessagePort`, so a Symbol.hasInstance bridge admits genuine
 * happy-dom ports; document.execCommand is polyfilled (not under test).
 */

const NS_SOURCE = "__navsentinel__";
const BRIDGE_INIT_TYPE = "ns-port-init";
const SESSION_A = "sess-a-half-open-release";
const SESSION_B = "sess-b-half-open-release";

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

describe("main_guard bridge handshake release", () => {
  it("releases a half-open handshake on timeout so a fresh init can verify", async () => {
    const stalled = makePeer();
    postInit(SESSION_A, stalled.guardPort());
    await waitFor(() => stalled.challenge() !== undefined, "session A ns-challenge");
    const staleChallenge = stalled.challenge()!;

    // Stall past BRIDGE_HANDSHAKE_TIMEOUT_MS (3000ms) without the echo.
    await new Promise((resolve) => setTimeout(resolve, 3300));

    // The stale echo now goes nowhere: the port was closed and the challenge
    // forgotten. Without the failBridgeHandshake clearing it would verify.
    stalled.send({
      source: NS_SOURCE,
      type: "ns-challenge-response",
      v: 1,
      session: SESSION_A,
      challenge: staleChallenge,
    });
    await settle();
    expect(stalled.types()).not.toContain("ns-bridge-ready");

    // The second init is accepted and can become verified.
    const fresh = makePeer();
    postInit(SESSION_B, fresh.guardPort());
    await waitFor(() => fresh.challenge() !== undefined, "session B ns-challenge");
    const freshChallenge = fresh.challenge()!;
    fresh.send({
      source: NS_SOURCE,
      type: "ns-challenge-response",
      v: 1,
      session: SESSION_B,
      challenge: freshChallenge,
    });
    await waitFor(() => fresh.types().includes("ns-bridge-ready"), "session B ns-bridge-ready");
    const ready = fresh.received.find((m) => m.type === "ns-bridge-ready")!;
    expect(ready.session).toBe(SESSION_B);

    // The pre-verification buffer survived the teardown and flushed on verify.
    expect(fresh.types()).toContain("ns-main-guard-ready");
  }, 15000);
});
