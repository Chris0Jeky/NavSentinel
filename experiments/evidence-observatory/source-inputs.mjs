/** Raw committed-byte binding for this optional campaign, not a release/tag gate.
 * Dependencies, OS/toolchain and concurrent hostile-process races remain trusted.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const MAX_BYTES = 64 * 1024 * 1024;
const excluded = name => name === '.git' || name.split('/').includes('node_modules') ||
  ['extension/dist', 'dist', '.vite', 'artifacts', 'test-results', 'playwright-report'].some(p => name === p || name.startsWith(`${p}/`));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  const nullDevice = process.platform === 'win32' ? 'NUL' : os.devNull;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: nullDevice, GIT_CONFIG_GLOBAL: nullDevice, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' };
}
function plain(root, relative) {
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('LINKED_INPUT');
  }
  return current;
}
export function captureInputs(inputRoot = process.cwd()) {
  const root = path.resolve(inputRoot);
  if (fs.realpathSync(root) !== root) throw new Error('LINKED_INPUT');
  const git = (args, input) => execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args],
    { cwd: root, env: gitEnv(), maxBuffer: MAX_BYTES, ...(input === undefined ? {} : { input }) });
  const head = git(['rev-parse', '--verify', 'HEAD']).toString().trim();
  const tree = git(['rev-parse', '--verify', 'HEAD^{tree}']).toString().trim();
  if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(tree)) throw new Error('GIT_IDENTITY_INVALID');
  const listing = new TextDecoder('utf-8', { fatal: true }).decode(git(['ls-tree', '-rz', 'HEAD']));
  const entries = listing.split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match) throw new Error('SOURCE_MODE_UNSUPPORTED');
    const [, mode, oid, name] = match;
    if (name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.') || /[\\\r\n:]/.test(name)) throw new Error('SOURCE_PATH_INVALID');
    if (excluded(name)) throw new Error('GENERATED_INPUT_TRACKED');
    return { mode, oid, name };
  });
  if (entries.length > 6000) throw new Error('SOURCE_COUNT_LIMIT');
  const names = new Set(entries.map(e => e.name));
  if (new Set(entries.map(e => e.name.toLowerCase())).size !== entries.length) throw new Error('SOURCE_CASE_COLLISION');
  let visited = 0;
  const walk = (relative = '') => {
    const dir = fs.opendirSync(path.join(root, relative));
    try {
      for (let entry; (entry = dir.readSync());) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (excluded(name)) continue;
        if (++visited > 10000) throw new Error('SOURCE_COUNT_LIMIT');
        const full = plain(root, name), stat = fs.lstatSync(full);
        if (stat.isDirectory()) walk(name);
        else if (!stat.isFile()) throw new Error('SOURCE_MODE_UNSUPPORTED');
        else if (!names.has(name)) throw new Error('UNTRACKED_INPUT');
      }
    } finally { dir.closeSync(); }
  };
  walk();
  const committed = git(['cat-file', '--batch'], `${entries.map(e => e.oid).join('\n')}\n`);
  let cursor = 0, bytes = 0; const hash = createHash('sha256'); let lockSha256 = null;
  for (const e of entries) {
    const end = committed.indexOf(10, cursor);
    if (end < 0) throw new Error('GIT_BLOB_STREAM_INVALID');
    const header = committed.subarray(cursor, end).toString('ascii').split(' ');
    const length = Number(header[2]);
    if (header[0] !== e.oid || header[1] !== 'blob' || !Number.isSafeInteger(length) || length < 0 || length > MAX_BYTES) throw new Error('GIT_BLOB_STREAM_INVALID');
    const blob = committed.subarray(end + 1, end + 1 + length); cursor = end + 2 + length;
    const full = plain(root, e.name), stat = fs.lstatSync(full);
    if (!stat.isFile()) throw new Error('SOURCE_MODE_UNSUPPORTED');
    if (stat.size !== length || (bytes += length) > MAX_BYTES) throw new Error('SOURCE_BYTES_DIFFER');
    const fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let raw;
    try {
      // One extra byte detects concurrent growth without an unbounded read.
      const buffer = Buffer.alloc(length + 1); let used = 0;
      while (used < buffer.length) { const n = fs.readSync(fd, buffer, used, buffer.length - used, null); if (!n) break; used += n; }
      raw = buffer.subarray(0, used);
    } finally { fs.closeSync(fd); }
    if (!raw.equals(blob)) throw new Error('SOURCE_BYTES_DIFFER');
    hash.update(`${e.mode}\0${e.name}\0${raw.length}\0`); hash.update(raw);
    if (e.name === 'package-lock.json') lockSha256 = sha(raw);
  }
  if (git(['rev-parse', 'HEAD']).toString().trim() !== head) throw new Error('SOURCE_HEAD_CHANGED');
  if (!lockSha256) throw new Error('LOCKFILE_MISSING');
  return { head, tree, digest: hash.digest('hex'), lockSha256, files: entries.length, bytes };
}
export function hashArtifact(inputRoot) {
  const root = path.resolve(inputRoot), files = [];
  if (fs.realpathSync(root) !== root) throw new Error('LINKED_INPUT');
  let bytes = 0;
  const walk = (relative = '') => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const target = plain(root, name), stat = fs.lstatSync(target);
      if (stat.isDirectory()) walk(name);
      else if (stat.isFile() && files.length < 4096 && (bytes += stat.size) <= MAX_BYTES) files.push(name);
      else throw new Error('ARTIFACT_LIMIT_OR_MODE_INVALID');
    }
  };
  walk(); const hash = createHash('sha256');
  for (const name of files.sort()) { const raw = fs.readFileSync(plain(root, name)); hash.update(`${name}\0${raw.length}\0`); hash.update(raw); }
  if (!files.includes('manifest.json')) throw new Error('ARTIFACT_MANIFEST_MISSING');
  return hash.digest('hex');
}
