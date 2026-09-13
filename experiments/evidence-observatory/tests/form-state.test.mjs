import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFormIntent } from '../form-state.mjs';
const event = (kind, source = 'page') => ({ kind, source });
const sample = (eventIndex, phase, action) => ({ eventIndex, eventId: `e${eventIndex + 1}`, phase, intent: { action } });
const fixture = () => ({ events: [event('run.start', 'runner'), event('form.intent'), event('form.intent'), event('form.intent'), event('form.intent')],
  formEvidence: { snapshots: [sample(1, 'input', 'harm'), sample(2, 'operation', 'harm'), sample(3, 'input', 'benign'), sample(4, 'operation', 'benign')] } });
test('future form snapshots cannot appear at the run boundary', () => assert.equal(selectFormIntent(fixture(), 0), null));
test('the latest independent input anchors a later operation', () => {
  const state = selectFormIntent(fixture(), 4);
  assert.equal(state.earlier.eventIndex, 3); assert.equal(state.current.eventIndex, 4);
});
test('a previous operation stays linked to its own earlier interaction', () => {
  const state = selectFormIntent(fixture(), 2); assert.equal(state.earlier.eventIndex, 1);
});
test('navigation clears the current document interval', () => {
  const c = fixture(); c.events[3] = event('navigation.committed', 'browser'); c.formEvidence.snapshots = c.formEvidence.snapshots.slice(0, 2);
  assert.equal(selectFormIntent(c, 4), null);
});
test('new snapshots after navigation do not adopt an earlier document input', () => {
  const c = fixture(); c.events[3] = event('navigation.committed', 'browser'); c.formEvidence.snapshots.splice(2, 1);
  const state = selectFormIntent(c, 4); assert.equal(state.earlier.eventIndex, 4);
});
test('selector snapshots are independent immutable copies for callers', () => {
  const c = fixture(), state = selectFormIntent(c, 2); state.current.intent.action = 'forged'; assert.equal(c.formEvidence.snapshots[1].intent.action, 'harm');
});
test('empty and out-of-range selections remain absent', () => {
  assert.equal(selectFormIntent({}, 0), null); assert.equal(selectFormIntent(fixture(), -1), null); assert.equal(selectFormIntent(fixture(), 99), null);
});
