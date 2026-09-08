'use strict';
// Cooperative client: policy → grant → one-time consume. This example never runs a shell or contacts a third party.
const fs=require('node:fs');const path=require('node:path');
const scenarios=require('../shared/scenarios.js');
(async()=>{
 const session=JSON.parse(fs.readFileSync(path.join(__dirname,'../.local/session.json'),'utf8'));
 async function post(route,body,token=session.agentToken){const r=await fetch(session.origin+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();return {status:r.status,...data};}
 console.log('1. Request a scoped reference navigation');
 const allow=await post('/api/request',{event:{...scenarios.find(s=>s.id==='newtab').event,action:'navigate'}});
 console.log(allow.result?.decision,allow.requestId);
 if(allow.capability){
  console.log('2. Consume once',await post('/api/consume',{token:allow.capability.token,event:allow.event}));
  console.log('3. Attempt replay',await post('/api/consume',{token:allow.capability.token,event:allow.event}));
 }
 console.log('4. Request an out-of-scope upload',await post('/api/request',{event:scenarios.find(s=>s.id==='agent-upload').event}));
 console.log('No URL was opened and no document was uploaded.');
})().catch(e=>{console.error(`Start the daemon first with npm start. ${e.message}`);process.exitCode=1;});
