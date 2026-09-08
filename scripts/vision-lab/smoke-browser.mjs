import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';

const require=createRequire(import.meta.url);
const {createService}=require('../../experiments/vision-lab/daemon/server.cjs');
const output=path.resolve('artifacts/vision-lab');
fs.mkdirSync(output,{recursive:true});
const sessions=path.resolve('experiments/vision-lab/.local/test-runs');
fs.mkdirSync(sessions,{recursive:true});
const service=await createService({port:0,labPort:0,dataDir:fs.mkdtempSync(path.join(sessions,'browser-session-')),quiet:true});
const browser=await chromium.launch({channel:'chromium',headless:true,...(process.env.NS_CHROMIUM_PATH?{executablePath:process.env.NS_CHROMIUM_PATH}:{})}).catch(async error=>{await service.close();throw error;});
const context=await browser.newContext({viewport:{width:1480,height:1000},acceptDownloads:true});
const checks=[],errors=[],expectedDiagnostics=[];
let expectingReplayRejection=false;
const page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{
  if(message.type()!=='error')return;
  const text=message.text(),url=message.location().url;
  if(url===service.origin+'/favicon.ico'&&text.includes('404')){expectedDiagnostics.push('Optional favicon is absent (404)');return;}
  if(expectingReplayRejection&&url===service.origin+'/api/consume'&&text.includes('409')){expectedDiagnostics.push('Deliberate replay rejected (409)');return;}
  errors.push({message:text,url});
});
const click=(action)=>page.locator(action).first().click();
const nav=view=>click(`.nav [data-view="${view}"]`);
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const assertNoOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
const canonicalFixture={format:'navsentinel-evidence',schema:1,source:'navsentinel-extension',evidence:'recorded-observation',exportedAt:'2026-09-08T00:00:00.000Z',events:[
  {id:'event-1',timestamp:'2026-09-08T00:00:00.000Z',kind:'nav_click_block',sourceSite:'source.test',destinationSite:'destination.test',outcome:'recorded',reasons:[],score:76},
  {id:'event-2',timestamp:'2026-09-08T00:00:01.000Z',kind:'mutation_alert',sourceSite:'source.test',destinationSite:null,outcome:'recorded',reasons:[]}
]};

try {
  for(const mode of ['extension','desktop','relay']) {
    await page.goto(service.origin+'/?mode='+mode);
    await page.locator('.app-shell').waitFor();
    const views=await page.locator('.nav [data-view]').evaluateAll(nodes=>nodes.map(node=>node.dataset.view));
    for(const view of views){await nav(view);assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('.error-banner').count(),0);}
    pass(`${mode}: every served view renders`);
    await nav('overview');
    for(const theme of ['forest','paper','midnight']) {
      await click(`[data-theme-choice="${theme}"]`);
      assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
      await assertNoOverflow();
      await page.screenshot({path:path.join(output,`${mode}-${theme}.png`),fullPage:true});
    }
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'midnight');
    pass(`${mode}: three themes and native storage persistence`);
    await page.setViewportSize({width:390,height:844});
    await assertNoOverflow();
    await page.screenshot({path:path.join(output,`${mode}-mobile.png`),fullPage:true});
    await page.setViewportSize({width:1480,height:1000});
    pass(`${mode}: 390px layout`);
  }
  for(const file of ['NavSentinel-Browser.html','NavSentinel-Desktop.html','NavSentinel-Intent-Relay.html']) {
    await page.goto(pathToFileURL(path.resolve('experiments/vision-lab',file)).href);
    await page.locator('.app-shell').waitFor();
    assert.equal(await page.locator('.error-banner').count(),0);
  }
  pass('all three standalone file entrypoints execute with their CSP');
  await page.goto(service.origin+'/?mode=desktop');
  await nav('evidence');
  // A producer-generated file supplied by the extension smoke test is used when
  // present. Otherwise the isolated Lab lane uses this explicitly synthetic fixture.
  const producerFile=process.env.NS_EVIDENCE_FILE;
  const contents=producerFile?fs.readFileSync(producerFile):Buffer.from(JSON.stringify(canonicalFixture));
  await page.locator('#evidence-file').setInputFiles({name:'navsentinel-evidence.json',mimeType:'application/json',buffer:contents});
  await click('[data-evidence-action="apply"]');
  await page.locator('#evidence-table').waitFor();
  assert.ok((await page.locator('#evidence-table').innerText()).includes('source.test'));
  await click('[data-evidence-action="inspect"]');
  await page.locator('#evidence-detail').waitFor();
  await click('[data-evidence-action="correct"][data-kind="uncertain"]');
  await page.reload();await nav('evidence');
  await click('[data-evidence-action="inspect"]');
  assert.ok((await page.locator('#evidence-detail').innerText()).toLowerCase().includes('uncertain'));
  pass('explicit file import, detail, separate correction and native persistence');
  await click('[data-evidence-action="export"]');
  const exportText=await page.locator('#dialog pre').innerText();
  const exported=JSON.parse(exportText);
  assert.ok(exportText.includes('source.test'));
  assert.ok(!exportText.includes('PRIVATE_CANARY'));
  const downloadPromise=page.waitForEvent('download');
  await click('[data-evidence-action="download"]');
  const download=await downloadPromise;
  await download.saveAs(path.join(output,'workspace-export.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'workspace-export.json'),'utf8')),exported);
  pass('preview equals actual local file download');
  if(await page.locator('#dialog').evaluate(element=>element.open))await page.keyboard.press('Escape');
  await click('[data-evidence-action="clear"]');await click('[data-evidence-action="confirm-clear"]');
  assert.equal(await page.locator('#evidence-table tbody tr').count(),0);
  const retained=await page.evaluate(()=>JSON.parse(localStorage.getItem('navsentinel-vision-lab-v1')).records.length);
  assert.ok(retained>0);pass('imported history clear preserves synthetic history');
  await page.locator('#evidence-file').setInputFiles(path.join(output,'workspace-export.json'));
  await page.locator('#dialog[open]').getByRole('heading',{name:'Review this import.'}).waitFor();
  assert.ok((await page.locator('#dialog').innerText()).includes('1 separate assessments'));
  await click('[data-evidence-action="apply"]');
  await page.reload();await nav('evidence');
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('navsentinel-imported-evidence-v1')));
  assert.deepEqual(restored.events,exported.events);assert.deepEqual(restored.corrections,exported.corrections);
  await click('[data-evidence-action="inspect"]');
  assert.ok((await page.locator('#evidence-detail').innerText()).includes('uncertain'));
  pass('downloaded review package restores linked assessments after clear and reload');

  await page.goto(service.origin+'/?mode=relay');
  await click('[data-action="connect"]');await page.locator('#broker-token').fill(service.adminToken);
  await click('[data-action="connect-submit"]');await nav('requests');
  await page.locator('#request-scenario').selectOption('fixture-review');
  await click('[data-action="api-request"]');
  await click('[data-action="api-approve"]');
  await click('[data-action="api-consume"]');
  await page.getByText('Accepted once',{exact:false}).first().waitFor();
  assert.equal((await (await fetch(service.labOrigin+'/broker-effects')).json()).count,1);
  expectingReplayRejection=true;
  await click('[data-action="api-consume"]');
  await page.getByText('Unknown, used or revoked',{exact:false}).first().waitFor();
  assert.equal((await (await fetch(service.labOrigin+'/broker-effects')).json()).count,1);
  pass('real browser networking: approval causes one independently observed fixture effect; replay causes none');
  assert.deepEqual(errors,[]);
  pass('zero uncaught renderer errors; expected HTTP rejection classified');
  fs.writeFileSync(path.join(output,'browser-smoke.json'),JSON.stringify({at:new Date().toISOString(),browser:browser.version(),checks,errors,expectedDiagnostics,
    evidenceInput:producerFile?'Actual extension export with seeded test records':'Synthetic contract fixture',
    boundary:'Actual loopback navigation, native localStorage, file import/download and API fetch. No browser protection efficacy claim.'},null,2));
} finally {await browser.close();await service.close();}
console.log(`Browser smoke: ${checks.length} checks passed.`);
