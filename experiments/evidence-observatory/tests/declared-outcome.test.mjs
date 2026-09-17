import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, supportsCompleteSet } from '../model.mjs';
import { demonstration } from '../demo.mjs';

function fixture() {
  const raw = demonstration();
  raw.mode = 'synthetic';
  raw.identity.browserVersion = '143.0.7499.4';
  return raw;
}

test('rejects a present noncanonical declared outcome', () => {
  const raw = fixture();
  raw.runs[1].declaredOutcome = ' blocked_pre_harm ';

  const report = buildReport([JSON.stringify(raw)]);

  assert.deepEqual(
    report.rejected.map(entry => entry.code),
    ['DECLARED_OUTCOME_INVALID'],
  );
  assert.equal(report.summary.boundedSupportedComparisons, 0);
  assert.equal(supportsCompleteSet(report), false);
});

test('keeps an omitted declared outcome optional and projects UNKNOWN', () => {
  const raw = fixture();
  delete raw.runs[1].declaredOutcome;

  const report = buildReport([JSON.stringify(raw)]);

  assert.equal(report.rejected.length, 0);
  assert.equal(report.cases[1].declaredOutcome, 'UNKNOWN');
});
