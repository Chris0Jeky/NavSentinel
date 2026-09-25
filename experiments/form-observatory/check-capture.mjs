/** Qualification admission check, not a substitute for the offline strict reader. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expectedKeys } from './compare.mjs';
export function checkDocumentCapture(rows) {
  const base = { schema:'navsentinel.form-capture-check.v1',passed:false,records:Array.isArray(rows)?rows.length:0,evidencePolicy:'CAPTURE_COMPLETENESS_NOT_PROTECTION_EVIDENCE' };
  try {
    if(!Array.isArray(rows)||rows.length!==expectedKeys.length)throw Error('CAPTURE_COUNT');
    const keys=new Set(),runs=new Set(),heads=new Set();
    for(const r of rows){
      const key=`${r?.variant}:${r?.protectedArm}`;
      if(!expectedKeys.includes(key)||keys.has(key)||typeof r.protectedArm!=='boolean'||typeof r.runId!=='string'||runs.has(r.runId))throw Error('CAPTURE_IDENTITY');
      if(r.schema!=='navsentinel.observatory.form.v2'||r.bindingPolicy!=='CDP_DEFAULT_WORLD_DOCUMENT'||r.experiment!=='form-campaign')throw Error('CAPTURE_CONTRACT');
      if(r.completed!==true||r.dropped!==0||!Array.isArray(r.gaps)||r.gaps.length)throw Error('CAPTURE_INCOMPLETE');
      if(!Array.isArray(r.events)||!r.events.some(e=>e.kind==='document.started')||!r.events.some(e=>e.kind==='form.intent')||!r.events.some(e=>e.kind==='document.ended')||r.events.at(-1)?.kind!=='observation.end')throw Error('CAPTURE_EVENTS_MISSING');
      if(typeof r.identity?.head!=='string'||!/^[a-f0-9]{40}$/.test(r.identity.head))throw Error('CAPTURE_SOURCE');
      keys.add(key);runs.add(r.runId);heads.add(r.identity.head);
    }
    if(heads.size!==1)throw Error('CAPTURE_SOURCE');
    return {...base,passed:true};
  }catch(error){return {...base,error:/^CAPTURE_[A-Z_]+$/.test(error.message)?error.message:'CAPTURE_INVALID'};}
}
function read(root){
  const rows=[];let visited=0;
  const walk=(directory,depth)=>{
    if(depth>8)throw Error('CAPTURE_DIRECTORY_LIMIT');
    const entries=fs.opendirSync(directory);
    try{for(let e;(e=entries.readSync());){
      if(++visited>1024||e.isSymbolicLink())throw Error('CAPTURE_DIRECTORY_LIMIT');
      const file=path.join(directory,e.name);
      if(e.isDirectory())walk(file,depth+1);
      else if(e.isFile()&&e.name.endsWith('.form-trace.json')){if(fs.statSync(file).size>1048576||rows.length>=expectedKeys.length)throw Error('CAPTURE_SIZE_LIMIT');rows.push(JSON.parse(fs.readFileSync(file,'utf8')));}
    }}finally{entries.closeSync();}
  };walk(root,0);return rows;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{if(process.argv.length!==3)throw Error('CAPTURE_ARGUMENTS');const r=checkDocumentCapture(read(process.argv[2]));console.log(JSON.stringify(r));process.exitCode=r.passed?0:1;}
 catch{console.error(JSON.stringify({error:'CAPTURE_INPUT_FAILED'}));process.exitCode=2;}
}
