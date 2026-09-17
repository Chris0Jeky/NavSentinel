import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
const api = await import('../worker-snapshot.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const scriptURL = 'chrome-extension://abcdefghijklmnop/service-worker-loader.js';
class Session extends EventEmitter {
  constructor(mode = 'valid') { super(); this.mode = mode; this.calls = []; }
  async send(method, params = {}) {
    this.calls.push({ method, params });
    if (method === 'Target.getTargets') return { targetInfos: this.mode === 'missing' ? [] : [
      { targetId: 'worker-target', type: this.mode === 'wrong-type' ? 'page' : 'service_worker', url: scriptURL },
      ...(this.mode === 'ambiguous' ? [{ targetId: 'duplicate', type: 'service_worker', url: scriptURL }] : []),
    ] };
    if (method === 'Target.attachToTarget') return { sessionId: 'attached-worker' };
    if (method === 'Target.sendMessageToTarget') {
      const request = JSON.parse(params.message);
      if (this.mode === 'silence') return {};
      if (this.mode === 'send-error') throw new Error('Private protocol message');
      queueMicrotask(() => {
        if (this.mode === 'detached') { this.emit('Target.detachedFromTarget', { sessionId: 'attached-worker' }); return; }
        const value = { extensionId: 'abcdefghijklmnop', scriptURL, epoch: null,
          decisions: [{ code: this.mode === 'bad-code' ? 'private data' : 'overlay-suppressed' }] };
        if (this.mode === 'wrong-realm') value.extensionId = 'other';
        if (this.mode === 'wrong-script') value.scriptURL += '?changed';
        const response = this.mode === 'protocol-error' ? { id: request.id, error: { message: 'Private protocol message' } } :
          { id: request.id, result: { result: { value }, ...(this.mode === 'exception' ? { exceptionDetails: { text: 'Private exception' } } : {}) } };
        // An unrelated CDP session cannot fulfill this response.
        this.emit('Target.receivedMessageFromTarget', { sessionId: 'unrelated', message: JSON.stringify({ id: request.id, result: { result: { value: {} } } }) });
        this.emit('Target.receivedMessageFromTarget', { sessionId: 'attached-worker', message: JSON.stringify(response) });
      });
    }
    return {};
  }
}
function read(session, options = {}) { assert.equal(typeof api.readWorkerSnapshot, 'function'); return api.readWorkerSnapshot(session, scriptURL, options); }
test('reads fixed metadata from the exact extension target without using a Playwright Worker handle', async () => {
  const s = new Session(), result = await read(s);
  assert.deepEqual(result, { epoch: null, decisions: [{ code: 'overlay-suppressed' }] });
  const sent = JSON.parse(s.calls.find(c => c.method === 'Target.sendMessageToTarget').params.message);
  assert.equal(sent.method, 'Runtime.evaluate'); assert.equal(sent.params.returnByValue, true); assert.equal(sent.params.awaitPromise, true);
  assert.ok(sent.params.expression.includes('chrome.storage.local.get'));
  assert.equal(s.calls.filter(c => c.method === 'Target.detachFromTarget').length, 1);
  assert.equal(s.listenerCount('Target.receivedMessageFromTarget'), 0);
});
for (const mode of ['missing', 'ambiguous', 'wrong-type', 'wrong-realm', 'wrong-script', 'bad-code', 'protocol-error', 'exception', 'detached', 'send-error', 'silence']) {
  test(`worker snapshot rejects ${mode} and detaches its own session`, async () => {
    const s = new Session(mode);
    await assert.rejects(() => read(s, { timeoutMs: 20 }), /WORKER_/);
    assert.equal(s.listenerCount('Target.receivedMessageFromTarget'), 0);
    assert.equal(s.listenerCount('Target.detachedFromTarget'), 0);
    assert.equal(s.calls.filter(c => c.method === 'Target.detachFromTarget').length, ['missing', 'ambiguous', 'wrong-type'].includes(mode) ? 0 : 1);
  });
}
test('refuses arbitrary non-extension scripts before target discovery', async () => {
  assert.equal(typeof api.readWorkerSnapshot, 'function'); const s = new Session();
  await assert.rejects(() => api.readWorkerSnapshot(s, 'https://example.com/worker.js'), /WORKER_SCOPE/); assert.deepEqual(s.calls, []);
});
