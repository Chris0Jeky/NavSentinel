'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createService}=require('../daemon/server.cjs');
async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ns-sink-stream-'));
  const service=await createService({port:0,labPort:0,dataDir:dir,quiet:true});
  t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
  return service;
}
async function count(service){
  const response=await fetch(service.labOrigin+'/lab-state');
  assert.equal(response.status,200);
  return (await response.json()).counts.navigation;
}
function post(service,headers={},timeout=3000){
  let request;
  const response=new Promise((resolve,reject)=>{
    request=http.request(service.labOrigin+'/sink?kind=navigation',{method:'POST',headers:{Connection:'close',...headers}},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,complete:res.complete,body:JSON.parse(Buffer.concat(chunks).toString()),headers:res.headers}));
    });
    request.on('error',reject);
    request.setTimeout(timeout,()=>request.destroy(new Error('Request timeout')));
  });
  return {request,response};
}
for(const [name,body,status] of [
  ['empty','',200],['exact ASCII byte cap','x'.repeat(16384),200],
  ['one byte above cap','x'.repeat(16385),413],
  ['exact UTF-8 byte cap','😀'.repeat(4096),200],
  ['UTF-8 over cap','😀'.repeat(4097),413],
]){
  test(`sink measures ${name} and delivers a complete response`,async t=>{
    const service=await setup(t),p=post(service,{'Content-Length':Buffer.byteLength(body)});
    p.request.end(body);
    const result=await p.response;
    assert.equal(result.status,status);assert.equal(result.complete,true);
    if(status===413)assert.deepEqual(result.body,{error:'Request exceeds 16 KiB'});
    else assert.equal(result.body.count,1);
    assert.equal(await count(service),status===200?1:0);
  });
}
test('chunked overflow is not counted and delivers its rejection body',async t=>{
  const service=await setup(t),p=post(service,{'Transfer-Encoding':'chunked'});
  p.request.write('x'.repeat(8192));p.request.end('y'.repeat(8193));
  const result=await p.response;
  assert.equal(result.status,413);assert.equal(result.complete,true);
  assert.deepEqual(result.body,{error:'Request exceeds 16 KiB'});
  assert.equal(await count(service),0);
});
test('a partial request is not counted until the final body bytes arrive',async t=>{
  const service=await setup(t);
  const accepted=once(service.labServer,'request');
  const p=post(service,{'Content-Length':10});
  p.request.flushHeaders();
  const [incoming]=await accepted;
  const data=once(incoming,'data');p.request.write('first');await data;
  assert.equal(await count(service),0);
  p.request.end('last!');
  const result=await p.response;
  assert.equal(result.status,200);assert.equal(result.complete,true);assert.equal(result.body.count,1);
  assert.equal(await count(service),1);
});
test('client abort before a complete body is never an accepted sink effect',async t=>{
  const service=await setup(t);
  const accepted=once(service.labServer,'request');
  const p=post(service,{'Content-Length':100});
  const outcome=p.response.catch(error=>({error:error.code}));
  p.request.flushHeaders();
  const [incoming]=await accepted;
  const closed=new Promise(resolve=>incoming.once('close',resolve));
  const data=once(incoming,'data');p.request.write('partial');await data;
  p.request.destroy();await closed;await outcome;
  assert.equal(incoming.complete,false);
  assert.equal(await count(service),0);
  assert.equal((await fetch(service.origin+'/api/health')).status,200);
  const ok=post(service);ok.request.end('next');
  assert.equal((await ok.response).body.count,1);
});

for(const trickle of [false,true]){
  test(`unfinished sink body has an absolute deadline (trickle=${trickle})`,{timeout:9000},async t=>{
    const service=await setup(t);
    const p=post(service,{'Content-Length':100},8000);
    const outcome=p.response.finally(()=>clearInterval(timer));
    const timer=trickle?setInterval(()=>p.request.write('x'),200):null;
    t.after(()=>{clearInterval(timer);p.request.destroy();});
    p.request.flushHeaders();
    const result=await outcome;
    assert.equal(result.status,408);assert.equal(result.complete,true);
    assert.deepEqual(result.body,{error:'Sink request body timed out'});
    assert.equal(result.headers.connection,'close');
    assert.equal(await count(service),0);
    assert.equal((await fetch(service.origin+'/api/health')).status,200);
    const next=post(service);next.request.end('after-timeout');
    assert.equal((await next.response).body.count,1);
  });
}
