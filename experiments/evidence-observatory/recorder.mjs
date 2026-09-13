/** Bounded runner-side recorder. No browser globals, persistence or policy writes. */
import { performance } from 'node:perf_hooks';
import { EVENT_SOURCES, TRACE_V2, validateEventMetadata } from './capture-v2.mjs';

export { TRACE_V2 };
export function createRunRecorder({ runId, arm, contextId, harmTargetId, benignTargetId,
  scenarioId = 'NS-ADV-UI-004', requiredMs = 2300, instrumentation = 'full',
  clock = () => performance.now(), maxEvents = 2000 }) {
  if (!Number.isInteger(maxEvents) || maxEvents < 8 || maxEvents > 2000) throw new Error('EVENT_LIMIT_INVALID');
  const start = clock(); let last = 0, dropped = 0, closed = false, result;
  const events = [], faults = new Set(); let startHealth = null, endHealth = null;
  const stamp = () => {
    const value = Math.round(clock() - start);
    if (!Number.isFinite(value) || value < last) faults.add('CLOCK_REGRESSION');
    last = Number.isFinite(value) ? Math.max(last, value) : last;
    return last;
  };
  const record = (source, kind, extra = {}) => {
    if (closed) throw new Error('RECORDER_CLOSED');
    if (!Object.hasOwn(EVENT_SOURCES, kind) || EVENT_SOURCES[kind] !== source) throw new Error('EVENT_PROVENANCE_INVALID');
    const allowed = ['frame', 'causes', 'code', 'consequence', 'sinkSequence', 'context', 'sourceClock', 'scene', 'receiver'];
    if (!extra || Object.keys(extra).some(k => !allowed.includes(k))) throw new Error('EVENT_FIELDS_INVALID');
    validateEventMetadata(extra);
    const critical = ['sink.receipt', 'observation.end', 'observer.health'].includes(kind);
    const reserve = Math.min(8, Math.floor(maxEvents / 2));
    if (events.length >= maxEvents - (critical ? 1 : reserve) && kind !== 'observation.end') {
      dropped++; if (critical) faults.add('CRITICAL_EVENT_OVERFLOW'); return null;
    }
    const id = `${runId}-e${events.length + 1}`;
    const e = { id, sequence: events.length + 1, elapsedMs: stamp(), source, kind, frame: 'none', causes: [], ...structuredClone(extra) };
    events.push(e); return id;
  };
  record('runner', 'run.start');
  return {
    record,
    gap(code) { if (closed) throw new Error('RECORDER_CLOSED'); faults.add(code); },
    health(phase, value) {
      if (closed) throw new Error('RECORDER_CLOSED');
      if (!['start', 'end'].includes(phase) || (phase === 'start' ? startHealth : endHealth)) throw new Error('HEALTH_PHASE_INVALID');
      const snapshot = structuredClone(value);
      if (phase === 'start') startHealth = snapshot; else endHealth = snapshot;
      record('runner', 'observer.health', { code: `sink-health-${phase}` });
    },
    receipt(receipt) {
      const expectedRole = arm === 'mixed' ? 'mixed' : receipt.targetId === benignTargetId ? 'benign' : 'attack';
      if (receipt.runId !== runId || receipt.scenarioId !== scenarioId || receipt.role !== expectedRole || receipt.method !== 'GET' ||
          ![harmTargetId, benignTargetId].includes(receipt.targetId)) {
        faults.add('RECEIVER_BINDING_MISMATCH'); throw new Error('RECEIVER_BINDING_MISMATCH');
      }
      const consequence = receipt.targetId === harmTargetId ? 'harm' : 'benign';
      if (receipt.consequence !== (consequence === 'harm' ? 'wrong-target-navigation' : 'benign-navigation')) {
        faults.add('RECEIVER_BINDING_MISMATCH'); throw new Error('RECEIVER_BINDING_MISMATCH');
      }
      return record('sink', 'sink.receipt', { consequence, sinkSequence: receipt.sequence, receiver: {
        runId: receipt.runId, scenarioId: receipt.scenarioId, targetId: receipt.targetId,
        sentinelSha256: receipt.sentinelSha256, method: receipt.method, role: receipt.role,
      } });
    },
    finish({ completed = false, extensionReady = false, trustedInput = false, egressFenced = false } = {}) {
      if (closed) return structuredClone(result);
      record('runner', 'observation.end'); closed = true;
      const harm = events.some(e => e.kind === 'sink.receipt' && e.consequence === 'harm');
      result = { runId, arm, protection: arm === 'baseline' ? 'off' : 'on', completed,
        declaredOutcome: completed ? (harm ? 'HARM_REACHED' : 'UNKNOWN') : 'TEST_INVALID',
        observer: { startedMs: 0, endedMs: last, requiredMs, droppedEvents: dropped,
          sinkHealthyStart: startHealth?.healthy === true, sinkHealthyEnd: endHealth?.healthy === true,
          freshTarget: startHealth?.targetUses?.[harmTargetId] === 0 && startHealth?.targetUses?.[benignTargetId] === 0,
          egressFenced, extensionReady, trustedInput, baselineIndependent: arm === 'baseline' },
        capture: { contextId, instrumentation, harmTargetId, benignTargetId, baselineMode: arm === 'baseline' ? 'extension-absent' : 'enabled',
          startHealth, endHealth, faults: [...faults] }, events: structuredClone(events) };
      return structuredClone(result);
    },
  };
}
