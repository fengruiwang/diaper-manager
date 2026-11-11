const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const preview=require('../cloudbase/smoke/p2-smoke-preview.js');
const page=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/p2-smoke-preview.html'),'utf8');
const engine=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/p2-smoke-preview.js'),'utf8');
const allowedResults={
 createAsMember:['REJECTED','OWNER_REQUIRED'],
 create:['PASS','SINGLE_TEST_CHILD_CREATED'],
 repeatCreate:['PASS','IDEMPOTENT_SAME_CHILD'],
 buyA:['PASS','APPLIED_ONCE'],
 buyB:['PASS','APPLIED_ONCE'],
 retryA:['PASS','DUPLICATE_ACK_NO_CHANGE'],
 reusedIdModifiedAmount:['REJECTED','OPERATION_ID_CONFLICT'],
 readA:['PASS','SERVER_VIEW_SIMULATED'],
 readB:['PASS','SERVER_VIEW_SIMULATED'],
 retireAsMember:['REJECTED','OWNER_REQUIRED'],
 retire:['PASS','TEST_CHILD_RETIRED_HISTORY_RETAINED'],
 buyAfterRetire:['REJECTED','CHILD_UNAVAILABLE']
};
test('all scripted rehearsal steps return expected result without leaking synthetic IDs',()=>{
 const m=preview.create();
 assert.equal(preview.scenario.length,12);
 for(const item of preview.scenario){
  const r=m.run(item.id);
  assert.equal(r.status,allowedResults[item.id][0],item.id);
  assert.equal(r.code,allowedResults[item.id][1],item.id);
  assert.equal(item.expected,r.code,item.id);
  assert.equal(r.state.environment,'MEMORY_ONLY');
  assert.equal(r.state.family,'SYNTHETIC');
  assert.ok(!JSON.stringify(r).includes('00000000-0000-4000'),item.id);
 }
 assert.deepEqual(m.state(),{
  environment:'MEMORY_ONLY',family:'SYNTHETIC',
  smokeChild:true,retired:true,quantity:140,revision:2,
  operationCount:2,purchaseCount:2,activeTotalFen:9998,visibleToRealApp:false
 });
});
test('new memory simulation starts isolated with no accidental inherited history',()=>{
 const a=preview.create(),b=preview.create();
 a.run('create');a.run('buyA');
 assert.equal(a.state().quantity,60);
 assert.equal(b.state().quantity,0);
 assert.equal(b.state().operationCount,0);
 assert.equal(b.run('buyB').code,'CHILD_UNAVAILABLE');
});
test('purchase retry does not increase stock, count or spend; changed payload is rejected',()=>{
 const m=preview.create();
 m.run('create');m.run('buyA');m.run('buyB');
 const before=m.state();
 assert.equal(m.run('retryA').code,'DUPLICATE_ACK_NO_CHANGE');
 assert.deepEqual(m.state(),before);
 assert.equal(m.run('reusedIdModifiedAmount').code,'OPERATION_ID_CONFLICT');
 assert.deepEqual(m.state(),before);
});
test('actor A and B each see one simulated receipt, both see 140 stock',()=>{
 const m=preview.create();m.run('create');m.run('buyA');m.run('buyB');
 for(const actor of ['readA','readB']){
  const response=m.run(actor);
  assert.equal(response.state.quantity,140);
  assert.equal(response.details.seenOwnOperations.length,1);
  assert.deepEqual(response.details.seenOwnOperations,['ACK']);
 }
});
test('retirement retains audit history and blocks further writes, never deletes or revives',()=>{
 const m=preview.create();m.run('create');m.run('buyA');m.run('buyB');
 assert.equal(m.run('retireAsMember').code,'OWNER_REQUIRED');
 const before=m.state();
 assert.equal(m.run('retire').code,'TEST_CHILD_RETIRED_HISTORY_RETAINED');
 assert.equal(m.run('buyAfterRetire').code,'CHILD_UNAVAILABLE');
 assert.equal(m.run('create').code,'RETIRED_SLOT_CANNOT_REOPEN');
 assert.equal(m.state().quantity,before.quantity);
 assert.equal(m.state().purchaseCount,2);
});
test('previews contain no actual CloudBase SDK, RPC calls, network, persistent storage or DML',()=>{
 assert.match(page,/p2-smoke-preview\.js/);
 assert.match(page,/真实创建测试宝宝（不可用）/);
 assert.match(page,/真实购买 \+60\/\+80（不可用）/);
 assert.match(page,/真实停用测试宝宝（不可用）/);
 assert.equal((page.match(/<button disabled type="button">/g)||[]).length,3);
 assert.match(page,/纯内存模拟，不连接腾讯云/);
 for(const text of [page,engine]){
  assert.doesNotMatch(text,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|indexedDB|localStorage|sessionStorage|navigator\.serviceWorker)\s*(?:\(|\[|\.)/);
  assert.doesNotMatch(text,/(?:window\.cloudbase|cloudbase\.init\s*\(|\.rdb\s*\(|db\.rpc\s*\(|\.from\s*\(|signInWithOtp\s*\(|createFamily\s*\(|xb_create_smoke_child\s*\(|xb_apply_inventory_operation\s*\()/i);
  assert.doesNotMatch(text,/\b(?:\.insert|\.update|\.delete|\.upsert)\s*\(/);
 }
});
