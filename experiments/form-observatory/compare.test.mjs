import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareFormEvidence, compareFormOutcomes, expectedKeys, validateFormTraces } from "./compare.mjs";
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


// Exercise the actual combined CLI: independently valid files can still disagree.
const setTraceReceivers = (trace, attempts) => {
  trace.events = trace.events.filter((entry) => entry.kind !== "receiver.attempt");
  trace.events.splice(trace.events.length - 2, 0, ...attempts.map((receipt) => ({
    id: "pending", sequence: 0, elapsedMs: 0,
    source: "sink", kind: "receiver.attempt", data: { ...receipt },
  })));
  renumber(trace.events);
};
const runCampaign = (t, full, control, traceRows) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ns-form-receivers-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fullRoot = path.join(root, "full");
  const controlRoot = path.join(root, "control");
  fs.mkdirSync(fullRoot);
  fs.mkdirSync(controlRoot);
  for (const [directory, rows, suffix] of [
    [fullRoot, full, ".result.json"],
    [controlRoot, control, ".result.json"],
    [fullRoot, traceRows, ".form-trace.json"],
  ]) {
    rows.forEach((row, index) => fs.writeFileSync(
      path.join(directory, `${String(index).padStart(3, "0")}${suffix}`), JSON.stringify(row),
    ));
  }
  const child = spawnSync(process.execPath, [
    fileURLToPath(new URL("./compare.mjs", import.meta.url)), fullRoot, controlRoot,
  ], { encoding: "utf8", timeout: 10_000 });
  assert.ifError(child.error);
  assert.equal(child.stderr, "");
  return { status: child.status, result: JSON.parse(child.stdout) };
};

test("CLI refuses missing receiver trace events even when result parity and trace structure pass (#762)", (t) => {
  const full = records();
  full[0].attempts = [{ role: "harm", method: "POST", accepted: true, ordinal: 1 }];
  const traceRows = traces();
  // All event IDs, health bounds and report sequences are valid; only the sink
  // callback is missing. The unchanged result files still agree with each other.
  assert.equal(validateFormTraces(traceRows).matched, true);
  assert.equal(compareFormOutcomes(full, full).matched, true);
  const { status, result } = runCampaign(t, full, full, traceRows);
  assert.equal(status, 1);
  assert.equal(result.matched, false);
  assert.equal(result.parityEvidence.matched, true);
  assert.equal(result.traceEvidence.matched, true);
  assert.equal(result.receiverEvidence.matched, false);
  assert.deepEqual(result.receiverEvidence.differences, [`FORM_TRACE_RECEIVER_MISMATCH:${expectedKeys[0]}`]);
});

const receiptCampaign = () => {
  const full = records();
  const traceRows = traces();
  full.forEach((row, index) => {
    row.attempts = index % 3 === 0 ? [] : [
      { role: index % 2 ? "harm" : "benign", method: index % 2 ? "POST" : "GET", accepted: true, ordinal: 1 },
      ...(index % 3 === 2 ? [{ role: "harm", method: "POST", accepted: false, ordinal: 2 }] : []),
    ];
    setTraceReceivers(traceRows[index], row.attempts);
  });
  return { full, traceRows };
};

test("reconciles every arm including zero attempts, accepted harm and rejected duplicates", () => {
  const { full, traceRows } = receiptCampaign();
  const result = compareFormEvidence(full, full, traceRows);
  assert.equal(result.matched, true);
  assert.equal(result.receiverEvidence.cases, expectedKeys.length);
  assert.equal(result.parityEvidence.evidencePolicy, "CONSEQUENCE_PARITY_NOT_ZERO_OBSERVER_EFFECT");
  assert.equal(result.receiverEvidence.evidencePolicy, "EXACT_PER_ARM_RECEIVER_PARITY_NOT_PREVENTION");
});

test("CLI certifies consistent receiver files without depending on collection or JSON key order", (t) => {
  const { full, traceRows } = receiptCampaign();
  for (const row of traceRows) {
    for (const entry of row.events.filter((entry) => entry.kind === "receiver.attempt")) {
      const { ordinal, accepted, method, role } = entry.data;
      entry.data = { ordinal, accepted, method, role };
    }
  }
  const { status, result } = runCampaign(t, full, [...full].reverse(), [...traceRows].reverse());
  assert.equal(status, 0);
  assert.equal(result.matched, true);
  assert.equal(result.receiverEvidence.matched, true);
});

test("an unexpected receiver event cannot certify an explicit zero-attempt arm", () => {
  const full = records();
  const traceRows = traces();
  setTraceReceivers(traceRows[0], [{ role: "harm", method: "POST", accepted: false, ordinal: 1 }]);
  const result = compareFormEvidence(full, full, traceRows);
  assert.equal(result.parityEvidence.matched, true);
  assert.equal(result.traceEvidence.matched, true);
  assert.equal(result.receiverEvidence.matched, false);
  assert.equal(result.matched, false);
});

for (const [field, value] of [["role", "benign"], ["method", "GET"], ["accepted", false], ["ordinal", 2]]) {
  test(`receiver ${field} mismatch cannot hide behind matching consequence files`, () => {
    const full = records();
    const traceRows = traces();
    const receipt = { role: "harm", method: "POST", accepted: true, ordinal: 1 };
    full[0].attempts = [receipt];
    setTraceReceivers(traceRows[0], [{ ...receipt, [field]: value }]);
    const result = compareFormEvidence(full, full, traceRows);
    assert.equal(result.parityEvidence.matched, true);
    assert.equal(result.traceEvidence.matched, true);
    assert.equal(result.receiverEvidence.matched, false);
    assert.equal(result.matched, false);
  });
}

test("receiver order and duplicate delivery are preserved, not set-normalized", () => {
  const { full, traceRows } = receiptCampaign();
  const index = full.findIndex((row) => row.attempts.length === 2);
  for (const attempts of [
    [...full[index].attempts].reverse(),
    [full[index].attempts[0], full[index].attempts[0], full[index].attempts[1]],
    full[index].attempts.slice(0, 1),
  ]) {
    setTraceReceivers(traceRows[index], attempts);
    const result = compareFormEvidence(full, full, traceRows);
    assert.equal(result.parityEvidence.matched, true);
    assert.equal(result.traceEvidence.matched, true);
    assert.equal(result.receiverEvidence.matched, false);
  }
});

test("receiver attempts attributed to another arm cannot match aggregate campaign totals", () => {
  const { full, traceRows } = receiptCampaign();
  setTraceReceivers(traceRows[0], full[1].attempts);
  setTraceReceivers(traceRows[1], full[0].attempts);
  const result = compareFormEvidence(full, full, traceRows);
  assert.equal(result.traceEvidence.matched, true);
  assert.deepEqual(result.receiverEvidence.differences, expectedKeys.slice(0, 2)
    .map((key) => `FORM_TRACE_RECEIVER_MISMATCH:${key}`));
  assert.equal(result.matched, false);
});

test("receiver reconciliation uses the observed run rather than its observer-off control", () => {
  const { full, traceRows } = receiptCampaign();
  const result = compareFormEvidence(full, records(), traceRows);
  assert.equal(result.parityEvidence.matched, false);
  assert.equal(result.traceEvidence.matched, true);
  assert.equal(result.receiverEvidence.matched, true);
  assert.equal(result.matched, false);
});

test("malformed or missing result records fail closed without a receiver agreement claim", () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => { rows[0] = rows[1]; },
    (rows) => { rows[0].attempts = [{ role: "harm", method: "POST", accepted: "true", ordinal: 1 }]; },
  ]) {
    const full = records();
    mutate(full);
    const result = compareFormEvidence(full, full, traces());
    assert.equal(result.receiverEvidence.matched, false);
    assert.equal(result.matched, false);
    assert.equal(result.receiverEvidence.cases, 0);
  }
});

test("receiver payload equality cannot certify malformed, incomplete or page-attributed traces", () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => { rows[0] = rows[1]; },
    (rows) => { rows[0].gaps = ["RECEIVER_CALLBACK_LOSS"]; },
    (rows) => { rows[0].dropped = 1; },
    (rows) => { rows[0].completed = false; },
    (rows) => { rows[1].events.find((entry) => entry.kind === "receiver.attempt").source = "page"; },
  ]) {
    const { full, traceRows } = receiptCampaign();
    mutate(traceRows);
    const result = compareFormEvidence(full, full, traceRows);
    assert.equal(result.parityEvidence.matched, true);
    assert.equal(result.traceEvidence.matched, false);
    assert.equal(result.receiverEvidence.matched, false);
    assert.equal(result.receiverEvidence.error, "FORM_TRACE_INVALID");
    assert.equal(result.matched, false);
  }
});
