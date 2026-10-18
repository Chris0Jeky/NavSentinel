import { describe, expect, it } from "vitest";
// @ts-expect-error The offline Observatory is a Node JavaScript module without declarations.
import { validateRunCapture } from "../experiments/evidence-observatory/capture-v2.mjs";

const SCENARIO_ID = "scenario-1";
const RUN_ID = "run-1";
const HARM_TARGET = "harm-target-1";
const BENIGN_TARGET = "benign-target-1";

function makeBaselineRun() {
  return {
    runId: RUN_ID,
    arm: "baseline",
    observer: { endedMs: 2000, requiredMs: 500 },
    events: [
      { kind: "input.dispatched", elapsedMs: 1000 },
      {
        kind: "sink.receipt",
        consequence: "harm",
        receiver: {
          runId: RUN_ID,
          scenarioId: SCENARIO_ID,
          targetId: HARM_TARGET,
          role: "attack",
        },
      },
    ],
    capture: {
      contextId: "ctx-1",
      instrumentation: "full",
      harmTargetId: HARM_TARGET,
      benignTargetId: BENIGN_TARGET,
      baselineMode: "extension-absent",
      startHealth: {
        healthy: true,
        healthSequence: 1,
        receiptCount: 0,
        invalidAttempts: 0,
        observerErrors: 0,
        targetUses: { [HARM_TARGET]: 0, [BENIGN_TARGET]: 0 },
      },
      endHealth: {
        healthy: true,
        healthSequence: 2,
        receiptCount: 1,
        invalidAttempts: 0,
        observerErrors: 0,
        targetUses: { [HARM_TARGET]: 1, [BENIGN_TARGET]: 0 },
      },
      faults: [],
    },
  };
}

describe("validateRunCapture receiver binding and health", () => {
  it("accepts the bound baseline with no gaps", () => {
    const { gaps } = validateRunCapture(makeBaselineRun(), SCENARIO_ID);
    expect(gaps).toEqual([]);
  });

  it("rejects a receipt whose receiver target does not match the harm target", () => {
    const run = makeBaselineRun();
    run.events[1]!.receiver!.targetId = BENIGN_TARGET;
    expect(() => validateRunCapture(run, SCENARIO_ID)).toThrow(
      "RECEIVER_BINDING_MISMATCH",
    );
  });

  it("reports RECEIVER_EVENT_COUNT_DISAGREES when endHealth.receiptCount differs from receipt events", () => {
    const run = makeBaselineRun();
    // Keep targetUses sum consistent with receiptCount so only the
    // event-count check (not the accounting check) is exercised.
    run.capture.endHealth.receiptCount = 2;
    run.capture.endHealth.targetUses = { [HARM_TARGET]: 2, [BENIGN_TARGET]: 0 };
    const { gaps } = validateRunCapture(run, SCENARIO_ID);
    expect(gaps).toContain("RECEIVER_EVENT_COUNT_DISAGREES");
  });

  it("reports RECEIVER_HEALTH_ACCOUNTING_DISAGREES when targetUses sum differs from receiptCount", () => {
    const run = makeBaselineRun();
    run.capture.endHealth.receiptCount = 1;
    run.capture.endHealth.targetUses = { [HARM_TARGET]: 0, [BENIGN_TARGET]: 0 };
    const { gaps } = validateRunCapture(run, SCENARIO_ID);
    expect(gaps).toContain("RECEIVER_HEALTH_ACCOUNTING_DISAGREES");
  });

  it("reports POST_INPUT_WINDOW_INCOMPLETE when the observer window after last input is short", () => {
    const run = makeBaselineRun();
    run.observer.endedMs = 1200;
    run.observer.requiredMs = 500;
    const { gaps } = validateRunCapture(run, SCENARIO_ID);
    expect(gaps).toContain("POST_INPUT_WINDOW_INCOMPLETE");
  });
});
