import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../model.mjs';
import { renderReport } from '../render.mjs';
const intent = { form: 'f', submitter: 'a', action: 'benign', declaredAction: 'harm', actionSource: 'submitter', method: 'POST', encoding: 'urlencoded', target: 'top', targetSource: 'form', targetOverride: 'absent', methodOverride: 'absent', ownerMatches: true };
export function formTrace(enabled = true) {
  const events = [
    ['runner','run.start',0,{}], ['sink','receiver.health',1,{phase:'start',ok:true,sequence:1}],
    ['runner','input.dispatched',10,{action:'click'}],
    ['page','form.intent',11,{phase:'input',primitive:'native',intent}],
    ['page','form.intent',110,{phase:'operation',primitive:'submit',intent:{...intent,submitter:'none',action:'harm',actionSource:'form'}}],
    ...(enabled ? [['extension','decision.report',2200,{code:'form-blocked'}]] : [['sink','receiver.attempt',120,{role:'harm',method:'POST',accepted:true,ordinal:1}],['browser','navigation.committed',130,{scope:'top',destination:'harm'}]]),
    ['sink','receiver.health',2500,{phase:'end',ok:true,sequence:2}], ['runner','observation.end',2501,{}]
  ].map(([source,kind,elapsedMs,data],i)=>({id:`e${i+1}`,sequence:i+1,source,kind,elapsedMs,data:structuredClone(data)}));
  return {schema:'navsentinel.observatory.form.v1',mode:'synthetic',scenarioId:'issue688-form-intent',variant:'action-substitution',pairId:'e'.repeat(64),runId:enabled?'protected-run':'baseline-run',protectedArm:enabled,
    identity:{head:'a'.repeat(40),tree:'b'.repeat(40),extensionSha256:'c'.repeat(64),fixtureSha256:'d'.repeat(64)},completed:true,browserVersion:'143.0.7499.4',requiredObservationMs:2300,dropped:0,gaps:[],events,evidencePolicy:'FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION'};
}
const report = (...r)=>buildReport(r.map(x=>JSON.stringify(x)));
test('form receipts are recognized but cannot certify the native four-arm contract',()=>{
 const r=report(formTrace(false),formTrace());assert.equal(r.rejected.length,0);assert.equal(r.cases[0].assessment,'HARM_OBSERVED');assert.equal(r.cases[1].assessment,'INCONCLUSIVE');assert.equal(r.summary.boundedSupportedComparisons,0);assert.equal(r.formComparisons[0].status,'PAIRED_NON_REACHABILITY_OBSERVED');
});
test('intent changes retain the actual source events, form and submitter',()=>{
 const c=report(formTrace()).cases[0];assert.equal(c.formEvidence.snapshots.length,2);assert.equal(c.formEvidence.snapshots[1].eventId,'e5');assert.equal(c.events[4].source,'page');
});
for(const [name,mutate] of [
 ['page forged sink',t=>t.events[3].source='sink'],['unknown sensitive payload',t=>t.events[3].data.intent.password='SECRET'],['unknown phase',t=>t.events[3].data.phase='arbitrary prose'],['bad identity',t=>t.identity.head='main'],['negative time',t=>t.events[1].elapsedMs=-1],['event beyond terminal',t=>t.events[3].elapsedMs=4000],['nonsequential receipts',t=>{t.events[5].data.ordinal=2;}],['invalid accepted bool',t=>{t.events[5].data.accepted='true';}],['unknown root field',t=>t.password='SECRET'],['string protected flag',t=>t.protectedArm='true'],['unknown gap',t=>t.gaps=['SECRET']],
]) test(`${name} is rejected without echoing raw data`,()=>{const t=formTrace(false);mutate(t);const r=report(t);assert.equal(r.rejected.length,1);assert.ok(!JSON.stringify(r).includes('SECRET'));});
for(const [name,mutate] of [
 ['receiver dies',t=>{t.events.at(-2).data.ok=false;}],['clock window too short',t=>{t.events.at(-2).elapsedMs=1200;t.events.at(-1).elapsedMs=1201;t.events[5].elapsedMs=1100;}],['dropped observations',t=>t.dropped=1],['incomplete run',t=>t.completed=false],['missing product observation',t=>{t.events[5].kind='input.dispatched';t.events[5].source='runner';t.events[5].data={action:'click'};}],
]) test(`${name} cannot become paired supported prevention`,()=>{const t=formTrace();mutate(t);const r=report(formTrace(false),t);assert.equal(r.summary.boundedSupportedComparisons,0);assert.notEqual(r.formComparisons[0].status,'BOUNDED_PREVENTION_SUPPORTED');if(name!=='missing product observation')assert.equal(r.formComparisons[0].status,'COMPARISON_INCOMPLETE');});
test('a received consequence followed by fixture return is harm then recovery',()=>{
 const t=formTrace(false);t.protectedArm=true;t.events[6].data.destination='fixture';
 assert.equal(report(t).cases[0].assessment,'HARM_THEN_RECOVERY');
});
test('returning to fixture before a later receipt cannot erase harm',()=>{
 const t=formTrace(false);t.events[5].source='browser';t.events[5].kind='navigation.committed';t.events[5].data={scope:'top',destination:'fixture'};
 t.events[6].source='sink';t.events[6].kind='receiver.attempt';t.events[6].data={role:'harm',method:'POST',accepted:true,ordinal:1};
 assert.equal(report(t).cases[0].assessment,'HARM_OBSERVED');
});
test('rejected duplicate spend remains visible and is not counted as another acceptance',()=>{
 const t=formTrace(false);const end=t.events.pop(),health=t.events.pop();t.events.push({id:'e8',sequence:8,elapsedMs:200,source:'sink',kind:'receiver.attempt',data:{role:'harm',method:'POST',accepted:false,ordinal:2}});health.id='e9';health.sequence=9;end.id='e10';end.sequence=10;t.events.push(health,end);
 const c=report(t).cases[0];assert.equal(c.facts.harmReceipts,1);assert.equal(c.formEvidence.rejectedAttempts,1);
});
test('failed producer set cannot retain a green paired result',()=>{
 const r=buildReport([JSON.stringify(formTrace(false)),JSON.stringify(formTrace())],{producerStatus:'failed'});assert.equal(r.formComparisons[0].status,'COMPARISON_INCOMPLETE');
});
test('same variant with different browser or executed artifact cannot be paired',()=>{
 const t=formTrace();t.browserVersion='144.0';assert.equal(report(formTrace(false),t).formComparisons[0].status,'COMPARISON_INCOMPLETE');
});
test('duplicate run IDs across different source bytes cannot be paired',()=>{
 const t=formTrace();t.runId='baseline-run';assert.equal(report(formTrace(false),t).formComparisons[0].status,'COMPARISON_INCOMPLETE');
});
test('viewer supplies the form intent panel without active imported content',()=>{const html=renderReport(report(formTrace()));assert.ok(html.includes('id="form-panel"'));assert.ok(!html.includes('innerHTML'));});
