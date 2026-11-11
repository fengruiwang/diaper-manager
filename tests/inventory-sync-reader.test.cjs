const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../sync/inventory-sync-reader.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const O='397b1791-b8d0-4d63-82d6-c5b829240f42';
const scope={familyId:F,childId:C,actorUid:'test-dad'};
const grant={familyId:F,actorUid:'test-dad',appCode:'xb',member:true,initialized:true};
function mock({permission=grant,verificationFails=false,remoteFails=false,
 localListFails=false,applyFails=false}={}){
 const calls=[];
 const outbox={
  async reconciliationIds(...args){
   calls.push(['ids',...args]);
   if(localListFails)throw Error('idb-broken');
   return [O];
  },
  async reconcileInventory(...args){
   calls.push(['reconcile',...args]);
   if(applyFails)throw Error('outbox_store:stale_checked_set');
   return {status:'local-pending',acknowledgedIds:[],pendingCount:1};
  }
 };
 const remote={async readReconciliation(arg){
  calls.push(['remote',arg]);
  if(remoteFails)throw Error('private error');
  return {complete:true,familyId:F,childId:C,actorUid:'test-dad',
   checkedOperationIds:[O],seenOperationIds:[],rows:[]};
 }};
 const verifyAccess=async input=>{
  calls.push(['verify',input]);
  if(verificationFails)throw Error('network');
  return permission;
 };
 return {sync:create({outbox,remote,verifyAccess}),calls};
}
test('default denies all remote reads and local writes',async()=>{
 const m=mock();assert.deepEqual(await m.sync.reconcile(scope),
  {status:'disabled',localUnchanged:true});
 assert.equal(m.calls.length,0);
});
test('fresh auth and xb permission must be proven before reading any queue or RPC',async()=>{
 for(const permission of [
  null,{...grant,member:false},{...grant,appCode:'jj'},
  {...grant,actorUid:'test-mom'}, {...grant,initialized:false}
 ]){
  const m=mock({permission});
  const r=await m.sync.reconcile({...scope,readEnabled:true});
  assert.equal(r.localUnchanged,true);
  assert.deepEqual(m.calls.map(x=>x[0]),['verify']);
 }
});
test('when authorized, read exact local operation IDs then RPC and atomic IDB commit',async()=>{
 const m=mock();
 const r=await m.sync.reconcile({...scope,readEnabled:true});
 assert.deepEqual(r,{status:'local-pending',acknowledgedCount:0,pendingCount:1,localUnchanged:false});
 assert.deepEqual(m.calls.map(x=>x[0]),['verify','ids','remote','reconcile']);
 assert.deepEqual(m.calls[2][1],{familyId:F,childId:C,operationIds:[O]});
 assert.equal(m.calls[3][3].complete,true);
});
test('offline, read failure or stale local state cannot overwrite existing stock',async()=>{
 for(const opts of [{verificationFails:true},{localListFails:true},
  {remoteFails:true},{applyFails:true}]){
  const m=mock(opts),r=await m.sync.reconcile({...scope,readEnabled:true});
  assert.equal(r.localUnchanged,true);
  assert.ok(!['local-pending','verified-as-of-server-read'].includes(r.status));
 }
});
test('malformed scope is rejected without talking to CloudBase',async()=>{
 const m=mock();
 await assert.rejects(()=>m.sync.reconcile({...scope,childId:'wrong',readEnabled:true}),/scope_required/);
 assert.equal(m.calls.length,0);
});
test('module construction does not initiate session, read or upload',()=>{
 const m=mock();
 assert.equal(m.calls.length,0);
 assert.equal(typeof m.sync.reconcile,'function');
});
