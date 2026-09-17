import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../campaign-plan.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
test('default and explicit lanes have distinct fixed configurations and output locations', () => {
  assert.equal(typeof api.selectLane, 'function');
  assert.equal(api.selectLane([]).id, 'overlay');
  assert.equal(new Set(['overlay','faults','challenges'].map(id => api.selectLane([id]).report)).size, 3);
});
test('no caller can select an arbitrary executable config, output path or test retry', () => {
  assert.equal(typeof api.selectLane, 'function');
  for (const args of [['../unsafe'], ['--retries=1'], ['faults','extra'], ['https://example.invalid']]) assert.throws(() => api.selectLane(args), /LANE_ARGUMENT_INVALID/);
});
test('challenge inputs are frozen and remain exactly the declared timing/viewport cases', () => {
  assert.equal(Array.isArray(api.CHALLENGES), true);
  assert.deepEqual(api.CHALLENGES.map(c => [c.id, c.clickDelayMs, c.viewport.width, c.viewport.height]), [
    ['narrow-reinsert-900', 900, 840, 760], ['wide-reinsert-2600', 2600, 1520, 1000],
  ]);
  assert.throws(() => { api.CHALLENGES[0].viewport.width = 1; }, TypeError);
  assert.throws(() => { api.CHALLENGES.push({}); }, TypeError);
});
