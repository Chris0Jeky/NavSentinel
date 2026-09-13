import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as source from '../source-inputs.mjs';
function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'observatory-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  fs.mkdirSync(path.join(root, 'gym')); fs.writeFileSync(path.join(root, 'gym', 'fixture.html'), 'original\n');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'gym/ignored.js\n'); git('add', '.'); git('commit', '-qm', 'test');
  return { root, git };
}
test('raw source verification binds committed source and lockfile', t => {
  const { root, git } = repo(t); assert.equal(typeof source.captureInputs, 'function');
  const value = source.captureInputs(root);
  assert.equal(value.head, git('rev-parse', 'HEAD')); assert.equal(value.tree, git('rev-parse', 'HEAD^{tree}'));
  assert.match(value.digest, /^[a-f0-9]{64}$/); assert.match(value.lockSha256, /^[a-f0-9]{64}$/);
});
test('ordinary and ignored untracked inputs inside fixture/build roots are refused', t => {
  const { root } = repo(t); assert.equal(typeof source.captureInputs, 'function');
  for (const name of ['ignored.js', 'new.js']) {
    fs.writeFileSync(path.join(root, 'gym', name), 'extra'); assert.throws(() => source.captureInputs(root), /UNTRACKED_INPUT/); fs.unlinkSync(path.join(root, 'gym', name));
  }
});
test('a clean filter cannot launder different executed bytes', t => {
  const { root, git } = repo(t); assert.equal(typeof source.captureInputs, 'function');
  fs.writeFileSync(path.join(root, '.gitattributes'), 'gym/fixture.html filter=mask\n');
  git('config', 'filter.mask.clean', 'printf "original\\n"'); git('add', '.gitattributes'); git('commit', '-qm', 'filter');
  fs.writeFileSync(path.join(root, 'gym', 'fixture.html'), 'changed attack\n');
  assert.equal(git('diff', '--name-only'), '');
  assert.throws(() => source.captureInputs(root), /SOURCE_BYTES_DIFFER/);
});
test('symlinks in executed source are rejected', t => {
  const { root } = repo(t); assert.equal(typeof source.captureInputs, 'function');
  fs.renameSync(path.join(root, 'gym', 'fixture.html'), path.join(root, 'other.html'));
  fs.symlinkSync('../other.html', path.join(root, 'gym', 'fixture.html'));
  assert.throws(() => source.captureInputs(root), /LINKED_INPUT/);
});
test('inherited Git index/object/worktree overrides are not honored', t => {
  const { root, git } = repo(t); assert.equal(typeof source.captureInputs, 'function');
  const before = process.env.GIT_WORK_TREE; process.env.GIT_WORK_TREE = '/not-the-repository';
  try { assert.equal(source.captureInputs(root).head, git('rev-parse', 'HEAD')); }
  finally { if (before === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = before; }
});
