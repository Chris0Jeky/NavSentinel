import { TRACE_SCHEMA } from './model.mjs';

/** Explicitly authored data, NOT a browser run or a NavSentinel protection receipt. */
export function demonstration() {
  const raw = {
    schema: TRACE_SCHEMA, mode: 'demo', campaignId: 'teaching-example', scenarioId: 'NS-ADV-UI-004', variantId: 'teaching-overlay',
    identity: { repositoryHead: 'a'.repeat(40), extensionSha256: 'b'.repeat(64), fixtureSha256: 'c'.repeat(64), browserVersion: 'demonstration', profile: 'illustrative', seed: 'demo-1' },
    runs: [],
  };
  for (const arm of ['baseline', 'protected', 'benign', 'mixed']) {
    const events = [];
    const add = (source, kind, elapsedMs, extra = {}) => {
      const sequence = events.length + 1;
      events.push({ id: `${arm}-e${sequence}`, sequence, elapsedMs, source, kind, frame: source === 'sink' || source === 'runner' ? 'none' : 'child', causes: sequence > 1 ? [events.at(-1).id] : [], ...extra });
    };
    add('runner', 'run.start', 0);
    if (arm !== 'benign') {
      add('page', 'attack.intent', 80);
      add('page', 'dom.changed', 160);
    }
    add('runner', 'input.dispatched', 300);
    if (arm !== 'benign') add('page', 'attack.attempt', 310);
    if (arm === 'baseline') {
      add('browser', 'request.observed', 335);
      add('sink', 'sink.receipt', 350, { consequence: 'harm', sinkSequence: 1 });
      add('browser', 'navigation.committed', 375);
    } else {
      add('extension', arm === 'benign' ? 'decision.allow' : 'decision.block', 320, { code: arm === 'benign' ? 'ordinary-control' : 'synthetic-overlay-rule' });
      if (arm === 'benign' || arm === 'mixed') {
        add('sink', 'sink.receipt', 450, { consequence: 'benign', sinkSequence: 1 });
        add('browser', 'control.completed', 475);
      }
    }
    add('runner', 'observation.end', 3000);
    raw.runs.push({ runId: `demo-${arm}`, arm, protection: arm === 'baseline' ? 'off' : 'on', completed: true,
      declaredOutcome: arm === 'baseline' ? 'HARM_REACHED' : arm === 'benign' ? 'NO_SIGNAL' : 'BLOCKED_PRE_HARM',
      observer: { startedMs: 0, endedMs: 3000, requiredMs: 3000, droppedEvents: 0, sinkHealthyStart: true, sinkHealthyEnd: true,
        freshTarget: true, egressFenced: true, extensionReady: arm !== 'baseline', trustedInput: true, baselineIndependent: arm === 'baseline' }, events });
  }
  return raw;
}
