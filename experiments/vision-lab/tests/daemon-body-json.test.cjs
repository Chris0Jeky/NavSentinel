'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../daemon/server.cjs');

test('suffixed media types get 415 while plain and charset-suffixed JSON still parse',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ns-content-type-'));
  const service=await createService({port:0,labPort:0,dataDir,quiet:true});
  try{
    const post=async contentType=>{
      const res=await fetch(`${service.origin}/api/scenario`,{method:'POST',headers:{Authorization:`Bearer ${service.adminToken}`,'Content-Type':contentType},body:JSON.stringify({id:'unknown-fixture'})});
      await res.text();
      return res.status;
    };
    assert.equal(await post('application/json'),400);
    assert.equal(await post('application/json; charset=utf-8'),400);
    assert.equal(await post('application/json-malicious'),415);
  }finally{
    await service.close();
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
});
