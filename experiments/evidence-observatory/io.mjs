/** Local explicit-file boundary. No network access, ZIP extraction or dynamic imports. */
import fs from 'node:fs';
import path from 'node:path';
import { LIMITS } from './model.mjs';
import { renderReport } from './render.mjs';

// Refuse links in every existing path component, not only the final file.
export function assertPlainPath(input) {
  const absolute = path.resolve(input);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('LINKED_PATH_REFUSED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}
export function readInput(input) {
  const file = assertPlainPath(input);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('REGULAR_FILE_REQUIRED');
    if (stat.size > LIMITS.bytes) throw new Error('INPUT_SIZE_LIMIT');
    // Bounded descriptor read, even if a concurrently written file grows.
    const buffer = Buffer.alloc(LIMITS.bytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const read = fs.readSync(fd, buffer, total, buffer.length - total, null);
      if (!read) break;
      total += read;
    }
    if (total > LIMITS.bytes) throw new Error('INPUT_SIZE_LIMIT');
    // A view would retain the entire scratch allocation for every tiny input.
    return Buffer.from(buffer.subarray(0, total));
  } finally { fs.closeSync(fd); }
}
export function collectInputs(input) {
  const root = assertPlainPath(input), inputs = [];
  let visited = 0, total = 0;
  const walk = (target, depth) => {
    if (++visited > 1024 || depth > 8) throw new Error('DIRECTORY_TRAVERSAL_LIMIT');
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('LINKED_PATH_REFUSED');
    if (stat.isDirectory()) {
      // Do not allocate an unbounded readdir result from an untrusted directory.
      const directory = fs.opendirSync(target), entries = [];
      try {
        for (let entry; (entry = directory.readSync());) {
          if (entries.length >= 1024) throw new Error('DIRECTORY_TRAVERSAL_LIMIT');
          entries.push(entry.name);
        }
      } finally { directory.closeSync(); }
      for (const name of entries.sort()) walk(path.join(target, name), depth + 1);
    } else if (!stat.isFile()) throw new Error('REGULAR_FILE_REQUIRED');
    else if (target === root || target.endsWith('.json')) {
      if (inputs.length >= LIMITS.files) throw new Error('FILE_COUNT_LIMIT');
      const bytes = readInput(target);
      total += bytes.length;
      if (total > LIMITS.totalBytes) throw new Error('TOTAL_SIZE_LIMIT');
      inputs.push(bytes);
    }
  };
  walk(root, 0);
  if (!inputs.length) throw new Error('NO_JSON_INPUTS');
  return inputs;
}
export function writeReport(directory, report) {
  const output = assertPlainPath(directory);
  // A new directory prevents overwriting a receipt or leaving stale success output.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output, { mode: 0o700 });
  try {
    fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(output, 'index.html'), renderReport(report), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    // Leave partial output marked as such, never call it a complete report.
    try { fs.writeFileSync(path.join(output, 'INCOMPLETE'), 'Report generation failed. Do not use this output.\n', { flag: 'wx', mode: 0o600 }); } catch { /* Preserve the original error. */ }
    throw error;
  }
  return output;
}
