const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const guard=require('../sync/child-scope-guard.js');
const code=fs.readFileSync(path.join(__dirname,'../sync/child-scope-guard.js'),'utf8');
const primary=Object.freeze({id:'prod',legacy_slot:'primary',deleted_at:null});
const ordinary=Object.freeze({id:'normal',legacy_slot:null,deleted_at:null});
const smoke=Object.freeze({id:'test',legacy_slot:'__xb_smoke_v1__',deleted_at:null});
const smokeLater=Object.freeze({id:'test2',legacy_slot:'__xb_smoke_v2__',deleted_at:null});
const retired=Object.freeze({id:'retired',legacy_slot:null,deleted_at:'2026-11-11T00:00:00Z'});
test('active cloud projection excludes retired and all reserved smoke versions',()=>{
 const rows=[primary,ordinary,smoke,smokeLater,retired];
 assert.deepEqual(guard.activeBusinessChildren(rows),[primary,ordinary]);
 assert.equal(guard.parse(smoke).smoke,true);
 assert.equal(guard.parse(smokeLater).smoke,true);
 assert.equal(guard.parse(primary).primary,true);
 assert.equal(guard.parse(retired).archived,true);
});
test('legacy migration can only target an explicit active primary slot',()=>{
 assert.equal(guard.requireLegacyMigrationTarget(primary),true);
 for(const bad of [ordinary,smoke,smokeLater,retired,{...primary,deleted_at:'2026-11-11T00:00:00Z'}]){
  assert.throws(()=>guard.requireLegacyMigrationTarget(bad),
   /legacy_migration_target_must_be_active_primary/);
 }
});
test('missing classification fields must fail closed instead of leaking a smoke child',()=>{
 for(const bad of [{id:'missing'},{legacy_slot:null},{deleted_at:null},null,42,'child',[]]){
  assert.throws(()=>guard.parse(bad),/child_scope:/);
 }
 assert.throws(()=>guard.activeBusinessChildren([{id:'fake'}]),/required_classification_fields_missing/);
 assert.throws(()=>guard.activeBusinessChildren(null),/expected_array/);
});
test('the production child guard is pure and makes no actual network or storage calls',()=>{
 assert.doesNotMatch(code,/\b(?:fetch|indexedDB|localStorage|sessionStorage|XMLHttpRequest|WebSocket|EventSource)\s*(?:\(|\[|\.)/);
 assert.doesNotMatch(code,/\b(?:\.insert|\.update|\.delete|\.upsert)\s*\(/);
 assert.doesNotMatch(code,/\b(?:cloudbase\.init|db\.rpc|\.rdb)\s*\(/);
});
