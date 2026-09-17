/** Compare fixed scenario outcomes, never page reports or protection percentages. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const paired=['alternate-submitter','action-substitution','target-mutation','method-mutation','enctype-mutation','base-href','base-target','reassociation','expired','mismatch-burn','synthetic','location-same','location-different','late-submit','replay'];
const controls=['exact-submit','exact-request','native','server-redirect','slow-response','empty-target','inherited-target','empty-method','invalid-method','self','validation','dialog','allow-once','allow-mutated','mixed'];
export const expectedKeys=Object.freeze([...paired.flatMap(v=>[`${v}:false`,`${v}:true`]),...controls.map(v=>`${v}:true`)].sort());
function normalized(rows){
 if(!Array.isArray(rows)||rows.length!==45)throw Error('FORM_RESULT_COUNT');
 const map=new Map();
 for(const row of rows){
  if(!row||Object.keys(row).sort().join()!=='atFixture,atSink,attempts,dialogClosed,protectedArm,variant'||typeof row.protectedArm!=='boolean'||typeof row.atFixture!=='boolean'||typeof row.atSink!=='boolean'||typeof row.dialogClosed!=='boolean'||!Array.isArray(row.attempts)||row.attempts.length>16)throw Error('FORM_RESULT_INVALID');
  const key=`${row.variant}:${row.protectedArm}`;if(!expectedKeys.includes(key)||map.has(key))throw Error('FORM_RESULT_DUPLICATE_OR_UNKNOWN');
  row.attempts.forEach((r,i)=>{if(!r||Object.keys(r).sort().join()!=='accepted,method,ordinal,role'||!['harm','benign'].includes(r.role)||!['GET','POST'].includes(r.method)||typeof r.accepted!=='boolean'||r.ordinal!==i+1)throw Error('FORM_RECEIVER_INVALID');});
  map.set(key,{attempts:row.attempts.map(r=>[r.role,r.method,r.accepted,r.ordinal]),atFixture:row.atFixture,atSink:row.atSink,dialogClosed:row.dialogClosed});
 }
 return map;
}
export function compareFormOutcomes(full,control){
 try {const a=normalized(full),b=normalized(control),differences=expectedKeys.filter(k=>JSON.stringify(a.get(k))!==JSON.stringify(b.get(k)));
 return {schema:'navsentinel.form-observer-parity.v1',matched:differences.length===0,cases:45,differences,evidencePolicy:'CONSEQUENCE_PARITY_NOT_ZERO_OBSERVER_EFFECT'};
 }catch(error){return {schema:'navsentinel.form-observer-parity.v1',matched:false,cases:0,error:error.message};}
}
export function collectFormResults(root){
 const rows=[];let entries=0;const walk=(dir,depth)=>{if(depth>8)throw Error('FORM_DIRECTORY_LIMIT');for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(++entries>1024||entry.isSymbolicLink())throw Error('FORM_DIRECTORY_LIMIT');const file=path.join(dir,entry.name);
  if(entry.isDirectory())walk(file,depth+1);else if(entry.isFile()&&entry.name.endsWith('.result.json')){if(fs.statSync(file).size>16384)throw Error('FORM_RESULT_SIZE');rows.push(JSON.parse(fs.readFileSync(file,'utf8')));}
 }};walk(root,0);return rows;
}
const FORM_TRACE_SCHEMA='navsentinel.observatory.form.v1';
export function validateFormTraces(rows){
 const differences=[];const seen=new Set();
 if(!Array.isArray(rows)||rows.length!==expectedKeys.length)differences.push('FORM_TRACE_COUNT');
 for(const row of Array.isArray(rows)?rows:[]){
  if(!row||typeof row!=='object'||Array.isArray(row)){differences.push('FORM_TRACE_INVALID');continue;}
  const key=`${row.variant}:${row.protectedArm}`;
  if(!expectedKeys.includes(key)||seen.has(key)){differences.push(`FORM_TRACE_DUPLICATE_OR_UNKNOWN:${key}`);}else seen.add(key);
  if(typeof row.protectedArm!=='boolean')differences.push(`FORM_TRACE_ARM_TYPE:${key}`);
  if(row.schema!==FORM_TRACE_SCHEMA)differences.push(`FORM_TRACE_SCHEMA:${key}`);
  if(row.completed!==true)differences.push(`FORM_TRACE_INCOMPLETE:${key}`);
  if(!Array.isArray(row.gaps)||row.gaps.length!==0)differences.push(`FORM_TRACE_GAPS:${key}`);
  if(row.dropped!==0)differences.push(`FORM_TRACE_DROPPED:${key}`);
  const events=row.events;
  if(!Array.isArray(events)){differences.push(`FORM_TRACE_EVENTS:${key}`);continue;}
  const has=(kind,predicate=()=>true)=>events.some(event=>event&&typeof event==='object'&&!Array.isArray(event)&&event.kind===kind&&predicate(event));
  if(!has('run.start'))differences.push(`FORM_TRACE_RUN_START:${key}`);
  if(!has('form.intent'))differences.push(`FORM_TRACE_INTENT:${key}`);
  if(!has('receiver.health',event=>event.data&&typeof event.data==='object'&&event.data.phase==='start'&&event.data.ok===true))differences.push(`FORM_TRACE_HEALTH_START:${key}`);
  if(!has('receiver.health',event=>event.data&&typeof event.data==='object'&&event.data.phase==='end'&&event.data.ok===true))differences.push(`FORM_TRACE_HEALTH_END:${key}`);
  if(!has('observation.end'))differences.push(`FORM_TRACE_END:${key}`);
 }
 return {schema:'navsentinel.form-observer-traces.v1',matched:differences.length===0,cases:Array.isArray(rows)?rows.length:0,differences,evidencePolicy:'COMPLETE_FORM_TRACE_REQUIRED'};
}
export function collectFormTraces(root){
 const rows=[];let entries=0;const walk=(dir,depth)=>{if(depth>8)throw Error('FORM_DIRECTORY_LIMIT');for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  if(++entries>1024||entry.isSymbolicLink())throw Error('FORM_DIRECTORY_LIMIT');const file=path.join(dir,entry.name);
  if(entry.isDirectory())walk(file,depth+1);else if(entry.isFile()&&entry.name.endsWith('.form-trace.json')){if(fs.statSync(file).size>65536)throw Error('FORM_TRACE_SIZE');rows.push(JSON.parse(fs.readFileSync(file,'utf8')));}
 }};walk(root,0);return rows;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{if(process.argv.length!==4)throw Error('FORM_ARGUMENTS');const fullRoot=process.argv[2],controlRoot=process.argv[3];const parity=compareFormOutcomes(collectFormResults(fullRoot),collectFormResults(controlRoot));const traceEvidence=validateFormTraces(collectFormTraces(fullRoot));const result={...parity,matched:parity.matched&&traceEvidence.matched,traceEvidence,evidencePolicy:'CONSEQUENCE_PARITY_AND_COMPLETE_FORM_TRACE'};console.log(JSON.stringify(result));process.exitCode=result.matched?0:1;}
 catch{console.error(JSON.stringify({error:'FORM_COMPARISON_INPUT_ERROR'}));process.exitCode=2;}
}
