import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunRecorder, TRACE_V2 } from '../recorder.mjs';
const api = await import('../fault-contract.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const ids = ['receiver-unavailable', 'primary-frame-detached', 'primary-document-replaced', 'worker-restarted', 'page-report-flood', 'receiver-observer-error'];
function fixture(faultId) {
  let now = 0;
  const arm = ['page-report-flood', 'receiver-observer-error'].includes(faultId) ? 'baseline' : 'protected';
  const r = createRunRecorder({ runId: `run-${faultId}`, arm, contextId: `context-${faultId}`, harmTargetId: 'harm', benignTargetId: 'benign', maxEvents: faultId === 'page-report-flood' ? 24 : 128, clock: () => now, requiredMs: 1000 });
  const health = { healthy: true, healthSequence: 1, receiptCount: 0, invalidAttempts: 0, observerErrors: 0, targetUses: { harm: 0, benign: 0 } };
  r.health('start', health);
  const context = { pageId: 'fixture-page', frameId: 'primary', documentId: 'doc-1', parentFrameId: 'top' };
  r.record('browser', 'navigation.committed', { context, frame: 'child' });
  r.record('page', 'attack.attempt'); r.record('runner', 'input.dispatched');
  now = 100; r.record('runner', 'fault.injected', { code: faultId, context, frame: 'child' });
  const end = structuredClone(health); end.healthSequence++;
  if (faultId === 'receiver-unavailable') end.healthy = false;
  if (faultId === 'primary-frame-detached') { r.record('browser', 'frame.detached', { context, frame: 'child' }); r.gap('PRIMARY_FRAME_DETACHED'); }
  if (faultId === 'primary-document-replaced') { r.record('browser', 'navigation.committed', { context: { ...context, documentId: 'doc-2' }, frame: 'child' }); r.gap('PRIMARY_FRAME_NAVIGATED'); }
  if (faultId === 'worker-restarted') { r.record('browser', 'worker.stopped'); r.gap('WORKER_EPOCH_CHANGED'); r.record('browser', 'worker.restarted'); }
  if (faultId === 'page-report-flood') for (let i = 0; i < 100; i++) r.record('page', 'dom.changed', { code: 'display-rewritten' });
  if (arm === 'baseline') {
    r.receipt({ sequence: 1, runId: `run-${faultId}`, scenarioId: 'NS-ADV-UI-004', targetId: 'harm', method: 'GET', role: 'attack', consequence: 'wrong-target-navigation', sentinelSha256: '1'.repeat(64) });
    end.receiptCount = 1; end.targetUses.harm = 1;
  }
  if (faultId === 'receiver-observer-error') end.observerErrors = 1;
  now = 1200; r.health('end', end);
  return { schema: TRACE_V2, mode: 'synthetic', campaignId: 'fault-unit', scenarioId: 'NS-ADV-UI-004', variantId: `fault-${faultId}`,
    identity: { repositoryHead: 'a'.repeat(40), extensionSha256: 'b'.repeat(64), fixtureSha256: 'c'.repeat(64), browserVersion: '143.0.1', profile: 'interaction-only', seed: 'unit-fault' },
    provenance: { sourceTree: 'd'.repeat(40), inputsBefore: 'e'.repeat(64), inputsAfter: 'e'.repeat(64), artifactAfter: 'b'.repeat(64), lockSha256: 'f'.repeat(64), settingsSha256: 'a'.repeat(64), rawVerified: true },
    runs: [r.finish({ completed: true, extensionReady: arm !== 'baseline', trustedInput: true, egressFenced: true })] };
}
function check(raw) { assert.equal(typeof api.assessFaultTrace, 'function', 'fault qualification API must exist'); return api.assessFaultTrace(raw); }
for (const id of ids) test(`${id} qualifies the observer check without qualifying prevention`, () => {
  const result = check(fixture(id));
  assert.equal(result.status, 'FAULT_DETECTED', JSON.stringify(result));
  assert.equal(result.preventionSupported, false);
});
for (const id of ids) test(`${id} announcement without consequence is not confirmation`, () => {
  const raw = fixture('receiver-unavailable'); raw.variantId = `fault-${id}`;
  raw.runs[0].events.find(e => e.kind === 'fault.injected').code = id;
  raw.runs[0].capture.endHealth.healthy = true;
  raw.runs[0].observer.sinkHealthyEnd = true;
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
test('an unrelated injected fault cannot satisfy a different fault test', () => {
  const raw = fixture('primary-frame-detached'); raw.variantId = 'fault-worker-restarted';
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
test('stale source identity is not accepted as fault qualification', () => {
  const raw = fixture('receiver-unavailable'); raw.provenance.rawVerified = false;
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
test('demo evidence is never an executed fault qualification', () => {
  const raw = fixture('receiver-unavailable'); raw.mode = 'demo';
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
test('unrelated frame detachment cannot satisfy primary-frame evidence', () => {
  const raw = fixture('primary-frame-detached'); raw.runs[0].events.find(e => e.kind === 'frame.detached').context.frameId = 'unrelated-frame';
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
test('post-hoc injection cannot adopt an earlier worker restart', () => {
  const raw = fixture('worker-restarted'), events = raw.runs[0].events;
  const injection = events.find(e => e.kind === 'fault.injected');
  events.splice(events.indexOf(injection), 1); events.splice(events.length - 1, 0, injection);
  events.forEach((e, i) => { e.sequence = i + 1; e.elapsedMs = i; }); raw.runs[0].observer.endedMs = events.at(-1).elapsedMs;
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
test('full matrix requires exactly one trial per fault and rejects duplication', () => {
  assert.equal(typeof api.checkFaultMatrix, 'function');
  assert.equal(api.checkFaultMatrix(ids.map(fixture)).passed, true);
  assert.equal(api.checkFaultMatrix(ids.slice(1).map(fixture)).passed, false);
  assert.equal(api.checkFaultMatrix([...ids.map(fixture), fixture(ids[0])]).passed, false);
  assert.equal(api.checkFaultMatrix([...ids.map(fixture), {}]).passed, false);
});
test('unknown fault identifiers and malformed traces are explicit failures', () => {
  assert.equal(check({}).status, 'FAULT_NOT_ESTABLISHED');
  const raw = fixture('receiver-unavailable'); raw.variantId = 'fault-arbitrary';
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});

for (const [name, mutate] of [
  ['runner failure after the intended fault', raw => { raw.runs[0].completed = false; raw.runs[0].declaredOutcome = 'TEST_INVALID'; }],
  ['unrelated runner fault category', raw => raw.runs[0].capture.faults.push('RUNNER_FAILED')],
  ['additional unexpected page error', raw => raw.runs[0].capture.faults.push('PAGE_ERROR')],
]) test(`${name} prevents fault qualification`, () => {
  const raw = fixture('primary-frame-detached'); mutate(raw);
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
test('a known sibling frame cannot stand in for the injected primary target', () => {
  const raw = fixture('primary-frame-detached');
  raw.runs[0].events.find(e => e.kind === 'fault.injected').context.frameId = 'different-primary';
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
test('callback failure requires a consequence after this injection', () => {
  const raw = fixture('receiver-observer-error'), events = raw.runs[0].events;
  const injection = events.find(e => e.kind === 'fault.injected'), receipt = events.find(e => e.kind === 'sink.receipt');
  const i = events.indexOf(injection), j = events.indexOf(receipt);
  [events[i], events[j]] = [receipt, injection];
  events.forEach((e, index) => { e.sequence = index + 1; });
  assert.equal(check(raw).status, 'FAULT_NOT_ESTABLISHED');
});
