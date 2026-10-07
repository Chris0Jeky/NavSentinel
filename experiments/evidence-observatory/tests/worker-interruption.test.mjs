import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildReport, supportsCompleteSet } from '../model.mjs';
import { demonstration } from '../demo.mjs';
import { sceneDemonstration } from '../scene-demo.mjs';

const GAP = 'WORKER_OBSERVATION_INTERRUPTED';
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const report = raw => buildReport([JSON.stringify(raw)]);
function fixture(version) {
  const raw = version === 1 ? demonstration() : sceneDemonstration();
  raw.mode = 'synthetic';
  raw.identity.browserVersion = 'unit-browser';
  if (version === 2) raw.provenance.rawVerified = true;
  for (const run of raw.runs) run.observer.requiredMs = 1000;
  return raw;
}
function append(run, kind, source = 'browser', extra = {}) {
  const end = run.events.pop(), previous = run.events.at(-1);
  const sequence = run.events.length + 1, id = `${run.arm}-extra-${sequence}`;
  run.events.push({ id, sequence, elapsedMs: previous.elapsedMs + 10, source, kind,
    frame: 'none', causes: [previous.id], ...extra });
  run.events.push({ ...end, sequence: sequence + 1, causes: [id] });
}
function check(raw) {
  const directory = mkdtempSync(join(tmpdir(), 'ns-worker-interruption-'));
  try {
    const input = join(directory, 'trace.json');
    writeFileSync(input, JSON.stringify(raw));
    const result = spawnSync(process.execPath, [cli, 'check', '--input', input], {
      encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, '');
    return { status: result.status, report: JSON.parse(result.stdout) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

for (const version of [1, 2]) {
  test(`v${version}: uninterrupted fixture is a complete positive control`, () => {
    const result = report(fixture(version));
    assert.deepEqual(result.rejected, []);
    assert.equal(result.cases.length, 4);
    assert.ok(result.cases.every(c => c.validity === 'complete' && c.gaps.length === 0));
    assert.equal(supportsCompleteSet(result), true);
  });

  for (const arm of ['baseline', 'protected', 'benign', 'mixed']) {
    for (const kinds of [['worker.stopped'], ['worker.restarted'], ['worker.stopped', 'worker.restarted']]) {
      test(`v${version}: ${arm} ${kinds.join(' then ')} cannot certify uninterrupted prevention`, () => {
        const raw = fixture(version), run = raw.runs.find(r => r.arm === arm);
        for (const kind of kinds) append(run, kind);
        // No explicit observer.gap, fault.injected or v2 capture fault attests
        // the interruption: the validated browser event itself must suffice.
        const result = report(raw), observed = result.cases.find(c => c.arm === arm);
        assert.deepEqual(result.rejected, []);
        assert.deepEqual(observed.gaps, [GAP]);
        assert.deepEqual(observed.events.filter(e => e.kind.startsWith('worker.')).map(e => e.kind), kinds);
        assert.equal(result.comparisons[0].status, 'INCONCLUSIVE');
        assert.deepEqual(result.comparisons[0].reasons, ['OBSERVATIONS_INCOMPLETE_OR_INVALID']);
        assert.equal(result.summary.boundedSupportedComparisons, 0);
        assert.equal(supportsCompleteSet(result), false);
      });
    }
  }

  test(`v${version}: worker restart cannot erase retained harm or navigation recovery`, () => {
    const raw = fixture(version), run = raw.runs[0];
    append(run, 'worker.stopped');
    append(run, 'navigation.restored');
    append(run, 'worker.restarted');
    const result = report(raw), observed = result.cases[0];
    assert.deepEqual(result.rejected, []);
    assert.deepEqual(observed.gaps, [GAP]);
    assert.equal(observed.facts.harmReceipts, 1);
    assert.equal(observed.facts.recovered, true);
    assert.equal(observed.assessment, 'HARM_THEN_RECOVERY');
    assert.equal(result.summary.harmCases, 1);
    assert.equal(result.summary.recoveryCases, 1);
    assert.equal(supportsCompleteSet(result), false);
  });

  for (const kind of ['worker.stopped', 'worker.restarted']) {
    test(`v${version}: page-reported ${kind} cannot impersonate browser provenance`, () => {
      const raw = fixture(version); append(raw.runs[1], kind, 'page');
      const result = report(raw);
      assert.equal(result.rejected[0].code, 'EVENT_PROVENANCE_INVALID');
      assert.equal(supportsCompleteSet(result), false);
    });
  }

  test(`v${version}: real CLI check returns 1 for interrupted observations, 0 for control`, () => {
    const raw = fixture(version);
    const control = check(raw);
    assert.equal(control.status, 0);
    assert.equal(supportsCompleteSet(control.report), true);
    append(raw.runs[1], 'worker.stopped');
    append(raw.runs[1], 'worker.restarted');
    const interrupted = check(raw);
    assert.equal(interrupted.status, 1);
    assert.deepEqual(interrupted.report.rejected, []);
    assert.deepEqual(interrupted.report.cases[1].gaps, [GAP]);
    assert.equal(supportsCompleteSet(interrupted.report), false);
  });
}
