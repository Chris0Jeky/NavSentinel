'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Ledger } = require('../daemon/security.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-ledger-staging-'));
  const remove = fs.rmSync;
  t.after(() => remove(root, { recursive: true, force: true }));
  const ledger = new Ledger(path.join(root, 'ledger'));
  ledger.append({ kind: 'before-failure' });
  return { root, ledger, temp: `${ledger.file}.${process.pid}.tmp`,
    state: ledger.snapshot(), bytes: fs.readFileSync(ledger.file, 'utf8') };
}

function unchanged(f) {
  assert.deepEqual(f.ledger.snapshot(), f.state, 'failed append must roll back in-memory state');
  assert.equal(fs.readFileSync(f.ledger.file, 'utf8'), f.bytes, 'committed journal must remain intact');
  assert.deepEqual(new Ledger(f.ledger.directory).snapshot(), f.state, 'previous journal must reopen');
}

function retry(f) {
  const entry = f.ledger.append({ kind: 'successful-retry' });
  assert.equal(entry.sequence, 2);
  assert.equal(new Ledger(f.ledger.directory).snapshot().entries.length, 2);
  assert.equal(fs.existsSync(f.temp), false);
}

test('an existing staging file is not overwritten, renamed or removed', t => {
  const f = fixture(t);
  fs.writeFileSync(f.temp, 'PREEXISTING_FILE');
  let failure;
  try { f.ledger.append({ kind: 'must-not-commit' }); } catch (error) { failure = error; }
  assert.equal(fs.existsSync(f.temp), true, 'an occupied staging path belongs to another operation');
  assert.equal(fs.readFileSync(f.temp, 'utf8'), 'PREEXISTING_FILE');
  assert.equal(failure?.code, 'EEXIST');
  unchanged(f);
  fs.unlinkSync(f.temp); // Test-owned obstruction, not application cleanup of an unknown file.
  retry(f);
});

for (const link of ['symlink', 'hardlink']) {
  test(`a staging ${link} cannot truncate an unrelated file`, t => {
    const f = fixture(t);
    const victim = path.join(f.root, 'unrelated.txt');
    fs.writeFileSync(victim, 'UNRELATED_FILE_MUST_SURVIVE');
    try {
      if (link === 'symlink') fs.symlinkSync(victim, f.temp);
      else fs.linkSync(victim, f.temp);
    } catch (error) {
      if (link === 'symlink' && process.platform === 'win32' && error.code === 'EPERM') {
        t.skip('This Windows account cannot create the file symlink required by this test.');
        return;
      }
      throw error;
    }
    let failure;
    try { f.ledger.append({ kind: 'must-not-commit' }); } catch (error) { failure = error; }
    assert.equal(fs.readFileSync(victim, 'utf8'), 'UNRELATED_FILE_MUST_SURVIVE');
    assert.equal(failure?.code, 'EEXIST');
    assert.equal(fs.existsSync(f.temp), true, 'do not remove a staging path this write did not create');
    unchanged(f);
  });
}

for (const phase of ['write', 'sync', 'rename']) {
  test(`${phase} failure cleans the owned staging file and allows a later append`, t => {
    const f = fixture(t);
    const failure = new Error(`injected ${phase} failure`);
    let descriptor;
    if (phase === 'write') {
      const write = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (file, data, ...args) => {
        if (typeof file !== 'number') return write(file, data, ...args);
        descriptor = file;
        write(file, 'PARTIAL_JOURNAL');
        throw failure;
      });
    } else if (phase === 'sync') {
      t.mock.method(fs, 'fsyncSync', fd => { descriptor = fd; throw failure; });
    } else {
      t.mock.method(fs, 'renameSync', () => { throw failure; });
    }
    assert.throws(() => f.ledger.append({ kind: 'must-not-commit' }), error => error === failure);
    assert.equal(fs.existsSync(f.temp), false, 'failed writes must not strand their own staging file');
    if (descriptor !== undefined) assert.throws(() => fs.fstatSync(descriptor), { code: 'EBADF' });
    t.mock.restoreAll();
    unchanged(f);
    retry(f);
  });
}

test('an allocation failure does not try to clean a staging file it never owned', t => {
  const f = fixture(t);
  const failure = new Error('injected open failure');
  const open = fs.openSync;
  let cleanups = 0;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (file === f.temp) throw failure;
    return open(file, ...args);
  });
  t.mock.method(fs, 'rmSync', () => { cleanups++; });
  assert.throws(() => f.ledger.append({ kind: 'must-not-commit' }), error => error === failure);
  assert.equal(cleanups, 0);
  t.mock.restoreAll();
  unchanged(f);
  retry(f);
});

test('a cleanup failure preserves both errors and never reports a committed append', t => {
  const f = fixture(t);
  const writeFailure = new Error('injected sync failure');
  const cleanupFailure = new Error('injected cleanup failure');
  t.mock.method(fs, 'fsyncSync', () => { throw writeFailure; });
  t.mock.method(fs, 'rmSync', () => { throw cleanupFailure; });
  assert.throws(() => f.ledger.append({ kind: 'must-not-commit' }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [writeFailure, cleanupFailure]);
    return true;
  });
  assert.equal(fs.existsSync(f.temp), true, 'cleanup denial leaves an explicit obstruction');
  t.mock.restoreAll();
  unchanged(f);
  fs.unlinkSync(f.temp); // Resolve the injected test-owned cleanup denial.
  retry(f);
});

test('a successful append leaves one valid journal and no staging file', t => {
  const f = fixture(t);
  retry(f);
  assert.deepEqual(fs.readdirSync(f.ledger.directory), ['journal.json']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.ledger.file).mode & 0o777, 0o600);
});
