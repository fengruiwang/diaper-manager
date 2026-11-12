const test=require('node:test'),assert=require('node:assert/strict');
const Bridge=require('../sync/primary-cloud-operations.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const PRIMARY='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const SMOKE='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const ACTOR='dad';
const OID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const sizes=['NB','S','M','L','XL','XXL'];
function fixture({enabled=false,receipt=true,badScope=false,offline=false,
  wrongActor=false,unknownAck=false}={}){
 const calls=[],app={};
 const scope={app,familyId:FAMILY,actorUid:ACTOR};
 let snapshot=null,queued=[],outstanding=0;
 const rows=()=>sizes.map(size=>({size,quantity:size==='S'?140:0,
  revision:size==='S'?2:1}));
 const outbox={
  async readInventory(){calls.push('outbox.readInventory');return snapshot;},
  async initializeInventory(w,data){
   calls.push('outbox.initializeInventory');
   snapshot={source:'verified-server',familyId:FAMILY,actorUid:ACTOR,
    childId:PRIMARY,inventory:data.inventory,serverRevisions:data.serverRevisions};
   return snapshot;
  },
  async commitInventory(w,op){
   calls.push('outbox.commitInventory');queued.push(op);outstanding++;
   return {duplicate:false,operation:op,snapshot};
  },
  async stats(){return {outstanding};}
 };
 const remote={
  async readReconciliation(input){
   calls.push('remote.readReconciliation');
   return {complete:true,familyId:FAMILY,actorUid:wrongActor?'stranger':ACTOR,
    childId:PRIMARY,rows:rows()};
  },
  normalizeOperation(op){
   calls.push('remote.normalizeOperation');
   if(op.kind!=='buy'&&op.kind!=='use'&&op.kind!=='stocktake'&&op.kind!=='reverse')
    throw Error('invalid_kind');
  }
 };
 const params={
  controller:{verifiedContext:()=>scope},
  host:{navigator:{onLine:!offline},indexedDB:{open(){}}},
  accessPreflight:{create:()=>({verifyAccess:async()=>({member:true,
   appCode:'xb',familyId:FAMILY,actorUid:ACTOR,initialized:false})})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>({
   familyId:FAMILY,childId:badScope?SMOKE:PRIMARY,
   readyForMigration:badScope?true:false})})},
  scopeGuard:{requireLegacyMigrationTarget(){}},
  legacyHistoryReader:{create:()=>({readSettings:async()=>{
   calls.push('legacy.readSettings');
   if(!receipt)throw Error('no_committed_receipt');
   return {complete:true,canEdit:false,canUpload:false};
  }})},
  inventoryClient:{create:()=>remote},
  outboxFactory:{create:cfg=>{
   calls.push('outbox.create:'+cfg.dbName);
   assert.equal(cfg.dbName,'xiaobao-primary-sync-v120');
   return outbox;
  }},
  outboxContract:{createOperation(){}},
  inventoryProjection:{createSnapshot(){}},
  inventoryReconciler:{build(){}},
  runnerFactory:{create:()=>({
   toRemote:op=>({kind:op.payload.kind,size:op.payload.size,
    familyId:op.familyId,childId:op.payload.childId}),
   flush:async (_,{uploadEnabled})=>{
    assert.equal(uploadEnabled,true);
    calls.push('runner.flush');
    if(unknownAck)throw Error('ACK_UNKNOWN');
    const count=queued.length;
    queued=[];outstanding=0;
    return {status:'awaiting-reconciliation',accepted:count};
   }
  })},
  syncFactory:{create:()=>({
   reconcile:async()=>{calls.push('sync.reconcile');
    return {status:'verified-as-of-server-read'};}
  })},
  cloudWritesEnabled:enabled
 };
 const bridge=Bridge.create(params);
 const op={id:OID,type:'inventory.delta',familyId:FAMILY,actorUid:ACTOR,
  createdAt:'2026-11-12T06:00:00Z',
  payload:{childId:PRIMARY,size:'S',kind:'buy',amount:6,
   purchase:{brand:'好奇',series:'小森林',totalFen:600,purchaseDate:'2026-11-12'}}};
 return {bridge,op,calls,scope};
}
test('M3 formal primary operation bridge uses its own isolated outbox and is inert before activate',()=>{
 const f=fixture();
 assert.equal(f.calls[0],'outbox.create:xiaobao-primary-sync-v120');
 assert.equal(f.calls.length,1);
 assert.equal(Bridge.PRIMARY_DB_NAME,'xiaobao-primary-sync-v120');
});
test('M3 formal business writes are disabled by default including if operator flag is true',async()=>{
 const f=fixture();
 assert.equal((await f.bridge.queue(f.op,{operatorApproved:true})).status,
  'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal((await f.bridge.flush({operatorApproved:true})).status,
  'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(f.calls.length,1);
});
test('M3 only initializes active receipt-backed primary, preserving six authoritative revisions',async()=>{
 const f=fixture();
 const r=await f.bridge.activate();
 assert.equal(r.status,'PRIMARY_OUTBOX_READ_ONLY_READY');
 assert.ok(f.calls.includes('legacy.readSettings'));
 assert.ok(f.calls.includes('outbox.initializeInventory'));
 const data=await f.bridge.read();
 assert.equal(data.status,'PRIMARY_CLOUD_READ_VERIFIED');
 assert.equal(data.inventory.S,140);
 assert.equal(data.revisions.S,2);
});
test('M3 does not import smoke child or initialize snapshot before receipt exists',async()=>{
 for(const x of [{badScope:true},{receipt:false}]){
  const f=fixture(x);
  assert.equal((await f.bridge.activate()).status,'PRIMARY_INITIALIZATION_UNVERIFIED');
  assert.ok(!f.calls.includes('outbox.initializeInventory'));
 }
});
test('M3 refuses corrupted actor scope during six-size verified baseline',async()=>{
 const f=fixture({wrongActor:true});
 assert.equal((await f.bridge.activate()).status,'PRIMARY_INITIALIZATION_UNVERIFIED');
 assert.ok(!f.calls.includes('outbox.initializeInventory'));
});
test('M3 owner+member formal buy queues durable same operation ID, never auto uploads',async()=>{
 const f=fixture({enabled:true});
 await f.bridge.activate();
 const queued=await f.bridge.queue(f.op,{operatorApproved:true});
 assert.equal(queued.status,'PRIMARY_OPERATION_DURABLY_QUEUED');
 assert.equal(queued.operationId,OID);
 assert.equal(queued.cloudWriteCommitted,false);
 assert.ok(f.calls.includes('outbox.commitInventory'));
 assert.ok(!f.calls.includes('runner.flush'));
 const done=await f.bridge.flush({operatorApproved:true});
 assert.equal(done.status,'PRIMARY_CLOUD_SYNCED_VERIFIED');
 assert.equal(done.cloudWriteCommitted,true);
 assert.ok(f.calls.includes('runner.flush'));
});
test('M3 disallows identity/child switching and other non-inventory operation types',async()=>{
 const f=fixture({enabled:true});
 await f.bridge.activate();
 const wrong={...f.op,payload:{...f.op.payload,childId:SMOKE}};
 assert.equal((await f.bridge.queue(wrong,{operatorApproved:true})).status,
  'PRIMARY_OPERATION_SCOPE_REJECTED');
 assert.equal((await f.bridge.queue({...f.op,type:'reference.patch'},
  {operatorApproved:true})).status,'PRIMARY_OPERATION_SCOPE_REJECTED');
 assert.ok(!f.calls.includes('outbox.commitInventory'));
});
test('M3 unknown server ACK fails closed; durable queue and original ID are retained',async()=>{
 const f=fixture({enabled:true,unknownAck:true});
 await f.bridge.activate();
 await f.bridge.queue(f.op,{operatorApproved:true});
 const r=await f.bridge.flush({operatorApproved:true});
 assert.equal(r.status,'PRIMARY_ACK_UNKNOWN_PRESERVE_ID_AND_QUEUE');
 assert.equal(r.cloudWriteCommitted,false);
 assert.ok(!f.calls.includes('outbox.commitInventory-again'));
});
test('M3 formal writes cannot queue while offline even if prior mode was authorized',async()=>{
 const f=fixture({enabled:true,offline:true});
 assert.equal((await f.bridge.activate()).status,'OFFLINE_READ_UNVERIFIED');
 assert.equal((await f.bridge.queue(f.op,{operatorApproved:true})).status,
  'PRIMARY_NOT_SELECTED');
});
