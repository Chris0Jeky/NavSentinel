/** Read-only, fixed-expression CDP view of one disposable extension worker realm.
 * The locked Playwright Worker object may retain a destroyed execution context
 * across ServiceWorker.stopWorker/startWorker. Do not use its object identity as
 * browser-native proof of a new realm. No imported expression or URL is executed.
 */
const snapshotExpression = `(${async function () {
  const stored = await chrome.storage.local.get('sentinelsuite:event_log_v1');
  const values = stored['sentinelsuite:event_log_v1'];
  return { extensionId: chrome.runtime.id, scriptURL: location.href,
    epoch: typeof globalThis.__nsObservatoryEpoch === 'string' ? globalThis.__nsObservatoryEpoch : null,
    decisions: (Array.isArray(values) ? values : []).filter(v => v.kind === 'mutation_alert' &&
      ['suppressed', 'reasserted'].includes(v.extra?.overlayCleanupOutcome)).slice(-64)
      .map(v => ({ code: `overlay-${v.extra.overlayCleanupOutcome}` })) };
}.toString()})();`;

export async function readWorkerSnapshot(root, scriptURL, { timeoutMs = 8000 } = {}) {
  let url;
  try { url = new URL(scriptURL); } catch { throw new Error('WORKER_SCOPE_INVALID'); }
  if (url.protocol !== 'chrome-extension:' || url.username || url.password || url.search || url.hash ||
      !/^[a-p]+$/.test(url.hostname) || url.pathname !== '/service-worker-loader.js') throw new Error('WORKER_SCOPE_INVALID');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000) throw new Error('WORKER_TIMEOUT_INVALID');
  const { targetInfos } = await root.send('Target.getTargets');
  const matches = targetInfos.filter(t => t.type === 'service_worker' && t.url === scriptURL);
  if (matches.length !== 1) throw new Error('WORKER_TARGET_MISSING_OR_AMBIGUOUS');
  // The pinned Chromium protocol supports this explicit non-flattened child
  // session. Public Playwright CDPSession.send cannot address a flattened child.
  // Keep this adapter separate: a future protocol retirement must fail visibly.
  const { sessionId } = await root.send('Target.attachToTarget', { targetId: matches[0].targetId, flatten: false });
  try {
    const response = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        root.off('Target.receivedMessageFromTarget', onMessage);
        root.off('Target.detachedFromTarget', onDetach);
        if (error) reject(error); else resolve(result);
      };
      const onDetach = event => { if (event.sessionId === sessionId) finish(new Error('WORKER_TARGET_DETACHED')); };
      const onMessage = event => {
        if (event.sessionId !== sessionId) return;
        if (typeof event.message !== 'string' || Buffer.byteLength(event.message) > 32768) { finish(new Error('WORKER_RESPONSE_INVALID')); return; }
        let message;
        try { message = JSON.parse(event.message); } catch { finish(new Error('WORKER_RESPONSE_INVALID')); return; }
        if (message.id !== 1) return;
        if (message.error || message.result?.exceptionDetails) finish(new Error('WORKER_EVALUATION_FAILED'));
        else finish(null, message.result?.result?.value);
      };
      const timer = setTimeout(() => finish(new Error('WORKER_RESPONSE_TIMEOUT')), timeoutMs);
      root.on('Target.receivedMessageFromTarget', onMessage);
      root.on('Target.detachedFromTarget', onDetach);
      Promise.resolve().then(() => root.send('Target.sendMessageToTarget', { sessionId,
        message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
          expression: snapshotExpression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
        } }) })).catch(() => finish(new Error('WORKER_PROTOCOL_FAILED')));
    });
    if (!response || response.extensionId !== url.hostname || response.scriptURL !== scriptURL ||
        !(response.epoch === null || typeof response.epoch === 'string' && /^[a-zA-Z0-9-]{1,96}$/.test(response.epoch)) ||
        !Array.isArray(response.decisions) || response.decisions.length > 64 ||
        response.decisions.some(d => !d || !['overlay-suppressed', 'overlay-reasserted'].includes(d.code))) throw new Error('WORKER_RESPONSE_INVALID');
    return { epoch: response.epoch, decisions: response.decisions.map(d => ({ code: d.code })) };
  } finally {
    await root.send('Target.detachFromTarget', { sessionId });
  }
}
