/** Viewer qualification over pinned browser records; no new product execution. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildReport, supportsCompleteSet } from './model.mjs';
import { writeReport } from './io.mjs';
assert.equal(process.argv.length, 2);
const root = new URL('./fixtures/documents/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('provenance.json', root), 'utf8'));
const packed = fs.readFileSync(new URL('recorded.json.gz', root));
assert.equal(createHash('sha256').update(packed).digest('hex'), manifest.gzipSha256);
const records = JSON.parse(gunzipSync(packed, { maxOutputLength: 1024 * 1024 }).toString('utf8'));
assert.equal(records.length, 10);
for (const [i, t] of records.entries()) {
  assert.equal(t.identity.head, manifest.producerHead); assert.equal(t.identity.tree, manifest.producerTree);
  assert.equal(t.runId, manifest.records[i].runId); assert.equal(t.experiment, manifest.records[i].experiment);
  assert.equal(t.schema, 'navsentinel.observatory.form.v2');
}
const report = buildReport(records.map(v => JSON.stringify(v)));
assert.deepEqual(report.rejected, []); assert.equal(supportsCompleteSet(report), false);
const output = writeReport('test-results/observatory-document-viewer', report);
const errors = [], requests = [];
let browser;
try {
  browser = await chromium.launch({ headless:true });
  const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  await context.route('http://**/*', r => r.abort());await context.route('https://**/*', r => r.abort());
  const page = await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(pathToFileURL(path.join(output,'index.html')).href);await page.locator('.case-button').first().waitFor();
  const choose = async (experiment, variant, arm) => {
    const i = report.cases.findIndex(c=>c.formEvidence.experiment===experiment&&(!variant||c.variant===variant)&&(!arm||c.arm===arm));
    assert.ok(i>=0);await page.locator('.case-button').nth(i).click();
    assert.equal(await page.locator('.document-life').count(),0,'no future document visible at start');
    assert.equal(await page.locator('#form-panel table').count(),0);return report.cases[i];
  };
  const step = async index => { await page.locator('.event').nth(index).click(); };
  await choose('form-campaign','action-substitution','protected');
  await page.getByRole('button',{name:'Show operation snapshot',exact:true}).click();
  assert.equal(await page.locator('#form-attribution').getAttribute('data-association'),'same-reporting-document');
  assert.deepEqual(await page.locator('[data-field="action"] td').allTextContents(),['benign','harm']);
  assert.match(await page.locator('#form-panel').innerText(),/Compare the clicked form\/submitter/);
  assert.match(await page.locator('#document-panel').innerText(),/reporting function/);
  await page.locator('#form-panel').screenshot({path:path.join(output,'bound-action-substitution.png')});
  for (const experiment of ['same-url-siblings','same-frame-reload','frame-replacement']) {
    const c = await choose(experiment);
    await page.getByRole('button',{name:'Show operation snapshot',exact:true}).click();
    assert.equal(await page.locator('#form-attribution').getAttribute('data-association'),'no-reported-input');
    assert.match(await page.locator('#form-attribution').innerText(),/No earlier reported snapshot/);
    assert.deepEqual(await page.locator('[data-field="action"] td').allTextContents(),['Not recorded','benign']);
    assert.match(await page.locator('#form-panel').innerText(),/No clicked input or native initiator is established/);
    assert.doesNotMatch(await page.locator('#form-panel').innerText(),/Compare the clicked form\/submitter/);
    assert.equal(await page.locator('.form-changed').count(),0,'no fabricated change from a different document');
    await page.locator('#form-panel').screenshot({path:path.join(output,`${experiment}.png`)});
    await step(c.events.length-1);assert.equal(await page.locator('#form-panel table').count(),0);
    assert.equal(await page.locator('.document-life').filter({hasText:'Active reporting interval'}).count(),0);
  }
  await choose('same-document-navigation');await page.getByRole('button',{name:'Show operation snapshot',exact:true}).click();
  assert.equal(await page.locator('#form-attribution').getAttribute('data-association'),'same-reporting-document');
  await choose('borrowed-reporting-function');await page.getByRole('button',{name:'Show operation snapshot',exact:true}).click();
  assert.equal(await page.locator('#form-attribution').getAttribute('data-association'),'same-reporting-document');
  assert.match(await page.locator('#document-panel').innerText(),/same-origin code can borrow/);
  assert.match(await page.locator('#form-panel').innerText(),/Earlier and selected reports belong to the same reporting document/);
  assert.match(await page.locator('#form-panel').innerText(),/not interaction or native causality/);
  await page.locator('#form-panel').screenshot({path:path.join(output,'borrowed-reporting-limit.png')});
  const bad = await choose('spoofed-identity-disposal');assert.ok(bad.gaps.includes('PROBE_REJECTED'));
  await step(bad.events.length-1);assert.equal(await page.locator('#form-panel table').count(),0);
  const late = await choose('form-campaign','late-submit','protected');assert.equal(late.assessment,'HARM_THEN_RECOVERY');
  await step(late.events.length-1);assert.equal(await page.locator('.receipt-link').count(),1);assert.equal(await page.locator('#form-panel table').count(),0);
  const mixed = await choose('form-campaign','mixed','mixed');const fresh=mixed.formEvidence.snapshots.findLast(s=>s.phase==='submit-event');await step(fresh.eventIndex);
  assert.deepEqual(await page.locator('[data-field="action"] td').allTextContents(),['benign','benign']);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  const pending=page.waitForEvent('download');await page.locator('#download').click();const file=path.join(output,'download-checked.json');await(await pending).saveAs(file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),report);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log('Recorded document viewer passed: same-URL siblings, reload, replacement, fragment navigation, borrowed-function limits, retired state, retained harm, mixed input, mobile, JSON equality and no HTTP requests. Not a new protection campaign.');
} finally {await browser?.close();}
