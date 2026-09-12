'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateRequest}=require('../desktop/bridge.cjs');

test('desktop bridge accepts only the fixed broker method for each operation',()=>{
  assert.deepEqual(validateRequest({path:'/api/state',method:'GET'}),{path:'/api/state',method:'GET',body:undefined});
  assert.equal(validateRequest({path:'/api/revoke',method:'POST',body:{}}).body,'{}');
  for(const path of ['/api/state?x=1','https://reference.test','/api/../state','/api/missing','__proto__']) {
    assert.throws(()=>validateRequest({path,method:'GET'}));
  }
  assert.throws(()=>validateRequest({path:'/api/state',method:'POST'}));
  assert.throws(()=>validateRequest({path:'/api/state',method:'GET',body:{}}));
  assert.throws(()=>validateRequest({path:'/api/state',method:'GET',headers:{Authorization:'caller'}}));
});

test('desktop bridge enforces the serialized UTF-8 payload budget',()=>{
  assert.throws(()=>validateRequest({path:'/api/request',method:'POST',body:[] }));
  assert.throws(()=>validateRequest({path:'/api/request',method:'POST',body:{data:'a'.repeat(16384)}}));
  assert.throws(()=>validateRequest({path:'/api/request',method:'POST',body:{data:'\u20ac'.repeat(6000)}}));
});
