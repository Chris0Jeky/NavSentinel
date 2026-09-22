import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDocumentCapture } from './check-capture.mjs';
import { expectedKeys } from './compare.mjs';
const fixtures=()=>expectedKeys.map((key,i)=>({schema:'navsentinel.observatory.form.v2',bindingPolicy:'CDP_DEFAULT_WORLD_DOCUMENT',experiment:'form-campaign',variant:key.split(':')[0],protectedArm:key.endsWith(':true'),runId:`run-${i}`,completed:true,dropped:0,gaps:[],identity:{head:'a'.repeat(40)},events:[{kind:'document.started'},{kind:'form.intent'},{kind:'document.ended'},{kind:'observation.end'}]}));
test('all fixed arm captures pass only the capture check, not protection',()=>{const r=checkDocumentCapture(fixtures());assert.equal(r.passed,true);assert.equal(r.records,expectedKeys.length);assert.equal(r.evidencePolicy,'CAPTURE_COMPLETENESS_NOT_PROTECTION_EVIDENCE');});
for(const [name,modify]of[
 ['missing capture',r=>r.pop()],['duplicate arm',r=>r[1]=structuredClone(r[0])],['reused run',r=>r[1].runId=r[0].runId],['failed run',r=>r[0].completed=false],['observer gap',r=>r[0].gaps=['DOCUMENT_CONTEXT_UNKNOWN']],['dropped report',r=>r[0].dropped=1],['unbound legacy',r=>r[0].schema='navsentinel.observatory.form.v1'],['lifecycle substituted',r=>r[0].experiment='same-url-siblings'],['missing snapshot',r=>r[0].events.splice(1,1)],['missing end',r=>r[0].events.pop()],['different head',r=>r[1].identity.head='b'.repeat(40)],
])test(`${name} cannot be hidden by outcome parity`,()=>{const r=fixtures();modify(r);assert.equal(checkDocumentCapture(r).passed,false);});
