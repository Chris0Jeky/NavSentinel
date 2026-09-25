import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDocumentCapture } from './check-capture.mjs';
import { expectedKeys } from './compare.mjs';
const fixtures=()=>expectedKeys.map((key,i)=>({schema:'navsentinel.observatory.form.v2',bindingPolicy:'CDP_DEFAULT_WORLD_DOCUMENT',experiment:'form-campaign',variant:key.split(':')[0],protectedArm:key.endsWith(':true'),runId:`run-${i}`,completed:true,dropped:0,gaps:[],identity:{head:'a'.repeat(40)},events:[{kind:'document.started'},{kind:'form.intent'},{kind:'document.ended'},{kind:'observation.end'}]}));
test('all fixed arm captures pass only the capture check, not protection',()=>{const r=checkDocumentCapture(fixtures());assert.equal(r.passed,true);assert.equal(r.records,expectedKeys.length);assert.equal(r.evidencePolicy,'CAPTURE_COMPLETENESS_NOT_PROTECTION_EVIDENCE');});
for(const [name,modify]of[
 ['missing capture',r=>r.pop()],['duplicate arm',r=>r[1]=structuredClone(r[0])],['reused run',r=>r[1].runId=r[0].runId],['failed run',r=>r[0].completed=false],['observer gap',r=>r[0].gaps=['DOCUMENT_CONTEXT_UNKNOWN']],['dropped report',r=>r[0].dropped=1],['unbound legacy',r=>r[0].schema='navsentinel.observatory.form.v1'],['lifecycle substituted',r=>r[0].experiment='same-url-siblings'],['missing snapshot',r=>r[0].events.splice(1,1)],['missing end',r=>r[0].events.pop()],['different head',r=>r[1].identity.head='b'.repeat(40)],
])test(`${name} cannot be hidden by outcome parity`,()=>{const r=fixtures();modify(r);assert.equal(checkDocumentCapture(r).passed,false);});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise the workflow pipeline itself, not only the checker exit code.
function runCaptureStep(t, rows, setup = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-capture-pipeline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'test-results/form-full');
  const output = path.join(root, 'form-evidence');
  const scripts = path.join(root, 'experiments/form-observatory');
  for (const directory of [input, output, scripts]) fs.mkdirSync(directory, { recursive: true });
  rows.forEach((row, index) => fs.writeFileSync(path.join(input, `${index}.form-trace.json`), JSON.stringify(row)));
  for (const file of ['check-capture.mjs', 'compare.mjs', 'trace-contract.mjs']) {
    fs.copyFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), path.join(scripts, file));
  }
  setup({ input, output });
  const workflow = fs.readFileSync(new URL('../../.github/workflows/observatory-form-evidence.yml', import.meta.url), 'utf8');
  const blocks = workflow.split(/(?=^      - )/m).filter((block) =>
    /^        run: node experiments\/form-observatory\/check-capture\.mjs /m.test(block));
  assert.equal(blocks.length, 1, 'one authoritative capture step is required');
  const block = blocks[0];
  const command = block.match(/^        run: (.+)$/m)[1];
  const shell = block.match(/^        shell: (.+)$/m)?.[1];
  assert.ok(shell === undefined || shell === 'bash', 'unsupported workflow shell');
  assert.doesNotMatch(block, /continue-on-error:/);
  const script = path.join(root, 'capture-step.sh');
  fs.writeFileSync(script, `${command}\n`);
  const args = shell === 'bash' ? ['--noprofile', '--norc', '-eo', 'pipefail', script] : ['-e', script];
  const child = spawnSync('bash', args, { cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` },
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  return { ...child, report: path.join(output, 'capture-check.json') };
}

test('workflow capture pipeline refuses incomplete evidence and retains diagnostic JSON', (t) => {
  const rows = fixtures();
  rows[0].completed = false;
  const child = runCaptureStep(t, rows);
  assert.equal(child.status, 1);
  assert.equal(child.stderr, '');
  assert.equal(JSON.parse(child.stdout).error, 'CAPTURE_INCOMPLETE');
  assert.equal(fs.readFileSync(child.report, 'utf8'), child.stdout);
});

test('workflow capture pipeline refuses malformed input instead of accepting tee success', (t) => {
  const child = runCaptureStep(t, fixtures(), ({ input }) =>
    fs.writeFileSync(path.join(input, '0.form-trace.json'), '{invalid JSON'));
  assert.equal(child.status, 2);
  assert.equal(JSON.parse(child.stderr).error, 'CAPTURE_INPUT_FAILED');
});

test('workflow capture pipeline accepts all declared arms and preserves its report', (t) => {
  const child = runCaptureStep(t, fixtures());
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.equal(JSON.parse(child.stdout).records, expectedKeys.length);
  assert.equal(JSON.parse(child.stdout).passed, true);
  assert.equal(fs.readFileSync(child.report, 'utf8'), child.stdout);
});

test('workflow capture pipeline refuses report-write failure', (t) => {
  const child = runCaptureStep(t, fixtures(), ({ output }) => {
    fs.rmSync(output, { recursive: true });
    fs.writeFileSync(output, 'not a directory');
  });
  assert.equal(child.status, 1);
  assert.equal(JSON.parse(child.stdout).passed, true);
  assert.notEqual(child.stderr, '');
});
