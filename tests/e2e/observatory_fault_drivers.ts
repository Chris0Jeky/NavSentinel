/** Deliberate faults in disposable loopback experiments. Never change a protection rule. */
import { expect, type BrowserContext, type Frame, type Page, type Worker } from "@playwright/test";
import type { createRunRecorder, FrameContext } from "../../experiments/evidence-observatory/recorder.mjs";
import type { FaultId } from "../../experiments/evidence-observatory/fault-contract.mjs";
import type { ProvingGroundFakeSink } from "./proving_ground_fake_sink";
import { selectReplacementWorker } from "../../experiments/evidence-observatory/worker-replacement.mjs";

type Scope = { faultId: FaultId; context: BrowserContext; page: Page; frame: Frame; worker: Worker | null;
  workerEpoch: string; sink: ProvingGroundFakeSink; recorder: ReturnType<typeof createRunRecorder>; primaryContext: FrameContext };
export async function injectObserverFault(scope: Scope): Promise<{ sinkClosed: boolean; skipScene: boolean; cleanup: () => void; worker?: Worker }> {
  const { faultId, context, page, frame, sink, recorder } = scope;
  const result = { sinkClosed: false, skipScene: false, cleanup: (): void => {} };
  recorder.record("runner", "fault.injected", { code: faultId, frame: "child", context: scope.primaryContext });
  if (faultId === "receiver-unavailable") {
    await sink.close(); result.sinkClosed = true;
    expect((await sink.probe()).healthy, "Receiver really stopped").toBe(false);
  } else if (faultId === "primary-frame-detached") {
    const observed = page.waitForEvent("framedetached", { predicate: f => f === frame, timeout: 5000 });
    await page.locator("#media-frame").evaluate(node => node.remove()); await observed;
    result.skipScene = true;
  } else if (faultId === "primary-document-replaced") {
    // Same-origin inert destination; no new attack and no user browser is controlled.
    await frame.goto(new URL("/local-fixture-sink.html", frame.url()).href);
    result.skipScene = true;
  } else if (faultId === "page-report-flood") {
    await frame.evaluate(async () => {
      const report = (window as unknown as { __nsObservatoryReport: (event: { kind: string; code: string; at: number }) => Promise<void> }).__nsObservatoryReport;
      for (let i = 0; i < 160; i++) await report({ kind: "dom.changed", code: "display-rewritten", at: performance.now() });
    });
  } else if (faultId === "receiver-observer-error") {
    // Primary collector still receives the consequence; a separate failed observer
    // must remain visible through the receiver's independently counted errors.
    result.cleanup = sink.observe(() => { throw new Error("SYNTHETIC_OBSERVER_FAILURE"); });
  } else if (faultId === "worker-restarted") {
    if (!scope.worker) throw new Error("FAULT_WORKER_MISSING");
    const workerURL = scope.worker.url();
    if (!workerURL.startsWith("chrome-extension://")) throw new Error("FAULT_WORKER_SCOPE_INVALID");
    const session = await context.newCDPSession(page);
    type Version = { versionId: string; scriptURL: string; runningStatus: string };
    const versions = new Map<string, Version>(); let stopped = false, armed = false;
    session.on("ServiceWorker.workerVersionUpdated", ({ versions: updates }: { versions: Version[] }) => {
      for (const version of updates) {
        if (version.scriptURL !== workerURL) continue;
        versions.set(version.versionId, version);
        if (armed && version.runningStatus === "stopped" && !stopped) {
          stopped = true; recorder.record("browser", "worker.stopped", { code: "extension-worker" });
          recorder.gap("WORKER_EPOCH_CHANGED");
        }
      }
    });
    try {
      await session.send("ServiceWorker.enable");
      await expect.poll(() => [...versions.values()].some(v => v.runningStatus === "running"), { timeout: 8000 }).toBe(true);
      const version = [...versions.values()].find(v => v.runningStatus === "running")!;
      armed = true;
      await session.send("ServiceWorker.stopWorker", { versionId: version.versionId });
      await expect.poll(() => stopped, { timeout: 8000 }).toBe(true);
      await session.send("ServiceWorker.startWorker", { scopeURL: new URL(".", workerURL).href });
      await expect.poll(() => [...versions.values()].some(v => v.runningStatus === "running"), { timeout: 8000 }).toBe(true);
      // CDP running-status can arrive before Playwright retires the old Worker.
      // Initial-worker lookup is not evidence that a new realm was attached.
      let replacement: Worker | undefined;
      await expect.poll(() => {
        replacement = selectReplacementWorker(context.serviceWorkers(), scope.worker!, workerURL);
        return Boolean(replacement);
      }, { timeout: 8000 }).toBe(true);
      const restarted = replacement!;
      const epoch = await restarted.evaluate(() => (globalThis as unknown as Record<string, unknown>).__nsObservatoryEpoch);
      expect(epoch, "A real new worker realm loses its old in-memory marker").not.toBe(scope.workerEpoch);
      recorder.record("browser", "worker.restarted", { code: "new-worker-epoch" });
      return { ...result, worker: restarted };
    } finally { armed = false; await session.detach(); }
  }
  return result;
}
