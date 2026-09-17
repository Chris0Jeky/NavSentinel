'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createService}=require('../daemon/server.cjs');

async function setup(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ns-fixture-adapter-'));
  let now=Date.now();
  const service=await createService({port:0,labPort:0,dataDir:directory,quiet:true,clock:()=>now});
  t.after(async()=>{await service.close();fs.rmSync(directory,{recursive:true,force:true});});
  const health=await (await fetch(service.origin+'/api/health')).json();
  const adapter=health.fixtureAdapter;
  async function call(route,body,token=service.agentToken){
    const response=await fetch(service.origin+route,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,...await response.json()};
  }
  const observe=async()=> (await fetch(adapter.observationUrl)).json();
  const event=(destination=adapter.reviewDestination)=>({id:'PRIVATE_ID_CANARY',journeyId:'PRIVATE_JOURNEY_CANARY',actor:'forged-operator',evidence:'sensor',action:'navigate',source:'https://source.test/private?secret=URL_CANARY',destination,signals:[],context:{document:'document-1',actionId:'action-1'}});
  async function approved(){
    const request=await call('/api/request',{event:event()});
    assert.equal(request.result.decision,'review');
    const approval=await call('/api/approve',{requestId:request.requestId},service.adminToken);
    assert.equal(approval.status,200);
    return {request,body:{token:approval.capability.token,event:request.event}};
  }
  return {service,directory,adapter,call,observe,event,approved,advance:ms=>{now+=ms;}};
}

test('client bootstrap contains only client authority, never operator or sink credentials',async t=>{
  const x=await setup(t);
  const raw=fs.readFileSync(path.join(x.directory,'session.json'),'utf8');
  const session=JSON.parse(raw);
  assert.deepEqual(Object.keys(session).sort(),['agentToken','labOrigin','origin']);
  assert.equal(session.agentToken,x.service.agentToken);
  assert.ok(!raw.includes(x.service.adminToken));
  assert.equal((await x.call('/api/approve',{requestId:'missing'},session.agentToken)).status,403);
});

test('operator approval produces exactly one independently observed fixture effect; replay produces none',async t=>{
  const x=await setup(t),{request,body}=await x.approved();
  assert.equal((await x.observe()).count,0);
  const consumed=await x.call('/api/consume',body);
  assert.equal(consumed.status,200);
  assert.equal(consumed.executed,true);
  assert.equal(consumed.fixtureOnly,true);
  assert.equal(consumed.receipt.data.kind,'fixture-effect');
  assert.deepEqual(await x.observe(),{fixtureOnly:true,count:1,lastRequestId:request.requestId});
  assert.equal((await x.call('/api/consume',body)).status,409);
  assert.equal((await x.observe()).count,1);
});

test('benign fixed fixture contract executes without operator approval',async t=>{
  const x=await setup(t);
  const request=await x.call('/api/request',{event:x.event(x.adapter.autoDestination)});
  assert.equal(request.result.decision,'allow');
  assert.ok(request.capability);
  assert.equal((await x.call('/api/consume',{token:request.capability.token,event:request.event})).executed,true);
  assert.equal((await x.observe()).count,1);
});

for(const mutation of ['document','destination','malformed'])test(`${mutation} mismatch burns the grant with no fixture effect`,async t=>{
  const x=await setup(t),{body}=await x.approved();
  const changed=structuredClone(body);
  if(mutation==='document')changed.event.context.document='different-document';
  if(mutation==='destination')changed.event.destination=x.adapter.autoDestination;
  if(mutation==='malformed')changed.event={password:'not-an-event'};
  assert.equal((await x.call('/api/consume',changed)).status,409);
  assert.equal((await x.call('/api/consume',body)).status,409);
  assert.equal((await x.observe()).count,0);
});

test('expiry and revocation leave the independent sink unchanged',async t=>{
  const x=await setup(t),first=await x.approved();
  x.advance(30001);
  assert.equal((await x.call('/api/consume',first.body)).status,409);
  const second=await x.approved();
  assert.equal((await x.call('/api/revoke',{},x.service.adminToken)).status,200);
  assert.equal((await x.call('/api/consume',second.body)).status,409);
  assert.equal((await x.observe()).count,0);
});

test('the wrong role cannot consume and burns authority before an effect',async t=>{
  const x=await setup(t),{body}=await x.approved();
  assert.equal((await x.call('/api/consume',body,x.service.adminToken)).status,409);
  assert.equal((await x.call('/api/consume',body)).status,409);
  assert.equal((await x.observe()).count,0);
});

test('concurrent duplicate consumes create only one independently observed effect',async t=>{
  const x=await setup(t),{body}=await x.approved();
  const results=await Promise.all([x.call('/api/consume',body),x.call('/api/consume',body)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await x.observe()).count,1);
});

test('external requests and near-matching fixture destinations remain explicitly inert',async t=>{
  const x=await setup(t);
  for(const destination of ['https://reference.test/',x.adapter.autoDestination+'?other=1',x.adapter.reviewDestination+'/extra']){
    const request=await x.call('/api/request',{event:x.event(destination)});
    let capability=request.capability;
    if(!capability)capability=(await x.call('/api/approve',{requestId:request.requestId},x.service.adminToken)).capability;
    const consumed=await x.call('/api/consume',{token:capability.token,event:request.event});
    assert.equal(consumed.status,200);
    assert.equal(consumed.executed,false);
  }
  assert.equal((await x.observe()).count,0);
});

test('neither a direct page visit nor either public bearer role can forge the fixture effect',async t=>{
  const x=await setup(t);
  for(const token of ['',x.service.agentToken,x.service.adminToken]){
    const r=await fetch(x.service.labOrigin+'/broker-effect',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({requestId:'req-AAAAAAAAAAAAAAAAAA'})});
    assert.equal(r.status,403);
  }
  await fetch(x.adapter.autoDestination);
  await fetch(x.service.labOrigin+'/sink?kind=navigation');
  assert.equal((await x.observe()).count,0);
});

test('broker receipt identities are server-generated and exclude caller ID and URL canaries',async t=>{
  const x=await setup(t);
  const request=await x.call('/api/request',{event:x.event(x.adapter.autoDestination)});
  assert.equal(request.event.id,request.requestId);
  assert.notEqual(request.event.journeyId,'PRIVATE_JOURNEY_CANARY');
  await x.call('/api/consume',{token:request.capability.token,event:request.event});
  const state=await x.call('/api/state',undefined,x.service.adminToken);
  assert.doesNotMatch(JSON.stringify(state.journal),/PRIVATE_ID_CANARY|PRIVATE_JOURNEY_CANARY|URL_CANARY/);
});

test('a journal write failure after the effect reports execution honestly and never replays',async t=>{
  const x=await setup(t),{body}=await x.approved();
  x.service.ledger.append=()=>{throw new Error('Simulated storage failure');};
  const consumed=await x.call('/api/consume',body);
  assert.equal(consumed.status,503);
  assert.equal(consumed.executed,true);
  assert.equal(consumed.receiptStatus,'unavailable');
  assert.equal((await x.observe()).count,1);
  assert.equal((await x.call('/api/consume',body)).status,409);
  assert.equal((await x.observe()).count,1);
});

test('the runnable demo client uses only its bootstrap token and proves its local effect',async t=>{
  const x=await setup(t);
  const {execFile}=require('node:child_process');
  const output=await new Promise((resolve,reject)=>execFile(process.execPath,[path.join(__dirname,'../examples/agent.cjs')],{env:{...process.env,NS_DATA_DIR:x.directory},timeout:10000},(error,stdout)=>error?reject(error):resolve(stdout)));
  assert.match(output,/Independent fixture sink after consume and replay/);
  assert.equal((await x.observe()).count,1);
});
