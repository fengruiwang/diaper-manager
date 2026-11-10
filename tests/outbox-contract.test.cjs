const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../sync/outbox-contract.js');
function operation(id,type='inventory.delta',opts={}){
 return C.createOperation({id,type,familyId:'family1',actorUid:'uid1',payload:{size:'S',delta:60},
  createdAt:'2026-11-10T00:00:00Z',expectedRevision:type==='inventory.delta'?null:1,...opts});
}
test('offline or cloud outage is degraded, never synced',()=>{
 const p=[operation('op1')];const before=JSON.stringify(p);
 assert.equal(C.mode({network:false,pendingCount:1}),'degraded');
 assert.equal(C.mode({serverAvailable:false,pendingCount:1}),'degraded');
 assert.equal(C.mode({authenticated:false,pendingCount:1}),'auth-required');
 assert.equal(C.mode({permitted:false,pendingCount:1}),'permission-denied');
 assert.equal(C.mode({enabled:false,pendingCount:1}),'local-only');
 assert.equal(C.mode({pendingCount:1}),'recovering');
 assert.equal(JSON.stringify(p),before);
});
test('timeout then retry with same id cannot be treated as another purchase',()=>{
 const item=operation('buy1');
 const x=C.applyResult(item,{kind:'timeout'});
 assert.equal(x.id,'buy1');assert.equal(x.status,'retry');
 const y=C.applyResult(x,{kind:'duplicate',receiptId:'receipt1'});
 assert.equal(y.status,'acked');assert.equal(y.id,'buy1');
 assert.equal(C.applyResult(y,{kind:'accepted',receiptId:'receipt2'}).receipt,'receipt1');
});
test('conflicts remain in queue; a stale stocktake needs revision',()=>{
 assert.throws(()=>operation('bad','inventory.count',{expectedRevision:null}),/revision_required/);
 const item=operation('count1','inventory.count',{payload:{size:'S',count:50}});
 const x=C.applyResult(item,{kind:'conflict'});
 assert.equal(x.status,'conflict');assert.equal(x.payload.count,50);
 assert.deepEqual(C.waiting([x]).map(y=>y.id),['count1']);
});
test('offline queue survives JSON rehydration and isolated families',()=>{
 const list=JSON.parse(JSON.stringify([operation('a'),operation('b','inventory.delta',{familyId:'family2',actorUid:'uid2'})]));
 assert.deepEqual(C.forFamily(list,'family1','uid1').map(x=>x.id),['a']);
 assert.deepEqual(C.forFamily(list,'family2','uid1'),[]);
});
test('merging same id cannot silently replace payload',()=>{
 const x=operation('dup');
 const y=operation('dup','inventory.delta',{payload:{size:'S',delta:120}});
 assert.throws(()=>C.mergeQueue([x],[y]),/same_id_different_payload/);
 assert.equal(C.mergeQueue([x],[x]).length,1);
});
test('auth and network failures retain identity and payload, never forge ACK',()=>{
 for(const kind of ['auth_expired','forbidden','rate_limited','server_error','offline']){
  const x=C.applyResult(operation(kind),{kind});
  assert.equal(x.receipt,null);assert.equal(x.id,kind);
  assert.notEqual(x.status,'acked');
  if(kind==='forbidden')assert.equal(x.status,'blocked');
 }
});
