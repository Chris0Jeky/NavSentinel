import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CdpPageClient } from "./acceptance/cdp_page_client";

/**
 * Focused acceptance-harness diagnostics for issue #918.
 *
 * `CdpPageClient.waitFor` used to turn every evaluate rejection into `false`,
 * so a closed popup socket surfaced as a misleading full-timeout. These tests
 * use a minimal fake CDP socket (no network, no browser) to prove that closure
 * rejects with socket context and false-then-true predicates still succeed.
 */

type CdpRequest = { id: number; method: string };

type EvaluateOutcome =
  | { kind: "value"; value: boolean }
  | { kind: "protocol-error"; message: string }
  | { kind: "page-exception"; text: string };

class FakeCdpSocket {
  readyState: number = WebSocket.OPEN;
  sent: CdpRequest[] = [];
  private listeners = new Map<string, Array<(event: unknown) => void>>();
  private outcomes: EvaluateOutcome[] = [];

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  send(raw: string): void {
    const request = JSON.parse(raw) as CdpRequest;
    this.sent.push(request);
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open: readyState is CLOSED");
    }
    if (request.method === "Runtime.evaluate") {
      const outcome: EvaluateOutcome = this.outcomes.shift() ?? { kind: "value", value: false };
      queueMicrotask(() => {
        if (outcome.kind === "value") {
          this.emit("message", { data: JSON.stringify({ id: request.id, result: { result: { value: outcome.value } } }) });
        } else if (outcome.kind === "protocol-error") {
          this.emit("message", { data: JSON.stringify({ id: request.id, error: { message: outcome.message } }) });
        } else {
          this.emit(
            "message",
            { data: JSON.stringify({ id: request.id, result: { result: {}, exceptionDetails: { text: outcome.text } } }) },
          );
        }
      });
    } else {
      queueMicrotask(() => {
        this.emit("message", { data: JSON.stringify({ id: request.id, result: {} }) });
      });
    }
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close", {});
  }

  enqueueValue(value: boolean): void {
    this.outcomes.push({ kind: "value", value });
  }

  enqueueProtocolError(message: string): void {
    this.outcomes.push({ kind: "protocol-error", message });
  }

  enqueuePageException(text: string): void {
    this.outcomes.push({ kind: "page-exception", text });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function attachFake(label: string, socket: FakeCdpSocket): CdpPageClient {
  const Ctor = CdpPageClient as unknown as new (
    socket: WebSocket,
    target: { id: string; type: string; url: string },
    label: string,
  ) => CdpPageClient;
  return new Ctor(
    socket as unknown as WebSocket,
    { id: "target-1", type: "page", url: "https://example.test/" },
    label,
  );
}

describe("CdpPageClient.waitFor socket diagnostics (#918)", () => {
  beforeAll(() => {
    // CI runs Node 20, which has no global WebSocket; this test only needs its
    // readyState constants because the fake owns all socket behavior.
    vi.stubGlobal("WebSocket", { OPEN: 1, CLOSED: 3 });
  });
  afterAll(() => vi.unstubAllGlobals());

  it("rejects promptly with socket context when the popup socket is closed", async () => {
    const socket = new FakeCdpSocket();
    const client = attachFake("popup", socket);
    socket.close();
    const predicate = "document.getElementById('late')";

    const failure = await client.waitFor(predicate, 1000).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain("popup");
    expect(failure?.message).toContain(predicate);
    expect(failure?.message).toMatch(/socket closed|not open/i);
    expect(failure?.message).not.toMatch(/timed out/);
    // Prompt: a single evaluate attempt, not a full polling loop.
    expect(socket.sent.length).toBe(1);
  });

  it("retries a false predicate then succeeds", async () => {
    const socket = new FakeCdpSocket();
    socket.enqueueValue(false);
    socket.enqueueValue(true);
    const client = attachFake("popup", socket);

    await expect(client.waitFor("document.getElementById('late')", 2000)).resolves.toBeUndefined();
    expect(socket.sent.length).toBe(2);
  });

  it("retries a page-thrown predicate (missing element) then succeeds", async () => {
    const socket = new FakeCdpSocket();
    socket.enqueuePageException("TypeError: Cannot read properties of null (reading 'checked')");
    socket.enqueueValue(true);
    const client = attachFake("popup", socket);

    await expect(client.waitFor("document.getElementById('late').checked === true", 2000)).resolves.toBeUndefined();
    expect(socket.sent.length).toBe(2);
  });

  it("surfaces an unrelated CDP error instead of timing out", async () => {
    const socket = new FakeCdpSocket();
    socket.enqueueProtocolError("Runtime.evaluate boom");
    const client = attachFake("popup", socket);

    const failure = await client.waitFor("document.getElementById('late')", 2000).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toContain("Runtime.evaluate boom");
    expect(failure?.message).not.toMatch(/timed out/);
    expect(socket.sent.length).toBe(1);
  });
});
