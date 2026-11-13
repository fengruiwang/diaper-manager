const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.join(__dirname,'..');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',P='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const SIZES=['NB','S','M','L','XL','XXL'];
function loadWithoutHasOwn(filename){
 const ctx=vm.createContext({module:{exports:{}}});
 vm.runInContext('Object.hasOwn=undefined;',ctx);
 vm.runInContext(fs.readFileSync(path.join(ROOT,filename),'utf8'),ctx,{filename});
 return ctx.module.exports;
}
function rows(){return SIZES.map(size=>({size,quantity:size==='S'?80:0,revision:1}));}
function primary(){
 return {status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  canWrite:false,legacyPurchasesAppliedToInventory:false,
  familyId:F,childId:P,actorUid:'dad',
  inventory:{NB:0,S:80,M:0,L:0,XL:0,XXL:0},
  revisions:Object.fromEntries(SIZES.map(size=>[size,1])),
  settings:{currentSize:'S',referenceOverrides:{'好奇|小森林|S':1.123},
   target:{NB:50,S:100},daily:{NB:10,S:8}},
  profileData:{babyProfile:{name:'正式宝宝'},dueDate:'2027-01-08',birthDate:'',babyWeight:''},
  legacyHistory:{complete:true,hasMore:false,offset:0,total:1,rows:[{
   kind:'transaction',id:'old-buy',payload:{id:'old-buy',type:'buy',
    date:'2026-11-05',brand:'好奇',series:'小森林',size:'S',pieces:30,price:48}
  }]},livePurchases:[]};
}
function defaults(){return {inventory:{},transactions:[],quotes:[],weightRecords:[],
 referenceOverrides:{},babyProfile:{},target:{},daily:{}};}
test('Chrome compatibility: formal primary read and six-size validation work without Object.hasOwn',async()=>{
 const Model=loadWithoutHasOwn('sync/primary-cloud-read-model.js');
 assert.equal(Model.numbers(rows()).inventory.S,80);
 assert.throws(()=>Model.numbers([...rows().slice(0,5),rows()[0]]),/invalid_inventory/);
 const model=Model.create({
  app:{rdb:()=>({from:()=>({select:()=>({eq(){return this},
   async limit(){return {data:[{family_id:F,child_id:P,profile_data:primary().profileData}]}}})})})},
  scopeGuard:{requireLegacyMigrationTarget(){}},
  accessPreflight:{create:()=>({verifyAccess:async()=>({member:true,appCode:'xb',
   familyId:F,actorUid:'dad'})})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>({
   familyId:F,childId:P,readyForMigration:false})})},
  inventoryClient:{create:()=>({
   readReconciliation:async()=>({complete:true,familyId:F,childId:P,
    actorUid:'dad',rows:rows()}),readPurchases:async()=>[]})},
  legacyHistoryReader:{create:()=>({
   readSettings:async()=>({complete:true,canEdit:false,canUpload:false,
    settings:primary().settings,revision:0}),
   readAll:async()=>({complete:true,canEdit:false,canUpload:false,
    hasMore:false,offset:0,total:1,rows:primary().legacyHistory.rows})})}
 });
 const result=await model.read({familyId:F,actorUid:'dad'});
 assert.equal(result.status,'PRIMARY_READ_ONLY_READY');
 assert.equal(result.inventory.S,80);
 assert.equal(result.legacyHistory.total,1);
 assert.equal(result.canWrite,false);
});
test('Chrome compatibility: inventory reconciler rejects duplicate size without Object.hasOwn',()=>{
 const Reconciler=loadWithoutHasOwn('sync/inventory-reconciler.js');
 const snapshot={familyId:F,childId:P,actorUid:'dad',transactions:[],
  serverRevisions:Object.fromEntries(SIZES.map(s=>[s,0])),localRevision:0};
 const response={complete:true,familyId:F,childId:P,actorUid:'dad',
  checkedOperationIds:[],seenOperationIds:[],rows:rows()};
 const ok=Reconciler.build({snapshot,operations:[],response});
 assert.equal(ok.status,'verified-as-of-server-read');
 assert.equal(ok.snapshot.inventory.S,80);
 assert.throws(()=>Reconciler.build({snapshot,operations:[],
  response:{...response,rows:[...rows().slice(0,5),rows()[0]]}}),
  /invalid_server_inventory/);
});
test('Chrome compatibility: projection maps historical purchases without adding to stock',()=>{
 const UI=loadWithoutHasOwn('sync/primary-ui-projection.js');
 const result=UI.project(primary(),defaults());
 assert.equal(result.state.transactions.length,1);
 assert.equal(result.state.transactions[0].origin,'legacy_migration');
 assert.equal(result.state.inventory.S,80);
 assert.equal(result.state.referenceOverrides['好奇|小森林|S'],1.123);
 assert.equal(result.historicPurchasesAddedToStock,false);
});
test('Chrome compatibility: document overlay applies verified settings without Object.hasOwn',()=>{
 const UI=loadWithoutHasOwn('sync/primary-ui-projection.js');
 const Overlay=loadWithoutHasOwn('sync/primary-documents-overlay.js');
 const base=UI.project(primary(),defaults());
 const bodies={quotes:{items:[]},reference:{referenceOverrides:{}},growth:{items:[]},
  profile:{babyProfile:{name:'正式宝宝'},dueDate:'2027-01-08'},
  settings:{target:{NB:50,S:100},daily:{NB:10,S:8}}};
 const snapshot={status:'PRIMARY_DOCUMENTS_FULLY_READ',documents:{}};
 for(const [kind,body] of Object.entries(bodies))
  snapshot.documents[kind]={status:'PRIMARY_DOCUMENT_READ_VERIFIED',
   kind,body,revision:0,familyId:F,childId:P};
 const output=Overlay.apply(base,snapshot);
 assert.equal(output.sharedBusinessDocumentsVerified,true);
 assert.equal(output.state.transactions.length,1);
 assert.equal(output.state.inventory.S,80);
});
test('Chrome compatibility: read-only primary activation initializes without Object.hasOwn',async()=>{
 const Ops=loadWithoutHasOwn('sync/primary-cloud-operations.js');
 const outbox={
  readInventory:async()=>null,
  initializeInventory:async(_,data)=>({source:'verified-server',
   familyId:F,actorUid:'dad',childId:P,
   inventory:data.inventory,serverRevisions:data.serverRevisions}),
  commitInventory:async()=>{},stats:async()=>({outstanding:0,total:0})
 };
 const bridge=Ops.create({
  controller:{verifiedContext:()=>({app:{},familyId:F,actorUid:'dad'})},
  host:{navigator:{onLine:true},indexedDB:{}},
  accessPreflight:{create:()=>({verifyAccess:async()=>({})})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>({})})},
  scopeGuard:{requireLegacyMigrationTarget(){}},
  legacyHistoryReader:{create:()=>({readSettings:async()=>({})})},
  inventoryClient:{create:()=>({readReconciliation:async()=>({})})},
  outboxFactory:{create:()=>outbox},outboxContract:{createOperation(){}},
  inventoryProjection:{createSnapshot(){}},inventoryReconciler:{build(){}},
  runnerFactory:{create:()=>({})},syncFactory:{create:()=>({})},
  cloudWritesEnabled:false
 });
 assert.equal((await bridge.activate({verifiedReadModel:primary()})).status,
  'PRIMARY_OUTBOX_READ_ONLY_READY');
 assert.equal(bridge.cloudWritesEnabled,false);
});
test('Chrome compatibility: formal inline modules match fixed sources, no Object.hasOwn dependency',()=>{
 const html=fs.readFileSync(path.join(ROOT,'preview/v1.2.0/formal/index.html'),'utf8');
 assert.equal(html.includes('Object.hasOwn('),false);
 for(const name of ['inventory-reconciler','primary-cloud-read-model',
   'primary-ui-projection','primary-cloud-operations','primary-documents-overlay']){
  const file=fs.readFileSync(path.join(ROOT,'sync',name+'.js'),'utf8').trim();
  assert.ok(html.includes(file),'embedded source mismatch: '+name);
 }
});
