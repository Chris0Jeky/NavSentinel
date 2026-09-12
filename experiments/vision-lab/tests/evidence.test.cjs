'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const E=require('../shared/evidence.js');
const timestamp='2026-09-08T12:00:00.000Z';
const row=(changes={})=>({id:'event-1',timestamp,kind:'nav_click_block',sourceSite:'reader.test',destinationSite:'other.test',outcome:'recorded',reasons:['nrs_cross_site'],score:75,...changes});
const file=(events=[row()])=>({format:'navsentinel-evidence',schema:1,exportedAt:timestamp,source:'navsentinel-extension',evidence:'recorded-observation',events});
test('valid extension export projects only recorded observation metadata',()=>{const clean=E.parse(JSON.stringify(file()));assert.deepEqual(clean,file());const projection=E.project(clean.events[0]);assert.equal(projection.outcome,'Recorded observation');assert.match(projection.knowledgeGap,/does not independently prove prevention/);assert.equal(projection.source,'reader.test');});
test('canonical IPv6 survives import, saved history and review export without acquiring authority',()=>{
  for(const host of ['::1','2001:db8::1','::ffff:c000:280']){
    const imported=E.parse(JSON.stringify(file([row({sourceSite:host,destinationSite:host})])));
    const state=E.merge(E.empty(),imported).state;
    const restored=E.restore(JSON.parse(JSON.stringify(state)));
    const reviewed=E.reviewEnvelope(E.exportReview(restored,timestamp));
    assert.equal(reviewed.events[0].sourceSite,host);
    assert.equal(reviewed.events[0].destinationSite,host);
    assert.equal(reviewed.events[0].outcome,'recorded');
  }
});
test('IP support rejects noncanonical addresses, ports, zones and URL-shaped metadata',()=>{
  for(const sourceSite of ['[::1]','[::1]:443','::1?secret','fe80::1%eth0','1::2::3','2001:0db8::1','::ffff:192.0.2.128','999.0.0.1','127.000.000.001','https://[::1]/private','::1\n']){
    assert.throws(()=>E.envelope(file([row({sourceSite})])),/canonical hostnames/);
  }
});
test('reject raw values, unknown keys, prototype fields and action authority at every boundary',()=>{for(const key of ['url','password','body','capability','allowOnce','__proto__']){const value=JSON.parse(JSON.stringify(file()));Object.defineProperty(value.events[0],key,{value:'sensitive',enumerable:true});assert.throws(()=>E.envelope(value),/unsupported fields/);}assert.throws(()=>E.envelope({...file(),token:'secret'}),/unsupported fields/);assert.throws(()=>E.envelope(file([row({outcome:'prevented'})])),/Unsupported/);assert.throws(()=>E.envelope(file([row({kind:'<img src=x onerror=alert(1)>'})])),/Unsupported/);});
test('hostnames reject executable text, URLs, paths, Unicode and user information',()=>{for(const sourceSite of ['https://reader.test/path?q=secret','reader.test/path','user@reader.test','reader.test:443','<svg/onload=alert(1)>','MiXeD.test','-bad.test','bad-.test','a..test','é.test','[::1]',undefined])assert.throws(()=>E.envelope(file([row({sourceSite})])),/canonical hostnames/);assert.equal(E.envelope(file([row({sourceSite:null,destinationSite:'127.0.0.1'})])).events[0].sourceSite,null);});
test('strict schema, timestamp, identifier and score bounds',()=>{for(const value of [null,{},[],{...file(),schema:2},{...file(),evidence:'verified-prevention'},{...file(),source:'page'}])assert.throws(()=>E.envelope(value));for(const timestamp of ['today','2026-02-30T00:00:00.000Z','2026-09-08',0])assert.throws(()=>E.envelope(file([row({timestamp})])));for(const id of ['','x/y','<script>', 'x'.repeat(101)])assert.throws(()=>E.envelope(file([row({id})])));for(const score of [NaN,Infinity,-1,101,'75'])assert.throws(()=>E.envelope(file([row({score})])));assert.throws(()=>E.envelope(file([row(),row()])),/Duplicate/);});
test('reject unknown and excessive reasons; deduplicate recognized codes',()=>{assert.throws(()=>E.envelope(file([row({reasons:['raw private text']})])));assert.throws(()=>E.envelope(file([row({reasons:Array(17).fill('nrs_cross_site')})])));assert.deepEqual(E.envelope(file([row({reasons:['nrs_cross_site','nrs_cross_site']})])).events[0].reasons,['nrs_cross_site']);});
test('file, record, and accumulated record bounds are enforced before mutation',()=>{assert.throws(()=>E.parse(' '.repeat(E.MAX_BYTES+1)),/limit/);const many=Array.from({length:E.MAX_EVENTS+1},(_,i)=>row({id:'event-'+i}));assert.throws(()=>E.envelope(file(many)),/at most/);const full={schema:1,events:many.slice(0,E.MAX_EVENTS),corrections:[]};assert.throws(()=>E.merge(full,file()),/full/);assert.equal(full.events.length,E.MAX_EVENTS);});
test('append preserves distinct repeated observations and assigns local non-authoritative identifiers',()=>{const input=file([row(),row({id:'event-2'})]);const first=E.merge(E.empty(),input);assert.equal(first.added,2);assert.deepEqual(first.state.events.map(item=>item.id),['observation-1','observation-2']);const second=E.merge(first.state,file());assert.equal(second.state.events.length,3);assert.equal(first.state.events.length,2);assert.equal(input.events[0].id,'event-1');});
test('assessments append separately and survive validated restore/export',()=>{const first=E.merge(E.empty(),file()).state;const updated=E.correct(first,'observation-1','uncertain',timestamp);assert.equal(first.corrections.length,0);assert.deepEqual(updated.events,first.events);const reopened=E.restore(JSON.parse(JSON.stringify(updated)));const exported=E.exportReview(reopened,timestamp);assert.equal(exported.format,'navsentinel-evidence-review');assert.equal(exported.events[0].outcome,'recorded');assert.equal(exported.corrections[0].kind,'uncertain');assert.throws(()=>E.parse(JSON.stringify(exported)),/unsupported fields|not a supported/);assert.throws(()=>E.correct(updated,'absent','should-allow'));assert.throws(()=>E.correct(updated,'observation-1','grant'));});
test('saved history rejects malformed corrections and value-bearing additions',()=>{const state=E.merge(E.empty(),file()).state;assert.throws(()=>E.restore({...state,token:'secret'}));assert.throws(()=>E.restore({...state,corrections:[{eventId:'missing',kind:'uncertain',timestamp}]}));assert.throws(()=>E.restore({...state,corrections:[{eventId:'observation-1',kind:'uncertain',timestamp,note:'raw text'}]}));});

test('review packages round-trip observations and assessments without changing original history',()=>{
  const original=E.correct(E.merge(E.empty(),file()).state,'observation-1','should-allow',timestamp);
  const review=E.exportReview(original,timestamp),parsed=E.parseImport(JSON.stringify(review));
  assert.deepEqual(E.merge(E.empty(),parsed).state,original);
  const appended=E.merge(original,parsed).state;
  assert.deepEqual(appended.events.map(row=>row.id),['observation-1','observation-2']);
  assert.deepEqual(appended.corrections.map(row=>row.eventId),['observation-1','observation-2']);
  assert.equal(original.events.length,1);assert.equal(review.events[0].id,'observation-1');
  assert.equal(appended.events[1].outcome,'recorded');
});
test('review import remaps colliding local identifiers and retains correction ordering',()=>{
  const existing={schema:1,events:[row({id:'observation-2'})],corrections:[]};
  const input={schema:1,events:[row({id:'observation-2'}),row({id:'unrelated'})],corrections:[
    {eventId:'unrelated',kind:'uncertain',timestamp},{eventId:'observation-2',kind:'should-block',timestamp}]};
  const merged=E.merge(existing,E.exportReview(input,timestamp)).state;
  assert.deepEqual(merged.events.map(row=>row.id),['observation-2','observation-3','observation-4']);
  assert.deepEqual(merged.corrections.map(row=>row.eventId),['observation-4','observation-3']);
  assert.doesNotThrow(()=>E.restore(merged));
});
test('hostile review packages fail validation before history changes',()=>{
  const review=E.exportReview(E.merge(E.empty(),file()).state,timestamp);
  for(const changes of [{token:'secret'},{schema:2},{source:'page'},{evidence:'verified-prevention'},
    {corrections:[{eventId:'absent',kind:'should-allow',timestamp}]},
    {corrections:[{eventId:'observation-1',kind:'grant',timestamp}]},
    {corrections:[{eventId:'observation-1',kind:'uncertain',timestamp,note:'sensitive'}]},
    {events:[{...review.events[0],url:'https://private.test/secret'}]}]) {
    assert.throws(()=>E.parseImport(JSON.stringify({...review,...changes})));
  }
  assert.throws(()=>E.parseImport(' '.repeat(E.MAX_BYTES+1)),/limit/);
  const full={schema:1,events:review.events,corrections:Array.from({length:5000},()=>({eventId:'observation-1',kind:'uncertain',timestamp}))};
  const incoming=E.exportReview(E.correct(E.merge(E.empty(),file()).state,'observation-1','should-block',timestamp),timestamp);
  assert.throws(()=>E.merge(full,incoming),/Correction history is full/);
  assert.equal(full.events.length,1);assert.equal(full.corrections.length,5000);
});
test('portable event and reason allowlists stay aligned with upstream source',()=>{const root=path.resolve(__dirname,'../../..');const storage=fs.readFileSync(path.join(root,'extension/src/shared/storage.ts'),'utf8');const kinds=storage.slice(storage.indexOf('export type EventKind =')).split(';')[0];assert.deepEqual([...kinds.matchAll(/"([a-z_]+)"/g)].map(match=>match[1]).sort(),[...E.KINDS].sort());const explanations=fs.readFileSync(path.join(root,'extension/src/shared/explanations.ts'),'utf8').split('};')[0];assert.deepEqual([...explanations.matchAll(/^\s+([a-z_]+):/gm)].map(match=>match[1]).sort(),[...E.REASONS].sort());});
