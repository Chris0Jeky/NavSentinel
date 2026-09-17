import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectInputs, readInput } from '../io.mjs';
import { LIMITS } from '../model.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'observatory-io-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function retainedBytes(inputs) {
  return [...new Set(inputs.map(input => input.buffer))]
    .reduce((total, buffer) => total + buffer.byteLength, 0);
}

test('tiny input owns a bounded backing store rather than retaining the read ceiling', t => {
  const file = path.join(fixture(t), 'tiny.json');
  fs.writeFileSync(file, '{"n":1}');
  const input = readInput(file);
  assert.ok(Buffer.isBuffer(input));
  assert.equal(input.toString(), '{"n":1}');
  assert.ok(input.buffer.byteLength <= Math.max(Buffer.poolSize, input.length));
});

test('a full collection of tiny files does not retain one maximum-size allocation per file', t => {
  const root = fixture(t);
  for (let i = 0; i < LIMITS.files; i++) {
    fs.writeFileSync(path.join(root, `${String(i).padStart(4, '0')}.json`), JSON.stringify({ n: i }));
  }
  const inputs = collectInputs(root);
  assert.equal(inputs.length, LIMITS.files);
  assert.deepEqual(inputs.map(input => JSON.parse(input).n), Array.from({ length: LIMITS.files }, (_, i) => i));
  assert.ok(retainedBytes(inputs) <= LIMITS.files * Buffer.poolSize,
    `tiny inputs retained ${retainedBytes(inputs)} backing bytes`);
  // A new read must not overwrite earlier results through a reused scratch buffer.
  const first = inputs[0].toString();
  const extra = path.join(root, 'other.txt');
  fs.writeFileSync(extra, 'different');
  readInput(extra);
  assert.equal(inputs[0].toString(), first);
});

test('empty regular input stays empty without retaining the read ceiling', t => {
  const file = path.join(fixture(t), 'empty.json');
  fs.writeFileSync(file, '');
  const input = readInput(file);
  assert.equal(input.length, 0);
  assert.equal(input.buffer.byteLength, 0);
});

test('exactly the input byte limit remains accepted and one extra byte is refused', t => {
  const file = path.join(fixture(t), 'boundary.json');
  const bytes = Buffer.alloc(LIMITS.bytes, 0x61);
  fs.writeFileSync(file, bytes);
  assert.deepEqual(readInput(file), bytes);
  fs.appendFileSync(file, 'x');
  assert.throws(() => readInput(file), /INPUT_SIZE_LIMIT/);
});

for (const oversized of [false, true]) {
  test(`descriptor reads still enforce the byte limit after growth (oversized=${oversized})`, t => {
    const file = path.join(fixture(t), 'growing.json');
    fs.writeFileSync(file, '{}');
    const original = fs.readSync;
    let appended = false;
    t.mock.method(fs, 'readSync', (...args) => {
      if (!appended) {
        appended = true;
        fs.appendFileSync(file, oversized ? Buffer.alloc(LIMITS.bytes) : '\n');
      }
      return original(...args);
    });
    if (oversized) assert.throws(() => readInput(file), /INPUT_SIZE_LIMIT/);
    else assert.equal(readInput(file).toString(), '{}\n');
  });
}
