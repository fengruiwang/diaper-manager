const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Bootstrap=require('../sync/inventory-bootstrap-coordinator.js');
const SOURCE=fs.readFileSync(path.join(__dirname,'../sync/inventory-bootstrap-coordinator.js'),'utf8');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const O='397b1791-b8d0-4d63-82d6-c5b829240f42';
const A='synthetic-owner';
const scope={familyId:F,childId:C,actorUid:A,readEnabled:true};
const SIZES=Bootstrap.SIZES;
const rows=(s=60,revision=3)=>SIZES.map(size=>({
 size,quantity:size==='S'?s:0,revision:size==='S'?revision:0
}));
const clearance=()=>({
 kind:'verified-server-migration-receipt',familyId:F,childId:C,actorUid:A,
 backupVerified:true,legacyReconciled:true,receiptsVerified:true
});
const queued=(status='pending',childId=C)=>({
 id:O,familyId:F,actorUid:A,type:'inventory.delta',status,
 payload:{childId,size:'S',kind:'buy',amount:60}
});
function fake({
 hasAuth=true,active=true,history=true,proof=clearance(),
 operations=[],snapshot=null,server=[rows(),rows(),rows()],
 seedAllowed=false,failAt=null,changedAuthOnSecond=false,
 proofOnSecond=null
}={}){
 const calls=[];let reads=0,authCount=0,historyCount=0;
 const local={snapshot,operations};
 const verifyAccess=async ()=>{
  calls.push('auth');authCount++;
  if(failAt==='auth')throw Error('SECRET_UID');
  if(changedAuthOnSecond&&authCount>1)return {familyId:F,actorUid:A,member:false,appCode:'xb'};
  return hasAuth?{familyId:F,actorUid:A,member:true,appCode:'xb',initialized:false}:null;
 };
 const children={listActiveChildren:async()=>{
  calls.push('children');
  if(failAt==='children')throw Error('SECRET');
  return {familyId:F,activeChildren:active?[{id:C}]:[]};
 }};
 const verifyHistoryClearance=history?async()=>{
  calls.push('history');historyCount++;
  if(failAt==='history')throw Error('SECRET');
  return historyCount>1&&proofOnSecond?proofOnSecond:proof;
 }:null;
 const outbox={
  readInventory:async(_scope,child)=>{
   calls.push('local');
   assert.equal(child,C);
   if(failAt==='local')throw Error('SECRET');
   return local.snapshot;
  },
  list:async(_scope,options)=>{
   calls.push('queue');
   assert.deepEqual(options,{includeAcked:true});
   if(failAt==='queue')throw Error('SECRET');
   return local.operations;
  },
  initializeInventory:async(_scope,params)=>{
   calls.push('commit');
   if(failAt==='commit')throw Error('QUOTA_PRIVATE');
   // fake of atomic IDB: reject concurrent prior snapshot or existing op
   if(local.snapshot!==null||local.operations.some(x=>x.payload.childId===C))
    throw Error('outbox_store:snapshot_or_queue_exists');
   local.snapshot={
    familyId:F,childId:C,actorUid:A,
    inventory:{...params.inventory},serverRevisions:{...params.serverRevisions},
    localRevision:0,source:params.source
   };
   return local.snapshot;
  },
  ready:async()=>{throw Error('UPLOAD_PATH_FORBIDDEN')},
  recordResult:async()=>{throw Error('ACK_PATH_FORBIDDEN')},
  reconcileInventory:async()=>{throw Error('RECONCILE_MUTATION_FORBIDDEN')}
 };
 const remote={readReconciliation:async(request)=>{
  calls.push('remote');
  assert.deepEqual(request,{familyId:F,childId:C,operationIds:[]});
  if(failAt==='remote'||(failAt==='third'&&reads===2))throw Error('PRIVATE_NETWORK');
  const serverRows=server[Math.min(reads,server.length-1)];
  reads++;
  return serverRows&&serverRows.complete!==undefined?serverRows:{
   complete:true,familyId:F,childId:C,actorUid:A,
   checkedOperationIds:[],seenOperationIds:[],rows:serverRows
  };
 },applyOperation:async()=>{throw Error('WRITE_RPC_FORBIDDEN')}};
 const module=Bootstrap.create({verifyAccess,children,outbox,remote,
  verifyHistoryClearance,permitIsolatedLocalSeed:seedAllowed});
 return {module,calls,local,remote};
}
test('default is zero-call and cannot seed or upload without explicit read',async()=>{
 const f=fake({seedAllowed:true});
 assert.deepEqual(await f.module.initialize({...scope,readEnabled:false,seedLocal:true}),
  {status:'disabled',uploadAllowed:false,localChanged:false});
 assert.deepEqual(f.calls,[]);
});
test('without independently verified historic migration receipt, no cloud read or local writes',async()=>{
 const f=fake({history:false,seedAllowed:true});
 const r=await f.module.initialize({...scope,seedLocal:true});
 assert.equal(r.status,'history-clearance-required');
 assert.equal(r.uploadAllowed,false);
 assert.deepEqual(f.calls,['auth','children']);
});
test('a forged, incomplete or mismatched migration proof cannot seed new empty snapshot',async()=>{
 for(const bad of [
  {...clearance(),backupVerified:false},
  {...clearance(),receiptsVerified:false},
  {...clearance(),legacyReconciled:false},
  {...clearance(),childId:O},
  {...clearance(),actorUid:'other'},
  {...clearance(),kind:'user-clicked-confirm'}
 ]){
  const f=fake({proof:bad,seedAllowed:true});
  const r=await f.module.initialize({...scope,seedLocal:true});
  assert.equal(r.status,'history-clearance-unverified');
  assert.ok(!f.calls.includes('remote'));
  assert.ok(!f.calls.includes('commit'));
 }
});
test('valid synthetic proof and two matching server reads still do not seed by default',async()=>{
 const f=fake({seedAllowed:false});
 const r=await f.module.initialize({...scope,seedLocal:true});
 assert.equal(r.status,'verified-preview-local-seed-disabled');
 assert.deepEqual(f.calls,['auth','children','history','local','queue','remote','remote']);
 assert.equal(f.local.snapshot,null);
 assert.equal(r.uploadAllowed,false);
 const v=fake({seedAllowed:true});
 const p=await v.module.initialize({...scope,seedLocal:false});
 assert.equal(p.status,'verified-preview-local-seed-disabled');
 assert.ok(!v.calls.includes('commit'));
});
test('isolated explicit seed verifies twice, rechecks access/history/queue, writes one snapshot then verifies again',async()=>{
 const f=fake({seedAllowed:true});
 const r=await f.module.initialize({...scope,seedLocal:true});
 assert.equal(r.status,'local-seeded-upload-still-disabled');
 assert.equal(r.localChanged,true);
 assert.equal(r.uploadAllowed,false);
 assert.equal(r.serverChecks,3);
 assert.deepEqual(f.calls,[
  'auth','children','history','local','queue','remote','remote',
  'auth','history','queue','commit','remote'
 ]);
 assert.deepEqual(f.local.snapshot.inventory,Object.fromEntries(SIZES.map(s=>[s,s==='S'?60:0])));
 assert.equal(f.local.snapshot.serverRevisions.S,3);
 assert.equal(f.local.snapshot.source,'verified-server');
});
test('repeat seed never overwrites an existing snapshot',async()=>{
 const f=fake({seedAllowed:true});
 assert.equal((await f.module.initialize({...scope,seedLocal:true})).localChanged,true);
 const before=JSON.stringify(f.local.snapshot);
 const r=await f.module.initialize({...scope,seedLocal:true});
 assert.equal(r.status,'existing-local-snapshot');
 assert.equal(JSON.stringify(f.local.snapshot),before);
 assert.equal(f.calls.filter(x=>x==='commit').length,1);
});
test('pending, acked and blocked operations all stop bootstrap before remote read',async()=>{
 for(const status of ['pending','retry','conflict','blocked','acked']){
  const f=fake({operations:[queued(status)],seedAllowed:true});
  const r=await f.module.initialize({...scope,seedLocal:true});
  assert.equal(r.status,'existing-child-queue-preserved');
  assert.ok(!f.calls.includes('remote'));
  assert.ok(!f.calls.includes('commit'));
 }
});
test('corrupt, duplicate, cross identity or >50 queued operations must not be skipped',async()=>{
 for(const operations of [
  [{...queued(),payload:{size:'S'}}],
  [queued(),queued()],
  [{...queued(),actorUid:'other'}],
  [{...queued(),familyId:O}],
  [{...queued(),id:'invalid'}],
  Array.from({length:51},(_,i)=>({...queued(),id:'780d45fe-dd5b-48c8-9660-'+String(i).padStart(12,'0'),payload:{childId:O}}))
 ]){
  const f=fake({operations,seedAllowed:true});
  const r=await f.module.initialize({...scope,seedLocal:true});
  assert.equal(r.status,'local-queue-or-snapshot-review-required');
  assert.ok(!f.calls.includes('remote'));
  assert.ok(!f.calls.includes('commit'));
 }
});
test('a valid unrelated child operation is not dropped or reclassified',async()=>{
 const f=fake({operations:[queued('acked',O)],seedAllowed:true});
 const r=await f.module.initialize({...scope,seedLocal:true});
 assert.equal(r.status,'local-seeded-upload-still-disabled');
 assert.equal(f.local.operations.length,1);
 assert.equal(f.local.operations[0].payload.childId,O);
});
test('invalid, incomplete, forged, or duplicate six-size rows fail closed',async()=>{
 for(const r of [
  rows().slice(1),
  [...rows().slice(0,5),rows()[1]],
  rows().map(x=>x.size==='S'?{...x,revision:-1}:x),
  {complete:false},
  {complete:true,familyId:O,childId:C,actorUid:A,checkedOperationIds:[],seenOperationIds:[],rows:rows()},
  {complete:true,familyId:F,childId:C,actorUid:A,checkedOperationIds:[],seenOperationIds:[O],rows:rows()}
 ]){
  const f=fake({server:[r],seedAllowed:true});
  const x=await f.module.initialize({...scope,seedLocal:true});
  assert.equal(x.status,'server-baseline-unverified');
  assert.ok(!f.calls.includes('commit'));
 }
});
test('server revision or stock changes between first two reads blocks local seed',async()=>{
 for(const second of [rows(80,3),rows(60,4)]){
  const f=fake({server:[rows(),second],seedAllowed:true});
  const r=await f.module.initialize({...scope,seedLocal:true});
  assert.equal(r.status,'server-changed-before-bootstrap');
  assert.equal(f.local.snapshot,null);
  assert.equal(r.uploadAllowed,false);
 }
});
test('loss of authorization or history clearance on precommit check is blocked',async()=>{
 const lostAuth=fake({seedAllowed:true,changedAuthOnSecond:true});
 assert.equal((await lostAuth.module.initialize({...scope,seedLocal:true})).status,
  'authorization-changed-before-bootstrap');
 assert.ok(!lostAuth.calls.includes('commit'));
 const lostProof=fake({seedAllowed:true,proofOnSecond:{...clearance(),receiptsVerified:false}});
 assert.equal((await lostProof.module.initialize({...scope,seedLocal:true})).status,
  'history-clearance-changed-before-bootstrap');
 assert.ok(!lostProof.calls.includes('commit'));
});
test('failed local atomic transaction never marks a bootstrap successful',async()=>{
 const f=fake({seedAllowed:true,failAt:'commit'});
 const r=await f.module.initialize({...scope,seedLocal:true});
 assert.equal(r.status,'local-bootstrap-transaction-rejected');
 assert.equal(r.localChanged,false);
 assert.equal(f.local.snapshot,null);
});
test('late cloud change or lost third read retains local seed but never permits upload',async()=>{
 for(const [failAt,server,expected] of [
  [null,[rows(),rows(),rows(80,4)],'local-seeded-cloud-changed-review-required'],
  ['third',[rows(),rows(),rows()],'local-seeded-cloud-recheck-unverified']
 ]){
  const f=fake({seedAllowed:true,failAt,server});
  const r=await f.module.initialize({...scope,seedLocal:true});
  assert.equal(r.status,expected);
  assert.equal(r.localChanged,true);
  assert.equal(r.uploadAllowed,false);
  assert.equal(f.local.snapshot.inventory.S,60);
 }
});
test('error handling never copies sensitive remote messages, and no cloud write methods are present',async()=>{
 for(const failAt of ['auth','children','history','local','queue','remote']){
  const f=fake({seedAllowed:true,failAt});
  const r=await f.module.initialize({...scope,seedLocal:true});
  assert.equal(r.uploadAllowed,false);
  assert.equal(JSON.stringify(r).includes('SECRET'),false);
  assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
 }
 assert.doesNotMatch(SOURCE,/\.(?:applyOperation|recordResult|commitInventory|reconcileInventory|insert|update|delete|upsert)\s*\(/);
 assert.doesNotMatch(SOURCE,/\b(?:localStorage|sessionStorage|indexedDB|fetch|WebSocket)\s*(?:\(|\.|\[)/);
 assert.match(SOURCE,/permitIsolatedLocalSeed=false/);
 assert.match(SOURCE,/uploadAllowed:false/);
});
test('reject malformed family/child/actor inputs before any asynchronous call',async()=>{
 const f=fake();
 for(const input of [{...scope,actorUid:''},{...scope,childId:'bad'},null]){
  await assert.rejects(()=>f.module.initialize(input),/bootstrap:invalid_scope/);
 }
 assert.deepEqual(f.calls,[]);
});
test('single in-process coordinator refuses overlapping initialization attempts',async()=>{
 let release;
 const f=fake();
 const first=f.module.initialize({...scope,seedLocal:false});
 // The initial authorization promise resolves asynchronously, leaving busy
 // until the first call finishes even if the second call is immediately made.
 const second=await f.module.initialize({...scope,seedLocal:false});
 assert.equal(second.status,'already-running');
 const r=await first;
 assert.equal(r.status,'verified-preview-local-seed-disabled');
});
