const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../preview/v1.2.0/m102-cloud.js');
const Contract=require('../sync/outbox-contract.js');
const Projection=require('../sync/inventory-local-projection.js');
const Reconciler=require('../sync/inventory-reconciler.js');
const Runner=require('../sync/inventory-outbox-runner.js');
const Reader=require('../sync/inventory-sync-reader.js');
const fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../preview/v1.2.0/index.html'),'utf8');
const ctl=fs.readFileSync(require('node:path').join(__dirname,'../preview/v1.2.0/m1-controller.js'),'utf8');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const SIZES=['NB','S','M','L','XL','XXL'];
const qty=(S=0)=>({NB:0,S,M:0,L:0,XL:0,XXL:0});
const purchase=(pieces,price)=>({brand:'好奇',series:'小森林',size:'S',pieces,price});
function inMemoryOutbox(){
 const snapshots=new Map(),operations=new Map();
 const key=(s,c)=>s.familyId+'|'+s.actorUid+'|'+c;
 const list=s=>[...operations.values()].filter(x=>x.familyId===s.familyId&&x.actorUid===s.actorUid);
 const get=(s,c)=>snapshots.get(key(s,c))||null;
 return {
  async readInventory(s,c){return get(s,c)},
  async initializeInventory(s,o){
   const k=key(s,o.childId);
   if(get(s,o.childId))throw Error('outbox_store:snapshot_already_initialized');
   if(list(s).some(x=>x.payload.childId===o.childId))throw Error('outbox_store:queue_exists_before_baseline');
   const snap=Projection.createSnapshot({familyId:s.familyId,actorUid:s.actorUid,...o});
   snapshots.set(k,snap);return snap;
  },
  async commitInventory(s,raw){
   const op=Contract.createOperation(raw),k=key(s,raw.payload.childId);
   const previous=operations.get(op.id);
   if(previous)throw Error('same_id_cannot_recreate');
   const next=Projection.apply(snapshots.get(k),op);
   snapshots.set(k,next);operations.set(op.id,op);
   return {duplicate:false,snapshot:next,operation:op};
  },
  async ready(s){return list(s).filter(x=>['pending','retry'].includes(x.status))},
  async recordResult(s,id,r){
   const op=operations.get(id);
   operations.set(id,Contract.applyResult(op,r));
  },
  async stats(s){
   const arr=list(s);return {outstanding:arr.filter(x=>x.status!=='acked').length,
    conflict:arr.filter(x=>x.status==='conflict').length,
    blocked:arr.filter(x=>x.status==='blocked').length};
  },
  async reconciliationIds(s,c){return list(s).filter(x=>x.payload.childId===c).map(x=>x.id)},
  async reconcileInventory(s,c,response){
   const arr=list(s).filter(x=>x.payload.childId===c),k=key(s,c);
   const plan=Reconciler.build({snapshot:snapshots.get(k),operations:arr,response});
   snapshots.set(k,plan.snapshot);
   for(const id of plan.acknowledgedIds){
    operations.set(id,Contract.applyResult(operations.get(id),{kind:'accepted',receiptId:id}));
   }
   return plan;
  },
  _ops:operations
 };
}
function fixture({smoke=true,permit=true,writeApproval=true,needsOperatorArm=false}={}){
 const server={S:0,rev:0,ops:new Map(),purchases:[],failNext:false};
 const local=inMemoryOutbox();
 let nextId=0;
 function user(actorUid){
  const app={actorUid};
  const host={
   indexedDB:{open(){throw Error('must not open real browser IndexedDB in mock')}},
   navigator:{onLine:true},
   crypto:{randomUUID:()=>{nextId++;return '00000000-0000-4000-8000-'+String(nextId).padStart(12,'0');}},
   XBDurableOutbox:{create:()=>local},
   XBInventoryClient:{create:()=>({
    async readReconciliation({familyId,childId,operationIds}){
     assert.equal(familyId,FAMILY);assert.equal(childId,CHILD);
     return {complete:true,familyId,childId,actorUid,
      checkedOperationIds:operationIds,
      seenOperationIds:operationIds.filter(id=>server.ops.has(id)),
      rows:SIZES.map(size=>({size,quantity:size==='S'?server.S:0,
       revision:size==='S'?server.rev:0}))};
    },
    async readPurchases(){return server.purchases.map(x=>({...x}))},
    async applyOperation(req){
     if(server.failNext){server.failNext=false;throw Error('network timeout');}
     if(server.ops.has(req.operationId)){
      const old=server.ops.get(req.operationId);
      if(JSON.stringify(old)!==JSON.stringify(req))
       throw Error('inventory_client:operation_conflict');
      return {operationId:req.operationId,duplicate:true,quantity:server.S,revision:server.rev};
     }
     if(!permit)throw Error('inventory_client:permission_denied');
     assert.equal(req.kind,'buy');assert.equal(req.size,'S');
     server.S+=req.amount;server.rev++;
     server.ops.set(req.operationId,req);
     server.purchases.push({operationId:req.operationId,brand:req.purchase.brand,
      series:req.purchase.series,size:req.size,pieces:req.amount,
      totalFen:req.purchase.totalFen,purchaseDate:req.purchase.purchaseDate,
      reversed:false,actorUid});
     return {operationId:req.operationId,duplicate:false,quantity:server.S,revision:server.rev};
    }
   })},
   XBCloudbaseAccessPreflight:{create:()=>({verifyAccess:async()=>({
    familyId:FAMILY,actorUid,member:permit,appCode:permit?'xb':'none',initialized:false
   })})},
   XBInventoryOutboxRunner:Runner,
   XBInventorySyncReader:Reader,
   XBInventoryProjection:Projection,
   XBInventoryReconciler:Reconciler,
   XBOutboxContract:Contract
  };
  app.rdb=()=>({
   from(table){
    assert.ok(['xb_children','family_members'].includes(table),table);
    return {select(){return {eq(){return this},async limit(){
     if(table==='family_members')return {data:[{
      family_id:FAMILY,user_uid:actorUid,member_role:actorUid==='dad'?'owner':'member'
     }]};
     return {data:smoke?[{id:CHILD,family_id:FAMILY,legacy_slot:M.SMOKE,
      deleted_at:null,revision:0}]:[]};
    }}}};
   }
  });
  const controller={
   async connect(){return 'FAMILY_READY_NO_BUSINESS_CHILD'},
   verifiedContext(){return {app,familyId:FAMILY,actorUid}}
  };
  const states=[];
  const client=M.create({host,controller,approvedWrites:writeApproval,
   approvedCreate:needsOperatorArm,requireOperatorUnlock:needsOperatorArm,
   view:{status:(code)=>states.push(code),render(){}}});
  return {client,host,states};
 }
 return {server,local,user};
}
test('M1-02 stays on isolated page; live main, v1.1.2 historical key and PWA unaffected',()=>{
 assert.match(html,/m102Mode/);assert.match(html,/m102-cloud\.js/);
 assert.match(html,/XBM102\.submitPurchase/);
 assert.match(html,/function renderM102History/);
 assert.doesNotMatch(html,/xiaobao_diaper_planner_v1/);
 assert.doesNotMatch(html,/serviceWorker\.register/);
 assert.match(ctl,/DEFAULT_PUBLIC_KEY=/);
 assert.match(ctl,/verifiedContext:/);
});
test('purchase payload preserves cents, stable ID, actor and child; reject fractional cents',()=>{
 const op=M.makeOperation(purchase(60,59.5),{familyId:FAMILY,actorUid:'dad'},CHILD,
  ()=>'2026-11-12T03:04:05.000Z',()=>'397b1791-b8d0-4d63-82d6-c5b829240f42');
 assert.equal(op.payload.purchase.totalFen,5950);
 assert.equal(op.payload.amount,60);assert.equal(op.payload.childId,CHILD);
 assert.equal(op.actorUid,'dad');
 assert.throws(()=>M.makeOperation(purchase(60,59.501),
  {familyId:FAMILY,actorUid:'dad'},CHILD,
  ()=>'2026-11-12T03:04:05.000Z',()=>'397b1791-b8d0-4d63-82d6-c5b829240f42'),
  /invalid_purchase_cents/);
});
test('bootstrap A=0 B=60 C=140 only when server inventory, revision and ledger match',()=>{
 const rows=n=>SIZES.map(s=>({size:s,quantity:s==='S'?n:0,
  revision:s==='S'?(n===0?0:n===60?1:2):0}));
 assert.equal(M.verifyPurchaseOnlyBaseline(rows(0),[]).qty.S,0);
 const a={operationId:'397b1791-b8d0-4d63-82d6-c5b829240f42',size:'S',pieces:60,reversed:false};
 const b={operationId:'e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64',size:'S',pieces:80,reversed:false};
 assert.equal(M.verifyPurchaseOnlyBaseline(rows(60),[a]).qty.S,60);
 assert.equal(M.verifyPurchaseOnlyBaseline(rows(140),[a,b]).qty.S,140);
 assert.throws(()=>M.verifyPurchaseOnlyBaseline(rows(140),[a]),/baseline_not_purchases_only/);
 assert.throws(()=>M.verifyPurchaseOnlyBaseline(rows(60),[{...a,reversed:true}]),/baseline_not_purchases_only/);
});
test('default browser approval gate blocks cloud writes even with a valid test child',async()=>{
 const f=fixture({writeApproval:false}),a=f.user('dad');
 assert.equal(await a.client.activate(),'CLOUD_SMOKE_READ_ONLY_APPROVAL_REQUIRED');
 assert.equal(await a.client.submitPurchase(purchase(60,59.5)),'CLOUD_WRITE_NOT_AUTHORIZED');
 assert.equal(f.server.S,0);assert.equal(f.server.purchases.length,0);
 assert.equal(f.local._ops.size,0);
});
test('missing smoke child and revoked family xb grant both reject before any purchase',async()=>{
 for(const options of [{smoke:false},{permit:false}]){
  const f=fixture(options),a=f.user('dad');
  const code=await a.client.activate();
  assert.ok(['SMOKE_CHILD_NOT_READY','GRANT_UNVERIFIED'].includes(code),code);
  assert.equal(a.client.isActive(),false);
  assert.equal(f.server.S,0);
 }
});
test('A S+60 B S+80 -> independently refreshed authoritative S=140 and exactly two purchases',async()=>{
 const f=fixture(),a=f.user('dad'),b=f.user('mom');
 assert.equal(await a.client.activate(),'CLOUD_SMOKE_READY');
 assert.equal(await a.client.submitPurchase(purchase(60,59.5)),'CLOUD_SYNCED');
 assert.equal(f.server.S,60);
 assert.equal(await b.client.activate(),'CLOUD_SMOKE_READY');
 assert.equal(b.client.stock('S'),60);
 assert.equal(await b.client.submitPurchase(purchase(80,79.9)),'CLOUD_SYNCED');
 assert.equal(f.server.S,140);assert.equal(f.server.purchases.length,2);
 assert.equal(await a.client.refresh(),'CLOUD_SYNCED');
 assert.equal(a.client.stock('S'),140);
 assert.equal(b.client.stock('S'),140);
 assert.equal(a.client.history().length,2);
 assert.equal(b.client.history().length,2);
 const prior=[...f.server.ops.values()][0];
 const app=a.host.XBInventoryClient.create({actorUid:'dad'});
 const same=await app.applyOperation(prior);
 assert.equal(same.duplicate,true);assert.equal(f.server.S,140);
});
test('offline local purchase remains durable pending; retry same operation ID after network recovers',async()=>{
 const f=fixture(),a=f.user('dad');
 await a.client.activate();
 a.host.navigator.onLine=false;
 assert.equal(await a.client.submitPurchase(purchase(60,59.5)),
  'OFFLINE_PURCHASE_QUEUED_NOT_SYNCED');
 assert.equal(f.server.S,0);assert.equal(a.client.stock('S'),60);
 assert.equal(f.local._ops.size,1);
 a.host.navigator.onLine=true;
 assert.equal(await a.client.refresh({retry:true}),'CLOUD_SYNCED');
 assert.equal(f.server.S,60);assert.equal(f.local._ops.size,1);
});
test('server/network error retains original ID for retry, does not claim confirmed purchase',async()=>{
 const f=fixture(),a=f.user('dad');
 await a.client.activate();
 f.server.failNext=true;
 assert.equal(await a.client.submitPurchase(purchase(60,59.5)),'CLOUD_LOCAL_PENDING');
 assert.equal(f.server.S,0);
 const original=[...f.local._ops.keys()][0];
 assert.equal(await a.client.refresh({retry:true}),'CLOUD_SYNCED');
 assert.equal([...f.local._ops.keys()][0],original);
 assert.equal(f.server.S,60);assert.equal(f.server.purchases.length,1);
});

test('lifecycle controls are installed in the existing page but cannot mutate cloud without individual approvals',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../preview/v1.2.0/m102-cloud.js'),'utf8');
 assert.match(source,/DEFAULT_CREATE_APPROVAL=false/);
 assert.match(source,/DEFAULT_WRITE_APPROVAL=false/);
 assert.match(source,/DEFAULT_RETIRE_APPROVAL=false/);
 for(const item of ['m102Create','m102Retire','m102RetireConfirmation','m102ChildInfo'])
  assert.match(html,new RegExp('id="'+item+'"'));
 const f=fixture(),a=f.user('dad');
 assert.equal(await a.client.createSmokeChild(),'CREATE_NOT_AUTHORIZED');
 assert.equal(await a.client.retireSmokeChild('确认停用'),'RETIRE_NOT_AUTHORIZED');
 assert.equal(f.server.S,0);
 assert.equal(f.server.purchases.length,0);
 assert.equal(f.local._ops.size,0);
});

test('Phase B browser candidate cannot send any write before manually typing approval phrase',async()=>{
 const f=fixture({needsOperatorArm:true}),a=f.user('dad');
 assert.equal(a.client.approvals.purchase,false);
 assert.equal(a.client.approvals.create,false);
 assert.equal(a.client.approvals.retire,false);
 assert.equal(await a.client.armPhaseB('wrong'),'PHASE_B_APPROVAL_PHRASE_REQUIRED');
 assert.equal(await a.client.createSmokeChild(),'CREATE_NOT_AUTHORIZED');
 assert.equal(await a.client.activate(),'CLOUD_SMOKE_READ_ONLY_APPROVAL_REQUIRED');
 assert.equal(await a.client.submitPurchase(purchase(60,59.5)),'CLOUD_WRITE_NOT_AUTHORIZED');
 assert.equal(f.server.S,0);
 assert.equal(a.client.approvals.retire,false);
});
test('Phase B strictly limits owner to S60 and member to S80, and blocks second new ID',async()=>{
 const f=fixture(),a=f.user('dad'),b=f.user('mom');
 await a.client.activate();
 assert.equal(await a.client.submitPurchase(purchase(80,79.9)),'PHASE_B_PURCHASE_SCOPE_REJECTED');
 assert.equal(await a.client.submitPurchase({...purchase(60,59.5),size:'M'}),'PHASE_B_PURCHASE_SCOPE_REJECTED');
 assert.equal(await a.client.submitPurchase(purchase(60,59.5)),'CLOUD_SYNCED');
 assert.equal(await a.client.submitPurchase(purchase(60,59.5)),'PHASE_B_ACTOR_ALREADY_PURCHASED');
 await b.client.activate();
 assert.equal(await b.client.submitPurchase(purchase(60,59.5)),'PHASE_B_PURCHASE_SCOPE_REJECTED');
 assert.equal(await b.client.submitPurchase(purchase(80,79.9)),'CLOUD_SYNCED');
 assert.equal(await b.client.submitPurchase(purchase(80,79.9)),'PHASE_B_ACTOR_ALREADY_PURCHASED');
 assert.equal(f.server.S,140);
 assert.equal(f.server.purchases.length,2);
});
test('Phase B authorized UI is not deployed automatically; retire stays in disabled candidate build',()=>{
 const src=fs.readFileSync(require('node:path').join(__dirname,'../preview/v1.2.0/m102-cloud.js'),'utf8');
 assert.match(src,/PHASE_B_CANDIDATE_CREATE=true/);
 assert.match(src,/PHASE_B_CANDIDATE_PURCHASE=true/);
 assert.match(src,/DEFAULT_RETIRE_APPROVAL=false/);
 assert.match(src,/requireOperatorUnlock:true/);
 assert.match(html,/id="m102Arm"/);
 assert.match(html,/id="m102ArmText"/);
 assert.doesNotMatch(html,/xiaobao_diaper_planner_v1/);
});
