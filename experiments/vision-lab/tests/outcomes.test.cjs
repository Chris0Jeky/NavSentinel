'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'web/app.js'),'utf8');
const functions=app.split(/\r?\n/).filter(line=>/^async function (api|consumeLive)\(/.test(line)).join('\n');
const refreshFunctions=app.split(/\r?\n/).filter(line=>/^async function (api|refreshService)\(/.test(line)).join('\n');
for(const fixture of [
 {name:'executed effect despite journal error',status:503,data:{accepted:true,executed:true,error:'Journal unavailable'},expected:'Executed'},
 {name:'unknown effect after adapter failure',status:502,data:{accepted:true,executed:null,error:'Effect uncertain'},expected:'Unknown'},
 {name:'transport loss',networkError:true,expected:'Unknown'},
 {name:'known inert receipt',status:200,data:{accepted:true,executed:false,effect:'Receipt only'},expected:'Accepted'},
 {name:'known rejection',status:409,data:{accepted:false,error:'Grant consumed'},expected:'Rejected'},
])test(`consume outcome survives unavailable status refresh: ${fixture.name}`,async()=>{
 const context={structuredClone,apiToken:'test-only',liveRequest:{capability:{token:'test-only'},event:{context:{document:'fixture'}}},liveOutcome:null,connected:true,renders:0};
 context.fetch=async()=>{if(fixture.networkError)throw Error('Transport closed');return {status:fixture.status,json:async()=>fixture.data};};
 context.refreshService=async()=>{throw Error('Status refresh unavailable');};
 context.render=()=>{context.renders++;};
 vm.runInNewContext(functions+'\nglobalThis.perform=consumeLive;',context,{timeout:1000});
 await context.perform();
 assert.equal(context.liveOutcome.status,fixture.expected);
 assert.equal(context.renders,1);
 assert.equal(context.connected,false);
 assert.equal(context.liveOutcome.retry,false);
});

test('initial authentication failure remains visible to the connect flow',async()=>{
 const context={structuredClone,apiToken:'invalid',health:null,remote:null,connected:false};
 context.fetch=async path=>({status:path==='/api/health'?200:401,json:async()=>path==='/api/health'?{ok:true}:{error:'Invalid operator token'}});
 vm.runInNewContext(refreshFunctions+'\nglobalThis.connectAttempt=()=>refreshService({required:true});',context,{timeout:1000});
 await assert.rejects(context.connectAttempt,/Invalid operator token/);
 assert.equal(context.connected,false);
 assert.equal(context.remote,null);
});

test('journal clear removes distinct tab badge overrides despite a closed tab',async()=>{
 let listener;const badges=[],writes=[];
 const event={addListener(){}};
 const chrome={runtime:{id:'lab',getURL:value=>'chrome-extension://lab/'+value,onInstalled:event,onStartup:event,onMessage:{addListener:fn=>{listener=fn;}}},tabs:{onRemoved:event,query:async()=>[{id:1},{id:3}]},permissions:{onRemoved:event},storage:{local:{get:async()=>({records:[{tabId:1},{tabId:1},{tabId:2},{}]}),set:async value=>{writes.push(value);}}},action:{setBadgeText:async value=>{badges.push(value);if(value.tabId===2)throw Error('Closed tab');}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'extension/worker.js'),'utf8'),{chrome,NSCore:{},importScripts(){},console},{timeout:1000});
 const response=await new Promise(resolve=>listener({type:'clear'},{id:'lab',url:'chrome-extension://lab/popup.html'},resolve));
 assert.equal(response.cleared,true);
 assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{records:[]}]);
 assert.deepEqual(JSON.parse(JSON.stringify(badges)),[{tabId:1,text:''},{tabId:2,text:''},{tabId:3,text:''},{text:''}]);
});
