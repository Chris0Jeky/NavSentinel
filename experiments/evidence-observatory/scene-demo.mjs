import { demonstration } from './demo.mjs';
import { TRACE_V2 } from './capture-v2.mjs';

/** Authored scene teaching data. No browser observation or security proof. */
export function sceneDemonstration() {
  const raw = demonstration(); raw.schema = TRACE_V2;
  raw.provenance = { sourceTree: 'a'.repeat(40), inputsBefore: 'b'.repeat(64), inputsAfter: 'b'.repeat(64), artifactAfter: raw.identity.extensionSha256,
    lockSha256: 'd'.repeat(64), settingsSha256: 'e'.repeat(64), rawVerified: false };
  for (const run of raw.runs) {
    const harmId = `${run.arm}-harm`, benignId = `${run.arm}-benign`;
    let hidden = run.arm === 'benign', sinkCount = 0, documentEpoch = 1;
    const context = () => ({ pageId: 'teaching-page', frameId: 'child-frame',
      documentId: documentEpoch === 1 ? 'child-document' : `child-document-${documentEpoch}`, parentFrameId: 'top-frame' });
    const events = [];
    for (const original of run.events) {
      const e = { ...original, causes: [] };
      if (e.frame === 'child' && e.kind === 'navigation.committed') documentEpoch++;
      if (e.frame === 'child') e.context = context();
      if (e.kind === 'sink.receipt') {
        sinkCount++;
        e.receiver = { runId: run.runId, scenarioId: raw.scenarioId, targetId: e.consequence === 'harm' ? harmId : benignId, method: 'GET',
          role: run.arm === 'mixed' ? 'mixed' : e.consequence === 'harm' ? 'attack' : 'benign', sentinelSha256: 'd'.repeat(64) };
      }
      events.push(e);
      if (e.kind === 'decision.block') hidden = true;
      if (['dom.changed', 'decision.block', 'control.completed'].includes(e.kind)) {
        const { frameId, documentId, parentFrameId } = context();
        const identity = { frameId, documentId, parentFrameId };
        const box = (id, kind, state, x, y, width, height, target = 'none') => ({ id, ...identity, kind, state, x, y, width, height,
          declaredTarget: target, effectiveTarget: target, targetScope: target === 'none' ? 'none' : 'new-context' });
        events.push({ id: 'temporary', sequence: 0, elapsedMs: e.elapsedMs, source: 'browser', kind: 'scene.sample', frame: 'child', causes: [], context: context(),
          scene: { width: 1280, height: 900, boxes: [box('media-frame','frame','visible',90,90,1100,650), box('playback-control','control','visible',140,650,200,60),
            box('attack-layer','attack',hidden?'hidden':'visible',hidden?0:90,hidden?0:90,hidden?0:1100,hidden?0:650,'harm-receiver')] } });
      }
    }
    events.forEach((e, i) => { e.sequence = i + 1; e.id = `${run.arm}-scene-e${i + 1}`; });
    run.events = events;
    const health = count => ({ healthy:true, healthSequence:count?2:1, receiptCount:count, invalidAttempts:0, observerErrors:0,
      targetUses:{[harmId]:run.arm==='baseline'?count:0,[benignId]:run.arm==='benign'||run.arm==='mixed'?count:0} });
    const startHealth = health(0), endHealth = health(sinkCount); endHealth.healthSequence=2;
    run.capture = { contextId:`teaching-${run.arm}`, instrumentation:'full', harmTargetId:harmId, benignTargetId:benignId,
      baselineMode:run.arm==='baseline'?'extension-absent':'enabled',startHealth,endHealth,faults:[] };
  }
  return raw;
}
