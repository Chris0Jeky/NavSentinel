import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { compareFormOutcomes, expectedKeys, validateFormTraces } from "./compare.mjs";
import { requiredFormReports } from "./trace-contract.mjs";

const identity = {
  head: "a".repeat(40),
  tree: "b".repeat(40),
  extensionSha256: "c".repeat(64),
  fixtureSha256: "d".repeat(64),
};
const intent = {
  form: "f",
  submitter: "a",
  action: "benign",
  declaredAction: "benign",
  actionSource: "form",
  method: "POST",
  encoding: "urlencoded",
  target: "top",
  targetSource: "form",
  targetOverride: "absent",
  methodOverride: "absent",
  ownerMatches: true,
};
const pairId = (variant) => createHash("sha256").update(variant).digest("hex");
const runId = (index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const event = (events, source, kind, data) => {
  const sequence = events.length + 1;
  events.push({ id: `e${sequence}`, sequence, elapsedMs: sequence === 1 ? 0 : sequence, source, kind, data });
};
const validTrace = (key, index) => {
  const separator = key.lastIndexOf(":");
  const variant = key.slice(0, separator);
  const protectedArm = key.slice(separator + 1) === "true";
  const events = [];
  event(events, "runner", "run.start", {});
  event(events, "sink", "receiver.health", { phase: "start", ok: true, sequence: 1 });
  for (const report of requiredFormReports(variant, protectedArm)) {
    event(events, "page", "form.intent", { ...report, intent: { ...intent } });
  }
  event(events, "sink", "receiver.health", { phase: "end", ok: true, sequence: 2 });
  event(events, "runner", "observation.end", {});
  return {
    schema: "navsentinel.observatory.form.v1",
    mode: "synthetic",
    scenarioId: "issue688-form-intent",
    variant,
    pairId: pairId(variant),
    runId: runId(index),
    protectedArm,
    identity: { ...identity },
    completed: true,
    browserVersion: "143.0.7499.4",
    requiredObservationMs: 2300,
    dropped: 0,
    gaps: [],
    events,
    evidencePolicy: "FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION",
  };
};
const traces = () => expectedKeys.map(validTrace);
const records = () => expectedKeys.map((key) => ({
  variant: key.slice(0, key.lastIndexOf(":")),
  protectedArm: key.endsWith(":true"),
  attempts: [],
  atFixture: true,
  atSink: false,
  dialogClosed: false,
}));
const changed = (mutate) => {
  const rows = traces();
  mutate(rows);
  return validateFormTraces(rows);
};
const renumber = (events) => events.forEach((entry, index) => {
  entry.id = `e${index + 1}`;
  entry.sequence = index + 1;
  entry.elapsedMs = index;
});

// Consequence parity remains independent from trace certification.
test("all explicit arms are required", () => {
  assert.equal(compareFormOutcomes(records(), records()).matched, true);
  assert.equal(compareFormOutcomes(records().slice(1), records()).matched, false);
});
test("copied arms do not substitute for a missing variant", () => {
  const rows = records();
  rows[0] = rows[1];
  assert.equal(compareFormOutcomes(rows, records()).matched, false);
});
test("accepted harm difference is not hidden by identical test status", () => {
  const rows = records();
  rows[0].attempts = [{ role: "harm", method: "POST", ordinal: 1, accepted: true }];
  assert.equal(compareFormOutcomes(rows, records()).matched, false);
});
test("rejected duplicate remains an observable difference", () => {
  const rows = records();
  rows[0].attempts = [{ role: "harm", method: "POST", ordinal: 1, accepted: false }];
  assert.equal(compareFormOutcomes(rows, records()).matched, false);
});
test("malformed truthy values cannot imply parity", () => {
  const rows = records();
  rows[0].protectedArm = "false";
  assert.equal(compareFormOutcomes(rows, records()).matched, false);
});
test("native dialog and navigation completion are part of parity", () => {
  const rows = records();
  rows[0].dialogClosed = true;
  assert.equal(compareFormOutcomes(rows, records()).matched, false);
});

// A complete, strictly shaped campaign is accepted.
test("strictly validates all complete traces", () => {
  const result = validateFormTraces(traces());
  assert.equal(result.matched, true, JSON.stringify(result.differences));
});
test("rejects missing and unknown top-level fields", () => {
  assert.equal(changed((rows) => { delete rows[0].identity; }).matched, false);
  assert.equal(changed((rows) => { rows[0].privateText = "SECRET"; }).matched, false);
});
test("rejects malformed source identity, duplicate run identity and mismatched pair identity", () => {
  assert.equal(changed((rows) => { rows[0].identity.head = "bad"; }).matched, false);
  assert.equal(changed((rows) => { rows[1].runId = rows[0].runId; }).matched, false);
  const paired = expectedKeys.findIndex((key) => key === "action-substitution:true");
  assert.notEqual(paired, -1);
  assert.equal(changed((rows) => { rows[paired].pairId = "f".repeat(64); }).matched, false);
});
test("rejects malformed event IDs, sequence, timing and terminal order", () => {
  assert.equal(changed((rows) => { rows[0].events[1].id = "e99"; }).matched, false);
  assert.equal(changed((rows) => { rows[0].events[1].sequence = 99; }).matched, false);
  assert.equal(changed((rows) => { rows[0].events[2].elapsedMs = -1; }).matched, false);
  assert.equal(changed((rows) => { rows[0].events.push(rows[0].events.shift()); }).matched, false);
});
test("rejects unknown event fields, wrong source and malformed intent payload", () => {
  assert.equal(changed((rows) => { rows[0].events[0].extra = true; }).matched, false);
  assert.equal(changed((rows) => { rows[0].events[0].source = "page"; }).matched, false);
  assert.equal(changed((rows) => {
    const report = rows[0].events.find((entry) => entry.kind === "form.intent");
    report.data.intent.password = "SECRET";
  }).matched, false);
});
test("rejects a populated trace that loses a required later operation", () => {
  const result = changed((rows) => {
    const index = expectedKeys.indexOf("replay:true");
    const reports = rows[index].events.filter((entry) => entry.kind === "form.intent");
    const secondOperation = reports.findLast((entry) => entry.data.phase === "operation");
    rows[index].events = rows[index].events.filter((entry) => entry !== secondOperation);
    rows[index].events.forEach((entry, eventIndex) => {
      entry.sequence = eventIndex + 1;
      entry.id = `e${eventIndex + 1}`;
    });
  });
  assert.equal(result.matched, false);
  assert.ok(result.differences.some((code) => code.startsWith("FORM_TRACE_REPORT_SEQUENCE:replay:true")));
});
test("rejects form reports outside the receiver health interval", () => {
  assert.equal(changed((rows) => {
    const events = rows[0].events;
    const report = events.splice(events.findIndex((entry) => entry.kind === "form.intent"), 1)[0];
    events.splice(1, 0, report);
    renumber(events);
  }).matched, false);
  assert.equal(changed((rows) => {
    const events = rows[0].events;
    const report = events.splice(events.findIndex((entry) => entry.kind === "form.intent"), 1)[0];
    events.splice(events.length - 1, 0, report);
    renumber(events);
  }).matched, false);
});
test("rejects unexpected trailing page reports", () => {
  const result = changed((rows) => {
    const events = rows[0].events;
    const next = events.length + 1;
    events.splice(-1, 0, {
      id: `e${next}`, sequence: next, elapsedMs: events.at(-2).elapsedMs + 1,
      source: "page", kind: "form.intent",
      data: { phase: "input", primitive: "native", intent: { ...intent } },
    });
    renumber(events);
  });
  assert.equal(result.matched, false);
  assert.ok(result.differences.some((code) => code.startsWith("FORM_TRACE_REPORT_SEQUENCE:")));
});
test("allows only prepared reports trailing a complete arm", () => {
  const result = changed((rows) => {
    const events = rows[0].events;
    events.splice(events.length - 2, 0, {
      id: "pending", sequence: 0, elapsedMs: 0,
      source: "page", kind: "form.intent",
      data: { phase: "prepared", primitive: "native", intent: { ...intent } },
    });
    renumber(events);
  });
  assert.equal(result.matched, true, JSON.stringify(result.differences));
});
test("known gaps, dropped records and contradictory completion cannot certify", () => {
  assert.equal(changed((rows) => { rows[0].gaps = ["RECEIVER_CALLBACK_LOSS"]; }).matched, false);
  assert.equal(changed((rows) => { rows[0].dropped = 1; }).matched, false);
  assert.equal(changed((rows) => { rows[0].completed = false; }).matched, false);
});
