'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const workerSource=fs.readFileSync(path.join(root,'extension/worker.js'),'utf8');

const LOCAL_ID='ns-12345678-1234-1234-1234-1234567890ab';
const SENDER_URL='https://example.com/page';
const ORIGIN=new URL(SENDER_URL).origin;

function harness(){
  let listener;
  const localSets=[],sessionSets=[],badges=[];
  const event={addListener(){}};
  const chrome={
    runtime:{id:'lab',getURL:value=>'chrome-extension://lab/'+value,onInstalled:event,onStartup:event,onMessage:{addListener:fn=>{listener=fn;}}},
    tabs:{onRemoved:event},
    permissions:{onRemoved:event},
    storage:{
      local:{get:async()=>({enabledOrigins:[ORIGIN],records:[]}),set:async value=>{localSets.push(JSON.parse(JSON.stringify(value)));}},
      session:{get:async()=>({}),set:async value=>{sessionSets.push(JSON.parse(JSON.stringify(value)));}}
    },
    action:{setBadgeText:async value=>{badges.push(value);},setBadgeBackgroundColor:async()=>{}}
  };
  const context=vm.createContext({chrome,URL,importScripts(){},console});
  vm.runInContext(fs.readFileSync(path.join(root,'extension/shared/core.js'),'utf8'),context,{timeout:1000});
  vm.runInContext(workerSource,context,{timeout:1000});
  const sender={id:'lab',tab:{id:7},frameId:0,documentId:'doc1',url:SENDER_URL};
  const send=message=>new Promise(resolve=>listener(vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(message))})`,context),sender,resolve));
  const baseEvent={action:'navigate',destination:'https://example.com/next',signals:['same_origin']};
  return {send,localSets,sessionSets,baseEvent};
}

test('suppressed maps to overlay-suppressed',async()=>{
  const h=harness();
  const response=await h.send({type:'sensor',localId:LOCAL_ID,event:h.baseEvent,effect:'suppressed'});
  assert.equal(response.recorded,true);
  assert.equal(h.localSets.length,1);
  assert.equal(h.localSets[0].records[0].effect,'overlay-suppressed');
});

test('held maps to captured-action-held',async()=>{
  const h=harness();
  const response=await h.send({type:'sensor',localId:LOCAL_ID,event:h.baseEvent,effect:'held'});
  assert.equal(response.recorded,true);
  assert.equal(h.localSets.length,1);
  assert.equal(h.localSets[0].records[0].effect,'captured-action-held');
});

test('absent effect maps to observed',async()=>{
  const h=harness();
  const response=await h.send({type:'sensor',localId:LOCAL_ID,event:h.baseEvent});
  assert.equal(response.recorded,true);
  assert.equal(h.localSets.length,1);
  assert.equal(h.localSets[0].records[0].effect,'observed');
});

test('deleted or other junk throws and persists nothing',async()=>{
  for(const effect of ['deleted','DELETED','bogus','observed','overlay-suppressed','',null,0,{}]){
    const h=harness();
    const response=await h.send({type:'sensor',localId:LOCAL_ID,event:h.baseEvent,effect});
    assert.match(response.error,/Invalid effect/,`effect ${JSON.stringify(effect)} must be rejected`);
    assert.equal(h.localSets.length,0,`effect ${JSON.stringify(effect)} must persist nothing`);
    assert.equal(h.sessionSets.length,0,`effect ${JSON.stringify(effect)} must persist nothing`);
  }
});
