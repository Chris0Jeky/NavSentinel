import { describe, expect, it } from "vitest";
// @ts-expect-error Observatory model is plain ESM and intentionally has no declaration file.
import { buildReport, TRACE_SCHEMA } from "../experiments/evidence-observatory/model.mjs";

function trace(withRestore: boolean) {
  const events: Record<string, unknown>[] = [];
  const add = (
    source: string,
    kind: string,
    elapsedMs: number,
    frame: string,
    extra: Record<string, unknown> = {},
  ) => {
    const sequence = events.length + 1;
    events.push({
      id: `e${sequence}`,
      sequence,
      elapsedMs,
      source,
      kind,
      frame,
      causes: sequence > 1 ? [`e${sequence - 1}`] : [],
      ...extra,
    });
  };
  add("runner", "run.start", 0, "none");
  add("runner", "input.dispatched", 300, "none");
  add("page", "attack.attempt", 310, "child");
  add("sink", "sink.receipt", 350, "none", { consequence: "harm", sinkSequence: 1 });
  if (withRestore) add("browser", "navigation.restored", 375, "child");
  add("runner", "observation.end", 3000, "none");
  return {
    schema: TRACE_SCHEMA,
    mode: "synthetic",
    campaignId: "unit-campaign",
    scenarioId: "unit-scenario",
    variantId: "unit-variant",
    identity: {
      repositoryHead: "a".repeat(40),
      extensionSha256: "b".repeat(64),
      fixtureSha256: "c".repeat(64),
      browserVersion: "143.0.7499.4",
      profile: "observatory-unit",
      seed: "unit-seed-1",
    },
    runs: [
      {
        runId: "run-1",
        arm: "baseline",
        protection: "off",
        completed: true,
        declaredOutcome: "HARM_REACHED",
        observer: {
          startedMs: 0,
          endedMs: 3000,
          requiredMs: 3000,
          droppedEvents: 0,
          sinkHealthyStart: true,
          sinkHealthyEnd: true,
          freshTarget: true,
          egressFenced: true,
          extensionReady: false,
          trustedInput: true,
          baselineIndependent: true,
        },
        events,
      },
    ],
  };
}

describe("observatory nativeTrace harm/recovery counting", () => {
  it("counts one harm receipt and recovers only after navigation.restored", () => {
    const restored = buildReport([JSON.stringify(trace(true))]);
    expect(restored.rejected).toEqual([]);
    expect(restored.cases[0].facts.harmReceipts).toBe(1);
    expect(restored.cases[0].facts.recovered).toBe(true);

    const control = buildReport([JSON.stringify(trace(false))]);
    expect(control.rejected).toEqual([]);
    expect(control.cases[0].facts.harmReceipts).toBe(1);
    expect(control.cases[0].facts.recovered).toBe(false);
  });
});
