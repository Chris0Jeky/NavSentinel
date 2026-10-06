import { describe, expect, it } from "vitest";
// @ts-expect-error The offline Observatory is a Node JavaScript module without declarations.
import { buildReport, TRACE_SCHEMA } from "../experiments/evidence-observatory/model.mjs";

const CAMPAIGN = "pin-compare-campaign";
const SCENARIO = "pin-compare-scenario";
const VARIANT = "pin-compare-v1";

const IDENTITY = {
  repositoryHead: "a".repeat(40),
  extensionSha256: "b".repeat(64),
  fixtureSha256: "c".repeat(64),
  browserVersion: "test-browser-1",
  profile: "test-profile",
  seed: "pin-seed-1",
};

const OBSERVER = {
  startedMs: 0,
  endedMs: 3000,
  requiredMs: 1000,
  droppedEvents: 0,
  sinkHealthyStart: true,
  sinkHealthyEnd: true,
  freshTarget: true,
  egressFenced: true,
  extensionReady: true,
  trustedInput: true,
  baselineIndependent: true,
};

type Step = {
  source: string;
  kind: string;
  elapsedMs: number;
  code?: string;
  consequence?: string;
};

function runEvents(arm: string, steps: Step[]): Record<string, unknown>[] {
  return steps.map((step, index) => {
    const sequence = index + 1;
    const event: Record<string, unknown> = {
      id: `${arm}-e${sequence}`,
      sequence,
      elapsedMs: step.elapsedMs,
      source: step.source,
      kind: step.kind,
      frame: step.source === "sink" || step.source === "runner" ? "none" : "child",
      causes: index === 0 ? [] : [`${arm}-e${sequence - 1}`],
    };
    if (step.code !== undefined) event.code = step.code;
    if (step.kind === "sink.receipt") {
      event.consequence = step.consequence;
      event.sinkSequence = 1;
    }
    return event;
  });
}

function makeTrace(): Record<string, unknown> {
  const runs = [
    {
      runId: "run-baseline",
      arm: "baseline",
      protection: "off",
      completed: true,
      // Neutral outcome keeps this case gap-free both with and without the
      // harm receipt, so the post-deletion verdict change isolates the
      // compare() baseline-harm prerequisite.
      declaredOutcome: "UNKNOWN",
      observer: { ...OBSERVER },
      events: runEvents("baseline", [
        { source: "runner", kind: "run.start", elapsedMs: 0 },
        { source: "page", kind: "attack.intent", elapsedMs: 80 },
        { source: "page", kind: "dom.changed", elapsedMs: 160 },
        { source: "runner", kind: "input.dispatched", elapsedMs: 300 },
        { source: "page", kind: "attack.attempt", elapsedMs: 310 },
        { source: "browser", kind: "request.observed", elapsedMs: 335 },
        { source: "sink", kind: "sink.receipt", elapsedMs: 350, consequence: "harm" },
        { source: "browser", kind: "navigation.committed", elapsedMs: 375 },
        { source: "runner", kind: "observation.end", elapsedMs: 3000 },
      ]),
    },
    {
      runId: "run-protected",
      arm: "protected",
      protection: "on",
      completed: true,
      declaredOutcome: "BLOCKED_PRE_HARM",
      observer: { ...OBSERVER },
      events: runEvents("protected", [
        { source: "runner", kind: "run.start", elapsedMs: 0 },
        { source: "page", kind: "attack.intent", elapsedMs: 80 },
        { source: "page", kind: "dom.changed", elapsedMs: 160 },
        { source: "runner", kind: "input.dispatched", elapsedMs: 300 },
        { source: "page", kind: "attack.attempt", elapsedMs: 310 },
        { source: "extension", kind: "decision.block", elapsedMs: 320, code: "synthetic-overlay-rule" },
        { source: "runner", kind: "observation.end", elapsedMs: 3000 },
      ]),
    },
    {
      runId: "run-benign",
      arm: "benign",
      protection: "on",
      completed: true,
      declaredOutcome: "NO_SIGNAL",
      observer: { ...OBSERVER },
      events: runEvents("benign", [
        { source: "runner", kind: "run.start", elapsedMs: 0 },
        { source: "runner", kind: "input.dispatched", elapsedMs: 300 },
        { source: "extension", kind: "decision.allow", elapsedMs: 320, code: "ordinary-control" },
        { source: "sink", kind: "sink.receipt", elapsedMs: 450, consequence: "benign" },
        { source: "browser", kind: "control.completed", elapsedMs: 475 },
        { source: "runner", kind: "observation.end", elapsedMs: 3000 },
      ]),
    },
    {
      runId: "run-mixed",
      arm: "mixed",
      protection: "on",
      completed: true,
      declaredOutcome: "BLOCKED_PRE_HARM",
      observer: { ...OBSERVER },
      events: runEvents("mixed", [
        { source: "runner", kind: "run.start", elapsedMs: 0 },
        { source: "page", kind: "attack.intent", elapsedMs: 80 },
        { source: "page", kind: "dom.changed", elapsedMs: 160 },
        { source: "runner", kind: "input.dispatched", elapsedMs: 300 },
        { source: "page", kind: "attack.attempt", elapsedMs: 310 },
        { source: "extension", kind: "decision.block", elapsedMs: 320, code: "synthetic-overlay-rule" },
        { source: "sink", kind: "sink.receipt", elapsedMs: 450, consequence: "benign" },
        { source: "browser", kind: "control.completed", elapsedMs: 475 },
        { source: "runner", kind: "observation.end", elapsedMs: 3000 },
      ]),
    },
  ];
  return {
    schema: TRACE_SCHEMA,
    mode: "synthetic",
    campaignId: CAMPAIGN,
    scenarioId: SCENARIO,
    variantId: VARIANT,
    identity: { ...IDENTITY },
    runs,
  };
}

function withoutBaselineHarm(trace: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(trace)) as { runs: any[] };
  const baseline = clone.runs.find((run) => run.arm === "baseline");
  baseline.events = baseline.events.filter(
    (event: any) => !(event.kind === "sink.receipt" && event.consequence === "harm"),
  );
  baseline.events.forEach((event: any, index: number) => {
    event.sequence = index + 1;
    event.causes = index === 0 ? [] : [baseline.events[index - 1].id];
  });
  return clone as unknown as Record<string, unknown>;
}

describe("observatory four-arm compare verdict pin", () => {
  it("supports bounded prevention with four complete arms, then goes inconclusive without the baseline harm receipt", () => {
    const intact = makeTrace();
    const supported = buildReport([JSON.stringify(intact)]);
    expect(supported.rejected).toEqual([]);
    expect(supported.cases).toHaveLength(4);
    expect(supported.cases.every((c: any) => c.validity === "complete" && c.gaps.length === 0)).toBe(true);
    expect(supported.comparisons).toHaveLength(1);
    expect(supported.comparisons[0].status).toBe("BOUNDED_PREVENTION_SUPPORTED");
    expect(supported.comparisons[0].reasons).toEqual([]);

    const mutated = withoutBaselineHarm(intact);
    const pinned = buildReport([JSON.stringify(mutated)]);
    expect(pinned.rejected).toEqual([]);
    expect(pinned.cases).toHaveLength(4);
    expect(pinned.cases.every((c: any) => c.validity === "complete" && c.gaps.length === 0)).toBe(true);
    expect(pinned.comparisons).toHaveLength(1);
    expect(pinned.comparisons[0].status).toBe("INCONCLUSIVE");
    expect(pinned.comparisons[0].reasons).toContain("BASELINE_DID_NOT_REACH_HARM");
  });
});
