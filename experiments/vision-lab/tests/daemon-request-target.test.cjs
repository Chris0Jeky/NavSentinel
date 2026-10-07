'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

// Use a real child process: an unhandled rejection in the HTTP listener must
// fail the liveness contract, not crash or get caught by this test runner.
async function serviceProcess(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ns-request-target-'));
  const program=`
    const {createService}=require(process.argv[1]);
    createService({port:0,labPort:0,dataDir:process.argv[2],quiet:true}).then(service=>{
      process.send({origin:service.origin,labOrigin:service.labOrigin});
      process.once('message',async()=>{await service.close();process.exit(0);});
    }).catch(error=>{console.error(error);process.exit(1);});
  `;
  const child=spawn(process.execPath,['-e',program,path.resolve(__dirname,'../daemon/server.cjs'),directory],{
    stdio:['ignore','ignore','pipe','ipc'],
  });
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=once(child,'exit');
  t.after(async()=>{
    const timer=setTimeout(()=>child.kill('SIGKILL'),2000);
    try{
      if(child.connected)child.send('close');
      await exited;
    }finally{clearTimeout(timer);fs.rmSync(directory,{recursive:true,force:true});}
  });
  const ready=await Promise.race([
    once(child,'message',{signal:AbortSignal.timeout(5000)}).then(([message])=>message),
    exited.then(()=>{throw new Error(`Daemon exited before ready: ${stderr}`);}),
  ]);
  return {...ready,child,stderr:()=>stderr};
}

function request(origin,target,headers={}){
  return new Promise(resolve=>{
    const req=http.request(origin,{path:target,headers:{Connection:'close',...headers}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;});
      res.on('end',()=>resolve({status:res.statusCode,body}));
      res.on('error',error=>resolve({status:null,error:error.code}));
    });
    req.on('error',error=>resolve({status:null,error:error.code}));
    req.setTimeout(3000,()=>req.destroy(new Error('Request timed out')));req.end();
  });
}

for(const endpoint of ['origin','labOrigin']){
  for(const target of ['http://[','//[','http://foreign.invalid/sink?kind=navigation',
    '//foreign.invalid/sink?kind=navigation','/\\foreign.invalid/sink?kind=navigation','/sink?kind=navigation#ignored']){
    test(`${endpoint} rejects non-local/malformed request target ${JSON.stringify(target)} without terminating`,{timeout:10000},async t=>{
      const service=await serviceProcess(t);
      const result=await request(service[endpoint],target);
      assert.equal(result.status,400,JSON.stringify({...result,stderr:service.stderr()}));
      assert.deepEqual(JSON.parse(result.body),{error:'Invalid local request target'});
      assert.equal(service.child.exitCode,null);
      assert.equal((await request(service.origin,'/api/health')).status,200);
      const state=await request(service.labOrigin,'/lab-state');assert.equal(state.status,200);
      assert.ok(Object.values(JSON.parse(state.body).counts).every(count=>count===0));
      assert.equal(JSON.parse((await request(service.labOrigin,'/sink?kind=navigation')).body).count,1);
      assert.equal(service.stderr(),'');
    });
  }
  test(`${endpoint} retains header refusal before request-target parsing`,{timeout:10000},async t=>{
    const service=await serviceProcess(t);
    for(const headers of [{Host:'foreign.invalid'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'}]){
      assert.equal((await request(service[endpoint],'http://[',headers)).status,403);
    }
    assert.equal((await request(service.origin,'/api/health')).status,200);
    assert.equal(service.stderr(),'');
  });
}

test('ordinary local routes and URL-like query data remain supported',{timeout:10000},async t=>{
  const service=await serviceProcess(t);
  const query='?target=http://foreign.invalid/&encoded=%2F%2Fforeign.invalid';
  assert.equal((await request(service.origin,'/api/health'+query)).status,200);
  assert.equal((await request(service.labOrigin,'/lab-state'+query)).status,200);
  assert.equal((await request(service.origin,'/api/state')).status,401);
  assert.equal((await request(service.labOrigin,'/')).status,200);
  assert.equal(service.stderr(),'');
});
