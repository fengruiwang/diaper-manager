const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Inspector=require('../sync/inventory-baseline-inspector.js');
const Access=require('../sync/cloudbase-access-preflight.js');
const Children=require('../sync/cloudbase-child-reader.js');
const ChildGuard=require('../sync/child-scope-guard.js');
const Inventory=require('../sync/cloudbase-inventory-client.js');
const SOURCE=fs.readFileSync(path.join(__dirname,'../sync/inventory-baseline-inspector.js'),'utf8');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const O1='397b1791-b8d0-4d63-82d6-c5b829240f42';
const O2='e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64';
const A='synthetic-owner';
const SIZES=Inspector.SIZES;
const scope={familyId:F,childId:C,actorUid:A,readEnabled:true};
const base=()=>Object.fromEntries(SIZES.map(s=>[s,s==='S'?60:0]));
const revs=()=>Object.fromEntries(SIZES.map(s=>[s,s==='S'?3:0]));
const rows=()=>SIZES.map(s=>({size:s,quantity:base()[s],revision:revs()[s]}));
const local=()=>({familyId:F,childId:C,actorUid:A,source:'verified-server',
 inventory:base(),serverRevisions:revs(),localRevision:0});
const op=(id,status='pending',childId=C)=>({
 id,familyId:F,actorUid:A,status,type:'inventory.delta',
 payload:{childId,size:'S',kind:'buy',amount:60}
});
function mock({grant=true,active=true,operations=[],snapshot=local(),seenIds=[],
 serverRows=rows(),responseOverride={},throwAt=null}={}){
 const calls=[];
 const access=async args=>{calls.push('auth');if(throwAt==='auth')throw Error('PRIVATE_UID');
  return grant?{familyId:F,actorUid:A,appCode:'xb',member:true,initialized:false}:
   {familyId:F,actorUid:A,appCode:'jj',member:false,initialized:false};};
 const children={async listActiveChildren(){
  calls.push('children');
  if(throwAt==='children')throw Error('private child error');
  return {familyId:F,activeChildren:active?[{id:C,displayName:'active'}]:[]};
 }};
 const outbox={
  async list(what,opts){calls.push('list');assert.equal(what.familyId,F);
   assert.equal(what.actorUid,A);assert.deepEqual(opts,{includeAcked:true});
   if(throwAt==='list')throw Error('private queue error');return operations;},
  async readInventory(what,child){calls.push('local');assert.equal(child,C);
   if(throwAt==='local')throw Error('private local storage error');return snapshot;},
  ready:async()=>{throw Error('NO_WRITE_PATH')},
  recordResult:async()=>{throw Error('NO_WRITE_PATH')},
  initializeInventory:async()=>{throw Error('NO_WRITE_PATH')},
  reconcileInventory:async()=>{throw Error('NO_WRITE_PATH')}
 };
 const remote={
  async readReconciliation(request){calls.push('remote');
   if(throwAt==='remote')throw Error('PRIVATE_RPC_ERROR');
   assert.equal(request.familyId,F);assert.equal(request.childId,C);
   const ids=operations.filter(x=>x.payload?.childId===C).map(x=>x.id);
   assert.deepEqual(request.operationIds,ids);
   return {
    familyId:F,childId:C,actorUid:A,complete:true,
    checkedOperationIds:ids,seenOperationIds:seenIds,rows:serverRows,
    ...responseOverride
   };
  },
  applyOperation:async()=>{throw Error('NO_WRITE_PATH')}
 };
 return {inspector:Inspector.create({verifyAccess:access,children,outbox,remote}),calls};
}
test('default inspection does not even read data and upload stays denied',async()=>{
 const {inspector,calls}=mock();
 assert.deepEqual(await inspector.inspect({...scope,readEnabled:false}),{
  status:'disabled',uploadAllowed:false,localUnchanged:true
 });
 assert.deepEqual(calls,[]);
});
test('matched six-size server and verified local snapshot is diagnostic only, never upload permission',async()=>{
 const {inspector,calls}=mock();
 const r=await inspector.inspect(scope);
 assert.equal(r.status,'snapshot-matches-cloud-upload-still-disabled');
 assert.equal(r.uploadAllowed,false);
 assert.equal(r.localUnchanged,true);
 assert.equal(r.sixSizesVerified,true);
 assert.equal(r.checkedOperations,0);
 assert.deepEqual(calls,['auth','children','list','local','remote']);
 assert.ok(!JSON.stringify(r).includes(F));
 assert.ok(!JSON.stringify(r).includes(C));
});
test('uninitialized local database must never be auto-seeded even if CloudBase has six valid sizes',async()=>{
 const {inspector}=mock({snapshot:null});
 const r=await inspector.inspect(scope);
 assert.equal(r.status,'initial-baseline-not-created');
 assert.equal(r.uploadAllowed,false);
});
test('existing pending or retry queue is never ACKed, discarded or automatically sent',async()=>{
 for(const status of ['pending','retry']){
  const {inspector,calls}=mock({operations:[op(O1,status)],seenIds:[]});
  const r=await inspector.inspect(scope);
  assert.equal(r.status,'pending-queue-preserved');
  assert.equal(r.checkedOperations,1);
  assert.equal(r.outstandingOperations,1);
  assert.equal(calls.filter(c=>c==='remote').length,1);
  assert.equal(r.uploadAllowed,false);
 }
});
test('local ACK whose server receipt vanished must flag possible cloud rollback',async()=>{
 const r=await mock({operations:[op(O1,'acked')],seenIds:[]}).inspector.inspect(scope);
 assert.equal(r.status,'previous-ack-missing-server');
 assert.equal(r.uploadAllowed,false);
});
test('conflict and blocked operations require manual review regardless of stock counters',async()=>{
 for(const status of ['conflict','blocked']){
  const r=await mock({operations:[op(O1,status)]}).inspector.inspect(scope);
  assert.equal(r.status,'manual-queue-conflict-review');
  assert.equal(r.uploadAllowed,false);
 }
});
test('different remote stock/revision cannot silently overwrite current local stock',async()=>{
 const r=await mock({
  serverRows:rows().map(x=>x.size==='S'?{...x,quantity:140,revision:4}:x)
 }).inspector.inspect(scope);
 assert.equal(r.status,'snapshot-differs-from-cloud');
 assert.deepEqual(r.mismatchSizes,['S']);
 assert.equal(r.uploadAllowed,false);
});
test('partial, duplicate, malformed, or forged six-size snapshots are blocked',async()=>{
 for(const sample of [
  rows().slice(1),
  [...rows().slice(0,5),rows()[1]],
  rows().map(x=>x.size==='S'?{...x,revision:-1}:x),
  rows().map(x=>x.size==='S'?{...x,quantity:NaN}:x)
 ]){
  const r=await mock({serverRows:sample}).inspector.inspect(scope);
  assert.equal(r.status,'cloud-snapshot-or-receipt-unverified');
  assert.equal(r.uploadAllowed,false);
 }
 for(const responseOverride of [
  {complete:false},{actorUid:'other-actor'},
  {familyId:'29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6'},
  {childId:O2},{checkedOperationIds:[O1]},{seenOperationIds:[O1]}
 ]){
  const r=await mock({responseOverride}).inspector.inspect(scope);
  assert.equal(r.status,'cloud-snapshot-or-receipt-unverified');
 }
});
test('wrong scope, missing authorization and invisible child prevent any RPC',async()=>{
 const invalid=mock();
 await assert.rejects(()=>invalid.inspector.inspect({...scope,childId:'bad'}),/invalid_scope/);
 assert.deepEqual(invalid.calls,[]);
 const bad=mock({grant:false});
 assert.equal((await bad.inspector.inspect(scope)).status,'authorization-unverified');
 assert.deepEqual(bad.calls,['auth']);
 const child=mock({active:false});
 assert.equal((await child.inspector.inspect(scope)).status,'child-not-active-or-test-excluded');
 assert.deepEqual(child.calls,['auth','children']);
});
test('untrusted source, missing local dimensions or forged identity cannot be considered verified baseline',async()=>{
 for(const snapshot of [
  {...local(),source:'test-fixture'},
  {...local(),source:'manual'},
  {...local(),inventory:{S:60}},
  {...local(),actorUid:'another'},
  {...local(),serverRevisions:{...revs(),XXL:-1}}
 ]){
  const r=await mock({snapshot}).inspector.inspect(scope);
  assert.equal(r.status,'local-baseline-or-queue-review-required');
  assert.equal(r.uploadAllowed,false);
 }
});
test('more than 50 local operations (including other child) require review, no remote call',async()=>{
 const many=Array.from({length:51},(_,i)=>op(
  '780d45fe-dd5b-48c8-9660-'+String(i).padStart(12,'0'),'acked',O2));
 const m=mock({operations:many});
 const r=await m.inspector.inspect(scope);
 assert.equal(r.status,'local-baseline-or-queue-review-required');
 assert.ok(!m.calls.includes('remote'));
});
test('duplicate, unknown status, cross-identity and malformed queue entries fail closed',async()=>{
 for(const operations of [
  [op(O1),op(O1)],
  [op(O1,'unknown')],
  [{...op(O1),familyId:O2}],
  [{...op(O1),payload:{size:'S'}}],
  [{...op(O1),actorUid:'other-actor'}]
 ]){
  const r=await mock({operations}).inspector.inspect(scope);
  assert.equal(r.status,'local-baseline-or-queue-review-required');
 }
});
test('cloud or local read exceptions do not leak backend/private messages',async()=>{
 for(const throwAt of ['auth','children','list','local','remote']){
  const r=await mock({throwAt}).inspector.inspect(scope);
  assert.equal(r.uploadAllowed,false);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
 }
});
test('actual CloudBase client adapter can be composed for read-only reconciliation without any mutations',async()=>{
 const calls=[];
 const auth={getSession:async()=>({data:{
  user:{id:A},session:{user:{id:A}}
 }})};
 const sdk={
  auth,
  rdb(){return {
   from(table){
    calls.push('select:'+table);
    let filters=[];
    const q={
     select(_){return q;},eq(k,v){filters.push([k,v]);return q;},
     limit:async()=>{
      if(table==='families')return {data:[{id:F}]};
      if(table==='family_members')return {data:[{family_id:F,user_uid:A,member_role:'owner'}]};
      if(table==='family_app_access')return {data:[{family_id:F,user_uid:A,app_code:'xb'}]};
      if(table==='xb_children')return {data:[{id:C,family_id:F,display_name:'正式宝宝',legacy_slot:'primary',deleted_at:null,revision:0}]};
      throw Error('Unexpected table '+table);
     },
     insert(){throw Error('WRITE_FORBIDDEN')},
     update(){throw Error('WRITE_FORBIDDEN')}
    };
    return q;
   },
   async rpc(name,request){
    calls.push('rpc:'+name);
    assert.equal(name,'xb_read_inventory_reconciliation');
    assert.deepEqual(request.p_operation_ids,[]);
    return {data:{complete:true,family_id:F,child_id:C,actor_uid:A,
     checked_operation_ids:[],seen_operation_ids:[],rows:rows()}};
   }
  }}
 };
 const preflight=Access.create(sdk);
 const kids=Children.create(sdk,ChildGuard);
 const inventory=Inventory.create(sdk);
 const outbox={
  list:async()=>[],readInventory:async()=>null
 };
 const inspector=Inspector.create({
  verifyAccess:preflight.verifyAccess,children:kids,outbox,remote:inventory
 });
 const r=await inspector.inspect(scope);
 assert.equal(r.status,'initial-baseline-not-created');
 assert.equal(r.uploadAllowed,false);
 assert.deepEqual(calls,['select:families','select:family_members',
  'select:family_app_access','select:families','select:family_app_access',
  'select:xb_children','rpc:xb_read_inventory_reconciliation']);
});
test('inspector source never calls write RPC, ACK, initializeInventory or mutates legacy storage',()=>{
 assert.doesNotMatch(SOURCE,/\.(?:applyOperation|initializeInventory|recordResult|reconcileInventory|commitInventory|enqueue)\s*\(/);
 assert.doesNotMatch(SOURCE,/\.(?:insert|update|delete|upsert)\s*\(/);
 assert.doesNotMatch(SOURCE,/\b(?:localStorage|sessionStorage|indexedDB|fetch|WebSocket|signInWithOtp)\s*(?:\(|\.|\[)/);
 assert.match(SOURCE,/uploadAllowed:false/);
});
