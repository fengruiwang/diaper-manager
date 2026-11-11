const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../sync/inventory-reconciler.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const O1='397b1791-b8d0-4d63-82d6-c5b829240f42';
const O2='e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64';
const sizes=['NB','S','M','L','XL','XXL'],sums=Object.fromEntries(sizes.map(x=>[x,0]));
const snapshot=()=>({familyId:F,childId:C,actorUid:'dad',inventory:{...sums,S:60},
 serverRevisions:{...sums},transactions:[{id:O1,kind:'buy'}],localRevision:1,source:'verified-server'});
const op=(id,extra={})=>({id,familyId:F,actorUid:'dad',type:'inventory.delta',
 status:'pending',createdAt:'2026-11-11T00:00:00Z',
 payload:{childId:C,size:'S',kind:'buy',amount:60,
  purchase:{totalFen:2999}},...extra});
const resp=(checkedOperationIds=[],seenOperationIds=[],quantity=60,revision=1)=>({
 familyId:F,childId:C,actorUid:'dad',complete:true,
 checkedOperationIds,seenOperationIds,
 rows:sizes.map(size=>({size,quantity:size==='S'?quantity:0,revision:size==='S'?revision:0}))
});
const build=(ops,server=resp(ops.map(x=>x.id)),snap=snapshot())=>R.build({snapshot:snap,operations:ops,response:server});
test('server already includes local pending purchase: do not overlay twice',()=>{
 const plan=build([op(O1)],resp([O1],[O1],60,1));
 assert.equal(plan.snapshot.inventory.S,60);
 assert.deepEqual(plan.acknowledgedIds,[O1]);
 assert.equal(plan.pendingCount,0);
});
test('new remote +80 plus local pending +60 displays 140 but not cloud-confirmed',()=>{
 const plan=build([op(O1)],resp([O1],[],80,2));
 assert.equal(plan.snapshot.inventory.S,140);
 assert.equal(plan.status,'local-pending');
 assert.equal(plan.pendingCount,1);
});
test('two pending operations with one acknowledged are counted exactly once',()=>{
 const ops=[op(O1),op(O2,{payload:{childId:C,size:'S',kind:'use',amount:10,purchase:null},
  createdAt:'2026-11-11T00:01:00Z'})];
 const plan=build(ops,resp([O1,O2],[O1],60,1));
 assert.equal(plan.snapshot.inventory.S,50);
 assert.deepEqual(plan.acknowledgedIds,[O1]);
 assert.equal(plan.pendingCount,1);
});
test('stale cloud revision cannot roll back an already observed snapshot',()=>{
 const snap=snapshot();snap.serverRevisions.S=5;
 assert.throws(()=>build([],resp([],[],40,4),snap),/server_revision_regressed/);
});
test('missing trusted receipt for previously ACKed operation means disaster recovery, not auto-rebase',()=>{
 const ack=op(O1,{status:'acked'});
 assert.throws(()=>build([ack],resp([O1],[],60,1)),/confirmed_operation_missing_server/);
});
test('RPC must have checked every locally scoped operation, never accept partial confirmation',()=>{
 assert.throws(()=>build([op(O1),op(O2)],resp([O1],[],60,1)),/stale_checked_set/);
 assert.throws(()=>build([op(O1)],resp([O1],[O2],60,1)),/unrequested_server_receipt/);
});
test('partial or duplicated size rows are rejected instead of silently treating missing stock as zero',()=>{
 const x=resp([],[],60,1);x.rows.pop();
 assert.throws(()=>build([],x),/partial_server_inventory/);
 const y=resp([],[],60,1);y.rows[5]={size:'S',quantity:0,revision:0};
 assert.throws(()=>build([],y),/invalid_server_inventory/);
});
test('cross family, child, actor and missing completeness proof fail closed',()=>{
 for(const mismatch of [{familyId:C},{childId:O2},{actorUid:'mom'},{complete:false}])
  assert.throws(()=>build([], {...resp(),...mismatch}),/unverified_scope/);
});
test('pending stocktake and reverse are not silently rebased on stale revision',()=>{
 const count=op(O1,{type:'inventory.count',expectedRevision:0,
  payload:{childId:C,size:'S',count:99}});
 const reverse=op(O2,{type:'transaction.reverse',payload:{childId:C,size:'S',reversesOperationId:O1}});
 for(const item of [count,reverse])
  assert.throws(()=>build([item]),/needs_manual_or_sequential_rebase/);
});
test('conflict/blocked operation stays preserved and cannot report synced',()=>{
 for(const status of ['conflict','blocked'])
  assert.throws(()=>build([op(O1,{status})]),/manual_conflict_or_permission_block/);
});
test('locally pending use that becomes negative after remote sync is rejected',()=>{
 const use=op(O1,{payload:{childId:C,size:'S',kind:'use',amount:20,purchase:null}});
 assert.throws(()=>build([use],resp([O1],[],10,1)),/pending_stock_out_of_bounds/);
});
test('pending operations from another baby do not contaminate this baby baseline',()=>{
 const alien=op(O1,{payload:{childId:O2,size:'S',kind:'buy',amount:60,purchase:{totalFen:2999}}});
 const r=build([alien],resp([],[],15,3));
 assert.equal(r.snapshot.inventory.S,15);
 assert.equal(r.pendingCount,0);
});
test('original snapshot is immutable and local-only history remains separate',()=>{
 const source=snapshot(),before=JSON.stringify(source);
 const r=build([op(O1)],resp([O1],[],80,1),source);
 assert.equal(r.snapshot.inventory.S,140);
 assert.equal(JSON.stringify(source),before);
 assert.deepEqual(r.snapshot.transactions,source.transactions);
});
