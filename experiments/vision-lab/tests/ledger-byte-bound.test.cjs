'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Ledger } = require('../daemon/security.cjs');

const MAX_BYTES = 4 * 1024 * 1024;
const large = { v: 'a'.repeat(8184) };

// A valid independently constructed hash chain avoids thousands of fsyncs in
// fixture setup. Every exercised append and reopen uses the actual Ledger.
function nearLimit(t, data = large, limit = 500) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-ledger-bytes-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const builder = new Ledger(directory, { limit });
  const state = builder.state;
  let entryBytes = 0;
  for (let i = 1; i <= limit; i++) {
    const entry = { sequence: state.nextSequence++, timestamp: '2026-10-07T00:00:00.000Z',
      previous: state.entries.at(-1)?.hash || state.anchor, data };
    entry.hash = builder.entryHash(entry);
    state.entries.push(entry);
    entryBytes += Buffer.byteLength(JSON.stringify(entry)) + (i > 1 ? 1 : 0);
    const bytes = entryBytes + Buffer.byteLength(JSON.stringify({ ...state, entries: [] }));
    if (bytes > MAX_BYTES) { state.entries.pop(); state.nextSequence--; break; }
  }
  fs.writeFileSync(builder.file, JSON.stringify(state));
  const ledger = new Ledger(directory, { limit });
  assert.equal(ledger.verify(), true);
  assert.ok(fs.statSync(ledger.file).size <= MAX_BYTES);
  return { ledger, limit };
}

function checkAppend(f, data) {
  const before = f.ledger.snapshot();
  const entry = f.ledger.append(data);
  const after = f.ledger.snapshot();
  assert.ok(fs.statSync(f.ledger.file).size <= MAX_BYTES, 'an accepted journal must remain reopenable');
  assert.equal(after.verified, true);
  assert.equal(entry.sequence, before.nextSequence);
  assert.equal(after.nextSequence, entry.sequence + 1);
  assert.deepEqual(after.entries, [...before.entries.filter(e => e.sequence > after.baseSequence), entry]);
  if (after.baseSequence > before.baseSequence) {
    assert.equal(after.anchor, before.entries.find(e => e.sequence === after.baseSequence).hash);
  }
  assert.deepEqual(new Ledger(f.ledger.directory, { limit: f.limit }).snapshot(), after);
  return { before, after };
}

test('full-sized valid receipts cannot make the default journal too large to reopen', t => {
  const f = nearLimit(t);
  assert.equal(Buffer.byteLength(JSON.stringify(large)), 8192);
  assert.equal(f.ledger.state.entries.length, 498);
  for (let i = 0; i < 3; i++) {
    const { before, after } = checkAppend(f, large);
    assert.ok(after.baseSequence > before.baseSequence);
    assert.ok(after.entries.length < 500, 'byte retention must apply before the row cap');
  }
});

test('the persisted limit counts UTF-8 bytes rather than JavaScript string length', t => {
  const unicode = { v: '界'.repeat(2728) };
  assert.equal(Buffer.byteLength(JSON.stringify(unicode)), 8192);
  assert.ok(JSON.stringify(unicode).length < 8192);
  const f = nearLimit(t, unicode);
  checkAppend(f, unicode);
});

test('one large receipt can evict multiple old small rows without changing retained entries', t => {
  const f = nearLimit(t, { v: 's'.repeat(300) }, 10000);
  const { before, after } = checkAppend(f, large);
  assert.ok(after.baseSequence - before.baseSequence > 1);
});

test('a failed write after byte eviction restores both state and committed bytes', t => {
  const f = nearLimit(t);
  const state = f.ledger.snapshot();
  const bytes = fs.readFileSync(f.ledger.file, 'utf8');
  const failure = new Error('injected rename failure after compaction');
  t.mock.method(fs, 'renameSync', () => { throw failure; });
  assert.throws(() => f.ledger.append(large), error => error === failure);
  t.mock.restoreAll();
  assert.deepEqual(f.ledger.snapshot(), state);
  assert.equal(fs.readFileSync(f.ledger.file, 'utf8'), bytes);
  assert.deepEqual(new Ledger(f.ledger.directory).snapshot(), state);
  checkAppend(f, large);
});

test('the row cap still applies independently of the byte cap', t => {
  const f = nearLimit(t, { v: 'small' }, 2);
  const { after } = checkAppend(f, { v: 'latest' });
  assert.equal(after.entries.length, 2);
  assert.equal(after.baseSequence, 1);
});

test('a receipt over 8192 bytes is rejected before either retention bound mutates state', t => {
  const f = nearLimit(t);
  const state = f.ledger.snapshot();
  const bytes = fs.readFileSync(f.ledger.file, 'utf8');
  assert.throws(() => f.ledger.append({ v: 'a'.repeat(8185) }), /Receipt exceeds byte limit/);
  assert.deepEqual(f.ledger.snapshot(), state);
  assert.equal(fs.readFileSync(f.ledger.file, 'utf8'), bytes);
});

test('uncompactable imported metadata fails closed without discarding the new receipt silently', t => {
  const f = nearLimit(t, { v: 'small' }, 1);
  const state = f.ledger.snapshot();
  // Unknown root metadata is accepted by the existing schema verifier. Keep
  // it byte-exactly at the read limit and require safe failure, not data loss.
  delete state.verified;
  delete state.integrityMeaning;
  state.padding = '';
  state.padding = 'x'.repeat(MAX_BYTES - Buffer.byteLength(JSON.stringify(state)));
  fs.writeFileSync(f.ledger.file, JSON.stringify(state));
  const ledger = new Ledger(f.ledger.directory, { limit: 1 });
  const before = ledger.snapshot();
  const bytes = fs.readFileSync(ledger.file, 'utf8');
  assert.throws(() => ledger.append(large), /Journal exceeds size limit/);
  assert.deepEqual(ledger.snapshot(), before);
  assert.equal(fs.readFileSync(ledger.file, 'utf8'), bytes);
  assert.deepEqual(new Ledger(ledger.directory, { limit: 1 }).snapshot(), before);
});
