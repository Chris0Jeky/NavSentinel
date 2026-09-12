import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const output=path.resolve('artifacts/vision-lab');
fs.mkdirSync(output,{recursive:true});
const extensionPath=path.resolve('extension/dist');
assert.ok(fs.existsSync(path.join(extensionPath,'src/evidence/evidence.html')),'Build Protection Center first');
const sessions=path.resolve('experiments/vision-lab/.local/test-runs');fs.mkdirSync(sessions,{recursive:true});
const profile=fs.mkdtempSync(path.join(sessions,'extension-profile-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,acceptDownloads:true,
  ...(process.env.NS_CHROMIUM_PATH?{executablePath:process.env.NS_CHROMIUM_PATH}:{}),
  args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`],viewport:{width:1360,height:960}});
const checks=[];
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  // Controlled test records in real Chrome storage. This tests the complete data
  // path and minimization, not whether a detector would have produced these rows.
  await worker.evaluate(async()=>chrome.storage.local.set({'sentinelsuite:event_log_v1':[
    {id:'PRIVATE_CANARY',ts:1788825600000,kind:'nav_click_block',site:'source.test',destHost:'destination.test',
      url:'https://source.test/private?token=PRIVATE_CANARY',score:76,reasons:[],extra:{secret:'PRIVATE_CANARY'}},
    {id:'second',ts:1788825601000,kind:'mutation_alert',site:'source.test',reasons:[]}
  ]}));
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`chrome-extension://${id}/src/evidence/evidence.html`);
  await page.waitForFunction(()=>document.querySelectorAll('#events details').length===2);
  checks.push('installed test extension reads actual bounded Chrome storage');
  await page.locator('#category').selectOption('navigation');
  await page.waitForFunction(()=>document.querySelectorAll('#events details').length===1);
  await page.locator('#resetFilters').click();
  await page.waitForFunction(()=>document.querySelectorAll('#events details').length===2);
  checks.push('category filter and reset show correct records');
  for(const theme of ['forest','paper','midnight']) {
    await page.locator('#theme').selectOption(theme);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(output,`protection-center-${theme}.png`),fullPage:true});
  }
  await page.reload();assert.equal(await page.locator('#theme').inputValue(),'midnight');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  checks.push('three themes, persistence and 390px layout');
  await page.locator('#export').click();
  const preview=await page.locator('#exportPreview').inputValue();
  await page.screenshot({path:path.join(output,'protection-center-export-preview.png')});
  const pending=page.waitForEvent('download');await page.locator('#downloadExport').click();
  const download=await pending;const filename=path.join(output,'extension-evidence.json');await download.saveAs(filename);
  const contents=fs.readFileSync(filename,'utf8');const data=JSON.parse(contents);
  assert.equal(contents,preview,'Downloaded bytes must match the reviewed preview');
  assert.equal(data.format,'navsentinel-evidence');assert.equal(data.events.length,2);
  assert.equal(contents.includes('PRIVATE_CANARY'),false);
  assert.equal(contents.includes('/private'),false);
  assert.deepEqual(errors,[]);checks.push('actual downloaded file omits arbitrary metadata, caller IDs, URL paths and queries');
  fs.writeFileSync(path.join(output,'extension-smoke.json'),JSON.stringify({at:new Date().toISOString(),checks,
    boundary:'Disposable automated Chromium extension, seeded test records. Not owner-installed branded Chrome acceptance or detection efficacy.'},null,2));
  console.log(`Extension data path: ${checks.length} checks passed. Export: ${filename}`);
} finally {await context.close();}
