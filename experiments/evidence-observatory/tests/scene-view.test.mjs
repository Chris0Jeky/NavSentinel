import test from 'node:test';
import assert from 'node:assert/strict';
import { selectScene } from '../scene-view.mjs';
import { renderReport } from '../render.mjs';
import { buildReport } from '../model.mjs';
import { demonstration } from '../demo.mjs';
const scene = { width: 1000, height: 700, boxes: [{ id: 'layer', frameId: 'f2', documentId: 'd1', parentFrameId: 'f1', kind: 'attack', state: 'visible', x: 10, y: 10, width: 100, height: 200, declaredTarget: 'harm-receiver', effectiveTarget: 'harm-receiver', targetScope: 'new-context' }] };
const events = [
  {id:'start',kind:'run.start',elapsedMs:0,data:{}},
  {id:'sample',kind:'scene.sample',elapsedMs:20,data:{scene}},
  {id:'block',kind:'decision.block',elapsedMs:40,data:{}},
];
test('no future geometry leaks into earlier events',()=>assert.equal(selectScene(events,0),null));
test('a sample remains an explicitly aged measurement, not animated motion',()=>{
 const selected=selectScene(events,2); assert.equal(selected.ageMs,20); assert.equal(selected.eventId,'sample'); assert.deepEqual(selected.scene,scene);
});
test('invalidated frame measurements are not shown as current geometry',()=>{
 const input=[...events,{id:'removed',kind:'frame.detached',elapsedMs:60,data:{context:{frameId:'f2',documentId:'d1'}}}];
 assert.equal(selectScene(input,3).invalidated,true);
});
test('document replacement invalidates prior scene until another sample',()=>{
 const input=[...events,{id:'nav',kind:'navigation.committed',elapsedMs:60,data:{context:{frameId:'f2',documentId:'d2'}}}];
 assert.equal(selectScene(input,3).invalidated,true);
 input.push({id:'new',kind:'scene.sample',elapsedMs:80,data:{scene}}); assert.equal(selectScene(input,4).invalidated,false);
});
test('receipt without collector time never invents an age',()=>{
 const input=[...events,{id:'legacy',kind:'sink.receipt',elapsedMs:null,data:{}}]; assert.equal(selectScene(input,3).ageMs,null);
});
test('geometry projection does not share mutable objects with the source',()=>{
 const s=selectScene(events,2); s.scene.boxes[0].x=999; assert.equal(events[1].data.scene.boxes[0].x,10);
});
test('viewer exposes measured scene and independent receipt panels',()=>{
 const html=renderReport(buildReport([JSON.stringify(demonstration())]));
 assert.ok(html.includes('id="scene-panel"')); assert.ok(html.includes('id="receiver-panel"'));
 assert.ok(html.includes('Sampled geometry')); assert.ok(html.includes('createElementNS'));
});


test('scene teaching example is structurally readable but never qualified evidence', async()=>{
 const {sceneDemonstration}=await import('../scene-demo.mjs');
 const report=buildReport([JSON.stringify(sceneDemonstration())]);
 assert.deepEqual(report.rejected,[]); assert.equal(report.cases.length,4);
 assert.ok(report.cases[0].events.some(e=>e.data.scene));
 assert.equal(report.summary.boundedSupportedComparisons,0);
 assert.ok(report.cases.every(c=>c.mode==='demo'));
});
