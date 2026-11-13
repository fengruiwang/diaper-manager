const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Commands=require('../sync/primary-business-commands.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Runner=require('../sync/inventory-outbox-runner.js');
const Client=require('../sync/cloudbase-inventory-client.js');
const UI=require('../sync/primary-ui-projection.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const BUY='79192488-bd70-4b88-8c66-3c5b5fb29ef5';
const USE='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const REVERSE='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6';
const DATE='2026-11-14T08:00:00.000Z';
const SIZES=['NB','S','M','L','XL','XXL'];
function createServer(){
 const inventory={NB:10,S:140,M:0,L:0,XL:0,XXL:0};
 const revisions=Object.fromEntries(SIZES.map(size=>[size,1]));
 revisions.S=2;
 const receipts=new Map(),operations=new Map(),rpcCalls=[];
 function app(actor){
  return {auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})},
   rdb:()=>({
    async rpc(name,p){
     assert.equal(name,'xb_apply_inventory_operation');
     assert.equal(p.p_family_id,F);assert.equal(p.p_child_id,CHILD);
     rpcCalls.push({actor,p});
     if(receipts.has(p.p_operation_id))
      return {data:{...receipts.get(p.p_operation_id),duplicate:true},error:null};
     const size=p.p_size,before=inventory[size];let next;
     if(p.p_kind==='stocktake'){
      if(revisions[size]!==p.p_expected_revision)
       return {data:null,error:{code:'DATABASE_40001'}};
      next=p.p_amount;
     }else if(p.p_kind==='buy')next=before+p.p_amount;
     else if(p.p_kind==='use')next=before-p.p_amount;
     else if(p.p_kind==='reverse'){
      const original=operations.get(p.p_reverses_operation_id);
      if(!original||original.reversed||original.size!==size)
       return {data:null,error:{code:'DATABASE_23505'}};
      next=before-original.delta;
      original.reversed=true;
     }else return {data:null,error:{code:'DATABASE_22023'}};
     if(!Number.isSafeInteger(next)||next<0||next>100000)
      return {data:null,error:{code:'DATABASE_23514'}};
     inventory[size]=next;revisions[size]++;
     const receipt={accepted:true,duplicate:false,operation_id:p.p_operation_id,
      child_id:CHILD,size,result_quantity:next,result_revision:revisions[size]};
     const delta=next-before;
     operations.set(p.p_operation_id,{size,kind:p.p_kind,delta,reversed:false});
     receipts.set(p.p_operation_id,receipt);
     return {data:receipt,error:null};
    },
    from(table){
     const q={filters:{},select(){return this},eq(k,v){this.filters[k]=v;return this},
      then(resolve,reject){
       assert.equal(this.filters.family_id,F);assert.equal(this.filters.child_id,CHILD);
       assert.equal(table,'xb_inventory');
       const data=SIZES.map(size=>({size,quantity:inventory[size],
        revision:revisions[size],updated_at:DATE}));
       return Promise.resolve({data,error:null}).then(resolve,reject);
      }};
     return q;
    }
   })
  };
 }
 return {inventory,revisions,receipts,operations,rpcCalls,app};
}
function form(values){
 return {getElementById:id=>{const size=id.slice(4);return SIZES.includes(size)?
  {value:String(values[size])}:null;}};
}
function setup(server,{actor='dad',displayed=null,uuid=ID,batch=null}={}){
 const client=Client.create(server.app(actor)),pending=[],queued=[],events=[];
 const scope={familyId:F,childId:CHILD,actorUid:actor};
 const shown=displayed||{inventory:{...server.inventory},revisions:{...server.revisions}};
 const primary={cloudWritesEnabled:true,selectedScope:()=>scope,
  read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{...server.inventory},revisions:{...server.revisions}}),
  queue:async op=>{
   pending.push({...op,status:'pending'});queued.push(op);
   return {status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:op.id};
  },
  flush:async()=>{
   const outbox={
    ready:async()=>pending.filter(x=>x.status!=='acked'),
    recordResult:async(_,id,result)=>{
     const op=pending.find(x=>x.id===id);assert.ok(op);
     op.status=['accepted','duplicate'].includes(result.kind)?'acked':'retry';
    }
   };
   const runner=Runner.create({outbox,remote:client,verifyAccess:async()=>({
    familyId:F,actorUid:actor,appCode:'xb',member:true,initialized:true
   })});
   const sent=await runner.flush(scope,{uploadEnabled:true,purchaseOnly:true,
    allowConsume:true,allowReverse:true,allowStocktake:true});
   return {status:sent.accepted>0?'PRIMARY_CLOUD_SYNCED_VERIFIED':
    'PRIMARY_UPLOAD_STOP_MANUAL_REVIEW_REQUIRED'};
  }
 };
 let uuidCalls=0,readback=null;
 const commands=Commands.create({primary,uuid:()=>{uuidCalls++;return uuid;},
  clock:()=>DATE});
 const actions=Actions.create({primary,commands,
  formalModeSelected:()=>true,buildAllowsWrites:true,
  operatorApproved:()=>true,purchaseOnly:true,allowConsume:true,
  allowReverse:true,allowStocktake:true,readStocktakeBaseline:()=>shown,
  batchStocktake:batch,createBatchId:()=>ID,
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  notify:answer=>events.push(answer.status),
  onPurchaseReadback:async info=>{
   readback=info;
   const rows=await client.readInventory({familyId:F,childId:CHILD});
   assert.equal(rows.length,6);
   return rows.some(row=>row.size===info.size&&row.quantity===info.count
    &&row.revision>info.expectedRevision)?'ready':'pending';
  }});
 return {actions,client,queued,events,shown,primary,
  get readback(){return readback},get uuidCalls(){return uuidCalls}};
}
const args=(operationId,kind,amount=null,expectedRevision=null,original=null)=>({
 familyId:F,childId:CHILD,operationId,kind,size:'S',amount,expectedRevision,
 reversesOperationId:original,occurredAt:DATE,
 purchase:kind==='buy'?{brand:'好奇',series:'小森林',
  totalFen:10000,purchaseDate:'2026-11-14'}:null
});
test('P2-04 original six-size editor -> durable single count -> RPC -> readback',async()=>{
 const s=createServer(),f=setup(s);
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  form({...s.inventory,S:135}));
 assert.equal(r.status,'PRIMARY_STOCKTAKE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.queued.length,1);assert.equal(f.uuidCalls,1);
 assert.equal(f.queued[0].id,ID);
 assert.equal(f.queued[0].type,'inventory.count');
 assert.equal(f.queued[0].expectedRevision,2);
 assert.equal(f.queued[0].payload.count,135);
 assert.equal(s.rpcCalls.length,1);
 assert.equal(s.rpcCalls[0].p.p_kind,'stocktake');
 assert.equal(s.rpcCalls[0].p.p_amount,135);
 assert.equal(s.rpcCalls[0].p.p_expected_revision,2);
 assert.equal(s.inventory.S,135);assert.equal(s.revisions.S,3);
 assert.equal(f.readback.expectedRevision,2);
});
test('P2-04 stale displayed revision cannot queue a new UUID or overwrite other member',async()=>{
 const s=createServer(),f=setup(s);
 await Client.create(s.app('mom')).applyOperation(args(BUY,'buy',5));
 assert.equal(s.inventory.S,145);
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  form({...f.shown.inventory,S:135}));
 assert.equal(r.status,'PRIMARY_STOCK_REVISION_CONFLICT');
 assert.equal(f.uuidCalls,0);assert.equal(f.queued.length,0);
 assert.equal(s.rpcCalls.length,1);assert.equal(s.inventory.S,145);
 await assert.rejects(()=>f.client.applyOperation(args(ID,'stocktake',135,2)),
  /inventory_client:revision_conflict/);
 assert.equal(s.inventory.S,145);
});
test('P2-04 same operation UUID retry is duplicate, never re-applies stocktake',async()=>{
 const s=createServer(),c=Client.create(s.app('dad'));
 const first=await c.applyOperation(args(ID,'stocktake',135,2));
 const second=await c.applyOperation(args(ID,'stocktake',135,2));
 assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);
 assert.equal(s.inventory.S,135);assert.equal(s.revisions.S,3);
 assert.equal(s.receipts.size,1);
});
test('P2-04 both family accounts read one authoritative six-size stock and revisions',async()=>{
 const s=createServer();
 await Client.create(s.app('dad')).applyOperation(args(ID,'stocktake',135,2));
 const left=await Client.create(s.app('dad')).readInventory({familyId:F,childId:CHILD});
 const right=await Client.create(s.app('mom')).readInventory({familyId:F,childId:CHILD});
 assert.deepEqual(left,right);
 assert.equal(right.find(x=>x.size==='S').quantity,135);
});
test('P2-04 rejects multiple edited sizes when batch sending is unavailable',async()=>{
 const s=createServer();let batchCalls=0;
 const f=setup(s,{batch:{queue:async()=>{batchCalls++;return{status:'BATCH_QUEUED'};}}});
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  form({...s.inventory,S:135,M:8}));
 assert.equal(r.status,'MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED');
 assert.equal(batchCalls,0);assert.equal(f.uuidCalls,0);
 assert.equal(f.queued.length,0);assert.equal(s.rpcCalls.length,0);
 assert.equal(s.inventory.S,140);assert.equal(s.inventory.M,0);
});
test('P2-04 retains buy/use/reverse and legacy historical stock as display-only',async()=>{
 const s=createServer(),client=Client.create(s.app('dad'));
 await client.applyOperation(args(ID,'stocktake',135,2));
 await client.applyOperation(args(BUY,'buy',5));
 await client.applyOperation(args(USE,'use',3));
 await client.applyOperation(args(REVERSE,'reverse',null,null,USE));
 assert.equal(s.inventory.S,140);
 const view={
  status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  canWrite:false,familyId:F,childId:CHILD,actorUid:'mom',
  inventory:{...s.inventory},revisions:{...s.revisions},
  settings:{currentSize:'S'},profileData:{
   babyProfile:{name:'正式宝宝'},dueDate:'2027-01-08',birthDate:'',babyWeight:''},
  legacyHistory:{complete:true,hasMore:false,total:1,rows:[{
   kind:'transaction',id:'old-buy',payload:{id:'old-buy',type:'buy',
    size:'S',pieces:10,price:10,date:'2026-10-28'}
  }]},legacyPurchasesAppliedToInventory:false,livePurchases:[],liveUses:[]
 };
 const projection=UI.project(view,{transactions:[],quotes:[],
  weightRecords:[],inventory:{},referenceOverrides:{},babyProfile:{}});
 assert.equal(projection.state.inventory.S,140);
 assert.equal(projection.state.transactions.length,1);
 assert.equal(projection.state.transactions[0].origin,'legacy_migration');
 assert.equal(projection.historicPurchasesAddedToStock,false);
});
test('P2-04 leaves production and formal write gates off; bundled sources stay in sync',()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 for(const filename of ['primary-business-commands.js','primary-formal-ui-actions.js',
  'primary-cloud-operations.js','inventory-outbox-runner.js']){
  assert.ok(html.includes(fs.readFileSync(path.join(__dirname,
   '../sync',filename),'utf8')),filename+' not mirrored in preview');
 }
 const controller=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(controller,/allowStocktake:true/);
 assert.match(controller,/batchStocktake:batchGuard/);
});
