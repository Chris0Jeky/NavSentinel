import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildReport, sha256, LIMITS } from '../model.mjs';
import { demonstration } from '../demo.mjs';
import { renderReport } from '../render.mjs';
import { collectInputs, readInput, writeReport } from '../io.mjs';
import Reporter from '../reporter.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const demo = () => buildReport([JSON.stringify(demonstration())]);
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'observatory-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
function symlinkOrSkip(t, target, link, type) {
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' && type === 'dir' ? 'junction' : type);
    return true;
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows host does not permit creating the symlink needed by this test');
      return false;
    }
    throw error;
  }
}

test('standalone HTML has an exact script hash and syntactically valid script', () => {
  const html = renderReport(demo());
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
  const code = scripts.at(-1)[1];
  assert.doesNotThrow(() => new vm.Script(code));
  const expected = Buffer.from(sha256(code), 'hex').toString('base64');
  assert.ok(html.includes(`sha256-${expected}`));
  assert.ok(html.includes("connect-src &#39;none&#39;"));
  assert.ok(!html.includes('innerHTML'));
  assert.ok(!/<(?:script|img)[^>]+src=/.test(html));
});
test('hostile imported strings are data and cannot break script boundaries', () => {
  const r = demo(); r.cases[0].title = '</script><img src=x onerror=alert(1)>\u2028';
  const html = renderReport(r);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('\\u003c/script\\u003e'));
  assert.equal((html.match(/<script/g) ?? []).length, 2);
});
test('arm filters have all native options and accessible controls', () => {
  const html = renderReport(demo());
  for (const arm of ['baseline', 'protected', 'benign', 'mixed', 'unknown']) assert.ok(html.includes(`<option>${arm}</option>`));
  assert.ok(html.includes('aria-live')); assert.ok(html.includes('type="range"'));
});
test('empty report still produces a safe empty viewer', () => assert.ok(renderReport(buildReport([])).includes('Evidence Observatory')));
test('wrong report schema is not rendered', () => assert.throws(() => renderReport({ schema: 'wrong' })));
test('local input discovery is bounded and ignores non-JSON artifacts', t => {
  const dir = temporary(t); fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(demonstration())); fs.writeFileSync(path.join(dir, 'image.png'), 'not an image');
  assert.equal(collectInputs(dir).length, 1);
});
test('directory symlinks are refused, never traversed', t => {
  const dir = temporary(t); fs.mkdirSync(path.join(dir, 'source'));
  if (!symlinkOrSkip(t, path.join(dir, 'source'), path.join(dir, 'linked'), 'dir')) return;
  assert.throws(() => collectInputs(path.join(dir, 'linked')), /LINKED_PATH_REFUSED/);
});
test('symlinked files and ancestors are refused', t => {
  const dir = temporary(t); fs.writeFileSync(path.join(dir, 'source.json'), '{}');
  if (!symlinkOrSkip(t, path.join(dir, 'source.json'), path.join(dir, 'linked.json'))) return;
  assert.throws(() => readInput(path.join(dir, 'linked.json')), /LINKED_PATH_REFUSED/);
});
test('oversized input is rejected before reading unbounded data', t => {
  const dir = temporary(t), file = path.join(dir, 'large.json'); fs.writeFileSync(file, Buffer.alloc(LIMITS.bytes + 1)); assert.throws(() => readInput(file), /INPUT_SIZE_LIMIT/);
});
test('existing output is not overwritten', t => {
  const dir = temporary(t), out = path.join(dir, 'out'); writeReport(out, demo()); const before = fs.readFileSync(path.join(out, 'report.json'));
  assert.throws(() => writeReport(out, demo()), /EEXIST/); assert.deepEqual(fs.readFileSync(path.join(out, 'report.json')), before);
});
test('CLI demo emits a usable HTML and JSON bundle', t => {
  const dir = temporary(t), out = path.join(dir, 'out'), run = invoke(['demo', '--out', out]); assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).boundedSupportedComparisons, 0); assert.ok(fs.existsSync(path.join(out, 'index.html')));
});
test('headless check returns non-success for demo without hiding its facts', t => {
  const dir = temporary(t), input = path.join(dir, 'demo.json'); fs.writeFileSync(input, JSON.stringify(demonstration()));
  const run = invoke(['check', '--input', input]); assert.equal(run.status, 1); assert.equal(JSON.parse(run.stdout).summary.harmCases, 1);
});
test('unsupported input is a visible refusal with exit 2', t => {
  const dir = temporary(t), input = path.join(dir, 'unknown.json'); fs.writeFileSync(input, '{}');
  const run = invoke(['inspect', '--input', input, '--out', path.join(dir, 'out')]); assert.equal(run.status, 2); assert.equal(JSON.parse(run.stdout).rejectedCount, 1);
});
test('CLI errors do not leak private filenames', t => {
  const dir = temporary(t), run = invoke(['check', '--input', path.join(dir, 'PRIVATE-UNIQUE-NAME')]);
  assert.equal(run.status, 2); assert.ok(!run.stderr.includes('PRIVATE-UNIQUE-NAME'));
});
test('CLI rejects duplicate, unknown and incomplete arguments', () => {
  for (const args of [['unknown'], ['demo', '--out'], ['demo', '--out', 'a', '--out', 'b'], ['check', '--out', 'a']]) assert.equal(invoke(args).status, 2);
});
test('reporter failure after successful attachments invalidates prior evidence', t => {
  const dir = temporary(t), output = path.join(dir, 'out'), reporter = new Reporter({ output });
  reporter.onTestEnd({}, { status: 'passed', retry: 0, attachments: [{ contentType: 'application/json', body: Buffer.from(JSON.stringify(demonstration())) }] });
  reporter.onTestEnd({}, { status: 'failed', retry: 0, attachments: [] }); reporter.onEnd({ status: 'failed' });
  const r = JSON.parse(fs.readFileSync(path.join(output, 'report.json'))); assert.equal(r.summary.invalidCases, 4); assert.equal(r.execution.withoutJson, 1);
});
test('reporter never treats a retry as an independent successful repetition', t => {
  const dir = temporary(t), output = path.join(dir, 'out'), reporter = new Reporter({ output });
  const attachment = { contentType: 'application/json', body: Buffer.from(JSON.stringify(demonstration())) };
  reporter.onTestEnd({}, { status: 'passed', retry: 1, attachments: [attachment, attachment] }); reporter.onEnd({ status: 'passed' });
  const r = JSON.parse(fs.readFileSync(path.join(output, 'report.json'))); assert.equal(r.summary.duplicateCopies, 1); assert.equal(r.execution.retried, 1); assert.equal(r.summary.invalidCases, 4);
});
test('missing attachment is an explicit collection error', t => {
  const dir = temporary(t), output = path.join(dir, 'out'), reporter = new Reporter({ output });
  reporter.onTestEnd({}, { status: 'passed', retry: 0, attachments: [{ contentType: 'application/json', path: path.join(dir, 'missing') }] }); reporter.onEnd({ status: 'passed' });
  const r = JSON.parse(fs.readFileSync(path.join(output, 'report.json'))); assert.equal(r.execution.collectionErrors, 1); assert.equal(r.producerStatus, 'failed');
});
