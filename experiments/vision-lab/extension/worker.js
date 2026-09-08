/* Trusted extension authority. Content messages can report; they cannot approve or lower protection. */
importScripts('shared/core.js');
const C=NSCore,MAX_ROWS=200,MAX_CONTEXTS=100,SESSION_KEY='liveContexts';
let queue=Promise.resolve();
const serial=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
const ownSurface=sender=>sender.id===chrome.runtime.id&&!sender.tab&&typeof sender.url==='string'&&sender.url.startsWith(chrome.runtime.getURL(''));
const contextKey=(tab,id)=>`${tab}:${id}`;
async function state(){const s=await chrome.storage.local.get(['enabledOrigins','records']);return {enabledOrigins:Array.isArray(s.enabledOrigins)?s.enabledOrigins:[],records:Array.isArray(s.records)?s.records.slice(-MAX_ROWS):[]};}
async function contexts(){const x=(await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY]||{};const now=Date.now();for(const[k,v]of Object.entries(x))if(!v||now-v.created>300000)delete x[k];return x;}
async function saveContexts(x){const keys=Object.keys(x);while(keys.length>MAX_CONTEXTS)delete x[keys.shift()];await chrome.storage.session.set({[SESSION_KEY]:x});}
function matchOrigin(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol))throw Error('Only ordinary HTTP(S) pages can be enabled.');return url.origin;}
function pattern(origin){const u=new URL(origin);return `${u.protocol}//${u.hostname}/*`;}
async function syncRegistration(origins){
 await chrome.scripting.unregisterContentScripts().catch(()=>{});
 if(origins.length)await chrome.scripting.registerContentScripts([{id:'navsentinel-opt-in-guard',matches:[...new Set(origins.map(pattern))],js:['shared/core.js','content.js'],runAt:'document_start',allFrames:true,persistAcrossSessions:true,world:'ISOLATED'}]);
}
async function init(){await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});const s=await state();await syncRegistration(s.enabledOrigins);}
chrome.runtime.onInstalled.addListener(()=>{serial(init).catch(console.error);});
chrome.runtime.onStartup.addListener(()=>{serial(init).catch(console.error);});
chrome.tabs.onRemoved.addListener(tab=>{serial(async()=>{const x=await contexts();for(const[k,v]of Object.entries(x))if(v.tabId===tab)delete x[k];await saveContexts(x);}).catch(()=>{});});
chrome.permissions.onRemoved.addListener(()=>{serial(async()=>{const s=await state();const retained=[];for(const origin of s.enabledOrigins)if(await chrome.permissions.contains({origins:[pattern(origin)]}))retained.push(origin);await chrome.storage.local.set({enabledOrigins:retained});await syncRegistration(retained);}).catch(console.error);});
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 const handle=async()=>{
  if(!message||typeof message!=='object')throw Error('Invalid message');
  const s=await state();
  if(message.type==='ready'){
   if(sender.id!==chrome.runtime.id||!sender.tab||!sender.documentId)return {enabled:false};
   return {enabled:s.enabledOrigins.includes(C.origin(sender.url||'')),version:C.VERSION};
  }
  if(message.type==='sensor'){
   if(sender.id!==chrome.runtime.id||!sender.tab||!sender.documentId)throw Error('Untrusted sensor sender');
   const source=C.origin(sender.url||'');if(!s.enabledOrigins.includes(source))throw Error('This origin is not enabled');
   if(typeof message.localId!=='string'||!/^ns-[a-f0-9-]{36}$/.test(message.localId))throw Error('Invalid local consequence ID');
   const input=C.normalizeEvent({...message.event,source:sender.url,actor:'browser-content',evidence:'sensor',context:{tab:String(sender.tab.id),frame:String(sender.frameId),document:sender.documentId,navigation:sender.documentId,actionId:message.localId}});
   const result=C.evaluate(input,{mode:'smart'}),receipt=C.publicReceipt(input,result,{sourceKind:'live-extension'});
   receipt.id=message.localId;receipt.tabId=sender.tab.id;receipt.frameId=sender.frameId;receipt.effect=message.effect==='suppressed'?'overlay-suppressed':message.effect==='held'?'captured-action-held':'observed';
   // Logs are not the enforcement oracle. Keep only purpose-limited, normalized metadata.
   s.records.push(receipt);s.records=s.records.slice(-MAX_ROWS);await chrome.storage.local.set({records:s.records});
   const x=await contexts();x[contextKey(sender.tab.id,message.localId)]={localId:message.localId,tabId:sender.tab.id,frameId:sender.frameId,documentId:sender.documentId,created:Date.now(),origin:source,action:input.action,decision:result.decision,hard:result.hard,approved:false,effect:receipt.effect};await saveContexts(x);
   await chrome.action.setBadgeText({tabId:sender.tab.id,text:String(Math.min(99,s.records.filter(r=>r.tabId===sender.tab.id).length))});await chrome.action.setBadgeBackgroundColor({tabId:sender.tab.id,color:'#294b32'});
   return {recorded:true,decision:result.decision};
  }
  if(!ownSurface(sender))throw Error('Only an extension-origin surface can request this operation');
  const tabId=Number(message.tabId);
  if(message.type==='state')return {...s,records:s.records.filter(r=>r.tabId===tabId).slice(-30).reverse(),version:C.VERSION};
  if(message.type==='enable'){
   const origin=matchOrigin(message.origin);if(!await chrome.permissions.contains({origins:[pattern(origin)]}))throw Error('Host permission was not granted');
   if(!s.enabledOrigins.includes(origin)){if(s.enabledOrigins.length>=50)throw Error('Enabled-origin limit reached');s.enabledOrigins.push(origin);}
   await chrome.storage.local.set({enabledOrigins:s.enabledOrigins});await syncRegistration(s.enabledOrigins);return {enabled:true,reloadRequired:true};
  }
  if(message.type==='disable'){
   const origin=matchOrigin(message.origin);s.enabledOrigins=s.enabledOrigins.filter(x=>x!==origin);await chrome.storage.local.set({enabledOrigins:s.enabledOrigins});await syncRegistration(s.enabledOrigins);
   const tabs=await chrome.tabs.query({});await Promise.all(tabs.filter(t=>Number.isInteger(t.id)).map(t=>chrome.tabs.sendMessage(t.id,{type:'ns-disable',origin}).catch(()=>{})));const live=await contexts();for(const [key,value]of Object.entries(live))if(value.origin===origin)delete live[key];await saveContexts(live);return {enabled:false,reloadRecommended:true};
  }
  if(message.type==='clear'){
   const tabIds=[...new Set(s.records.map(record=>record?.tabId).filter(tabId=>Number.isInteger(tabId)))];
   await chrome.storage.local.set({records:[]});
   await Promise.all(tabIds.map(tabId=>chrome.action.setBadgeText({tabId,text:''}).catch(()=>{})));
   await chrome.action.setBadgeText({text:''});
   return {cleared:true};
  }
  if(message.type==='undo'||message.type==='approve'){
   const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(!active||active.id!==tabId)throw Error('The requesting tab is no longer active');
   const x=await contexts(),key=contextKey(tabId,message.localId),entry=x[key];if(!entry||!s.enabledOrigins.includes(entry.origin))throw Error('The consequence is missing, expired, or no longer enabled');
   if(message.type==='approve'&&(entry.action!=='navigate'||entry.decision!=='review'||entry.hard||entry.approved||Date.now()-entry.created>30000))throw Error('No current overridable navigation review');
   if(message.type==='undo'&&entry.effect!=='overlay-suppressed')throw Error('This record does not own a reversible overlay');
   // Burn authority before dispatch. A failed exact-document delivery never becomes a broad tab grant.
   if(message.type==='approve')entry.approved=true;else delete x[key];await saveContexts(x);
   const response=await chrome.tabs.sendMessage(tabId,{type:message.type==='undo'?'ns-undo':'ns-approve',localId:entry.localId},{documentId:entry.documentId});
   if(!response?.ok)throw Error(response?.error||'The original document rejected this action');
   return response;
  }
  throw Error('Unknown operation');
 };
 serial(handle).then(sendResponse,error=>sendResponse({error:error.message}));return true;
});
