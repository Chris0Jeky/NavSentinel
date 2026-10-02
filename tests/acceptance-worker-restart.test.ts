import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptanceSession } from "./acceptance/acceptance_harness";
import { CdpPageClient } from "./acceptance/cdp_page_client";

/**
 * Shutdown-proof regressions for #958.
 *
 * `stopServiceWorker` must latch a post-command `stopped` event for the exact
 * selected versionId while armed. A selected version that emits stopped then
 * running between 100ms samples is still genuine shutdown; an earlier stopped
 * event or another version must never satisfy the proof.
 */

const WORKER_URL = "chrome-extension://test-id/service-worker-loader.js";

type VersionEvent = { versionId: string; scriptURL: string; runningStatus: string };

class FakeCdpSession {
  handlers = new Map<string, (payload: { versions: VersionEvent[] }) => void>();
  sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  detachCalls = 0;
  onEnable: (() => void) | null = null;
  onStopWorker: ((versionId: string) => void) | null = null;

  on(method: string, handler: (payload: { versions: VersionEvent[] }) => void): void {
    this.handlers.set(method, handler);
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.sent.push({ method, params });
    if (method === "ServiceWorker.enable") this.onEnable?.();
    if (method === "ServiceWorker.stopWorker") this.onStopWorker?.(params["versionId"] as string);
    return {};
  }

  async detach(): Promise<void> {
    this.detachCalls += 1;
  }

  emit(versions: VersionEvent[]): void {
    this.handlers.get("ServiceWorker.workerVersionUpdated")?.({ versions });
  }

  stopWorkerVersionIds(): string[] {
    return this.sent
      .filter((entry) => entry.method === "ServiceWorker.stopWorker")
      .map((entry) => entry.params["versionId"] as string);
  }
}

function running(versionId: string, scriptURL = WORKER_URL): VersionEvent {
  return { versionId, scriptURL, runningStatus: "running" };
}

function stopped(versionId: string, scriptURL = WORKER_URL): VersionEvent {
  return { versionId, scriptURL, runningStatus: "stopped" };
}

function createHarness(options: {
  onEnable: (emit: (versions: VersionEvent[]) => void) => void;
  onStopWorker: (versionId: string, emit: (versions: VersionEvent[]) => void) => void;
  attachMarker: string | null;
}) {
  const cdp = new FakeCdpSession();
  cdp.onEnable = () => options.onEnable((versions) => cdp.emit(versions));
  cdp.onStopWorker = (versionId) => options.onStopWorker(versionId, (versions) => cdp.emit(versions));
  const probe = { goto: vi.fn(async () => undefined), close: vi.fn(async () => undefined) };
  const fakeContext = {
    newPage: vi.fn(async () => probe),
    newCDPSession: vi.fn(async () => cdp),
  };
  const worker = { url: () => WORKER_URL, evaluate: vi.fn(async () => undefined) };
  const session = Object.create(AcceptanceSession.prototype) as AcceptanceSession;
  (session as unknown as Record<string, unknown>)["currentWorker"] = worker;
  (session as unknown as Record<string, unknown>)["currentContext"] = fakeContext;
  (session as unknown as Record<string, unknown>)["currentDevToolsPort"] = 9222;
  (session as unknown as Record<string, unknown>)["extensionId"] = "test-id";
  (session as unknown as Record<string, unknown>)["receipt"] = { notes: [] as string[] };
  (session as unknown as Record<string, unknown>)["workerClient"] = null;
  const attachClient = {
    evaluate: vi.fn(async () => options.attachMarker),
    close: vi.fn(async () => undefined),
  };
  const attachSpy = vi
    .spyOn(CdpPageClient, "attach")
    .mockResolvedValue(attachClient as unknown as CdpPageClient);
  return { session, cdp, probe, attachClient, attachSpy };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AcceptanceSession.stopServiceWorker shutdown proof (#958)", () => {
  it("succeeds when the selected version emits stopped immediately followed by running", async () => {
    const { session, cdp, attachSpy } = createHarness({
      onEnable: (emit) => emit([running("v1")]),
      onStopWorker: (versionId, emit) => emit([stopped(versionId), running(versionId)]),
      attachMarker: null,
    });

    await session.stopServiceWorker();

    expect(cdp.stopWorkerVersionIds()).toEqual(["v1"]);
    expect(cdp.detachCalls).toBe(1);
    expect(attachSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores a pre-command stopped event for the selected version", async () => {
    vi.useFakeTimers();
    const { session, cdp, attachSpy } = createHarness({
      // The stopped event arrives while disarmed, before the running version
      // is selected and the stop command is sent.
      onEnable: (emit) => emit([stopped("v1"), running("v1")]),
      onStopWorker: () => undefined,
      attachMarker: null,
    });

    const pending = session.stopServiceWorker();
    const assertion = expect(pending).rejects.toThrow("extension service worker did not stop");
    await vi.advanceTimersByTimeAsync(9000);
    await assertion;

    expect(cdp.stopWorkerVersionIds()).toEqual(["v1"]);
    expect(cdp.detachCalls).toBe(1);
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it("ignores stopped events for another version or the wrong script", async () => {
    vi.useFakeTimers();
    const { session, cdp, attachSpy } = createHarness({
      onEnable: (emit) => emit([running("v1")]),
      onStopWorker: (_versionId, emit) =>
        emit([stopped("v2"), stopped("v1", "chrome-extension://test-id/other.js")]),
      attachMarker: null,
    });

    const pending = session.stopServiceWorker();
    const assertion = expect(pending).rejects.toThrow("extension service worker did not stop");
    await vi.advanceTimersByTimeAsync(9000);
    await assertion;

    expect(cdp.stopWorkerVersionIds()).toEqual(["v1"]);
    expect(cdp.detachCalls).toBe(1);
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it("rejects when the epoch survives the restart", async () => {
    const { session, cdp, attachSpy } = createHarness({
      onEnable: (emit) => emit([running("v1")]),
      onStopWorker: (versionId, emit) => emit([stopped(versionId), running(versionId)]),
      attachMarker: "acceptance-stale-epoch",
    });

    await expect(session.stopServiceWorker()).rejects.toThrow(
      "service worker realm did not change after restart",
    );

    expect(cdp.stopWorkerVersionIds()).toEqual(["v1"]);
    expect(cdp.detachCalls).toBe(1);
    expect(attachSpy).toHaveBeenCalledTimes(1);
  });
});
