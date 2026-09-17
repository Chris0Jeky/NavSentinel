/** Offline diagnostic projection. Never imports code or promotes registry evidence. */
import { createHash } from 'node:crypto';
import { FORM_DOCUMENT_SCHEMA } from './form-documents.mjs';
import { FORM_SCHEMA, parseFormTrace, compareFormCases } from './form-trace.mjs';
import { TRACE_V2, validateEventMetadata, validateRunCapture, validateProvenance } from './capture-v2.mjs';

export const LIMITS = Object.freeze({ bytes: 1024 * 1024, totalBytes: 32 * 1024 * 1024, files: 128, events: 2000, runs: 16 });
export const TRACE_SCHEMA = 'navsentinel.observatory.trace.v1';
export const REPORT_SCHEMA = 'navsentinel.observatory.report.v1';
const ARMS = ['baseline', 'protected', 'benign', 'mixed'];
const OUTCOMES = ['NO_SIGNAL', 'ANNOTATED', 'WARNED', 'HELD_PRE_HARM', 'BLOCKED_PRE_HARM', 'ROLLED_BACK_POST_COMMIT', 'HARM_REACHED', 'TEST_INVALID', 'UNKNOWN'];
const SOURCES = {
  'run.start': 'runner', 'input.dispatched': 'runner', 'observation.end': 'runner', 'observer.gap': 'runner',
  'attack.intent': 'page', 'attack.attempt': 'page', 'dom.changed': 'page',
  'decision.block': 'extension', 'decision.allow': 'extension', 'decision.warn': 'extension',
  'decision.hold': 'extension', 'decision.rollback': 'extension',
  'navigation.committed': 'browser', 'navigation.restored': 'browser', 'request.observed': 'browser',
  'control.completed': 'browser', 'sink.receipt': 'sink',
  'observer.health': 'runner', 'fault.injected': 'runner', 'worker.stopped': 'browser', 'worker.restarted': 'browser', 'scene.sample': 'browser', 'frame.attached': 'browser', 'frame.detached': 'browser',
};
const EXPLANATIONS = {
  'fault.injected': 'The test runner deliberately requested an observer fault. This announcement does not establish that the fault occurred.',
  'worker.stopped': 'Chromium reported the extension worker stopped. The observation interval is incomplete even if protection later resumes.',
  'worker.restarted': 'The browser worker resumed with a different in-memory epoch. This is recovery, not continuous observation.',
  'observer.health': 'The runner checked the independent receiver using a separate non-consuming health challenge.',
  'scene.sample': 'The browser harness sampled these element rectangles. This is a snapshot, not continuous video.',
  'frame.attached': 'The browser observed a frame/document context; IDs are local to this fresh run.',
  'frame.detached': 'The browser observed this frame being removed; its document identity is no longer live.',
  'run.start': 'The runner began this observation window.',
  'input.dispatched': 'The runner dispatched input. This is not itself proof of a human actor.',
  'attack.intent': 'The fixture announced its intent; this is an untrusted page report.',
  'attack.attempt': 'The fixture reported attempting its consequential operation.',
  'dom.changed': 'The fixture reported changing the page structure or layout.',
  'decision.block': 'NavSentinel reported a block. Inspect the consequence independently.',
  'decision.allow': 'NavSentinel reported allowing the operation.',
  'decision.warn': 'NavSentinel reported a warning; a warning is not prevention.',
  'decision.hold': 'NavSentinel reported holding the operation for a decision.',
  'decision.rollback': 'NavSentinel reported requesting recovery; completion is a separate observation.',
  'navigation.committed': 'The browser observer reported a committed navigation.',
  'navigation.restored': 'The browser observer reported a restored navigation after the attempt.',
  'request.observed': 'The browser observer saw a request; this does not prove receiver acceptance.',
  'control.completed': 'The browser observer reported completion of a legitimate control.',
  'sink.receipt': 'The independent test receiver reported accepting a synthetic consequence.',
  'observer.gap': 'The collector reports missing observations; absence is not evidence.',
  'observation.end': 'The runner closed the bounded observation window.',
};
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const token = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(x) ? x : null;
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x) ? x : null;
const head = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x) ? x : null;
const count = x => Number.isSafeInteger(x) && x >= 0 && x <= 1000000 ? x : null;
const millis = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 86400000 ? x : null;
const bool = x => typeof x === 'boolean' ? x : null;
const enumValue = (x, values) => values.includes(x) ? x : null;
const declaredOutcome = value => value === undefined ? 'UNKNOWN' : requireValue(enumValue(value, OUTCOMES), 'DECLARED_OUTCOME_INVALID');
const array = (x, max = LIMITS.events) => {
  if (!Array.isArray(x) || x.length > max) throw new Error('ARRAY_INVALID_OR_OVER_LIMIT');
  return x;
};
function requireValue(value, code) { if (value === null || value === undefined) throw new Error(code); return value; }
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('UNKNOWN_OR_INVALID_FIELDS');
}
function event(sequence, source, kind, explanation, data = {}, elapsedMs = null, clock = 'not-recorded') {
  return { id: `e${sequence}`, sequence, source, kind, explanation, elapsedMs, clock, frame: 'unknown', causes: [], data };
}
function baseCase(source, scenario, variant, arm) {
  return {
    id: `${source.id}-${arm}`, sourceId: source.id, scenario, variant, arm, mode: 'imported',
    title: scenario === 'NS-ADV-UI-004' ? 'An overlay redirects the intended click' :
      scenario === 'issue-593-hidden-media-layer-modelled' ? 'A hidden frame attempts navigation' : 'Synthetic consequence inspection',
    intent: scenario === 'NS-ADV-UI-004' ? 'A deceptive layer tries to receive a click meant for a legitimate control and open a different destination.' :
      scenario === 'issue-593-hidden-media-layer-modelled' ? 'A child frame tries to turn an interaction into a navigation that the user did not request.' :
        'Compare the declared synthetic attack with observations at the receiver and the defense.',
    boundary: 'A typed, inert test receiver accepts the declared consequence. No real secret or OS execution is involved.',
    declaredOutcome: 'UNKNOWN', assessment: 'INCONCLUSIVE', validity: 'unverified',
    identity: { repositoryHead: null, extensionSha256: null, fixtureSha256: null, browserVersion: null, profile: null, seed: null },
    facts: { harmReceipts: null, benignReceipts: null, cumulativeReceipts: null, legitimateCompletions: null, recovered: null },
    events: [], gaps: [], warnings: [], proof: null,
  };
}
function sinkRows(value, expectedScenario) {
  return array(value).map(r => {
    if (!object(r) || r.scenarioId !== expectedScenario || count(r.sequence) === null || r.sequence < 1 ||
        !token(r.runId) || !enumValue(r.role, ['attack', 'benign', 'mixed']) || !digest(r.sentinelSha256) || r.method !== 'GET') {
      throw new Error('SINK_RECEIPT_INVALID');
    }
    // No raw targets, query strings, source URLs, wall-clock timestamps or payloads.
    return { sequence: r.sequence, runId: r.runId, role: r.role, consequence: token(r.consequence),
      targetId: token(r.targetId), method: 'GET', sentinelSha256: r.sentinelSha256 };
  });
}
function assess(c) {
  if (c.validity === 'invalid') { c.assessment = 'INVALID'; return c; }
  if (c.facts.harmReceipts > 0) c.assessment = c.facts.recovered === true ? 'HARM_THEN_RECOVERY' : 'HARM_OBSERVED';
  else if (c.arm === 'benign' && c.facts.legitimateCompletions > 0) c.assessment = 'BENIGN_COMPLETED';
  else c.assessment = 'INCONCLUSIVE';
  return c;
}
function overlay(raw, source) {
  if (raw.schema_version !== '1.0.0' || raw.scenario_id !== 'NS-ADV-UI-004' || raw.oracle?.type !== 'independent_harm') throw new Error('UNSUPPORTED_FORMAT');
  const o = raw.oracle;
  const obs = o.observation;
  if (!object(obs) || !object(o.sink_snapshot)) throw new Error('ORACLE_INVALID');
  const role = requireValue(enumValue(raw.fixture?.role, ['attack', 'benign', 'mixed']), 'FIXTURE_ROLE_INVALID');
  const rows = sinkRows(o.sink_snapshot.receipts, raw.scenario_id);
  if (rows.some(r => r.role !== role)) throw new Error('SINK_ROLE_DISAGREES');
  const invalid = array(o.sink_snapshot.invalidAttempts);
  const delta = requireValue(count(o.sink_receipt_count), 'SINK_COUNT_INVALID');
  if (delta > rows.length) throw new Error('SINK_COUNT_EXCEEDS_SNAPSHOT');
  const protectedPhase = Object.hasOwn(obs, 'protectedReceiptCount');
  const arm = raw.fixture?.role === 'benign' ? 'benign' : raw.fixture?.role === 'mixed' ? 'mixed' : protectedPhase ? 'protected' : raw.outcome === 'HARM_REACHED' ? 'baseline' : 'unknown';
  const c = baseCase(source, raw.scenario_id, 'overlay-nesting', arm);
  c.declaredOutcome = declaredOutcome(raw.outcome);
  c.identity = { ...c.identity, repositoryHead: head(raw.repository_head), extensionSha256: digest(raw.extension_build_sha256),
    fixtureSha256: digest(raw.fixture?.sha256), browserVersion: token(raw.browser?.version), profile: token(raw.profile) };
  const hashMatches = digest(o.local_receipt_sha256) === sha256(JSON.stringify({ sinkSnapshot: o.sink_snapshot, observation: obs }));
  const violations = array(raw.network_violations);
  c.validity = raw.valid === false || c.declaredOutcome === 'TEST_INVALID' || invalid.length > 0 || violations.length > 0 || !hashMatches ? 'invalid' : 'unverified';
  c.facts.cumulativeReceipts = rows.length;
  c.facts.harmReceipts = arm === 'benign' ? 0 : delta;
  c.facts.benignReceipts = arm === 'benign' ? delta : null;
  c.facts.legitimateCompletions = count(obs.trustedUnderlyingClicksCompleted ?? obs.trustedBenignClicksCompleted ?? obs.trustedClicksCompleted ?? obs.underlyingControlClicksCompleted);
  c.events.push(event(1, 'runner', 'receipt.summary', 'Producer-declared outcome; not independently certified by this viewer.', { outcome: c.declaredOutcome, oracleHashMatches: hashMatches }));
  c.events.push(event(2, 'sink', 'sink.snapshot', 'The snapshot is cumulative. The phase-local count is displayed separately.',
    { cumulativeCount: rows.length, phaseCount: delta, invalidAttemptCount: invalid.length }));
  for (const row of rows) c.events.push(event(c.events.length + 1, 'sink', 'sink.snapshot.row', 'Receipt in the cumulative snapshot; not necessarily a new receipt in this phase.', row));
  if (protectedPhase && (count(obs.protectedReceiptCount) !== delta ||
      (Object.hasOwn(obs, 'baselineReceiptCount') ? count(obs.baselineReceiptCount) === null || obs.baselineReceiptCount + delta !== rows.length : rows.length !== delta))) {
    c.validity = 'invalid'; c.warnings.push('PHASE_COUNTS_DISAGREE');
  }
  if (Array.isArray(obs.visibilitySamples)) {
    let previous = -1;
    for (const sample of array(obs.visibilitySamples, 1000)) {
      const ms = requireValue(millis(sample.elapsedMs), 'SAMPLE_TIME_INVALID');
      if (ms < previous) throw new Error('SAMPLE_CLOCK_REVERSED');
      previous = ms;
      const visibleCount = array(sample.visibleIds, 128).length;
      c.events.push(event(c.events.length + 1, 'browser', 'visibility.sample', 'Number of attack layers visible at this sampled instant; gaps between samples remain unobserved.',
        { visibleCount }, ms, 'visibility-sampler'));
    }
  }
  c.events.push(event(c.events.length + 1, 'runner', 'control.summary', 'Legitimate control completions reported by the runner.', { completions: c.facts.legitimateCompletions }));
  c.gaps.push('LEGACY_RECEIPT_NOT_A_COMPLETE_TRACE', 'NO_INDEPENDENT_EXACT_SOURCE_VERIFICATION', 'NO_RUN_SCOPED_FRESH_TARGET_ATTESTATION', 'NO_END_TO_END_OBSERVER_HEALTH');
  if (Object.hasOwn(obs, 'baselineReceiptCount')) c.gaps.push('CUMULATIVE_SINK_REUSED_ACROSS_PHASES');
  c.warnings.push('Navigation Off baseline is not an extension-uninstalled baseline.', 'Receipt self-hashes check consistency, not authenticity.', 'Capture order is not a synchronized cross-process timeline.');
  return [assess(c)];
}
function hiddenMedia(raw, source) {
  const scenario = 'issue-593-hidden-media-layer-modelled';
  if (!object(raw.arm) || !['baseline', 'protected'].includes(raw.mode)) throw new Error('UNSUPPORTED_FORMAT');
  requireValue(enumValue(raw.arm.role, ['attack', 'benign']), 'FIXTURE_ROLE_INVALID');
  const variant = requireValue(token(raw.arm.id), 'VARIANT_INVALID');
  const before = requireValue(count(raw.sinkReceiptsBefore), 'SINK_COUNT_INVALID');
  const after = requireValue(count(raw.sinkReceiptsAfter), 'SINK_COUNT_INVALID');
  const rows = sinkRows(raw.sinkReceipts, scenario);
  if (after < before || after !== rows.length) throw new Error('SINK_COUNTS_DISAGREE');
  const roles = rows.slice(before).map(r => r.role);
  if (roles.some(r => r !== raw.arm.role)) throw new Error('SINK_ROLE_DISAGREES');
  const arm = raw.arm.role === 'benign' ? 'benign' : raw.mode;
  const c = baseCase(source, scenario, variant, arm);
  c.facts.cumulativeReceipts = after;
  c.facts.harmReceipts = raw.arm.role === 'benign' ? 0 : after - before;
  c.facts.benignReceipts = raw.arm.role === 'benign' ? after - before : 0;
  c.facts.recovered = bool(raw.topReturnedToFixture);
  // A reachable benign sink is only a consequence, not proof the whole task completed.
  c.facts.legitimateCompletions = null;
  c.validity = array(raw.invalidSinkAttempts).length || array(raw.fixtureEgressViolations).length || array(raw.pageErrors).length ? 'invalid' : 'unverified';
  const phases = ['parent-ready', 'child-ready', 'pointerdown', 'armed', 'executing', 'blocked', 'click', 'keydown', 'submitted', 'error'];
  for (const d of array(raw.diagnostics, 1500)) {
    if (!object(d)) throw new Error('PAGE_DIAGNOSTIC_INVALID');
    const e = event(c.events.length + 1, 'page', 'page.report', 'The fixture reported this phase. It is not a trusted consequence receipt.',
      { phase: enumValue(d.phase, phases) ?? 'other', primitive: token(d.primitive), trustedReported: bool(d.trusted) }, millis(d.at), 'page-local-unbound');
    e.frame = enumValue(d.frame, ['parent', 'child']) ?? 'unknown';
    c.events.push(e);
  }
  c.events.push(event(c.events.length + 1, 'sink', 'sink.phase', 'New receipts are the difference between the two explicit sink counters.', { before, after, delta: after - before }));
  for (const row of rows.slice(before)) c.events.push(event(c.events.length + 1, 'sink', 'sink.receipt', 'Typed test receiver receipt attributed to this phase.', row));
  c.events.push(event(c.events.length + 1, 'extension', 'decision.report', 'Product-reported reason, when available. No toast text or page content is imported.', { reasonCode: token(raw.reasonCode) }));
  c.events.push(event(c.events.length + 1, 'browser', 'recovery.summary', 'Runner reports whether the top frame returned to the fixture. This cannot undo receipt of a request.', { returnedToFixture: c.facts.recovered }));
  c.gaps.push('NO_ARTIFACT_IDENTITY_IN_LEGACY_DIAGNOSTIC', 'PAGE_CLOCKS_RESET_AND_ARE_NOT_GLOBALLY_ORDERED', 'NO_END_TO_END_OBSERVER_HEALTH', 'NO_CERTIFIED_BASELINE_PAIR');
  c.warnings.push('Expected test outcome is deliberately not used as an observed outcome.', 'Page events may be duplicated by forwarding; they remain visible and are not counted as independent evidence.');
  return [assess(c)];
}
function nativeTrace(raw, source) {
  const v2 = raw.schema === TRACE_V2;
  keys(raw, ['schema', 'mode', 'campaignId', 'scenarioId', 'variantId', 'identity', 'runs', ...(v2 ? ['provenance'] : [])]);
  const provenance = v2 ? validateProvenance(raw.provenance) : null;
  const mode = requireValue(enumValue(raw.mode, ['synthetic', 'demo']), 'MODE_INVALID');
  const campaignId = requireValue(token(raw.campaignId), 'CAMPAIGN_INVALID');
  const scenario = requireValue(token(raw.scenarioId), 'SCENARIO_INVALID');
  const variant = requireValue(token(raw.variantId), 'VARIANT_INVALID');
  keys(raw.identity, ['repositoryHead', 'extensionSha256', 'fixtureSha256', 'browserVersion', 'profile', 'seed']);
  const identity = { repositoryHead: head(raw.identity.repositoryHead), extensionSha256: digest(raw.identity.extensionSha256),
    fixtureSha256: digest(raw.identity.fixtureSha256), browserVersion: token(raw.identity.browserVersion), profile: token(raw.identity.profile), seed: token(raw.identity.seed) };
  const runIds = new Set();
  return array(raw.runs, LIMITS.runs).map(run => {
    keys(run, ['runId', 'arm', 'protection', 'completed', 'declaredOutcome', 'observer', 'events', ...(v2 ? ['capture'] : [])]);
    const runId = requireValue(token(run.runId), 'RUN_ID_INVALID');
    if (runIds.has(runId)) throw new Error('DUPLICATE_RUN_ID');
    runIds.add(runId);
    const arm = requireValue(enumValue(run.arm, ARMS), 'ARM_INVALID');
    const c = baseCase(source, scenario, variant, arm);
    c.id = `${source.id}-${runId}`; c.mode = mode; c.identity = identity;
    c.declaredOutcome = declaredOutcome(run.declaredOutcome);
    c.validity = run.completed === true && c.declaredOutcome !== 'TEST_INVALID' ? 'complete' : 'invalid';
    requireValue(enumValue(run.protection, ['off', 'on']), 'PROTECTION_INVALID');
    keys(run.observer, ['startedMs', 'endedMs', 'requiredMs', 'droppedEvents', 'sinkHealthyStart', 'sinkHealthyEnd', 'freshTarget', 'egressFenced', 'extensionReady', 'trustedInput', 'baselineIndependent']);
    const o = run.observer;
    for (const k of ['startedMs', 'endedMs', 'requiredMs']) requireValue(millis(o[k]), 'OBSERVER_TIME_INVALID');
    requireValue(count(o.droppedEvents), 'DROPPED_COUNT_INVALID');
    for (const k of ['sinkHealthyStart', 'sinkHealthyEnd', 'freshTarget', 'egressFenced', 'extensionReady', 'trustedInput', 'baselineIndependent']) requireValue(bool(o[k]), 'OBSERVER_FLAG_INVALID');
    if (o.endedMs < o.startedMs || o.requiredMs === 0) throw new Error('OBSERVER_WINDOW_INVALID');
    const ids = new Set(); let previousMs = o.startedMs; let sinkSequence = 0; let harmSequence = -1;
    c.facts = { harmReceipts: 0, benignReceipts: 0, cumulativeReceipts: null, legitimateCompletions: 0, recovered: false };
    for (const input of array(run.events)) {
      keys(input, ['id', 'sequence', 'elapsedMs', 'source', 'kind', 'frame', 'causes', 'code', 'consequence', 'sinkSequence', ...(v2 ? ['context', 'sourceClock', 'scene', 'receiver'] : [])]);
      const id = requireValue(token(input.id), 'EVENT_ID_INVALID');
      if (ids.has(id) || input.sequence !== c.events.length + 1) throw new Error('EVENT_ORDER_OR_ID_INVALID');
      const time = requireValue(millis(input.elapsedMs), 'EVENT_TIME_INVALID');
      if (time < previousMs || time > o.endedMs) throw new Error('EVENT_CLOCK_INVALID');
      previousMs = time;
      if (!Object.hasOwn(SOURCES, input.kind) || SOURCES[input.kind] !== input.source) throw new Error('EVENT_PROVENANCE_INVALID');
      const causes = array(input.causes, 4);
      if (new Set(causes).size !== causes.length || causes.some(id => !ids.has(id))) throw new Error('CAUSE_NOT_PREVIOUS_EVENT');
      const e = event(input.sequence, input.source, input.kind, EXPLANATIONS[input.kind], v2 ? validateEventMetadata(input) : {}, time, 'collector-monotonic');
      if (v2 && ((input.receiver !== undefined && input.kind !== 'sink.receipt') || (input.scene !== undefined && input.kind !== 'scene.sample'))) throw new Error('CAPTURE_METADATA_KIND_MISMATCH');
      e.id = id; e.causes = [...causes]; e.frame = requireValue(enumValue(input.frame, ['top', 'child', 'none', 'unknown']), 'FRAME_INVALID');
      if (input.code !== undefined) e.data.code = requireValue(token(input.code), 'REASON_CODE_INVALID');
      if (input.kind === 'sink.receipt') {
        const consequence = requireValue(enumValue(input.consequence, ['harm', 'benign']), 'CONSEQUENCE_INVALID');
        if (input.sinkSequence !== ++sinkSequence) throw new Error('SINK_SEQUENCE_INVALID');
        e.data = { ...e.data, consequence, sinkSequence };
        if (consequence === 'harm') { c.facts.harmReceipts++; harmSequence = input.sequence; c.facts.recovered = false; }
        else c.facts.benignReceipts++;
      } else if (input.consequence !== undefined || input.sinkSequence !== undefined) throw new Error('SINK_FIELDS_ON_NON_SINK_EVENT');
      if (input.kind === 'navigation.restored' && harmSequence >= 0) c.facts.recovered = true;
      if (input.kind === 'control.completed') c.facts.legitimateCompletions++;
      if (input.kind === 'observer.gap') c.gaps.push('OBSERVER_GAP_EVENT');
      if (input.kind === 'fault.injected') c.gaps.push('INTENTIONAL_FAULT_EXPERIMENT');
      c.events.push(e); ids.add(id);
    }
    if (c.events[0]?.kind !== 'run.start' || c.events[0]?.elapsedMs !== o.startedMs || c.events.at(-1)?.kind !== 'observation.end' || c.events.at(-1)?.elapsedMs !== o.endedMs) c.gaps.push('WINDOW_BOUNDARIES_MISSING');
    if (o.endedMs - o.startedMs < o.requiredMs) c.gaps.push('OBSERVATION_WINDOW_TOO_SHORT');
    if (o.droppedEvents) c.gaps.push('EVENTS_DROPPED');
    for (const [field, code] of [['sinkHealthyStart', 'SINK_NOT_HEALTHY_AT_START'], ['sinkHealthyEnd', 'SINK_NOT_HEALTHY_AT_END'], ['freshTarget', 'TARGET_NOT_FRESH'], ['egressFenced', 'EGRESS_NOT_FENCED'], ['trustedInput', 'INPUT_NOT_ATTESTED']]) if (!o[field]) c.gaps.push(code);
    if (!Object.values(identity).every(Boolean)) c.gaps.push('IDENTITY_INCOMPLETE');
    if (arm === 'baseline' && (run.protection !== 'off' || !o.baselineIndependent)) c.gaps.push('BASELINE_NOT_INDEPENDENT');
    if (arm !== 'baseline' && (run.protection !== 'on' || !o.extensionReady)) c.gaps.push('PROTECTION_NOT_READY');
    if (!c.events.some(e => e.kind === 'input.dispatched')) c.gaps.push('INPUT_EVENT_MISSING');
    if (arm !== 'benign' && !c.events.some(e => e.kind === 'attack.attempt')) c.gaps.push('ATTEMPT_NOT_RECORDED');
    if (c.declaredOutcome === 'HARM_REACHED' && c.facts.harmReceipts === 0) c.gaps.push('DECLARED_HARM_NOT_RECEIPTED');
    c.proof = { campaignId, runId, producerContract: v2 ? TRACE_V2 : TRACE_SCHEMA, observationMs: o.endedMs - o.startedMs, requiredMs: o.requiredMs };
    if (v2) {
      const capture = validateRunCapture(run, scenario);
      c.proof.capture = capture.value; c.proof.provenance = provenance; c.gaps.push(...capture.gaps);
      if (!provenance.rawVerified) c.gaps.push('RAW_SOURCE_NOT_VERIFIED');
      if (provenance.inputsBefore !== provenance.inputsAfter) c.gaps.push('SOURCE_INPUTS_CHANGED');
      if (provenance.artifactAfter !== identity.extensionSha256) c.gaps.push('BUILT_ARTIFACT_CHANGED');
    }
    c.warnings.push('Producer attestations are not authenticated by importing JSON.', 'A bounded synthetic run is not an open-web efficacy measurement.');
    if (mode === 'demo') c.warnings.push('DEMONSTRATION: authored example, not an executed NavSentinel campaign.');
    return assess(c);
  });
}
export function parseSource(bytes, id = 'source-1') {
  if (!token(id)) throw new Error('SOURCE_ID_INVALID');
  if (typeof bytes === 'string') bytes = Buffer.from(bytes, 'utf8');
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes) throw new Error('INPUT_SIZE_LIMIT');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let raw; try { raw = JSON.parse(text); } catch { throw new Error('INVALID_JSON'); }
  if (!object(raw)) throw new Error('ROOT_NOT_OBJECT');
  const source = { id, sha256: sha256(bytes), bytes: bytes.length, format: 'unknown' };
  let cases;
  if (raw.schema === FORM_SCHEMA || raw.schema === FORM_DOCUMENT_SCHEMA) { source.format = raw.schema === FORM_DOCUMENT_SCHEMA ? 'form-observatory-v2' : 'form-observatory-v1'; cases = parseFormTrace(raw, source, baseCase); }
  else if (raw.schema === TRACE_SCHEMA || raw.schema === TRACE_V2) { source.format = raw.schema === TRACE_V2 ? 'observatory-trace-v2' : 'observatory-trace-v1'; cases = nativeTrace(raw, source); }
  else if (raw.scenario_id === 'NS-ADV-UI-004') { source.format = 'overlay-receipt-v1'; cases = overlay(raw, source); }
  else if (raw.arm && Array.isArray(raw.sinkReceipts) && Array.isArray(raw.diagnostics)) { source.format = 'hidden-media-diagnostic-v1'; cases = hiddenMedia(raw, source); }
  else throw new Error('UNSUPPORTED_FORMAT');
  return { source, cases };
}
function compare(cases) {
  const groups = new Map();
  for (const c of cases.filter(c => c.proof)) {
    const key = JSON.stringify([c.proof.campaignId, c.scenario, c.variant]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.values()].map(group => {
    const reasons = [];
    const arms = Object.fromEntries(ARMS.map(a => [a, group.filter(c => c.arm === a)]));
    if (ARMS.some(a => arms[a].length !== 1)) reasons.push('REQUIRE_EXACTLY_ONE_OF_EACH_ARM');
    if (new Set(group.map(c => JSON.stringify(c.identity))).size !== 1) reasons.push('IDENTITY_MISMATCH');
    if (new Set(group.map(c => c.proof.producerContract)).size !== 1) reasons.push('PRODUCER_VERSION_MISMATCH');
    if (group.some(c => c.proof.capture)) {
      if (new Set(group.map(c => c.proof.capture?.contextId)).size !== group.length) reasons.push('CONTEXT_REUSED_ACROSS_ARMS');
      if (new Set(group.map(c => JSON.stringify(c.proof.provenance))).size !== 1) reasons.push('PROVENANCE_MISMATCH');
    }
    if (new Set(group.map(c => c.proof.runId)).size !== group.length) reasons.push('DUPLICATE_RUN_ID_ACROSS_INPUTS');
    if (group.some(c => c.mode === 'demo')) reasons.push('DEMONSTRATION_NOT_EVIDENCE');
    if (group.some(c => c.validity !== 'complete' || c.gaps.length)) reasons.push('OBSERVATIONS_INCOMPLETE_OR_INVALID');
    if (!(arms.baseline[0]?.facts.harmReceipts > 0)) reasons.push('BASELINE_DID_NOT_REACH_HARM');
    if (group.some(c => c.arm !== 'baseline' && c.facts.harmReceipts > 0)) reasons.push('HARM_REACHED_WITH_PROTECTION');
    for (const a of ['benign', 'mixed']) if (!(arms[a][0]?.facts.legitimateCompletions > 0 && arms[a][0]?.facts.benignReceipts > 0)) reasons.push(`${a.toUpperCase()}_CONTROL_NOT_COMPLETED`);
    for (const a of ['protected', 'mixed']) {
      const events = arms[a][0]?.events ?? [];
      const attempt = events.findIndex(e => e.kind === 'attack.attempt');
      if (!events.some((e, i) => i > attempt && attempt >= 0 && (e.kind === 'decision.block' || e.kind === 'decision.hold'))) reasons.push(`${a.toUpperCase()}_INTERVENTION_NOT_AFTER_ATTEMPT`);
    }
    const status = reasons.length ? 'INCONCLUSIVE' : 'BOUNDED_PREVENTION_SUPPORTED';
    if (!reasons.length) for (const c of [...arms.protected, ...arms.mixed]) c.assessment = status;
    return { campaignId: group[0].proof.campaignId, scenario: group[0].scenario, variant: group[0].variant,
      caseIds: group.map(c => c.id), status, reasons };
  });
}
export function buildReport(inputs, { producerStatus = 'not-recorded' } = {}) {
  if (!Array.isArray(inputs) || inputs.length > LIMITS.files) throw new Error('FILE_COUNT_LIMIT');
  let total = 0;
  const sources = [], cases = [], rejected = [], duplicates = [];
  const seen = new Map();
  for (let i = 0; i < inputs.length; i++) {
    const bytes = Buffer.isBuffer(inputs[i]) ? inputs[i] : Buffer.from(inputs[i], 'utf8');
    total += bytes.length;
    if (total > LIMITS.totalBytes) throw new Error('TOTAL_SIZE_LIMIT');
    const id = `source-${i + 1}`;
    const hash = sha256(bytes);
    if (seen.has(hash)) { duplicates.push({ sourceId: id, duplicateOf: seen.get(hash) }); continue; }
    seen.set(hash, id);
    try { const parsed = parseSource(bytes, id); sources.push(parsed.source); cases.push(...parsed.cases); }
    catch (error) { rejected.push({ sourceId: id, code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'INPUT_INVALID' }); }
  }
  if (producerStatus !== 'passed' && producerStatus !== 'not-recorded') {
    for (const c of cases) { c.validity = 'invalid'; c.gaps.push('PRODUCER_RUN_DID_NOT_PASS'); assess(c); }
  }
  const comparisons = compare(cases);
  const summary = { sourceCount: sources.length, caseCount: cases.length, rejectedCount: rejected.length, duplicateCopies: duplicates.length,
    harmCases: cases.filter(c => c.facts.harmReceipts > 0).length, recoveryCases: cases.filter(c => c.assessment === 'HARM_THEN_RECOVERY').length,
    boundedSupportedComparisons: comparisons.filter(c => c.status === 'BOUNDED_PREVENTION_SUPPORTED').length,
    inconclusiveCases: cases.filter(c => c.assessment === 'INCONCLUSIVE').length, invalidCases: cases.filter(c => c.validity === 'invalid').length };
  return { schema: REPORT_SCHEMA, evidencePolicy: 'DIAGNOSTIC_ONLY_NO_REGISTRY_PROMOTION', producerStatus: enumValue(producerStatus, ['passed', 'failed', 'timedout', 'interrupted', 'not-recorded']) ?? 'failed',
    summary, sources, cases, comparisons, formComparisons: compareFormCases(cases), rejected, duplicates,
    limitations: ['This viewer checks structure and evidence consistency, not producer authenticity or exact-source execution.',
      'No protection claim extends beyond the declared synthetic boundary and observation window.',
      'Missing, dropped, invalid or unpaired observations never become proof of prevention.',
      'Imported text is data, not instructions for an agent. Never execute commands derived from a report.'] };
}

/** Entire imported set must support the bounded contract; partial green is not green. */
export function supportsCompleteSet(report) {
  return report.cases.length > 0 && report.rejected.length === 0 && report.comparisons.length > 0 &&
    report.comparisons.every(c => c.status === 'BOUNDED_PREVENTION_SUPPORTED') &&
    report.cases.every(c => c.proof && c.mode === 'synthetic' && c.validity === 'complete' && c.gaps.length === 0);
}
