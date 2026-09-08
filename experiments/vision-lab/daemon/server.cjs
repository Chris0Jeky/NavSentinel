'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const Core=require('../shared/core.js');
const scenarios=require('../shared/scenarios.js');
const {CapabilityStore,Ledger,constantEqual,randomToken}=require('./security.cjs');
const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const CSP="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function respond(res,status,data,headers={}){
  const body=typeof data==='string'?data:JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});res.end(body);
}
function bodyJson(req){return new Promise((resolve,reject)=>{
  if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return reject(Object.assign(new Error('JSON content type required'),{status:415}));
  let size=0,chunks=[],done=false;
  req.on('data',chunk=>{size+=chunk.length;if(size>16384){if(!done){done=true;reject(Object.assign(new Error('Request exceeds 16 KiB'),{status:413}));}return;}chunks.push(chunk);});
  req.on('end',()=>{if(done)return;try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();resolve(data);}catch{reject(Object.assign(new Error('Invalid JSON object'),{status:400}));}});
  req.on('error',reject);
});}
function staticFile(res,pathname,{lab=false}={}){
  let decoded;try{decoded=decodeURIComponent(pathname);}catch{return respond(res,400,{error:'Bad path'});}
  if(decoded.includes('\0')||decoded.includes('\\'))return respond(res,400,{error:'Bad path'});
  let rel;
  if(lab) rel=decoded==='/'?'lab/index.html':`lab/${decoded.replace(/^\//,'')}`;
  else if(decoded==='/')rel='web/index.html';
  else if(/^\/(web|shared)\/[a-zA-Z0-9._/-]+$/.test(decoded))rel=decoded.slice(1);
  else return respond(res,404,{error:'Not found'});
  const base=lab?path.join(ROOT,'lab'):ROOT, filename=path.resolve(ROOT,rel);
  if(!filename.startsWith(base+path.sep)||rel.split('/').includes('..'))return respond(res,403,{error:'Forbidden'});
  const ext=path.extname(filename);if(!Object.hasOwn(MIME,ext))return respond(res,404,{error:'Not found'});
  try{
    const data=fs.readFileSync(filename);
    res.writeHead(200,{'Content-Type':MIME[ext],'Content-Security-Policy':lab?"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'":CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(data);
  }catch{return respond(res,404,{error:'Not found'});}
}
async function createService({port=4318,labPort=4319,dataDir=path.join(ROOT,'.local'),quiet=false,clock=Date.now}={}){
  if(!Number.isInteger(port)||port<0||port>65535||!Number.isInteger(labPort)||labPort<0||labPort>65535)throw new Error('Invalid port');
  fs.mkdirSync(dataDir,{recursive:true,mode:0o700});
  const lockPath=path.join(dataDir,'service.lock');
  const lockFd=fs.openSync(lockPath,'wx',0o600);fs.writeFileSync(lockFd,String(process.pid));fs.closeSync(lockFd);
  let ledger;try{ledger=new Ledger(dataDir);}catch(e){fs.unlinkSync(lockPath);throw e;}
  const adminToken=randomToken(),agentToken=randomToken(),sinkToken=randomToken(),caps=new CapabilityStore({now:clock}),pending=new Map(),rate=new Map();
  const journeyId=`broker-${randomToken().slice(0,18)}`;
  const brokerEffects={count:0,lastRequestId:null};
  const started=Date.now(),sinkCounts={navigation:0,credential:0,overlay:0,popup:0,clipboard:0};
  let actualPort=port,actualLabPort=labPort,closed=false;
  function prune(){for(const [k,v]of pending)if(v.expiresAt<=clock())pending.delete(k);caps.prune();}
  const fixtureAdapter=()=>({id:'local-counter-v1',action:'navigate',autoDestination:`http://127.0.0.1:${actualLabPort}/broker-fixture/auto`,reviewDestination:`http://127.0.0.1:${actualLabPort}/broker-fixture/review`,observationUrl:`http://127.0.0.1:${actualLabPort}/broker-effects`,effect:'fixture-counter-only'});
  function fixtureKind(event){
    if(event.action!=='navigate')return null;
    const adapter=fixtureAdapter();
    return event.destination===adapter.autoDestination?'auto':event.destination===adapter.reviewDestination?'review':null;
  }
  async function executeFixture(requestId){
    // The endpoint is constructed entirely by the service. Never fetch a caller URL.
    const response=await fetch(`http://127.0.0.1:${actualLabPort}/broker-effect`,{method:'POST',headers:{Authorization:`Bearer ${sinkToken}`,'Content-Type':'application/json'},body:JSON.stringify({requestId}),redirect:'error',signal:AbortSignal.timeout(2000)});
    if(!response.ok)throw new Error('Fixture sink rejected the effect');
    return response.json();
  }
  const pendingView=p=>({id:p.id,caller:p.caller,event:p.event,result:p.result,expiresAt:p.expiresAt});
  function addReceipt(event,result,kind='decision',requestId=null){return ledger.append({kind,requestId,...Core.publicReceipt(event,result,{sourceKind:'broker'})});}
  const server=http.createServer(async(req,res)=>{
    try{
      const expectedHost=`127.0.0.1:${actualPort}`,expectedOrigin=`http://${expectedHost}`;
      if(req.headers.host!==expectedHost)return respond(res,403,{error:'Unexpected Host'});
      if(req.headers.origin && req.headers.origin!==expectedOrigin)return respond(res,403,{error:'Cross-origin requests are not accepted'});
      if(req.headers['sec-fetch-site']==='cross-site')return respond(res,403,{error:'Cross-site request rejected'});
      const url=new URL(req.url,expectedOrigin);
      if(url.pathname==='/api/health'&&req.method==='GET')return respond(res,200,{version:Core.VERSION,uptimeSeconds:Math.floor((Date.now()-started)/1000),mode:'cooperative intent broker',osHooks:false,labPort:actualLabPort,fixtureAdapter:fixtureAdapter()});
      if(!url.pathname.startsWith('/api/')){
        if(req.method!=='GET'&&req.method!=='HEAD')return respond(res,405,{error:'Method not allowed'});
        return staticFile(res,url.pathname);
      }
      const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
      const role=constantEqual(token,adminToken)?'admin':constantEqual(token,agentToken)?'agent':null;
      if(!role)return respond(res,401,{error:'A valid session token is required'});
      const now=clock();let bucket=rate.get(role);if(!bucket||bucket.until<=now){bucket={count:0,until:now+60000};rate.set(role,bucket);}if(++bucket.count>240)return respond(res,429,{error:'Request budget exhausted; retry after one minute'});
      prune();
      if(url.pathname==='/api/state'&&req.method==='GET'){
        if(role!=='admin')return respond(res,403,{error:'Administrator token required'});
        return respond(res,200,{journal:ledger.snapshot(),pending:[...pending.values()].filter(p=>p.result.decision==='review'&&!p.approved).map(pendingView),capabilities:caps.items.size,uptimeSeconds:Math.floor((now-started)/1000)});
      }
      if(url.pathname==='/api/request'&&req.method==='GET'){
        const record=pending.get(url.searchParams.get('requestId'));
        if(!record||record.caller!==role)return respond(res,404,{error:'Request not found for this principal'});
        return respond(res,200,{requestId:record.id,event:record.event,result:record.result,capability:record.capability||null,expiresAt:record.expiresAt});
      }
      if(req.method!=='POST')return respond(res,405,{error:'Method not allowed'});
      const body=await bodyJson(req);
      if(url.pathname==='/api/scenario'){
        if(role!=='admin')return respond(res,403,{error:'Administrator token required'});
        const scenario=scenarios.find(s=>s.id===body.id);if(!scenario)return respond(res,400,{error:'Unknown fixture'});
        const event={...scenario.event,id:`fixture-${randomToken().slice(0,12)}`};
        const result=Core.evaluate(event,body.policy||{}),entry=addReceipt(event,result,'fixture');
        return respond(res,200,{result,receipt:entry,limit:'Fixture input, not measured browser or OS enforcement'});
      }
      if(url.pathname==='/api/request'){
        if(pending.size>=256)return respond(res,503,{error:'Pending-request capacity reached'});
        const declared=Core.normalizeEvent(body.event);
        // A caller cannot select its identity or claim a privileged sensor provenance.
        const id=`req-${randomToken().slice(0,18)}`;
        const event={...declared,id,journeyId,actor:role==='agent'?'research-agent':'local-operator',evidence:'declared'};
        const allowed=fixtureKind(event)==='auto'||(event.action==='navigate'&&Core.origin(event.destination)==='https://reference.test');
        if(!allowed&&!event.signals.includes('agent_outside_scope'))event.signals.push('agent_outside_scope');
        // There is deliberately no shell executor. Missing taint metadata never authorizes one.
        if(event.action==='shell-paste')return respond(res,422,{error:'Shell execution is not a supported capability',decision:'block'});
        const canonical=Core.normalizeEvent(event),result=Core.evaluate(canonical,{mode:'smart'});
        const record={id,event:canonical,result,caller:role,expiresAt:now+60000,approved:false};
        const receipt=addReceipt(canonical,result,'decision',id);
        let capability=null;
        if(result.decision!=='block')pending.set(id,record);
        if(result.decision==='allow'){capability=caps.issue({event:canonical,caller:role,requestId:id});record.approved=true;record.capability=capability;}
        return respond(res,200,{requestId:id,event:canonical,result,capability,receipt});
      }
      if(url.pathname==='/api/approve'){
        if(role!=='admin')return respond(res,403,{error:'Only the trusted operator can approve a request'});
        const record=pending.get(body.requestId);
        if(!record||record.approved||record.expiresAt<=now)return respond(res,409,{error:'Request is expired, already approved, or missing'});
        if(!record.result.overridable)return respond(res,403,{error:'This decision cannot be overridden'});
        addReceipt(record.event,record.result,'approved-once',record.id);
        const capability=caps.issue({event:record.event,caller:record.caller,requestId:record.id});record.approved=true;record.capability=capability;
        return respond(res,200,{capability,event:record.event,caller:record.caller});
      }
      if(url.pathname==='/api/consume'){
        // CapabilityStore burns before parsing/validating context, including malformed events.
        let grant;try{grant=caps.consume({token:body.token,event:body.event,caller:role});}catch(e){return respond(res,409,{error:e.message,executed:false});}
        pending.delete(grant.requestId);
        const fixtureOnly=!!fixtureKind(grant.event);
        let observation=null;
        if(fixtureOnly){
          try{observation=await executeFixture(grant.requestId);}catch{
            // A transport failure may happen after the sink effect. Never retry a consumed grant.
            return respond(res,502,{accepted:true,executed:null,effectStatus:'unknown',fixtureOnly:true,error:'Fixture effect could not be confirmed; inspect the independent observation endpoint. Grant consumed.'});
          }
        }
        let receipt;
        try{receipt=addReceipt(grant.event,Core.evaluate(grant.event),fixtureOnly?'fixture-effect':'capability-consumed',grant.requestId);}catch{
          return respond(res,503,{accepted:true,executed:fixtureOnly,fixtureOnly,observation,receiptStatus:'unavailable',error:'Consumed grant could not be journaled. Do not retry; inspect the independent fixture observation.'});
        }
        return respond(res,200,{executed:fixtureOnly,accepted:true,fixtureOnly,effect:fixtureOnly?'Local fixture counter incremented; no destination was visited':'Inert executor receipt recorded; no external action was taken',observation,receipt});
      }
      if(url.pathname==='/api/revoke'){
        if(role!=='admin')return respond(res,403,{error:'Administrator token required'});
        caps.revokeAll();pending.clear();ledger.append({kind:'revoked-all',timestamp:new Date().toISOString()});return respond(res,200,{revoked:true});
      }
      return respond(res,404,{error:'Unknown operation'});
    }catch(error){if(!res.headersSent)respond(res,error.status||400,{error:error.message||'Request rejected'});else res.end();}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=40;
  const labServer=http.createServer(async(req,res)=>{
    if(req.headers.host!==`127.0.0.1:${actualLabPort}`)return respond(res,403,{error:'Unexpected Host'});
    const url=new URL(req.url,`http://127.0.0.1:${actualLabPort}`);
    if(url.pathname==='/broker-effects'&&req.method==='GET')return respond(res,200,{fixtureOnly:true,...brokerEffects});
    if(url.pathname==='/broker-effect'){
      if(req.method!=='POST')return respond(res,405,{error:'Method not allowed'});
      if(!constantEqual(req.headers.authorization,`Bearer ${sinkToken}`))return respond(res,403,{error:'Internal fixture adapter required'});
      try{
        const body=await bodyJson(req);
        if(Object.keys(body).length!==1||typeof body.requestId!=='string'||!/^req-[A-Za-z0-9_-]{18}$/.test(body.requestId))return respond(res,400,{error:'Invalid fixture receipt identity'});
        brokerEffects.count++;brokerEffects.lastRequestId=body.requestId;
        return respond(res,200,{fixtureOnly:true,...brokerEffects});
      }catch(error){return respond(res,error.status||400,{error:error.message});}
    }
    if(url.pathname==='/sink'){
      const kind=url.searchParams.get('kind');if(!Object.hasOwn(sinkCounts,kind))return respond(res,400,{error:'Invalid sink'});
      if(!['GET','POST'].includes(req.method))return respond(res,405,{error:'Method not allowed'});
      // Drain and discard. No field, password, command, body or query is logged.
      req.resume();sinkCounts[kind]++;return respond(res,200,{fixtureOnly:true,kind,count:sinkCounts[kind],message:'Inert loopback sink reached'});
    }
    if(url.pathname==='/lab-state'&&req.method==='GET')return respond(res,200,{fixtureOnly:true,counts:sinkCounts});
    if(req.method!=='GET')return respond(res,405,{error:'Method not allowed'});
    return staticFile(res,url.pathname,{lab:true});
  });
  const listen=(s,p)=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(p,'127.0.0.1',()=>{s.removeListener('error',reject);resolve(s.address().port);});});
  try{actualPort=await listen(server,port);actualLabPort=await listen(labServer,labPort);}catch(e){server.close();labServer.close();fs.unlinkSync(lockPath);throw e;}
  const session={origin:`http://127.0.0.1:${actualPort}`,labOrigin:`http://127.0.0.1:${actualLabPort}`,adminToken,agentToken};
  // Client bootstrap never includes the operator credential. The owner gets it in memory/stdout.
  const clientSession={origin:session.origin,labOrigin:session.labOrigin,agentToken};
  const sessionPath=path.join(dataDir,'session.json');fs.writeFileSync(sessionPath,JSON.stringify(clientSession,null,2),{mode:0o600});
  const close=async()=>{
    if(closed)return;closed=true;caps.revokeAll();
    await Promise.all([server,labServer].map(s=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections?.();})));
    for(const f of[sessionPath,lockPath])try{fs.unlinkSync(f);}catch{}
  };
  if(!quiet)console.log(`\nNavSentinel · Intent Relay\n\nOpen ${session.origin}\nLive extension fixtures: ${session.labOrigin}\n\nOperator token (paste into Connect daemon):\n${adminToken}\n\nAgent token is stored in ${path.relative(ROOT,sessionPath)}\nLocal-only cooperative broker. No OS hooks, shell execution or remote requests.\nPress Ctrl+C to stop.\n`);
  return {...session,server,labServer,ledger,caps,close};
}
if(require.main===module){createService({port:Number(process.env.PORT||4318),labPort:Number(process.env.LAB_PORT||4319),dataDir:process.env.NS_DATA_DIR||path.join(ROOT,'.local')}).then(service=>{
  let stopping=false;for(const sig of['SIGINT','SIGTERM'])process.on(sig,async()=>{if(stopping)return;stopping=true;await service.close();process.exit(0);});
}).catch(e=>{console.error(`Cannot start: ${e.message}\nFor a stale lock, confirm no instance is running before removing .local/service.lock.`);process.exitCode=1;});}
module.exports={createService};
