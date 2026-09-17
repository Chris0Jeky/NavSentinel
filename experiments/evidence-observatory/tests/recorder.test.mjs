import test from 'node:test';
import assert from 'node:assert/strict';
import * as recording from '../recorder.mjs';
import { buildReport } from '../model.mjs';

const identity = { repositoryHead: 'a'.repeat(40), extensionSha256: 'b'.repeat(64), fixtureSha256: 'c'.repeat(64), browserVersion: '143.0.1', profile: 'interaction-only', seed: 'unit-1' };
const provenance = { sourceTree: 'd'.repeat(40), inputsBefore: 'e'.repeat(64), inputsAfter: 'e'.repeat(64), artifactAfter: 'b'.repeat(64), lockSha256: 'f'.repeat(64), settingsSha256: 'a'.repeat(64), rawVerified: true };
const context = { pageId: 'page-1', frameId: 'frame-1', documentId: 'doc-1', parentFrameId: null };
function makeRecorder(overrides = {}) {
  assert.equal(typeof recording.createRunRecorder, 'function');
  let now = 0;
  const recorder = recording.createRunRecorder({ runId: 'unit-protected', arm: 'protected', contextId: 'unit-context', harmTargetId: 'harm', benignTargetId: 'benign', clock: () => now, requiredMs: 1000, ...overrides });
  return { recorder, setTime(value) { now = value; } };
}
const health = (seq, overrides = {}) => ({ healthy: true, healthSequence: seq, receiptCount: 0, invalidAttempts: 0, observerErrors: 0, targetUses: { harm: 0, benign: 0 }, ...overrides });
function trace(run) {
  return { schema: 'navsentinel.observatory.trace.v2', mode: 'synthetic', campaignId: 'unit', scenarioId: 'NS-ADV-UI-004', variantId: 'base', identity, provenance, runs: [run] };
}
function completed() {
  const { recorder: r, setTime } = makeRecorder();
  r.health('start', health(1));
  r.record('page', 'attack.attempt', { context, code: 'layer-appended', sourceClock: { id: 'doc-1', timeMs: 30 } });
  r.record('extension', 'decision.block', { code: 'overlay-dismissed' });
  r.record('runner', 'input.dispatched');
  setTime(1100); r.health('end', health(2));
  return r.finish({ completed: true, extensionReady: true, trustedInput: true, egressFenced: true });
}
test('recorder creates a complete terminal trace without inventing receipts', () => {
  const result = buildReport([JSON.stringify(trace(completed()))]);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.cases[0].gaps, []);
  assert.equal(result.cases[0].facts.harmReceipts, 0);
  assert.equal(result.cases[0].assessment, 'INCONCLUSIVE');
});
test('all clocks and sequence IDs are assigned by the recorder', () => {
  const { recorder: r, setTime } = makeRecorder();
  setTime(10); r.record('page', 'attack.attempt', { context });
  assert.throws(() => r.record('page', 'sink.receipt'), /PROVENANCE/);
  const run = r.finish({ completed: false });
  assert.deepEqual(run.events.map(e => e.sequence), run.events.map((_, i) => i + 1));
  assert.equal(run.events.at(-1).kind, 'observation.end');
});
test('late writes cannot mutate a finished run or previously returned snapshots', () => {
  const { recorder: r } = makeRecorder();
  const a = r.finish({ completed: false }); a.events[0].kind = 'broken';
  assert.notEqual(r.finish({ completed: false }).events[0].kind, 'broken');
  assert.throws(() => r.record('runner', 'input.dispatched'), /CLOSED/);
});
test('bounded page flood retains receiver harm and terminal drop count', () => {
  const { recorder: r, setTime } = makeRecorder({ maxEvents: 12 });
  for (let i = 0; i < 30; i++) r.record('page', 'attack.attempt', { code: 'flood' });
  setTime(1100);
  r.receipt({ sequence: 1, runId: 'unit-protected', scenarioId: 'NS-ADV-UI-004', role: 'attack', consequence: 'wrong-target-navigation', targetId: 'harm', method: 'GET', sentinelSha256: '9'.repeat(64) });
  const run = r.finish({ completed: true });
  assert.ok(run.events.length <= 12);
  assert.ok(run.observer.droppedEvents > 0);
  assert.equal(run.events.filter(e => e.kind === 'sink.receipt').length, 1);
  assert.equal(run.events.at(-1).kind, 'observation.end');
});
test('clock regression creates an explicit gap instead of reversed timestamps', () => {
  const { recorder: r, setTime } = makeRecorder();
  setTime(20); r.record('runner', 'input.dispatched'); setTime(10); r.record('page', 'attack.attempt');
  const run = r.finish({ completed: false });
  assert.ok(run.capture.faults.includes('CLOCK_REGRESSION'));
  assert.ok(run.events.every((e, i) => i === 0 || e.elapsedMs >= run.events[i-1].elapsedMs));
});
for (const [name, mutate] of [
  ['sink died', r => { r.capture.endHealth.healthy = false; }],
  ['target already spent', r => { r.capture.startHealth.targetUses.harm = 1; }],
  ['receiver rejected an attempt', r => { r.capture.endHealth.invalidAttempts = 1; }],
  ['callback loss', r => { r.capture.endHealth.observerErrors = 1; }],
  ['readiness unavailable', r => { r.observer.extensionReady = false; }],
  ['unexpected primary frame detach', r => { r.capture.faults.push('PRIMARY_FRAME_DETACHED'); }],
  ['worker epoch changed', r => { r.capture.faults.push('WORKER_EPOCH_CHANGED'); }],
  ['health challenge never advanced', r => { r.capture.endHealth.healthSequence = r.capture.startHealth.healthSequence; }],
]) test(`${name} makes negative evidence incomplete`, () => {
  const run = completed(); mutate(run);
  const result = buildReport([JSON.stringify(trace(run))]);
  assert.equal(result.rejected.length, 0);
  assert.ok(result.cases[0].gaps.length > 0);
});
test('source mutation never earns native v2 support', () => {
  const raw = trace(completed()); raw.provenance = { ...raw.provenance, inputsAfter: 'f'.repeat(64) };
  const r = buildReport([JSON.stringify(raw)]); assert.equal(r.rejected.length, 0); assert.ok(r.cases[0].gaps.includes('SOURCE_INPUTS_CHANGED'));
});
test('unknown or unsafe metadata is rejected rather than exported', () => {
  const raw = trace(completed()); raw.runs[0].events[0].context = { ...context, url: 'https://private.invalid/?secret=x' };
  const r = buildReport([JSON.stringify(raw)]); assert.equal(r.rejected.length, 1); assert.ok(!JSON.stringify(r).includes('private.invalid'));
});
test('frame identity and source-local clock survive projection', () => {
  const r = buildReport([JSON.stringify(trace(completed()))]);
  const e = r.cases[0].events.find(e => e.kind === 'attack.attempt');
  assert.deepEqual(e.data.context, context); assert.deepEqual(e.data.sourceClock, { id: 'doc-1', timeMs: 30 });
});
