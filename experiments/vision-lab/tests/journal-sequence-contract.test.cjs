'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Ledger } = require('../daemon/security.cjs');

function workspace(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-journal-sequence-'));
  try { run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function empty(baseSequence = 0, nextSequence = 1) {
  return { schema: 1, anchor: '0'.repeat(64), baseSequence, nextSequence, entries: [] };
}
const invalidCounters = [
  ['negative base', -1, 0],
  ['negative next', -3, -2],
  ['rounded 2^53', 2 ** 53, 2 ** 53],
  ['rounded large integer', 1e30, 1e30],
  ['largest finite integer', Number.MAX_VALUE, Number.MAX_VALUE],
  ['zero next', 0, 0],
  ['fractional base', 0.5, 1.5],
  ['fractional next', 0, 1.5],
  ['string base', '0', 1],
  ['string next', 0, '1'],
];

for (const [label, base, next] of invalidCounters) {
  test(`verify refuses ${label} counters rather than certifying an empty chain`, () => workspace(directory => {
    const ledger = new Ledger(directory);
    ledger.state = empty(base, next);
    assert.equal(ledger.verify(), false);
    assert.equal(ledger.snapshot().verified, false);
  }));

  test(`startup refuses ${label} counters without changing existing bytes`, () => workspace(directory => {
    const file = path.join(directory, 'journal.json');
    const bytes = JSON.stringify(empty(base, next));
    fs.writeFileSync(file, bytes);
    assert.throws(() => new Ledger(directory), /Journal integrity check failed/);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    assert.deepEqual(fs.readdirSync(directory), ['journal.json']);
  }));
}

for (const invalid of [null, [], 'not-an-entry']) {
  test(`malformed entry ${JSON.stringify(invalid)} produces a false verification result`, () => workspace(directory => {
    const ledger = new Ledger(directory);
    ledger.state = { ...empty(0, 2), entries: [invalid] };
    assert.equal(ledger.verify(), false);
    assert.equal(ledger.snapshot().verified, false);
    fs.writeFileSync(ledger.file, JSON.stringify(ledger.state));
    const bytes = fs.readFileSync(ledger.file);
    assert.throws(() => new Ledger(directory), /Journal integrity check failed/);
    assert.deepEqual(fs.readFileSync(ledger.file), bytes);
  }));
}

test('normal sequence, retention anchor and reload remain valid', () => workspace(directory => {
  const ledger = new Ledger(directory, { limit: 2 });
  assert.equal(ledger.verify(), true);
  const receipts = [1, 2, 3].map(value => ledger.append({ value }));
  assert.deepEqual(receipts.map(entry => entry.sequence), [1, 2, 3]);
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.baseSequence, 1);
  assert.equal(snapshot.nextSequence, 4);
  assert.equal(snapshot.anchor, receipts[0].hash);
  assert.deepEqual(snapshot.entries.map(entry => entry.sequence), [2, 3]);
  assert.equal(snapshot.verified, true);
  assert.deepEqual(new Ledger(directory, { limit: 2 }).snapshot(), snapshot);
}));

test('last representable next counter remains readable but refuses further allocation before mutation', () => workspace(directory => {
  const maximum = Number.MAX_SAFE_INTEGER;
  fs.writeFileSync(path.join(directory, 'journal.json'), JSON.stringify(empty(maximum - 3, maximum - 2)));
  const ledger = new Ledger(directory, { limit: 1 });
  const penultimate = ledger.append({ value: 'penultimate' });
  const last = ledger.append({ value: 'last' });
  assert.equal(penultimate.sequence, maximum - 2);
  assert.equal(last.sequence, maximum - 1);
  assert.equal(ledger.state.baseSequence, maximum - 2);
  assert.equal(ledger.state.nextSequence, maximum);
  assert.equal(ledger.verify(), true);
  const before = ledger.snapshot(), bytes = fs.readFileSync(ledger.file);
  const names = fs.readdirSync(directory);
  let encodings = 0;
  const data = { toJSON() { encodings++; return { value: 'must-not-append' }; } };
  assert.throws(() => ledger.append(data), /Journal sequence capacity reached/);
  assert.equal(encodings, 0, 'refuse before caller serialization or persistence');
  assert.deepEqual(ledger.snapshot(), before);
  assert.deepEqual(fs.readFileSync(ledger.file), bytes);
  assert.deepEqual(fs.readdirSync(directory), names);
  const reopened = new Ledger(directory, { limit: 1 });
  assert.deepEqual(reopened.snapshot(), before);
  assert.throws(() => reopened.append({ value: 'still-exhausted' }), /Journal sequence capacity reached/);
  assert.deepEqual(fs.readFileSync(ledger.file), bytes);
}));
