const test=require('node:test');
const assert=require('node:assert/strict');
const Contract=require('../sync/outbox-contract.js');
const Runner=require('../sync/inventory-outbox-runner.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const O1='397b1791-b8d0-4d63-82d6-c5b829240f42';
const O2='e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64';
const O3='780d45fe-dd5b-48c8-9660-ec14d4c0bb96';
const scope={familyId:F,actorUid:'uid-dad'};
const authorized={familyId:F,actorUid:'uid-dad',appCode:'xb',member:true,initialized:true};
const op=(id=O1,extra={})=>Contract.createOperation({
 id,type:'inventory.delta',familyId:F,actorUid:'uid-dad',
 payload:{childId:C,size:'S',kind:'buy',amount:60,
  occurredAt:'2026-11-10T08:30:00Z',
  purchase:{brand:'好奇',series:'小森林',totalFen:2999,purchaseDate:'2026-11-10'}},
 createdAt:'2026-11-10T08:30:00Z',...extra
});
function fake({operations=[op()],grant=authorized,remoteResult,remoteError,verifyError=false,ackFails=false}={}){
 const queue=operations.map(item=>({...item})),calls={verify:0,remote:[],results:[]};
 const outbox={
  async ready(s){
   assert.equal(s.familyId,F);assert.equal(s.actorUid,'uid-dad');
   return queue.filter(x=>x.status==='pending'||x.status==='retry');
  },
  async recordResult(s,id,result){
   calls.results.push([id,result]);
   if(ackFails&&['accepted','duplicate'].includes(result.kind))
    throw new Error('outbox_store:write_failed');
   const at=queue.findIndex(x=>x.id===id);
   queue[at]=Contract.applyResult(queue[at],result);
  }
 };
 const remote={async applyOperation(req){
  calls.remote.push(req);
  if(remoteError)throw new Error(remoteError);
  if(remoteResult)return remoteResult(req);
  return {operationId:req.operationId,duplicate:false,quantity:60,revision:1};
 }};
 const verifyAccess=async()=>{
  calls.verify++;
  if(verifyError)throw Error('network unavailable');
  return grant;
 };
 return {runner:Runner.create({outbox,remote,verifyAccess}),calls,queue};
}
test('runner import and default flush never verify access or initiate network',async()=>{
 const f=fake();
 const r=await f.runner.flush(scope);
 assert.equal(r.status,'upload-disabled');
 assert.equal(r.accepted,0);
 assert.equal(f.calls.verify,0);
 assert.equal(f.calls.remote.length,0);
 assert.equal(f.queue[0].status,'pending');
});
test('mismatched identity or not initialized must stop before any RPC',async()=>{
 for(const grant of [
  null,{...authorized,actorUid:'not-same'},
  {...authorized,appCode:'jj'}, {...authorized,member:false},
  {...authorized,initialized:false}
 ]){
  const f=fake({grant});
  const result=await f.runner.flush(scope,{uploadEnabled:true});
  assert.equal(f.calls.remote.length,0);
  assert.ok(['permission-unverified','family-not-initialized'].includes(result.status));
  assert.equal(f.queue[0].status,'pending');
 }
});
test('family verification network error leaves operations untouched',async()=>{
 const f=fake({verifyError:true});
 const r=await f.runner.flush(scope,{uploadEnabled:true});
 assert.equal(r.status,'verification-unavailable');
 assert.equal(f.calls.remote.length,0);
 assert.equal(f.queue[0].status,'pending');
});
test('explicitly authorized buy replays stable ID and original purchase, then durable ACK',async()=>{
 const f=fake({operations:[op(O1),op(O2)]});
 const r=await f.runner.flush(scope,{uploadEnabled:true,maxItems:20});
 assert.equal(r.status,'awaiting-reconciliation');
 assert.equal(r.accepted,2);
 assert.equal(r.remaining,0);
 assert.deepEqual(f.calls.remote.map(x=>x.operationId),[O1,O2]);
 assert.deepEqual(f.calls.remote[0].purchase,op().payload.purchase);
 assert.equal(f.queue[0].status,'acked');
 assert.equal(f.queue[0].id,O1);
 assert.equal(f.queue[1].id,O2);
});
test('duplicate ACK has same outcome and does not create a replacement ID',async()=>{
 const f=fake({remoteResult:req=>({operationId:req.operationId,duplicate:true})});
 const r=await f.runner.flush(scope,{uploadEnabled:true});
 assert.equal(r.accepted,1);
 assert.equal(f.queue[0].receipt,O1);
 assert.equal(f.queue[0].status,'acked');
});
test('stale stocktake conflicts and stops later purchases',async()=>{
 const count=op(O1,{type:'inventory.count',expectedRevision:0,
  payload:{childId:C,size:'S',count:99,occurredAt:'2026-11-10T08:30:00Z'}});
 const f=fake({operations:[count,op(O2)],remoteError:'inventory_client:revision_conflict'});
 const r=await f.runner.flush(scope,{uploadEnabled:true});
 assert.equal(r.status,'manual-review-required');
 assert.equal(r.accepted,0);
 assert.equal(r.attempted,1);
 assert.equal(f.queue[0].status,'conflict');
 assert.equal(f.queue[1].status,'pending');
 assert.equal(f.calls.remote[0].kind,'stocktake');
 assert.equal(f.calls.remote[0].expectedRevision,0);
});
test('permission revoked blocks operation and cannot claim sync success',async()=>{
 const f=fake({remoteError:'inventory_client:permission_denied'});
 const r=await f.runner.flush(scope,{uploadEnabled:true});
 assert.equal(r.status,'permission-denied');
 assert.equal(f.queue[0].status,'blocked');
 assert.equal(f.queue[0].receipt,null);
});
test('HTTP timeout or unknown failure stays retryable with unchanged original ID',async()=>{
 const f=fake({remoteError:'network timeout'});
 const r=await f.runner.flush(scope,{uploadEnabled:true});
 assert.equal(r.status,'network-or-server-failure');
 assert.equal(f.queue[0].status,'retry');
 assert.equal(f.queue[0].id,O1);
 assert.equal(f.queue[0].receipt,null);
});
test('unknown module type cannot be sent or falsely ACKed',async()=>{
 const weight=op(O1,{type:'weight.upsert',expectedRevision:0,payload:{recordId:O3}});
 const f=fake({operations:[weight,op(O2)]});
 const r=await f.runner.flush(scope,{uploadEnabled:true});
 assert.equal(r.status,'unsupported-pending-type');
 assert.equal(f.calls.remote.length,0);
 assert.equal(f.queue[0].status,'pending');
});
test('mismatched remote receipt never acknowledges source operation',async()=>{
 const f=fake({remoteResult:()=>({operationId:O2})});
 const r=await f.runner.flush(scope,{uploadEnabled:true});
 assert.equal(r.status,'network-or-server-failure');
 assert.equal(f.queue[0].status,'retry');
 assert.equal(f.queue[0].receipt,null);
});
test('local durable ACK failure must propagate; no second operation is submitted',async()=>{
 const f=fake({operations:[op(O1),op(O2)],ackFails:true});
 await assert.rejects(()=>f.runner.flush(scope,{uploadEnabled:true}),/outbox_store:write_failed/);
 assert.equal(f.calls.remote.length,1);
 assert.equal(f.queue[0].status,'pending');
});
test('unsupported batch sizes never cause network access',async()=>{
 const f=fake();
 await assert.rejects(()=>f.runner.flush(scope,{uploadEnabled:true,maxItems:0}),/invalid_batch_size/);
 assert.equal(f.calls.remote.length,0);
});
