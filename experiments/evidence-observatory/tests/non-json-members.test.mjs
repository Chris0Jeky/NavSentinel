import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectInputs } from '../io.mjs';
import { demonstration } from '../demo.mjs';

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observatory-non-json-member-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('mixed-suffix directory members are not silently dropped', t => {
  for (const stray of ['bad.JSON', 'trace.json.bak', 'notes.txt']) {
    const dir = temporary(t);
    fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(demonstration()));
    fs.writeFileSync(path.join(dir, stray), JSON.stringify({ contradicting: true }));
    assert.throws(() => collectInputs(dir), /NON_JSON_MEMBER_PRESENT/, stray);
  }
});

test('unrelated artifacts remain ignored', t => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'good.json'), JSON.stringify(demonstration()));
  fs.writeFileSync(path.join(dir, 'image.png'), 'not an image');
  assert.equal(collectInputs(dir).length, 1);
});
