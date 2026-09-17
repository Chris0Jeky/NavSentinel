import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../model.mjs';
import { selectFormIntent } from '../form-state.mjs';
const binding = (n = 1, frame = n + 1) => ({ frameId: `frame-${frame}`, documentId: `document-${n}`, scope: 'child' });
const intent = { form: 'f', submitter: 'a', action: 'benign', declaredAction: 'harm', actionSource: 'submitter', method: 'POST', encoding: 'urlencoded', target: 'top', targetSource: 'form', targetOverride: 'absent', methodOverride: 'absent', ownerMatches: true };
const add = (t, source, kind, data = {}, b) => t.events.push({ id:`e${t.events.length+1}`,sequence:t.events.length+1,elapsedMs:t.events.length,source,kind,data:structuredClone(data),...(b?{binding:{...b}}:{}) });
function trace() {
  const t = { schema:'navsentinel.observatory.form.v2',bindingPolicy:'CDP_DEFAULT_WORLD_DOCUMENT',mode:'synthetic',scenarioId:'issue688-form-intent',variant:'action-substitution',pairId:'e'.repeat(64),runId:'bound-run',protectedArm:true,identity:{head:'a'.repeat(40),tree:'b'.repeat(40),extensionSha256:'c'.repeat(64),fixtureSha256:'d'.repeat(64)},completed:true,browserVersion:'143.0.7499.4',requiredObservationMs:2300,dropped:0,gaps:[],events:[],evidencePolicy:'FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION' };
  add(t,'runner','run.start'); add(t,'sink','receiver.health',{phase:'start',ok:true,sequence:1});return t;
}
function finish(t) {
  add(t,'sink','receiver.health',{phase:'end',ok:true,sequence:2});add(t,'runner','observation.end');
  t.events.at(-2).elapsedMs=3000;t.events.at(-1).elapsedMs=3001;return t;
}
const snapshot = (t, phase, b=binding()) => add(t,'page','form.intent',{phase,primitive:'native',intent},b);
function complete() { const t=trace();add(t,'browser','document.started',{},binding());add(t,'runner','input.dispatched',{action:'click'});snapshot(t,'input');snapshot(t,'operation');add(t,'browser','document.ended',{reason:'collector-closed'},binding());return finish(t); }
const report = t=>buildReport([JSON.stringify(t)]);
const project = t=>{const r=report(t);assert.deepEqual(r.rejected,[]);return r.cases[0];};
test('v2 retains browser document lifecycle, but no native initiator or prevention proof',()=>{
 const c=project(complete());assert.equal(c.formEvidence.bindingPolicy,'CDP_DEFAULT_WORLD_DOCUMENT');assert.equal(c.formEvidence.documents.length,1);assert.equal(c.formEvidence.snapshots[0].binding.documentId,'document-1');assert.equal(c.events[4].documentId,'document-1');assert.equal(c.proof,null);assert.equal(c.formEvidence.documents[0].endEventId,'e7');
});
for(const [name,mutate]of [
 ['missing policy',t=>delete t.bindingPolicy],['unknown policy',t=>t.bindingPolicy='AUTHENTICATED'],['raw document ID',t=>t.events[2].binding.documentId='https://SECRET.example/'],['payload binding',t=>t.events[4].data.binding=binding()],['unstarted source',t=>t.events[4].binding=binding(2)],['missing source',t=>delete t.events[4].binding],['wrong frame',t=>t.events[4].binding.frameId='frame-3'],['wrong scope',t=>t.events[4].binding.scope='top'],['page forged lifecycle',t=>t.events[2].source='page'],['unknown retirement',t=>t.events[6].data.reason='SECRET'],['receiver falsely bound',t=>t.events[1].binding=binding()],['retired source',t=>{t.events[5].kind='document.ended';t.events[5].source='browser';t.events[5].data={reason:'navigation'};t.events[6].kind='form.intent';t.events[6].source='page';t.events[6].data={phase:'operation',primitive:'native',intent};}],
])test(`${name} is rejected, never repaired with a fabricated identity`,()=>{const t=complete();mutate(t);const r=report(t);assert.equal(r.rejected.length,1);assert.ok(!JSON.stringify(r).includes('SECRET'));});
test('document ID reuse cannot create a second lifetime',()=>{const t=trace();add(t,'browser','document.started',{},binding());add(t,'browser','document.ended',{reason:'navigation'},binding());add(t,'browser','document.started',{},binding());assert.equal(report(finish(t)).rejected.length,1);});
test('two simultaneous default documents in one frame are contradictory',()=>{const t=trace();add(t,'browser','document.started',{},binding());add(t,'browser','document.started',{},binding(2,2));assert.equal(report(finish(t)).rejected.length,1);});
test('missing document end is an explicit gap and does not erase a received consequence',()=>{const t=trace();add(t,'browser','document.started',{},binding());add(t,'runner','input.dispatched',{action:'click'});snapshot(t,'input');add(t,'sink','receiver.attempt',{role:'harm',accepted:true,method:'POST',ordinal:1});const c=project(finish(t));assert.ok(c.gaps.includes('DOCUMENT_LIFECYCLE_INCOMPLETE'));assert.equal(c.facts.harmReceipts,1);});
test('document lifecycle without a page observation is not complete intent evidence',()=>{const t=trace();add(t,'browser','document.started',{},binding());add(t,'runner','input.dispatched',{action:'click'});add(t,'browser','document.ended',{reason:'collector-closed'},binding());assert.ok(project(finish(t)).gaps.includes('DOCUMENT_REPORTS_MISSING'));});
test('interleaved sibling input cannot become the selected operation anchor',()=>{
 const t=trace();add(t,'browser','document.started',{},binding());add(t,'browser','document.started',{},binding(2));snapshot(t,'input',binding());snapshot(t,'input',binding(2));snapshot(t,'operation',binding());add(t,'browser','document.ended',{reason:'collector-closed'},binding());add(t,'browser','document.ended',{reason:'collector-closed'},binding(2));const c=project(finish(t));const s=selectFormIntent(c,6);assert.equal(s.earlier.eventId,'e5');assert.equal(s.current.binding.documentId,'document-1');assert.equal(s.association,'same-reporting-document');
});
test('sibling operation without its own input remains unanchored',()=>{
 const t=trace();add(t,'browser','document.started',{},binding());add(t,'browser','document.started',{},binding(2));snapshot(t,'input',binding());snapshot(t,'operation',binding(2));add(t,'browser','document.ended',{reason:'collector-closed'},binding());add(t,'browser','document.ended',{reason:'collector-closed'},binding(2));const s=selectFormIntent(project(finish(t)),5);assert.equal(s.earlier,null);assert.equal(s.association,'no-reported-input');
});
test('same-frame replacement cannot inherit its retired document input',()=>{
 const t=trace();add(t,'browser','document.started',{},binding());snapshot(t,'input');add(t,'browser','document.ended',{reason:'navigation'},binding());add(t,'browser','document.started',{},binding(2,2));snapshot(t,'operation',binding(2,2));add(t,'browser','document.ended',{reason:'collector-closed'},binding(2,2));const c=project(finish(t));assert.equal(selectFormIntent(c,4),null);assert.equal(selectFormIntent(c,5),null);assert.equal(selectFormIntent(c,6).earlier,null);
});
test('navigation in a different document does not clear a valid bound snapshot',()=>{
 const t=trace();add(t,'browser','document.started',{},binding());snapshot(t,'input');add(t,'browser','navigation.committed',{scope:'child',destination:'fixture'});add(t,'browser','document.ended',{reason:'collector-closed'},binding());const c=project(finish(t));assert.equal(selectFormIntent(c,4).current.eventId,'e4');assert.equal(selectFormIntent(c,5),null);
});
test('same-realm borrowed report remains explicitly temporal, never native-causal',()=>{
 const c=project(complete()),s=selectFormIntent(c,5);assert.equal(s.association,'same-reporting-document');assert.deepEqual(c.events[5].causes,[]);assert.ok(c.warnings.some(w=>w.includes('borrow')));
});
test('v1 cannot smuggle binding metadata or gain a document identity',()=>{
 const t=complete();t.schema='navsentinel.observatory.form.v1';delete t.bindingPolicy;assert.equal(report(t).rejected.length,1);
});
test('terminal event invalidates current measurements but preserves inspectable history',()=>{const c=project(complete());assert.equal(selectFormIntent(c,c.events.length-1),null);assert.notEqual(selectFormIntent(c,5),null);});

test('viewer marks document lifetimes and distinguishes reporting realm from caller',async()=>{
 const { renderReport }=await import('../render.mjs');const html=renderReport(report(complete()));
 assert.ok(html.includes('Reporting documents'));assert.ok(html.includes('same-origin code can borrow'));assert.ok(html.includes('document-life'));
});
test('an empty ended document cannot reveal another live document snapshot',()=>{
 const t=trace();add(t,'browser','document.started',{},binding());snapshot(t,'input');add(t,'browser','document.started',{},binding(2));add(t,'browser','document.ended',{reason:'navigation'},binding(2));add(t,'browser','document.ended',{reason:'collector-closed'},binding());const c=project(finish(t));assert.equal(selectFormIntent(c,5),null);
});
test('selectors return independent copies of reporting binding data',()=>{const c=project(complete()),s=selectFormIntent(c,5);s.current.binding.documentId='forged';assert.equal(c.formEvidence.snapshots[1].binding.documentId,'document-1');});
test('explicit lifecycle experiments are clearly classified and never paired as efficacy runs',()=>{
 const t=complete();t.experiment='same-url-siblings';const r=report(t);assert.equal(r.rejected.length,0);assert.match(r.cases[0].title,/Reporting documents/);assert.deepEqual(r.formComparisons,[]);assert.ok(r.cases[0].warnings.includes('OBSERVER_LIFECYCLE_NOT_PROTECTION_EVIDENCE'));
});
test('unknown experiment labels cannot become unreviewed explanations',()=>{const t=complete();t.experiment='SECRET';assert.equal(report(t).rejected.length,1);assert.ok(!JSON.stringify(report(t)).includes('SECRET'));});
test('binding tokens must be strings, not coercible arrays',()=>{for(const key of ['frameId','documentId']){const t=trace();const b=binding();b[key]=[b[key]];add(t,'browser','document.started',{},b);assert.equal(report(finish(t)).rejected.length,1);}});
