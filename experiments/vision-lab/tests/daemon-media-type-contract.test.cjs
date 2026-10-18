'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createService}=require('../daemon/server.cjs');

async function setup(t){
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ns-media-contract-'));
  let service;
  t.after(async()=>{await service?.close();fs.rmSync(dataDir,{recursive:true,force:true});});
  service=await createService({port:0,labPort:0,dataDir,quiet:true});
  return service;
}
function post(service,contentType,body,authorized=true){
  return new Promise((resolve,reject)=>{
    const headers={'Content-Length':Buffer.byteLength(body),Connection:'close'};
    // Use the raw HTTP client so null really omits Content-Type. Fetch would
    // silently add text/plain for a string body and miss the absent-header arm.
    if(contentType!==null)headers['Content-Type']=contentType;
    if(authorized)headers.Authorization=`Bearer ${service.adminToken}`;
    const req=http.request(service.origin+'/api/scenario',{method:'POST',headers},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;});
      res.on('error',reject);
      res.on('end',()=>{try{resolve({status:res.statusCode,complete:res.complete,body:JSON.parse(text)});}catch(error){reject(error);}});
    });
    req.on('error',reject);req.setTimeout(2000,()=>req.destroy(new Error('Request timed out')));req.end(body);
  });
}
const fixture=JSON.stringify({id:'overlay'});
for(const contentType of [null,'','application/json-malicious','application/jsonp','application/json+xml',
  'application/problem+json','application/jsonx; charset=utf-8','application/json, text/plain','text/json','text/plain']){
  test(`unsupported media type ${JSON.stringify(contentType)} cannot create a fixture receipt`,async t=>{
    const service=await setup(t);
    const result=await post(service,contentType,fixture);
    assert.equal(result.status,415);assert.equal(result.complete,true);
    assert.deepEqual(result.body,{error:'JSON content type required'});
    assert.equal(service.ledger.snapshot().entries.length,0);
    // A valid operation still works after the early refusal.
    const next=await post(service,'application/json',fixture);
    assert.equal(next.status,200);assert.equal(next.body.receipt.sequence,1);
  });
}
for(const contentType of ['application/json','APPLICATION/JSON','application/json; charset=utf-8',' application/json ; charset=utf-8 ']){
  test(`supported media type ${JSON.stringify(contentType)} reaches the real fixture operation`,async t=>{
    const service=await setup(t);
    const result=await post(service,contentType,fixture);
    assert.equal(result.status,200);assert.equal(result.complete,true);
    assert.equal(result.body.receipt.sequence,1);
    assert.equal(service.ledger.snapshot().entries.length,1);
  });
}
test('missing authentication is refused before media-type parsing',async t=>{
  const service=await setup(t);
  const result=await post(service,'application/json-malicious',fixture,false);
  assert.equal(result.status,401);assert.equal(service.ledger.snapshot().entries.length,0);
});
for(const body of ['null','[]','false','{']){
  test(`exact JSON media type does not authorize invalid object ${JSON.stringify(body)}`,async t=>{
    const service=await setup(t);
    const result=await post(service,'application/json',body);
    assert.equal(result.status,400);assert.equal(result.complete,true);
    assert.deepEqual(result.body,{error:'Invalid JSON object'});
    assert.equal(service.ledger.snapshot().entries.length,0);
  });
}
