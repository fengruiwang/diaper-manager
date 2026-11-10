const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../sync/module-registry.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const OP='397b1791-b8d0-4d63-82d6-c5b829240f42';
test('future module registrations are inert and reuse the same family/child identity',()=>{
 assert.equal(C.moduleFor('feeding').phase,'future');
 assert.equal(C.moduleFor('vaccination').phase,'future');
 assert.equal(C.moduleFor('diaper').sync,'ledger');
 assert.ok(!C.moduleFor('not-yet'));
 const e=C.envelope({module:'feeding',familyId:FAMILY,childId:CHILD,operationId:OP,actorUid:'uid',payload:{kind:'formula',volumeMl:90}});
 assert.equal(e.childId,CHILD);
 assert.equal(e.module,'feeding');
 assert.equal(e.app,'xb');
});
test('growth/feeding/vaccination always require child ID to prevent cross-baby mixups',()=>{
 for(const module of ['children','growth','feeding','vaccination','reminders','sleep']){
  assert.throws(()=>C.envelope({module,familyId:FAMILY,operationId:OP,actorUid:'uid',payload:{}}),/child_id_required/);
 }
});
test('family price preferences do not accept arbitrary child IDs',()=>{
 assert.equal(C.envelope({module:'price',familyId:FAMILY,operationId:OP,actorUid:'uid',payload:{price:2}}).childId,null);
 assert.throws(()=>C.envelope({module:'price',familyId:FAMILY,childId:CHILD,operationId:OP,actorUid:'uid',payload:{}}),/unexpected_child_id/);
});
test('reject cross-app and malformed envelope before any server write',()=>{
 const attrs={module:'diaper',familyId:FAMILY,childId:CHILD,operationId:OP,actorUid:'uid',payload:{size:'S',delta:60}};
 assert.throws(()=>C.envelope({...attrs,app:'jj'}),/unknown_module/);
 assert.throws(()=>C.envelope({...attrs,operationId:'reused'}),/invalid_ids/);
 assert.throws(()=>C.envelope({...attrs,version:0}),/invalid_version/);
});
test('building envelope does not mutate source payload',()=>{
 const payload={weight:4.5,note:'x'};const e=C.envelope({module:'growth',familyId:FAMILY,childId:CHILD,operationId:OP,actorUid:'uid',payload});
 e.payload.note='y';assert.equal(payload.note,'x');
});
