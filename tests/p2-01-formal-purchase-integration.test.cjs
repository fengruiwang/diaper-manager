const test=require('node:test'),assert=require('node:assert/strict');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Commands=require('../sync/primary-business-commands.js');
const Runner=require('../sync/inventory-outbox-runner.js');
const Client=require('../sync/cloudbase-inventory-client.js');
const Project=require('../sync/primary-ui-projection.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const SIZES=['NB','S','M','L','XL','XXL'];
function sharedCloud(){
 const records=[],operations=new Map(),stock={NB:10,S:80,M:0,L:0,XL:0,XXL:0};
 const revisions=Object.fromEntries(SIZES.map(size=>[size,1]));
 let rpcCalls=0;
 const app=actor=>({
  auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})},
  rdb:()=>({
   async rpc(name,p){
    assert.equal(name,'xb_apply_inventory_operation');
    assert.equal(p.p_family_id,F);assert.equal(p.p_child_id,CHILD);
    rpcCalls++;
    const found=operations.get(p.p_operation_id);
    if(found)return {data:{...found,duplicate:true},error:null};
    assert.equal(p.p_kind,'buy');
    const next=stock[p.p_size]+p.p_amount;stock[p.p_size]=next;
    revisions[p.p_size]++;
    records.push({operation_id:p.p_operation_id,brand:p.p_purchase.brand,
     series:p.p_purchase.series,size:p.p_size,pieces:p.p_amount,
     total_fen:p.p_purchase.total_fen,purchase_date:p.p_purchase.purchase_date,
     reversed_by_operation_id:null,created_by:actor});
    const ack={accepted:true,duplicate:false,
     operation_id:p.p_operation_id,child_id:CHILD,size:p.p_size,
     result_quantity:next,result_revision:revisions[p.p_size]};
    operations.set(p.p_operation_id,ack);
    return{data:ack,error:null};
   },
   from(table){
    assert.equal(table,'xb_transactions');
    const filters={};let calls=0;
    const query={eq(k,v){
     filters[k]=v;calls++;
     if(calls<2)return query;
     assert.equal(filters.family_id,F);assert.equal(filters.child_id,CHILD);
     return Promise.resolve({data:records.slice(),error:null});
    }};
    return{select(){return query}};
   }
  })
 });
 return{app,stock,revisions,records,get rpcCalls(){return rpcCalls}};
}
function projected(cloud,actor,purchases){
 return Project.project({
  status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  canWrite:false,familyId:F,childId:CHILD,actorUid:actor,
  inventory:{...cloud.stock},revisions:{...cloud.revisions},
  settings:{currentSize:'S',target:{NB:20,S:140},daily:{NB:9,S:8}},
  profileData:{dueDate:'2027-01-08',birthDate:'',babyWeight:'',
   babyProfile:{name:'正式宝宝',sex:''}},
  legacyHistory:{complete:true,hasMore:false,total:1,rows:[{
   kind:'transaction',id:'old-buy',payload:{id:'old-buy',type:'buy',
    date:'2026-11-01',brand:'旧品牌',series:'旧系列',
    size:'S',pieces:20,price:30}
  }]},
  livePurchases:purchases,legacyPurchasesAppliedToInventory:false
 },{transactions:[],quotes:[],weightRecords:[],inventory:{},
  referenceOverrides:{},target:{},daily:{},babyProfile:{}});
}
test('P2-01 original purchase form -> persistent UUID -> RPC -> cloud readback shared by two accounts',async()=>{
 const cloud=sharedCloud(),client=Client.create(cloud.app('dad')),items=[];
 const outbox={
  ready:async()=>items.filter(x=>x.status==='pending'),
  recordResult:async(_scope,id,ack)=>{
   const op=items.find(x=>x.id===id);assert.ok(op);
   op.status=ack.kind==='accepted'||ack.kind==='duplicate'?'acked':'pending';
  }
 };
 const runner=Runner.create({outbox,remote:client,
  verifyAccess:async()=>({familyId:F,actorUid:'dad',appCode:'xb',
   member:true,initialized:true})});
 let shown=null,uuidCalls=0;
 const primary={cloudWritesEnabled:true,
  selectedScope:()=>({familyId:F,childId:CHILD,actorUid:'dad'}),
  read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{...cloud.stock},revisions:{...cloud.revisions}}),
  queue:async op=>{
   items.push({...op,status:'pending'});
   return{status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:op.id};
  },
  flush:async()=>{
   const sent=await runner.flush({familyId:F,actorUid:'dad'},
    {uploadEnabled:true,purchaseOnly:true});
   assert.equal(sent.attempted,1);assert.equal(sent.accepted,1);
   return{status:'PRIMARY_CLOUD_SYNCED_VERIFIED'};
  }
 };
 const commands=Commands.create({primary,uuid:()=>{uuidCalls++;return ID},
  clock:()=> '2026-11-13T13:30:00.000Z'});
 const ui=Actions.create({commands,primary,
  formalModeSelected:()=>true,buildAllowsWrites:true,
  operatorApproved:()=>true,purchaseOnly:true,
  readPurchase:()=>({size:'S',brand:'好奇',series:'小森林',pieces:60,price:99.95}),
  readQuote:()=>null,readTransaction:()=>null,notify:()=>{},
  onPurchaseReadback:async({operationId})=>{
   assert.equal(operationId,ID);
   shown=projected(cloud,'dad',await client.readPurchases({
    familyId:F,childId:CHILD}));
   return 'ready';
  }});
 const result=await ui.handle({id:'buyNow',dataset:{}},{});
 assert.equal(result.status,'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED');
 assert.equal(result.operationId,ID);assert.equal(uuidCalls,1);
 assert.equal(cloud.stock.S,140);assert.equal(cloud.records.length,1);
 assert.equal(cloud.records[0].total_fen,9995);
 assert.equal(shown.state.transactions.length,2);
 assert.equal(shown.state.inventory.S,140);
 assert.equal(shown.state.transactions[1].origin,'cloud_post_migration');
 const mom=Client.create(cloud.app('mom'));
 const seen=projected(cloud,'mom',await mom.readPurchases({
  familyId:F,childId:CHILD}));
 assert.equal(seen.state.inventory.S,140);
 assert.equal(seen.state.transactions.length,2);
 assert.equal(seen.state.transactions[1].operationId,ID);
 assert.equal(seen.state.transactions[0].origin,'legacy_migration');
});
test('P2-01 retry of the SAME server operation ID is idempotent: one purchase and stock increase',async()=>{
 const cloud=sharedCloud(),client=Client.create(cloud.app('dad'));
 const request={familyId:F,childId:CHILD,operationId:ID,kind:'buy',
  size:'S',occurredAt:'2026-11-13T13:30:00Z',amount:60,
  purchase:{brand:'好奇',series:'小森林',totalFen:9995,purchaseDate:'2026-11-13'}};
 const first=await client.applyOperation(request);
 const second=await client.applyOperation(request);
 assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);
 assert.equal(cloud.stock.S,140);assert.equal(cloud.records.length,1);
 assert.equal(cloud.rpcCalls,2);
});
test('P2-01 purchase-only UI rejects consume, stocktake, reverse, document writes',async()=>{
 const submitted=[];
 const primary={read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})};
 const actions=Actions.create({primary,
  commands:{submit:async(kind)=>{submitted.push(kind);return{status:'QUEUED'}}},
  formalModeSelected:()=>true,buildAllowsWrites:true,operatorApproved:()=>true,
  purchaseOnly:true,readPurchase:()=>({}),readQuote:()=>null,
  readTransaction:()=>null,notify:()=>{}});
 for(const el of [{id:'saveStocks',dataset:{}},
  {id:'saveWeight',dataset:{}},{id:'',dataset:{action:'consume',size:'S',count:1}},
  {id:'',dataset:{action:'deletetx',id:'foo'}}]){
  assert.equal((await actions.handle(el,{})).status,'FORMAL_PURCHASE_ONLY');
 }
 assert.equal(submitted.length,0);
});
test('P2-01 runner purchase-only retry never uploads a non-buy queue',async()=>{
 const sent=[];
 const outbox={ready:async()=>[{id:ID,type:'inventory.delta',familyId:F,
  actorUid:'dad',payload:{childId:CHILD,size:'S',kind:'use',amount:3}}],
  recordResult:async()=>{}};
 const runner=Runner.create({outbox,remote:{
  applyOperation:async r=>{sent.push(r);return{operationId:r.operationId}}
 },verifyAccess:async()=>({familyId:F,actorUid:'dad',appCode:'xb',
 member:true,initialized:true})});
 const result=await runner.flush({familyId:F,actorUid:'dad'},
  {uploadEnabled:true,purchaseOnly:true});
 assert.equal(result.status,'unsupported-pending-type');
 assert.equal(result.attempted,0);assert.equal(sent.length,0);
});
test('P2-01 production flags disabled and no queue or RPC if not separately approved',async()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 let calls=0;
 const app=Actions.create({primary:{read:async()=>{calls++}},
  commands:{submit:async()=>{calls++;return{status:'QUEUED'}}},
  formalModeSelected:()=>true,buildAllowsWrites:false,
  operatorApproved:()=>true,purchaseOnly:true,
  readPurchase:()=>({size:'S'}),readQuote:()=>null,
  readTransaction:()=>null,notify:()=>{}});
 assert.equal((await app.handle({id:'buyNow',dataset:{}},{})).status,
  'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(calls,0);
});
test('P2-01 formal controller exposes disabled release, and retry button is capture-exempt',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,
  '../sync/primary-formal-ui-actions.js'),'utf8');
 const ctrl=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(source,/'formalSyncNow'/);
 assert.match(ctrl,/const FORMAL_PURCHASE_ENABLED=false/);
 assert.match(ctrl,/purchaseOnly:true/);
});

// Positive return is not enough: the formal controller must verify this UUID
// actually appears in the newly read primary transaction history.
test('P2-01 only a verified cloud purchase operation ID may complete UI readback',async()=>{
 const root=require('../preview/v1.2.0/formal-controller.js');
 const elements=new Map();
 const el=id=>{if(!elements.has(id))elements.set(id,{hidden:false,
  textContent:'',value:'',addEventListener(){}});return elements.get(id);};
 const doc={body:{dataset:{}},getElementById:el,addEventListener(){}};
 const host={navigator:{onLine:true},crypto:{randomUUID:()=>ID},
  addEventListener(){}};
 let purchaseRows=[];
 const controller={connect:async()=> 'FORMAL_FAMILY_VERIFIED',
  verifiedContext:()=>({app:{auth:{getSession:async()=>({data:{user:{id:'dad'}}})}},
   familyId:F,actorUid:'dad'}),signOut:async()=> 'LOGIN_REQUIRED'};
 const app=root.create({host,doc,loginController:{create:()=>controller},
  readModelFactory:()=>({read:async()=>({...{
   status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
   familyId:F,childId:CHILD,actorUid:'dad',canWrite:false
  },livePurchases:purchaseRows})}),
  primaryFactory:()=>({activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'})}),
  commandsFactory:{create:()=>({submit:async()=>({status:'DISABLED'})})},
  actionsFactory:{create:()=>({attach:()=>({detach(){}})})},
  projection:{project:()=>({canWrite:false,state:{}})},
  ui:{defaults:()=>({}),show(){},clear(){}},scriptLoader:async()=>{}});
 assert.equal(await app.start(),'ready');
 assert.equal(await app.restore({expectedPurchaseId:ID}),
  'PRIMARY_PURCHASE_READBACK_PENDING');
 purchaseRows=[{operationId:ID,reversed:false}];
 assert.equal(await app.restore({expectedPurchaseId:ID}),'ready');
 assert.equal(doc.body.dataset.formalState,'ready');
});

test('P2-01 unknown RPC acknowledgment retains original purchase UUID for manual retry',async()=>{
 const seen=[];
 const commands={submit:async(action)=>{
  seen.push(action);return{status:'PRIMARY_OPERATION_DURABLY_QUEUED',
   operationId:ID,cloudWriteCommitted:false};
 }};
 const actions=Actions.create({commands,
  primary:{read:async()=>({}),flush:async()=>{throw Error('network dropped ACK')}},
  formalModeSelected:()=>true,buildAllowsWrites:true,
  operatorApproved:()=>true,purchaseOnly:true,
  onPurchaseReadback:async()=>{throw Error('must not read back before ACK')},
  readPurchase:()=>({brand:'好奇',series:'小森林',size:'S',pieces:60,price:99.95}),
  readQuote:()=>null,readTransaction:()=>null,notify:()=>{}});
 const result=await actions.handle({id:'buyNow',dataset:{}},{});
 assert.equal(result.status,'PRIMARY_PURCHASE_PENDING_REVIEW');
 assert.equal(result.operationId,ID);
 assert.equal(result.cloudWriteCommitted,false);
 assert.deepEqual(seen,['purchase']);
});
