import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunRecorder } from '../recorder.mjs';
function setup(maxEvents = 64) {
  let now = 0;
  const recorder = createRunRecorder({ runId: 'fault-unit', arm: 'protected', contextId: 'context', harmTargetId: 'harm', benignTargetId: 'benign', maxEvents, clock: () => now });
  return { recorder, at(value) { now = value; } };
}
test('faults have timestamped timeline events rather than only terminal strings', () => {
  const { recorder, at } = setup(); at(150);
  recorder.gap('PRIMARY_FRAME_DETACHED');
  const run = recorder.finish();
  assert.deepEqual(run.events.filter(e => e.kind === 'observer.gap').map(e => [e.code, e.elapsedMs]), [['PRIMARY_FRAME_DETACHED', 150]]);
});
test('repeated same fault is bounded and does not obscure the first occurrence', () => {
  const { recorder, at } = setup(); at(10); recorder.gap('WORKER_EPOCH_CHANGED'); at(100);
  for (let i = 0; i < 1000; i++) recorder.gap('WORKER_EPOCH_CHANGED');
  const run = recorder.finish();
  assert.equal(run.events.filter(e => e.kind === 'observer.gap').length, 1);
  assert.deepEqual(run.capture.faults, ['WORKER_EPOCH_CHANGED']);
  assert.equal(run.observer.droppedEvents, 0);
});
test('unrecognized fault text is refused before storing arbitrary diagnostic strings', () => {
  const { recorder } = setup();
  assert.throws(() => recorder.gap('a-private-value'), /FAULT_CODE_INVALID/);
  assert.deepEqual(recorder.finish().capture.faults, []);
});
test('full ordinary buffer retains gap event, harm receipt and terminal record', () => {
  const { recorder, at } = setup(16);
  for (let i = 0; i < 100; i++) recorder.record('page', 'dom.changed', { code: 'display-rewritten' });
  at(100); recorder.gap('PRIMARY_FRAME_DETACHED');
  recorder.receipt({ sequence: 1, runId: 'fault-unit', scenarioId: 'NS-ADV-UI-004', role: 'attack', consequence: 'wrong-target-navigation', targetId: 'harm', method: 'GET', sentinelSha256: '9'.repeat(64) });
  const run = recorder.finish();
  assert.ok(run.events.length <= 16);
  assert.equal(run.events.filter(e => e.kind === 'observer.gap').length, 1);
  assert.equal(run.events.filter(e => e.kind === 'sink.receipt').length, 1);
  assert.equal(run.events.at(-1).kind, 'observation.end');
  assert.ok(run.observer.droppedEvents > 0);
});

test('multiple gap events cannot consume the reserved harm receipt slot', () => {
  const { recorder } = setup(16);
  for (let i = 0; i < 100; i++) recorder.record('page', 'attack.attempt', { code: 'flood' });
  for (const code of [
    'PRIMARY_FRAME_DETACHED', 'PRIMARY_FRAME_NAVIGATED', 'WORKER_EPOCH_CHANGED',
    'PRODUCT_OBSERVER_FAILED', 'PAGE_REPORT_REJECTED', 'PAGE_ERROR', 'SCENE_SAMPLE_FAILED',
  ]) recorder.gap(code);
  recorder.receipt({ sequence: 1, runId: 'fault-unit', scenarioId: 'NS-ADV-UI-004', role: 'attack', consequence: 'wrong-target-navigation', targetId: 'harm', method: 'GET', sentinelSha256: '9'.repeat(64) });
  const run = recorder.finish({ completed: true });
  assert.equal(run.events.filter(e => e.kind === 'sink.receipt' && e.consequence === 'harm').length, 1);
  assert.equal(run.events.at(-1).kind, 'observation.end');
  assert.ok(run.observer.droppedEvents > 0);
});
