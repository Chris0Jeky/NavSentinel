'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../shared/evidence.js');

const timestamp='2026-09-08T12:00:00.000Z';
const envelope=sourceSite=>({
  format:'navsentinel-evidence',
  schema:1,
  exportedAt:timestamp,
  source:'navsentinel-extension',
  evidence:'recorded-observation',
  events:[{
    id:'event-1',
    timestamp,
    kind:'nav_click_block',
    sourceSite,
    destinationSite:'other.test',
    outcome:'recorded',
    reasons:['nrs_cross_site'],
  }],
});

test('shared evidence import rejects WHATWG numeric-final hosts that fail URL parsing',()=>{
  for(const sourceSite of ['4294967296','0x100000000','1.2.3.999','example.999','a.1','08']){
    assert.throws(()=>E.envelope(envelope(sourceSite)),/canonical hostnames/,sourceSite);
  }
});

test('shared evidence import retains canonical IP and ordinary hostname controls',()=>{
  for(const sourceSite of ['127.0.0.1','example.test','123.example']){
    assert.equal(E.envelope(envelope(sourceSite)).events[0].sourceSite,sourceSite);
  }
});
