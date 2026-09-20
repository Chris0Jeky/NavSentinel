import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRunCapture } from '../capture-v2.mjs';

const health = (healthSequence, targetUses, receiptCount = 0) => ({
  healthy: true,
  healthSequence,
  receiptCount,
  invalidAttempts: 0,
  observerErrors: 0,
  targetUses,
});

function run() {
  return {
    runId: 'protected-run',
    arm: 'protected',
    observer: { endedMs: 2500, requiredMs: 1000 },
    events: [
      { kind: 'input.dispatched', elapsedMs: 1000 },
    ],
    capture: {
      contextId: 'context-1',
      instrumentation: 'full',
      harmTargetId: 'harm-target',
      benignTargetId: 'benign-target',
      baselineMode: 'enabled',
      startHealth: health(1, { 'harm-target': 0, 'benign-target': 0 }),
      endHealth: health(2, { 'harm-target': 0, 'benign-target': 0 }),
      faults: [],
    },
  };
}

test('a coherent two-authority receiver capture remains complete', () => {
  assert.deepEqual(validateRunCapture(run(), 'scenario-1').gaps, []);
});

test('an undeclared receiver authority makes the capture incomplete even when unused', () => {
  const input = run();
  input.capture.endHealth.targetUses['shadow-target'] = 0;

  const { gaps } = validateRunCapture(input, 'scenario-1');
  assert.ok(gaps.includes('RECEIVER_AUTHORITY_SET_DISAGREES'));
});

test('receiver target-use totals must account for the reported receipt count', () => {
  const input = run();
  input.capture.endHealth.targetUses['shadow-target'] = 1;

  const { gaps } = validateRunCapture(input, 'scenario-1');
  assert.ok(gaps.includes('RECEIVER_HEALTH_ACCOUNTING_DISAGREES'));
});
