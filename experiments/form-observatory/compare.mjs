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
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{if(process.argv.length!==4)throw Error('FORM_ARGUMENTS');const result=compareFormOutcomes(collectFormResults(process.argv[2]),collectFormResults(process.argv[3]));console.log(JSON.stringify(result));process.exitCode=result.matched?0:1;}
 catch{console.error(JSON.stringify({error:'FORM_COMPARISON_INPUT_ERROR'}));process.exitCode=2;}
}
