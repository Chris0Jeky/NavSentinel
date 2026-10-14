import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readWorkerSnapshot } from '../worker-snapshot.mjs';

const scriptURL = 'chrome-extension://abcdefghijklmnop/service-worker-loader.js';

class DetachFailsSession extends EventEmitter {
  constructor(mode = 'valid') {
    super();
    this.mode = mode;
    this.detachCalls = 0;
  }

  async send(method, params = {}) {
    if (method === 'Target.getTargets') {
      return { targetInfos: [{ targetId: 'worker-target', type: 'service_worker', url: scriptURL }] };
    }
    if (method === 'Target.attachToTarget') return { sessionId: 'attached-worker' };
    if (method === 'Target.sendMessageToTarget') {
      const request = JSON.parse(params.message);
      queueMicrotask(() => {
        if (this.mode === 'detached') {
          this.emit('Target.detachedFromTarget', { sessionId: 'attached-worker' });
          return;
        }
        const value = { extensionId: 'abcdefghijklmnop', scriptURL, epoch: null,
          decisions: [{ code: 'overlay-suppressed' }] };
        this.emit('Target.receivedMessageFromTarget', { sessionId: 'attached-worker',
          message: JSON.stringify({ id: request.id, result: { result: { value } } }) });
      });
      return {};
    }
    if (method === 'Target.detachFromTarget') {
      this.detachCalls += 1;
      throw new Error('DETACH_FAILED');
    }
    return {};
  }
}

test('detach failure does not mask a successful snapshot', async () => {
  const s = new DetachFailsSession('valid');
  const result = await readWorkerSnapshot(s, scriptURL);
  assert.deepEqual(result, { epoch: null, decisions: [{ code: 'overlay-suppressed' }] });
  assert.equal(s.detachCalls, 1);
  assert.equal(s.listenerCount('Target.receivedMessageFromTarget'), 0);
  assert.equal(s.listenerCount('Target.detachedFromTarget'), 0);
});

test('detach failure does not mask WORKER_TARGET_DETACHED', async () => {
  const s = new DetachFailsSession('detached');
  await assert.rejects(() => readWorkerSnapshot(s, scriptURL, { timeoutMs: 20 }), /WORKER_TARGET_DETACHED/);
  assert.equal(s.detachCalls, 1);
});
