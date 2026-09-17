/** Native recorder metadata contract. No arbitrary strings, URLs, DOM or payloads. */
export const TRACE_V2 = 'navsentinel.observatory.trace.v2';
export const EVENT_SOURCES = Object.freeze({
  'run.start': 'runner', 'input.dispatched': 'runner', 'observation.end': 'runner', 'observer.gap': 'runner',
  'observer.health': 'runner', 'fault.injected': 'runner', 'worker.stopped': 'browser', 'worker.restarted': 'browser', 'attack.intent': 'page', 'attack.attempt': 'page', 'dom.changed': 'page',
  'decision.block': 'extension', 'decision.allow': 'extension', 'decision.warn': 'extension', 'decision.hold': 'extension', 'decision.rollback': 'extension',
  'navigation.committed': 'browser', 'navigation.restored': 'browser', 'request.observed': 'browser',
  'control.completed': 'browser', 'sink.receipt': 'sink', 'scene.sample': 'browser', 'frame.attached': 'browser', 'frame.detached': 'browser',
});
const validToken = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(x);
const hex = (x, length = 64) => typeof x === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(x);
const num = (x, max = 1000000) => Number.isSafeInteger(x) && x >= 0 && x <= max;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function fields(x, allowed) { if (!object(x) || Object.keys(x).some(k => !allowed.includes(k))) throw new Error('CAPTURE_FIELDS_INVALID'); }
function requireThat(ok, code) { if (!ok) throw new Error(code); }
export const FAULT_CODES = Object.freeze(['CLOCK_REGRESSION', 'CRITICAL_EVENT_OVERFLOW', 'PRIMARY_FRAME_DETACHED', 'PRIMARY_FRAME_NAVIGATED', 'WORKER_EPOCH_CHANGED', 'PRODUCT_OBSERVER_FAILED', 'PAGE_REPORT_REJECTED', 'PAGE_ERROR', 'SCENE_SAMPLE_FAILED', 'EGRESS_ATTEMPT', 'RECEIVER_BINDING_MISMATCH', 'RUNNER_FAILED', 'SOURCE_CHANGED', 'RECEIVER_COUNTER_MISMATCH']);

export function validateEventMetadata(e) {
  const output = {};
  if (e.context !== undefined) {
    fields(e.context, ['pageId', 'frameId', 'documentId', 'parentFrameId']);
    requireThat(['pageId', 'frameId', 'documentId'].every(k => validToken(e.context[k])) &&
      (e.context.parentFrameId === null || validToken(e.context.parentFrameId)), 'FRAME_CONTEXT_INVALID');
    requireThat(e.context.parentFrameId !== e.context.frameId, 'FRAME_CONTEXT_INVALID');
    output.context = { ...e.context };
  }
  if (e.sourceClock !== undefined) {
    fields(e.sourceClock, ['id', 'timeMs']);
    requireThat(validToken(e.sourceClock.id) && typeof e.sourceClock.timeMs === 'number' && Number.isFinite(e.sourceClock.timeMs) &&
      e.sourceClock.timeMs >= 0 && e.sourceClock.timeMs <= 86400000, 'SOURCE_CLOCK_INVALID');
    output.sourceClock = { ...e.sourceClock };
  }
  if (e.receiver !== undefined) {
    fields(e.receiver, ['runId', 'scenarioId', 'targetId', 'sentinelSha256', 'method', 'role']);
    requireThat(['runId', 'scenarioId', 'targetId'].every(k => validToken(e.receiver[k])) && hex(e.receiver.sentinelSha256) &&
      e.receiver.method === 'GET' && ['attack', 'benign', 'mixed'].includes(e.receiver.role), 'RECEIVER_METADATA_INVALID');
    output.receiver = { ...e.receiver };
  }
  if (e.scene !== undefined) {
    fields(e.scene, ['width', 'height', 'boxes']);
    requireThat(num(e.scene.width, 8192) && e.scene.width > 0 && num(e.scene.height, 8192) && e.scene.height > 0 &&
      Array.isArray(e.scene.boxes) && e.scene.boxes.length <= 16, 'SCENE_INVALID');
    const ids = new Set();
    output.scene = { width: e.scene.width, height: e.scene.height, boxes: e.scene.boxes.map(box => {
      fields(box, ['id', 'frameId', 'documentId', 'parentFrameId', 'kind', 'state', 'x', 'y', 'width', 'height', 'declaredTarget', 'effectiveTarget', 'targetScope']);
      requireThat(['id', 'frameId', 'documentId'].every(k => validToken(box[k])) && !ids.has(box.id) &&
        (box.parentFrameId === null || validToken(box.parentFrameId)), 'SCENE_ID_INVALID'); ids.add(box.id);
      requireThat(['frame', 'control', 'attack'].includes(box.kind) && ['visible', 'hidden', 'absent'].includes(box.state), 'SCENE_KIND_INVALID');
      requireThat(['x', 'y', 'width', 'height'].every(k => Number.isInteger(box[k]) && Math.abs(box[k]) <= 16384) && box.width >= 0 && box.height >= 0, 'SCENE_GEOMETRY_INVALID');
      const targets = ['harm-receiver', 'benign-receiver', 'same-document', 'none', 'unknown'];
      requireThat(targets.includes(box.declaredTarget) && targets.includes(box.effectiveTarget) &&
        ['new-context', 'current-context', 'none', 'unknown'].includes(box.targetScope), 'SCENE_TARGET_INVALID');
      return { ...box };
    }) };
  }
  return output;
}
function health(value) {
  if (value === null) return null;
  fields(value, ['healthy', 'healthSequence', 'receiptCount', 'invalidAttempts', 'observerErrors', 'targetUses']);
  requireThat(typeof value.healthy === 'boolean' && ['healthSequence', 'receiptCount', 'invalidAttempts', 'observerErrors'].every(k => num(value[k])) &&
    object(value.targetUses) && Object.keys(value.targetUses).length <= 8 && Object.entries(value.targetUses).every(([k,v]) => validToken(k) && num(v)), 'HEALTH_INVALID');
  return structuredClone(value);
}
export function validateProvenance(value) {
  fields(value, ['sourceTree', 'inputsBefore', 'inputsAfter', 'artifactAfter', 'lockSha256', 'settingsSha256', 'rawVerified']);
  requireThat(hex(value.sourceTree, 40) && ['inputsBefore', 'inputsAfter', 'artifactAfter', 'lockSha256', 'settingsSha256'].every(k => hex(value[k])) &&
    typeof value.rawVerified === 'boolean', 'PROVENANCE_INVALID');
  return { ...value };
}
export function validateRunCapture(run, scenarioId) {
  const value = run.capture;
  fields(value, ['contextId', 'instrumentation', 'harmTargetId', 'benignTargetId', 'baselineMode', 'startHealth', 'endHealth', 'faults']);
  requireThat(['contextId', 'harmTargetId', 'benignTargetId'].every(k => validToken(value[k])) && value.harmTargetId !== value.benignTargetId &&
    ['full', 'minimal'].includes(value.instrumentation) && ['extension-absent', 'enabled'].includes(value.baselineMode), 'RUN_CAPTURE_INVALID');
  requireThat(Array.isArray(value.faults) && value.faults.length <= 32 && value.faults.every(c => FAULT_CODES.includes(c)), 'FAULT_CODE_INVALID');
  const startHealth = health(value.startHealth), endHealth = health(value.endHealth);
  const gaps = [...value.faults];
  if (!startHealth?.healthy || !endHealth?.healthy) gaps.push('RECEIVER_HEALTH_INCOMPLETE');
  if (!(startHealth?.healthSequence > 0 && endHealth?.healthSequence > startHealth.healthSequence)) gaps.push('HEALTH_CHALLENGE_NOT_ADVANCED');
  if (startHealth?.receiptCount !== 0 || [value.harmTargetId, value.benignTargetId].some(id => startHealth?.targetUses[id] !== 0)) gaps.push('RECEIVER_TARGET_NOT_FRESH');
  if (startHealth?.invalidAttempts !== 0 || endHealth?.invalidAttempts !== 0) gaps.push('RECEIVER_REJECTED_ATTEMPTS');
  if (startHealth?.observerErrors !== 0 || endHealth?.observerErrors !== 0) gaps.push('RECEIVER_OBSERVER_LOSS');
  if (run.arm === 'baseline' ? value.baselineMode !== 'extension-absent' : value.baselineMode !== 'enabled') gaps.push('BASELINE_MODE_DISAGREES');
  const receipts = run.events.filter(e => e.kind === 'sink.receipt');
  if (endHealth?.receiptCount !== receipts.length) gaps.push('RECEIVER_EVENT_COUNT_DISAGREES');
  const uses = new Map();
  for (const e of receipts) {
    const r = e.receiver;
    const target = e.consequence === 'harm' ? value.harmTargetId : value.benignTargetId;
    if (!r || r.targetId !== target || r.runId !== run.runId || r.scenarioId !== scenarioId ||
      r.role !== (run.arm === 'mixed' ? 'mixed' : e.consequence === 'benign' ? 'benign' : 'attack')) throw new Error('RECEIVER_BINDING_MISMATCH');
    uses.set(target, (uses.get(target) ?? 0) + 1);
  }
  for (const id of [value.harmTargetId, value.benignTargetId]) {
    if (endHealth?.targetUses[id] !== (uses.get(id) ?? 0) || (uses.get(id) ?? 0) > 1) gaps.push('RECEIVER_AUTHORITY_COUNT_DISAGREES');
  }
  const input = run.events.filter(e => e.kind === 'input.dispatched').at(-1);
  if (!input || run.observer.endedMs - input.elapsedMs < run.observer.requiredMs) gaps.push('POST_INPUT_WINDOW_INCOMPLETE');
  return { value: { ...value, startHealth, endHealth, faults: [...value.faults] }, gaps };
}
