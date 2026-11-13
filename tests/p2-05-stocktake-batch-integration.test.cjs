const test=require('node:test'),assert=require('node:assert/strict');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Batch=require('../sync/primary-stocktake-batch-client.js');
const Contract=require('../sync/outbox-contract.js');
const Client=require('../sync/cloudbase-inventory-client.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const BATCH='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const SIZES=['NB','S','M','L','XL','XXL'];
function fixture({enabled=true,ackLost=false,hiddenReceipts=0}={}){
 const stock={NB:100,S:200,M:0,L:0,XL:0,XXL:0};
 const revisions={NB:3,S:7,M:1,L:1,XL:1,XXL:1};
 const receipts=new Map(),queued=new Map(),sent=[],single=[];
 let batchWrites=0,receiptReads=0,uuidCalls=0;
 const scope={familyId:F,childId:CHILD,actorUid:'dad'};
 const displayed={inventory:{...stock},revisions:{...revisions}};
 function app(actor){
  return {auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})},
   rdb:()=>({
    async rpc(name,p){
     assert.equal(p.p_family_id,F);assert.equal(p.p_child_id,CHILD);
     if(name==='xb_read_primary_stocktake_batch_receipt_draft'){
      receiptReads++;
      const item=receipts.get(p.p_batch_id);
      if(item&&hiddenReceipts-->0)return{data:{
       status:'NO_RECEIPT',family_id:F,child_id:CHILD,batch_id:p.p_batch_id}};
      return {data:item?{status:'COMMITTED',family_id:F,child_id:CHILD,
       batch_id:p.p_batch_id,result:item.result}:
       {status:'NO_RECEIPT',family_id:F,child_id:CHILD,
        batch_id:p.p_batch_id}};
     }
     assert.equal(name,'xb_primary_stocktake_batch_draft');
     batchWrites++;sent.push({actor,p});
     const previous=receipts.get(p.p_batch_id);
     if(previous)return {data:{...previous,duplicate:true}};
     assert.ok(p.p_items.length>=2);
     // The real all-or-nothing guarantee is separately checked in PG16;
     // this fixture checks JS -> RPC argument and readback wiring.
     if(p.p_items.some(row=>revisions[row.size]!==row.expectedRevision))
      return{error:{code:'DATABASE_40001'}};
     const changes=p.p_items.map(row=>({
      size:row.size,new_quantity:row.count,
      revision:row.expectedRevision+1
     }));
     for(const row of p.p_items){
      stock[row.size]=row.count;revisions[row.size]++;
     }
     const receipt={saved:true,family_id:F,child_id:CHILD,batch_id:p.p_batch_id,
      result:{status:'APPLIED',changed_sizes:changes.length,changes}};
     receipts.set(p.p_batch_id,receipt);
     if(ackLost){ackLost=false;throw Error('synthetic reply lost after commit');}
     return {data:receipt};
    },
    from(name){
     assert.equal(name,'xb_inventory');
     const filters={},q={
      select(){return this;},eq(k,v){filters[k]=v;return this;},
      then(resolve,reject){
       assert.equal(filters.family_id,F);assert.equal(filters.child_id,CHILD);
       const data=SIZES.map(size=>({size,quantity:stock[size],
        revision:revisions[size],updated_at:'2026-11-14T10:00:00Z'}));
       return Promise.resolve({data,error:null}).then(resolve,reject);
      }
     };return q;
    }
   })
  };
 }
 const primary={
  selectedScope:()=>scope,
  read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{...stock},revisions:{...revisions}}),
  flush:async()=>({status:'PRIMARY_CLOUD_SYNCED_VERIFIED'})
 };
 const idbStore={
  async enqueue(op){if(queued.has(op.id))throw Error('duplicate_id');
   queued.set(op.id,{...op});return {duplicate:false};},
  async ready(){return [...queued.values()].filter(x=>x.status==='pending'||x.status==='retry');},
  async stats(){const list=[...queued.values()];return{
   total:list.length,outstanding:list.filter(x=>x.status!=='acked').length,
   pending:list.filter(x=>x.status==='pending').length,
   retry:0,conflict:list.filter(x=>x.status==='conflict').length,blocked:0,acked:0};},
  async recordResult(_scope,id,result){const op=queued.get(id);assert.ok(op);
   op.status=['accepted','duplicate'].includes(result.kind)?'acked':'conflict';},
  async get(_scope,id){return queued.get(id)||null;}
 };
 const controller={verifiedContext:()=>({...scope,app:app('dad')})};
 const createBatch=()=>Batch.create({controller,primary,
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  outboxFactory:{create:()=>idbStore},contract:Contract,
  cloudWritesEnabled:enabled});
 let bridge=createBatch();
 const commands={submit:async(action,value)=>{
  single.push({action,value});return{status:'PRIMARY_OPERATION_DURABLY_QUEUED',
   operationId:'79192488-bd70-4b88-8c66-3c5b5fb29ef5'};}};
 const actions=Actions.create({primary,commands,formalModeSelected:()=>true,
  buildAllowsWrites:enabled,operatorApproved:()=>enabled,purchaseOnly:true,
  allowConsume:true,allowReverse:true,allowStocktake:true,
  readStocktakeBaseline:()=>displayed,batchStocktake:bridge,
  createBatchId:()=>{uuidCalls++;return BATCH;},
  onBatchReadback:async({batchId,items})=>{
   assert.equal(batchId,BATCH);
   const dad=await Client.create(app('dad')).readInventory({familyId:F,childId:CHILD});
   const mom=await Client.create(app('mom')).readInventory({familyId:F,childId:CHILD});
   assert.deepEqual(dad,mom);
   return items.every(item=>dad.some(row=>row.size===item.size
    &&row.quantity===item.count&&row.revision>item.expectedRevision))
    ?'ready':'pending';
  },
  onPurchaseReadback:async()=> 'ready',
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  notify:()=>{}});
 const form=(changes={})=>({
  getElementById:id=>{const size=id.slice(4);return SIZES.includes(size)
   ?{value:String(Object.hasOwn(changes,size)?changes[size]:displayed.inventory[size])}
   :null;}
 });
 return {actions,form,stock,revisions,displayed,scope,primary,queued,receipts,
  sent,single,app,createBatch,get bridge(){return bridge},
  get batchWrites(){return batchWrites},
  get receiptReads(){return receiptReads},
  get uuidCalls(){return uuidCalls}
 };
}
test('P2-05 two edited sizes use one durable UUID, one atomic batch RPC and six-size shared readback',async()=>{
 const f=fixture();
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  f.form({NB:120,S:180}));
 assert.equal(r.status,'BATCH_CLOUD_READBACK_VERIFIED');
 assert.equal(r.batchId,BATCH);assert.equal(r.changedSizes,2);
 assert.equal(f.uuidCalls,1);assert.equal(f.queued.size,1);
 assert.equal(f.queued.get(BATCH).status,'acked');
 assert.equal(f.single.length,0);assert.equal(f.batchWrites,1);
 assert.equal(f.receipts.size,1);assert.ok(f.receiptReads>=2);
 assert.deepEqual(f.sent[0].p.p_items,[
  {size:'NB',count:120,expectedRevision:3},
  {size:'S',count:180,expectedRevision:7}
 ]);
 assert.equal(f.stock.NB,120);assert.equal(f.stock.S,180);
 assert.equal(f.revisions.NB,4);assert.equal(f.revisions.S,8);
 // Stocktakes do not create purchase/consumption history rows.
 assert.equal(f.sent[0].p.p_purchase,undefined);
});
test('P2-05 single edited size stays on existing P2-04 command route',async()=>{
 const f=fixture();
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  f.form({S:180}));
 assert.equal(r.status,'PRIMARY_STOCKTAKE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.single.length,1);assert.equal(f.single[0].action,'stocktake');
 assert.equal(f.single[0].value.expectedRevision,7);
 assert.equal(f.uuidCalls,0);assert.equal(f.batchWrites,0);
});
test('P2-05 edited snapshot stale before click rejects entire form before queuing',async()=>{
 const f=fixture();
 f.stock.S=205;f.revisions.S=8;
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  f.form({NB:120,S:180}));
 assert.equal(r.status,'PRIMARY_STOCK_REVISION_CONFLICT');
 assert.equal(f.queued.size,0);assert.equal(f.uuidCalls,0);
 assert.equal(f.batchWrites,0);assert.equal(f.stock.NB,100);
});
test('P2-05 server CAS race rejects full batch with DATABASE_40001, preserves old UUID',async()=>{
 const f=fixture();
 const client=f.bridge;
 const q=await client.queue({operatorApproved:true,batchId:BATCH,
  items:[{size:'NB',count:120,expectedRevision:3},
   {size:'S',count:180,expectedRevision:7}]});
 assert.equal(q.status,'BATCH_DURABLY_QUEUED');
 f.stock.S=205;f.revisions.S=8;
 const r=await client.send({operatorApproved:true});
 assert.equal(r.status,'BATCH_REVISION_CONFLICT_MANUAL_REVIEW');
 assert.equal(r.batchId,BATCH);
 assert.equal(f.stock.NB,100);assert.equal(f.stock.S,205);
 assert.equal(f.queued.get(BATCH).status,'conflict');
 assert.equal(f.queued.size,1);assert.equal(f.batchWrites,1);
});
test('P2-05 lost write response recovers receipt with same UUID, no second write',async()=>{
 const f=fixture({ackLost:true});
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  f.form({NB:120,S:180}));
 assert.equal(r.status,'BATCH_CLOUD_READBACK_VERIFIED');
 assert.equal(f.batchWrites,1);
 assert.equal(f.queued.get(BATCH).status,'acked');
 assert.equal(f.stock.NB,120);assert.equal(f.stock.S,180);
});
test('P2-05 unreadable receipt preserves queued batch across client recreation',async()=>{
 const f=fixture({hiddenReceipts:1});
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  f.form({NB:120,S:180}));
 assert.equal(r.status,'BATCH_RECEIPT_READBACK_REQUIRED_KEEP_ID');
 assert.equal(r.batchId,BATCH);assert.equal(f.queued.get(BATCH).status,'pending');
 assert.equal(f.batchWrites,1);
 const reopened=f.createBatch();
 const ack=await reopened.send({operatorApproved:true});
 assert.equal(ack.status,'BATCH_ACK_RECOVERED');
 assert.equal(ack.batchId,BATCH);
 assert.equal(f.queued.get(BATCH).status,'acked');
 assert.equal(f.batchWrites,1);
});
test('P2-05 default formal and batch gates remain disabled',async()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const f=fixture({enabled:false});
 const r=await f.actions.handle({id:'saveStocks',dataset:{}},
  f.form({NB:120,S:180}));
 assert.equal(r.status,'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(f.batchWrites,0);assert.equal(f.queued.size,0);
 assert.equal((await f.bridge.send({operatorApproved:true})).status,
  'BATCH_WRITES_NOT_AUTHORIZED');
});
