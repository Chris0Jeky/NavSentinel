/** Qualify the monitor's reaction to deliberate faults, never the defense itself. */
import { buildReport, supportsCompleteSet } from './model.mjs';
import { TRACE_V2 } from './capture-v2.mjs';

export const FAULT_IDS = Object.freeze(['receiver-unavailable', 'primary-frame-detached', 'primary-document-replaced',
  'worker-restarted', 'page-report-flood', 'receiver-observer-error']);
const positiveHarm = c => c.facts.harmReceipts > 0;
export function assessFaultTrace(trace) {
  const faultId = FAULT_IDS.find(id => trace?.variantId === `fault-${id}`) ?? null;
  const reasons = [];
  let report;
  try { report = buildReport([JSON.stringify(trace)]); } catch { reasons.push('TRACE_REJECTED'); }
  const c = report?.cases?.[0], run = trace?.runs?.[0];
  if (!faultId || trace?.schema !== TRACE_V2 || trace?.mode !== 'synthetic' || trace?.runs?.length !== 1 || report?.rejected.length || !c) reasons.push('FAULT_TRACE_INVALID');
  const output = () => ({ faultId, status: reasons.length ? 'FAULT_NOT_ESTABLISHED' : 'FAULT_DETECTED',
    preventionSupported: report ? supportsCompleteSet(report) : false, reasons,
    assessment: c?.assessment ?? 'INVALID', gaps: c?.gaps ?? [], facts: c?.facts ?? null,
    sourceDigest: report?.sources?.[0]?.sha256 ?? null,
    evidencePolicy: 'OBSERVER_FAULT_CHECK_NOT_PROTECTION_EVIDENCE' });
  if (reasons.length) return output();
  const expectedFaults = {
    'receiver-unavailable': [], 'primary-frame-detached': ['PRIMARY_FRAME_DETACHED'],
    'primary-document-replaced': ['PRIMARY_FRAME_NAVIGATED'], 'worker-restarted': ['WORKER_EPOCH_CHANGED'],
    'page-report-flood': [], 'receiver-observer-error': [],
  };
  if (run.completed !== true || c.validity === 'invalid' || run.capture.faults.some(code => !expectedFaults[faultId].includes(code))) {
    reasons.push('UNEXPECTED_RUN_FAILURE');
  }
  if (!trace.provenance.rawVerified || trace.provenance.inputsBefore !== trace.provenance.inputsAfter ||
      trace.provenance.artifactAfter !== trace.identity.extensionSha256) reasons.push('FAULT_SOURCE_UNVERIFIED');
  if (!run.observer.trustedInput || !run.observer.egressFenced || (run.arm !== 'baseline' && !run.observer.extensionReady) ||
      !run.capture.startHealth?.healthy) reasons.push('FAULT_PRECONDITIONS_MISSING');
  const injections = c.events.filter(e => e.kind === 'fault.injected' && e.source === 'runner');
  const injection = injections[0];
  if (injections.length !== 1 || injection?.data.code !== faultId) reasons.push('FAULT_INJECTION_NOT_IDENTIFIED');
  const after = c.events.filter(e => injection && e.sequence > injection.sequence);
  const earlierFrames = new Map(c.events.filter(e => injection && e.sequence < injection.sequence && e.data.context)
    .map(e => [e.data.context.frameId, e.data.context]));
  const primary = injection?.data.context;
  const isPrimary = e => primary && e.data.context && e.data.context.pageId === primary.pageId && e.data.context.frameId === primary.frameId;
  const start = run.capture.startHealth, end = run.capture.endHealth;
  let confirmed = false;
  switch (faultId) {
    case 'receiver-unavailable':
      confirmed = start?.healthy === true && end?.healthy === false && c.gaps.includes('RECEIVER_HEALTH_INCOMPLETE');
      break;
    case 'primary-frame-detached':
      confirmed = c.gaps.includes('PRIMARY_FRAME_DETACHED') && after.some(e => e.kind === 'frame.detached' && isPrimary(e) && e.data.context.documentId === primary.documentId &&
        e.data.context && earlierFrames.get(e.data.context.frameId)?.documentId === e.data.context.documentId);
      break;
    case 'primary-document-replaced':
      confirmed = c.gaps.includes('PRIMARY_FRAME_NAVIGATED') && after.some(e => e.kind === 'navigation.committed' && isPrimary(e) && e.data.context.documentId !== primary.documentId &&
        earlierFrames.has(e.data.context.frameId) && earlierFrames.get(e.data.context.frameId).documentId !== e.data.context.documentId);
      break;
    case 'worker-restarted': {
      const stopped = after.find(e => e.kind === 'worker.stopped');
      confirmed = c.gaps.includes('WORKER_EPOCH_CHANGED') && Boolean(stopped && after.some(e => e.kind === 'worker.restarted' && e.sequence > stopped.sequence));
      break;
    }
    case 'page-report-flood':
      confirmed = run.observer.droppedEvents > 0 && c.gaps.includes('EVENTS_DROPPED') && positiveHarm(c) &&
        after.some(e => e.kind === 'sink.receipt' && e.data.consequence === 'harm');
      break;
    case 'receiver-observer-error':
      confirmed = start?.observerErrors === 0 && end?.observerErrors > 0 && c.gaps.includes('RECEIVER_OBSERVER_LOSS') && positiveHarm(c) &&
        after.some(e => e.kind === 'sink.receipt' && e.data.consequence === 'harm');
      break;
  }
  if (!confirmed) reasons.push('INDEPENDENT_FAULT_OBSERVATION_MISSING');
  if (supportsCompleteSet(report) || report.summary.boundedSupportedComparisons > 0 || !c.gaps.length) reasons.push('FAULT_MISCLASSIFIED_AS_PREVENTION');
  return output();
}
export function checkFaultMatrix(traces) {
  if (!Array.isArray(traces) || traces.length > 32) throw new Error('FAULT_MATRIX_SIZE_INVALID');
  const trials = traces.map(assessFaultTrace);
  const counts = Object.fromEntries(FAULT_IDS.map(id => [id, trials.filter(t => t.faultId === id).length]));
  const identityKeys = traces.map(t => JSON.stringify([t?.identity, t?.provenance]));
  const runs = traces.flatMap(t => Array.isArray(t?.runs) ? t.runs : []);
  const uniqueRuns = new Set(runs.map(r => r.runId)).size === runs.length && new Set(runs.map(r => r.capture?.contextId)).size === runs.length;
  return { schema: 'navsentinel.observatory.fault-check.v1',
    evidencePolicy: 'OBSERVER_FAULT_CHECK_NOT_PROTECTION_EVIDENCE',
    passed: trials.length === FAULT_IDS.length && Object.values(counts).every(n => n === 1) && uniqueRuns &&
      new Set(identityKeys).size === 1 && trials.every(t => t.status === 'FAULT_DETECTED' && !t.preventionSupported),
    counts, uniqueRuns, sameInputs: new Set(identityKeys).size === 1, trials };
}
