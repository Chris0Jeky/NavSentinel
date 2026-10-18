'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'extension/worker.js'),'utf8');
const ORIGIN='https://example.test';
const SURFACE={id:'lab',url:'chrome-extension://lab/popup.html'};

function loadWorker({tabList,sendImpl,sessionSeed}){
 let listener;const event={addListener(){}};
 let localData={enabledOrigins:[ORIGIN],records:[]};
 let sessionData=sessionSeed||{};
 const sessionWrites=[],sent=[];
 const chrome={
  runtime:{id:'lab',getURL:value=>'chrome-extension://lab/'+value,onInstalled:event,onStartup:event,onMessage:{addListener:fn=>{listener=fn;}}},
  tabs:{onRemoved:event,query:async()=>tabList,sendMessage:async(id,message)=>{sent.push({id,message});return sendImpl(id,message);}},
  permissions:{onRemoved:event},
  scripting:{unregisterContentScripts:async()=>{},registerContentScripts:async()=>{}},
  storage:{
   local:{get:async()=>({enabledOrigins:localData.enabledOrigins,records:localData.records}),set:async value=>{Object.assign(localData,value);}},
   session:{get:async()=>({liveContexts:sessionData}),set:async value=>{sessionData=value.liveContexts;sessionWrites.push(value);}}
  },
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}
 };
 vm.runInNewContext(source,{chrome,NSCore:{},importScripts(){},console,URL},{timeout:1000});
 return {listener,sent,sessionWrites,getSession:()=>sessionData,getLocal:()=>localData};
}

function seed(){const now=Date.now();return {'7:local-a':{origin:ORIGIN,tabId:7,created:now},'8:local-b':{origin:ORIGIN,tabId:8,created:now}};}

function dispatch(listener,message){return new Promise(resolve=>listener(message,SURFACE,resolve));}

test('disable delivers to every tab and reports zero failures',async()=>{
 const harness=loadWorker({tabList:[{id:7},{id:8}],sendImpl:async()=>({ok:true}),sessionSeed:seed()});
 const response=await dispatch(harness.listener,{type:'disable',origin:ORIGIN});
 assert.equal(response.enabled,false);
 assert.equal(response.reloadRecommended,true);
 assert.equal(response.failedCount,0);
 assert.deepEqual(Array.from(response.failedTabIds),[]);
 assert.deepEqual(harness.sent.map(entry=>entry.id).sort(),[7,8]);
 assert.equal(Object.keys(harness.getSession()).length,0);
 assert.ok(harness.sessionWrites.length>0);
 assert.deepEqual(Array.from(harness.getLocal().enabledOrigins),[]);
});

test('disable reports the rejecting tab while server-side cleanup still runs',async()=>{
 const harness=loadWorker({tabList:[{id:7},{id:8}],sendImpl:async id=>{if(id===8)throw Error('tab closed');return {ok:true};},sessionSeed:seed()});
 const response=await dispatch(harness.listener,{type:'disable',origin:ORIGIN});
 assert.equal(response.enabled,false);
 assert.equal(response.reloadRecommended,true);
 assert.equal(response.failedCount,1);
 assert.deepEqual(Array.from(response.failedTabIds),[8]);
 assert.deepEqual(harness.sent.map(entry=>entry.id).sort(),[7,8]);
 assert.equal(Object.keys(harness.getSession()).length,0);
 assert.ok(harness.sessionWrites.length>0);
 assert.deepEqual(Array.from(harness.getLocal().enabledOrigins),[]);
});
