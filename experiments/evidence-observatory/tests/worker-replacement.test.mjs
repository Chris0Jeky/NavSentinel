import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReplacementWorker } from '../worker-replacement.mjs';

const scriptURL = 'chrome-extension://fixture/service-worker-loader.js';
const worker = (url = scriptURL) => ({ url: () => url });
test('a stopped worker still listed by Playwright is not its replacement', () => {
  const previous = worker();
  assert.equal(selectReplacementWorker([previous], previous, scriptURL), undefined);
});
test('replacement selection waits through unrelated worker creation', () => {
  const previous = worker(), unrelated = worker('chrome-extension://other/worker.js');
  assert.equal(selectReplacementWorker([previous, unrelated], previous, scriptURL), undefined);
});
test('replacement binds both new object identity and the exact script URL', () => {
  const previous = worker(), replacement = worker();
  assert.equal(selectReplacementWorker([previous, replacement], previous, scriptURL), replacement);
});
test('multiple new same-script candidates are ambiguous, not an arbitrary epoch', () => {
  const previous = worker();
  assert.equal(selectReplacementWorker([previous, worker(), worker()], previous, scriptURL), undefined);
});
