import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, parseSource, sha256, LIMITS, TRACE_SCHEMA, supportsCompleteSet } from '../model.mjs';
import { demonstration } from '../demo.mjs';

function fixture() { const raw = demonstration(); raw.mode = 'synthetic'; raw.identity.browserVersion = '143.0.7499.4'; return raw; }
const report = raw => buildReport([JSON.stringify(raw)]);
const errors = raw => report(raw).rejected.map(r => r.code);
function add(run, kind, source, extra = {}) {
  const end = run.events.pop(), previous = run.events.at(-1);
  const sequence = run.events.length + 1;
  run.events.push({ id: `added-${sequence}`, sequence, elapsedMs: previous.elapsedMs + 10, kind, source, frame: 'none', causes: [previous.id], ...extra });
  run.events.push({ ...end, sequence: sequence + 1, causes: [`added-${sequence}`] });
}
function overlay(overrides = {}) {
  const raw = { schema_version: '1.0.0', scenario_id: 'NS-ADV-UI-004', fixture: { role: 'attack', sha256: 'c'.repeat(64) },
    repository_head: 'a'.repeat(40), extension_build_sha256: 'b'.repeat(64), browser: { version: '143.0.7499.4' }, profile: 'proving_ground', outcome: 'BLOCKED_PRE_HARM', valid: true,
    network_violations: [], blocked_external_attempts: [], oracle: { type: 'independent_harm', sink_receipt_count: 0,
      observation: { baselineReceiptCount: 1, protectedReceiptCount: 0, trustedUnderlyingClicksCompleted: 1 },
      sink_snapshot: { receipts: [{ sequence: 1, runId: 'previous-run', scenarioId: 'NS-ADV-UI-004', role: 'attack', consequence: 'wrong-target-navigation', method: 'GET', sentinelSha256: 'd'.repeat(64) }], invalidAttempts: [] } }, ...overrides };
  raw.oracle.local_receipt_sha256 = sha256(JSON.stringify({ sinkSnapshot: raw.oracle.sink_snapshot, observation: raw.oracle.observation }));
  return raw;
}
function hidden() {
  return { mode: 'protected', arm: { id: 'top-assign-100', role: 'attack', expectation: 'blocked-pre-harm' }, sinkReceiptsBefore: 0, sinkReceiptsAfter: 1,
    sinkReceipts: [{ sequence: 1, runId: 'run-1', scenarioId: 'issue-593-hidden-media-layer-modelled', role: 'attack', method: 'GET', sentinelSha256: 'd'.repeat(64) }],
    diagnostics: [{ frame: 'parent', phase: 'parent-ready', at: 100 }, { frame: 'child', phase: 'executing', at: 10 }],
    pageErrors: [], fixtureEgressViolations: [], invalidSinkAttempts: [], topReturnedToFixture: true,
    fixtureUrl: 'http://localhost/?password=DO_NOT_EXPORT', toastText: 'DO_NOT_EXPORT' };
}

test('complete four-arm unit fixture supports only the declared bounded contract', () => {
  const r = report(fixture());
  assert.equal(r.summary.boundedSupportedComparisons, 1);
  assert.equal(r.cases[0].assessment, 'HARM_OBSERVED');
  assert.equal(r.cases[1].assessment, 'BOUNDED_PREVENTION_SUPPORTED');
  assert.equal(r.cases[2].assessment, 'BENIGN_COMPLETED');
  assert.equal(r.evidencePolicy, 'DIAGNOSTIC_ONLY_NO_REGISTRY_PROMOTION');
});
test('authored demonstration is never protection evidence', () => {
  const r = report(demonstration());
  assert.equal(r.summary.boundedSupportedComparisons, 0);
  assert.ok(r.comparisons[0].reasons.includes('DEMONSTRATION_NOT_EVIDENCE'));
});
for (const [name, mutate] of [
  ['missing baseline', r => r.runs.shift()],
  ['missing mixed', r => r.runs.pop()],
  ['different identity', r => { r.identity.repositoryHead = null; }],
  ['failed run', r => { r.runs[1].completed = false; }],
  ['invalid producer outcome', r => { r.runs[1].declaredOutcome = 'TEST_INVALID'; }],
  ['protection not ready', r => { r.runs[1].observer.extensionReady = false; }],
  ['consumed sink target', r => { r.runs[1].observer.freshTarget = false; }],
  ['dead sink', r => { r.runs[1].observer.sinkHealthyEnd = false; }],
  ['no independent baseline', r => { r.runs[0].observer.baselineIndependent = false; }],
  ['lost events', r => { r.runs[1].observer.droppedEvents = 1; }],
  ['short observation', r => { r.runs[1].observer.requiredMs = 4000; }],
  ['no egress fence', r => { r.runs[1].observer.egressFenced = false; }],
  ['unattested input', r => { r.runs[1].observer.trustedInput = false; }],
  ['gap event', r => add(r.runs[1], 'observer.gap', 'runner')],
  ['warning only', r => { r.runs[1].events.find(e => e.kind === 'decision.block').kind = 'decision.warn'; }],
  ['mixed warning only', r => { r.runs[3].events.find(e => e.kind === 'decision.block').kind = 'decision.warn'; }],
  ['baseline consequence benign', r => { r.runs[0].events.find(e => e.kind === 'sink.receipt').consequence = 'benign'; }],
  ['missing task completion', r => { r.runs[2].events.find(e => e.kind === 'control.completed').kind = 'request.observed'; }],
  ['missing input', r => { const e = r.runs[1].events.find(e => e.kind === 'input.dispatched'); e.kind = 'observer.gap'; }],
]) test(`${name} cannot produce a supported comparison`, () => {
  const raw = fixture(); mutate(raw);
  const result = report(raw);
  assert.equal(result.summary.boundedSupportedComparisons, 0);
  assert.equal(result.rejected.length, 0);
});
test('intervention before attempt is not correlated prevention', () => {
  const r = fixture(), events = r.runs[1].events;
  const first = events.find(e => e.kind === 'attack.attempt'), second = events.find(e => e.kind === 'decision.block');
  [first.kind, first.source, second.kind, second.source] = ['decision.block', 'extension', 'attack.attempt', 'page'];
  assert.equal(report(r).summary.boundedSupportedComparisons, 0);
});
test('product block followed by harm is a survivor', () => {
  const r = fixture(); add(r.runs[1], 'sink.receipt', 'sink', { consequence: 'harm', sinkSequence: 1 });
  const result = report(r);
  assert.equal(result.cases[1].assessment, 'HARM_OBSERVED');
  assert.equal(result.summary.boundedSupportedComparisons, 0);
});
test('harm followed by recovery remains harm, not prevention', () => {
  const r = fixture(); add(r.runs[1], 'sink.receipt', 'sink', { consequence: 'harm', sinkSequence: 1 }); add(r.runs[1], 'navigation.restored', 'browser');
  assert.equal(report(r).cases[1].assessment, 'HARM_THEN_RECOVERY');
});
test('new harm after a recovery clears the recovered state', () => {
  const r = fixture(); add(r.runs[1], 'sink.receipt', 'sink', { consequence: 'harm', sinkSequence: 1 }); add(r.runs[1], 'navigation.restored', 'browser');
  add(r.runs[1], 'sink.receipt', 'sink', { consequence: 'harm', sinkSequence: 2 });
  assert.equal(report(r).cases[1].assessment, 'HARM_OBSERVED');
});
for (const [name, mutate] of [
  ['forged sink provenance', r => { const e = r.runs[0].events.find(e => e.kind === 'sink.receipt'); e.source = 'page'; }],
  ['unknown payload field', r => { r.runs[0].events[0].password = 'secret'; }],
  ['future cause', r => { r.runs[0].events[0].causes = ['missing']; }],
  ['duplicate run ID', r => { r.runs[1].runId = r.runs[0].runId; }],
  ['duplicate event ID', r => { r.runs[0].events[1].id = r.runs[0].events[0].id; }],
  ['nonsequential event', r => { r.runs[0].events[1].sequence = 999; }],
  ['negative clock', r => { r.runs[0].events[0].elapsedMs = -1; }],
  ['backwards clock', r => { r.runs[0].events[2].elapsedMs = 0; }],
  ['after-end event', r => { r.runs[0].events.at(-1).elapsedMs = 9000; }],
  ['string observer boolean', r => { r.runs[0].observer.freshTarget = 'true'; }],
  ['unknown mode', r => { r.mode = 'live'; }],
  ['nonsequential sink', r => { r.runs[0].events.find(e => e.kind === 'sink.receipt').sinkSequence = 2; }],
  ['sink fields on page event', r => { r.runs[0].events[1].consequence = 'harm'; }],
]) test(`${name} is rejected at the data boundary`, () => {
  const raw = fixture(); mutate(raw); assert.equal(errors(raw).length, 1);
});
test('different build identities cannot be pooled', () => {
  const a = fixture(), b = fixture(); a.runs = a.runs.slice(0, 2); b.runs = b.runs.slice(2); b.identity.extensionSha256 = 'f'.repeat(64);
  const r = buildReport([JSON.stringify(a), JSON.stringify(b)]);
  assert.ok(r.comparisons[0].reasons.includes('IDENTITY_MISMATCH'));
});
test('copied attachments do not become repeated trials', () => {
  const text = JSON.stringify(fixture()), r = buildReport([text, text]);
  assert.equal(r.summary.duplicateCopies, 1); assert.equal(r.summary.caseCount, 4);
});
test('failed framework status invalidates earlier success without deleting harm', () => {
  const r = buildReport([JSON.stringify(fixture())], { producerStatus: 'failed' });
  assert.equal(r.summary.invalidCases, 4); assert.equal(r.summary.harmCases, 1); assert.equal(r.summary.boundedSupportedComparisons, 0);
});
test('empty input is not evidence', () => assert.equal(buildReport([]).summary.boundedSupportedComparisons, 0));
test('UTF-8 is decoded strictly', () => assert.throws(() => parseSource(Buffer.from([0xff]))));
test('unknown format and malformed JSON are visible rejections', () => {
  assert.deepEqual(buildReport(['{}', '{']).rejected.map(r => r.code), ['UNSUPPORTED_FORMAT', 'INVALID_JSON']);
});
test('exact byte limit is accepted, one extra byte rejected', () => {
  const text = JSON.stringify(fixture()), padded = text + ' '.repeat(LIMITS.bytes - Buffer.byteLength(text));
  assert.equal(parseSource(padded).cases.length, 4);
  assert.throws(() => parseSource(padded + ' '), /INPUT_SIZE_LIMIT/);
});
test('file and event counts are bounded', () => {
  assert.throws(() => buildReport(Array(LIMITS.files + 1).fill('{}')), /FILE_COUNT_LIMIT/);
  const r = fixture(); r.runs[0].events = Array(LIMITS.events + 1).fill(r.runs[0].events[0]); assert.equal(errors(r).length, 1);
});
test('legacy cumulative snapshot does not become fresh protected harm', () => {
  const c = report(overlay()).cases[0];
  assert.equal(c.arm, 'protected'); assert.equal(c.facts.cumulativeReceipts, 1); assert.equal(c.facts.harmReceipts, 0);
  assert.equal(c.assessment, 'INCONCLUSIVE'); assert.ok(c.gaps.includes('CUMULATIVE_SINK_REUSED_ACROSS_PHASES'));
});
test('changed legacy hash invalidates the receipt', () => {
  const r = overlay(); r.oracle.local_receipt_sha256 = 'f'.repeat(64); assert.equal(report(r).cases[0].validity, 'invalid');
});
test('self-consistent but contradictory phase counts are invalid', () => {
  const r = overlay(); r.oracle.observation.baselineReceiptCount = 0;
  r.oracle.local_receipt_sha256 = sha256(JSON.stringify({ sinkSnapshot: r.oracle.sink_snapshot, observation: r.oracle.observation }));
  assert.equal(report(r).cases[0].validity, 'invalid');
});
test('legacy raw page data never crosses the allowlist projection', () => {
  const r = overlay(); r.url = 'https://private.example/?token=DO_NOT_EXPORT'; r.extra = 'DO_NOT_EXPORT';
  assert.ok(!JSON.stringify(report(r)).includes('DO_NOT_EXPORT'));
});
test('legacy hidden-media expected prevention does not suppress observed harm', () => {
  const r = report(hidden()); assert.equal(r.cases[0].assessment, 'HARM_THEN_RECOVERY');
  assert.ok(!JSON.stringify(r).includes('DO_NOT_EXPORT'));
});
test('page clocks are retained in capture order instead of invented global order', () => {
  const c = report(hidden()).cases[0]; assert.deepEqual(c.events.slice(0, 2).map(e => e.elapsedMs), [100, 10]);
});
test('hidden-media sink mismatch is refused', () => {
  const r = hidden(); r.sinkReceipts[0].scenarioId = 'wrong'; assert.equal(errors(r)[0], 'SINK_RECEIPT_INVALID');
});
test('hidden-media missing count never defaults to zero', () => { const r = hidden(); delete r.sinkReceiptsAfter; assert.equal(errors(r)[0], 'SINK_COUNT_INVALID'); });
test('native schema identifier is stable', () => assert.equal(fixture().schema, TRACE_SCHEMA));

test('mixed legacy receipt does not require a nonexistent baseline counter', () => {
  const r = overlay(); r.fixture.role = 'mixed'; r.oracle.sink_snapshot.receipts = []; delete r.oracle.observation.baselineReceiptCount;
  delete r.oracle.observation.trustedUnderlyingClicksCompleted; r.oracle.observation.trustedBenignClicksCompleted = 1;
  r.oracle.local_receipt_sha256 = sha256(JSON.stringify({ sinkSnapshot: r.oracle.sink_snapshot, observation: r.oracle.observation }));
  const c = report(r).cases[0];
  assert.equal(c.validity, 'unverified'); assert.equal(c.facts.legitimateCompletions, 1); assert.equal(c.facts.harmReceipts, 0);
  assert.ok(!c.gaps.includes('CUMULATIVE_SINK_REUSED_ACROSS_PHASES'));
});
test('one supported comparison cannot conceal another inconclusive campaign', () => {
  const a = fixture(), b = fixture(); b.campaignId = 'other'; b.runs.pop();
  const r = buildReport([JSON.stringify(a), JSON.stringify(b)]);
  assert.equal(r.summary.boundedSupportedComparisons, 1); assert.equal(supportsCompleteSet(r), false);
});
test('a complete set is a bounded structural pass only', () => assert.equal(supportsCompleteSet(report(fixture())), true));

test('legacy benign label cannot launder an attack-role receipt', () => { const r = overlay(); r.fixture.role = 'benign'; assert.equal(errors(r)[0], 'SINK_ROLE_DISAGREES'); });
test('cross-source run reuse is not a fresh independent arm', () => {
  const a = fixture(), b = fixture(); a.runs = a.runs.slice(0, 2); b.runs = b.runs.slice(2); b.runs[0].runId = a.runs[0].runId;
  const r = buildReport([JSON.stringify(a), JSON.stringify(b)]); assert.ok(r.comparisons[0].reasons.includes('DUPLICATE_RUN_ID_ACROSS_INPUTS'));
});
test('declared harm without receipts makes a native comparison incomplete', () => { const r = fixture(); r.runs[1].declaredOutcome = 'HARM_REACHED'; assert.equal(report(r).summary.boundedSupportedComparisons, 0); });

test('a fault injection excludes an otherwise complete four-arm set from prevention support', () => {
  const raw = fixture(); add(raw.runs[1], 'fault.injected', 'runner', { code: 'receiver-unavailable' });
  const result = report(raw);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.summary.boundedSupportedComparisons, 0);
});
