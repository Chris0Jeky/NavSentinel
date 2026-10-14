'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createService}=require('../daemon/server.cjs');
let service,dir;
before(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'ns-sink-cap-'));service=await createService({port:0,labPort:0,dataDir:dir,quiet:true});});
after(async()=>{await service?.close();fs.rmSync(dir,{recursive:true,force:true});});
test('oversize sink body is rejected and not counted',async()=>{
  const beforeState=await (await fetch(service.labOrigin+'/lab-state')).json();
  const r=await fetch(service.labOrigin+'/sink?kind=navigation',{method:'POST',body:'x'.repeat(17000)});
  assert.equal(r.status,413);
  await r.text().catch(()=>{});
  const afterState=await (await fetch(service.labOrigin+'/lab-state')).json();
  assert.equal(afterState.counts.navigation,beforeState.counts.navigation);
  const ok=await fetch(service.labOrigin+'/sink?kind=navigation',{method:'POST',body:'small'});
  assert.equal(ok.status,200);
  const finalState=await (await fetch(service.labOrigin+'/lab-state')).json();
  assert.equal(finalState.counts.navigation,beforeState.counts.navigation+1);
});
