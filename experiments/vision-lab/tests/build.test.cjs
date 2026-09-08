'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('standalone HTML and CSP hashes are identical from LF and Windows CRLF sources',()=>{
 const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'navsentinel-build-'));
 const files=['scripts/build.cjs','shared/core.js','shared/scenarios.js','shared/evidence.js','web/style.css','web/renderer.js','web/evidence-workspace.js','web/app.js'];
 try{
  for(const ending of ['lf','crlf']){
   const destination=path.join(temporary,ending);fs.mkdirSync(path.join(destination,'extension/shared'),{recursive:true});
   for(const file of files){const target=path.join(destination,file);fs.mkdirSync(path.dirname(target),{recursive:true});const source=fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');fs.writeFileSync(target,ending==='lf'?source:source.replace(/\n/g,'\r\n'));}
   execFileSync(process.execPath,[path.join(destination,'scripts/build.cjs')],{stdio:'pipe'});
  }
  for(const name of ['NavSentinel-Browser.html','NavSentinel-Desktop.html','NavSentinel-Intent-Relay.html'])assert.equal(fs.readFileSync(path.join(temporary,'lf',name),'utf8'),fs.readFileSync(path.join(temporary,'crlf',name),'utf8'),name);
 }finally{if(path.dirname(temporary)!==os.tmpdir()||!path.basename(temporary).startsWith('navsentinel-build-'))throw Error('Unexpected temporary cleanup target');fs.rmSync(temporary,{recursive:true});}
});

test('Lab preserves consumed execution outcomes and clears per-tab badges',()=>{
 const root=path.resolve(__dirname,'..');
 const app=fs.readFileSync(path.join(root,'web/app.js'),'utf8');
 const worker=fs.readFileSync(path.join(root,'extension/worker.js'),'utf8');
 assert.match(app,/status:'Executed'/);
 assert.match(app,/status:'Unknown'/);
 assert.match(app,/Do not retry/);
 assert.match(app,/e\.data/);
 assert.match(app,/liveRequest\.capability&&!liveOutcome/);
 assert.match(worker,/record\?\.tabId/);
 assert.match(worker,/setBadgeText\(\{tabId,text:''\}\)/);
});
