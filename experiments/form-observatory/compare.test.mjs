import test from 'node:test';import assert from 'node:assert/strict';
import {compareFormOutcomes,expectedKeys} from './compare.mjs';
const records=()=>expectedKeys.map(k=>({variant:k.split(':')[0],protectedArm:k.endsWith('true'),attempts:[],atFixture:true,atSink:false,dialogClosed:false}));
test('all 45 explicit arms are required',()=>{assert.equal(compareFormOutcomes(records(),records()).matched,true);assert.equal(compareFormOutcomes(records().slice(1),records()).matched,false);});
test('copied arms do not substitute for a missing variant',()=>{const r=records();r[0]=r[1];assert.equal(compareFormOutcomes(r,records()).matched,false);});
test('accepted harm difference is not hidden by identical test status',()=>{const r=records();r[0].attempts=[{role:'harm',method:'POST',ordinal:1,accepted:true}];assert.equal(compareFormOutcomes(r,records()).matched,false);});
test('rejected duplicate remains an observable difference',()=>{const r=records();r[0].attempts=[{role:'harm',method:'POST',ordinal:1,accepted:false}];assert.equal(compareFormOutcomes(r,records()).matched,false);});
test('malformed truthy values cannot imply parity',()=>{const r=records();r[0].protectedArm='false';assert.equal(compareFormOutcomes(r,records()).matched,false);});
test('native dialog and navigation completion are part of parity',()=>{const r=records();r[0].dialogClosed=true;assert.equal(compareFormOutcomes(r,records()).matched,false);});
