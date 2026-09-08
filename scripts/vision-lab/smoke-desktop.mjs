import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {_electron as electron} from 'playwright';

const root = path.resolve('experiments/vision-lab');
const output = path.resolve('artifacts/vision-lab');
fs.mkdirSync(output,{recursive:true});
const dataDir = fs.mkdtempSync(path.join(output,'desktop-session-'));
const executablePath = path.join(root,'desktop/node_modules/electron/dist',process.platform==='win32'?'electron.exe':process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron');
const checks = [];
const application = await electron.launch({executablePath,args:[path.join(root,'desktop')],
  env:{...process.env,NS_DESKTOP_DATA_DIR:dataDir,NS_DESKTOP_PORT:'0',NS_DESKTOP_LAB_PORT:'0',NS_DESKTOP_HIDDEN:'1'},timeout:60000});
let origin;
try {
  const page = await application.firstWindow();
  await page.waitForFunction(()=>document.querySelector('.app-shell'));
  origin = new URL(page.url()).origin;
  assert.equal(await page.evaluate(()=>typeof globalThis.require),'undefined');
  assert.equal(await page.evaluate(()=>typeof globalThis.process),'undefined');
  checks.push('renderer has no Node globals');
  const preferences = await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.sandbox,true);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);
  checks.push('native sandbox and context isolation enabled');
  const state = await page.evaluate(()=>globalThis.navDesktop.request({path:'/api/state',method:'GET'}));
  assert.equal(state.status,200);assert.ok(Array.isArray(state.data.journal.entries));
  assert.equal(JSON.stringify(state).includes('adminToken'),false);
  checks.push('real preload IPC reaches authenticated broker without exposing token');
  const rejected = await page.evaluate(async()=>{
    try { await globalThis.navDesktop.request({path:'https://reference.test',method:'GET'});return false; }
    catch { return true; }
  });
  assert.equal(rejected,true);checks.push('arbitrary transport rejected');
  const journalWrite = await page.evaluate(()=>globalThis.navDesktop.request({path:'/api/scenario',method:'POST',body:{id:'overlay'}}));
  assert.equal(journalWrite.status,200);checks.push('native IPC creates a fixture receipt');
  // A hidden native window does not produce compositor screenshots reliably on
  // Windows. The browser smoke lane captures the identical served renderer.
} finally { await application.close(); }
await assert.rejects(fetch(origin+'/api/health',{signal:AbortSignal.timeout(1500)}));
assert.equal(fs.existsSync(path.join(dataDir,'broker/service.lock')),false);
assert.equal(fs.existsSync(path.join(dataDir,'broker/session.json')),false);
checks.push('native exit closes server and removes live credentials');
fs.writeFileSync(path.join(output,'desktop-smoke.json'),JSON.stringify({at:new Date().toISOString(),checks,boundary:'Local native shell and IPC only; no OS enforcement or signing.'},null,2));
console.log(`Native desktop: ${checks.length} checks passed.`);
