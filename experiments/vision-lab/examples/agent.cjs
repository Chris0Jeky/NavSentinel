'use strict';
// Cooperative client: policy → grant → one-time local fixture effect → independent observation.
// This example never runs a shell, visits a proposed destination or contacts a third party.
const fs=require('node:fs');const path=require('node:path');
const scenarios=require('../shared/scenarios.js');
(async()=>{
 const session=JSON.parse(fs.readFileSync(path.join(process.env.NS_DATA_DIR||path.join(__dirname,'../.local'),'session.json'),'utf8'));
 async function post(route,body,token=session.agentToken){const r=await fetch(session.origin+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();return {status:r.status,...data};}
 const health=await (await fetch(session.origin+'/api/health')).json();
 const adapter=health.fixtureAdapter;
 const observe=async()=> (await fetch(adapter.observationUrl)).json();
 console.log('1. Independent fixture sink before request:',await observe());
 const review=process.argv.includes('--review');
 const allow=await post('/api/request',{event:{...scenarios.find(s=>s.id==='newtab').event,action:'navigate',destination:review?adapter.reviewDestination:adapter.autoDestination}});
 console.log(allow.result?.decision,allow.requestId);
 if(review&&!allow.capability){
  console.log('Approve this request in the operator console. Waiting up to 60 seconds.');
  const until=Date.now()+60000;
  while(Date.now()<until&&!allow.capability){
   await new Promise(resolve=>setTimeout(resolve,1000));
   const response=await fetch(session.origin+'/api/request?requestId='+encodeURIComponent(allow.requestId),{headers:{Authorization:`Bearer ${session.agentToken}`}});
   if(!response.ok)break;
   allow.capability=(await response.json()).capability;
  }
 }
 if(allow.capability){
  console.log('2. Consume once',await post('/api/consume',{token:allow.capability.token,event:allow.event}));
  console.log('3. Attempt replay',await post('/api/consume',{token:allow.capability.token,event:allow.event}));
 }
 console.log('4. Independent fixture sink after consume and replay:',await observe());
 console.log('5. Request an out-of-scope upload',await post('/api/request',{event:scenarios.find(s=>s.id==='agent-upload').event}));
 console.log('Only the local fixture counter can change. No URL was opened and no document was uploaded.');
})().catch(e=>{console.error(`Start the daemon first with npm start. ${e.message}`);process.exitCode=1;});
