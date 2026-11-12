const test=require('node:test'),assert=require('node:assert/strict');
const Batch=require('../sync/primary-stocktake-batch-client.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const item=()=>[{size:'NB',count:10,expectedRevision:1},
 {size:'S',count:150,expectedRevision:2}];
function fixture({enabled=false,offline=false,ackLost=false,conflict=false,
  selected=true,alreadyCommitted=false}={}){
 const calls=[],rows=new Map();
 const scope={familyId:F,actorUid:'A',childId:CHILD};
 let receipt=alreadyCommitted;
 const client={
  rdb:()=>({rpc:async(name,params)=>{
   calls.push(['rpc',name,params]);
   if(name==='xb_read_primary_stocktake_batch_receipt_draft'){
    return {data:receipt?{status:'COMMITTED',family_id:F,child_id:CHILD,
     batch_id:ID,result:{status:'APPLIED',changed_sizes:2}}:
     {status:'NO_RECEIPT',family_id:F,child_id:CHILD,batch_id:ID}};
   }
   if(name!=='xb_primary_stocktake_batch_draft')throw Error('other RPC');
   if(conflict)return {error:{code:'40001'}};
   receipt=true;
   if(ackLost)throw Error('synthetic lost reply after PG commit');
   return {data:{saved:true,batch_id:ID,family_id:F,child_id:CHILD,
    result:{status:'APPLIED',changed_sizes:2}}};
  }})
 };
 const store={
  async enqueue(op){calls.push(['enqueue',op.id]);
   rows.set(op.id,{...op,status:'pending'});
   return {duplicate:false}},
  async get(_s,id){return rows.get(id)||null},
  async ready(){return [...rows.values()].filter(x=>x.status==='pending')},
  async stats(){let all=[...rows.values()];return{
   total:all.length,outstanding:all.filter(x=>x.status!=='acked').length,
   pending:all.filter(x=>x.status==='pending').length,
   retry:0,conflict:all.filter(x=>x.status==='conflict').length,blocked:0,acked:0}},
  async recordResult(_s,id,r){calls.push(['ack',r.kind,id]);
   rows.get(id).status=r.kind==='accepted'?'acked':'conflict'}
 };
 const bridge=Batch.create({
  controller:{verifiedContext:()=>selected?{...scope,app:client}:null},
  host:{navigator:{onLine:!offline},indexedDB:{open(){}}},
  primary:{selectedScope:()=>selected?scope:null,
   read:async()=>{calls.push(['primary.read']);return{
    status:'PRIMARY_CLOUD_READ_VERIFIED',
    inventory:{NB:0,S:140,M:0,L:0,XL:0,XXL:0},
    revisions:{NB:1,S:2,M:1,L:1,XL:1,XXL:1}
   }}},
  outboxFactory:{create:args=>{
   calls.push(['outbox.create',args.dbName]);return store}},
  contract:{createOperation:args=>args},
  cloudWritesEnabled:enabled
 });
 return {bridge,calls,rows,get receipt(){return receipt}};
}
test('batch uses separate durable store and is disabled before authorization',async()=>{
 const f=fixture();
 assert.equal(f.calls[0][1],Batch.DB_NAME);
 assert.notEqual(Batch.DB_NAME,'xiaobao-primary-sync-v120');
 assert.notEqual(Batch.DB_NAME,'xiaobao-primary-documents-v120');
 assert.equal((await f.bridge.queue({items:item(),batchId:ID,
  operatorApproved:true})).status,'BATCH_WRITES_NOT_AUTHORIZED');
 assert.equal(f.calls.length,1);
});
test('two sizes queue one immutable operation ID before any SQL writes',async()=>{
 const f=fixture({enabled:true});
 const q=await f.bridge.queue({items:item(),batchId:ID,operatorApproved:true});
 assert.equal(q.status,'BATCH_DURABLY_QUEUED');
 assert.equal(q.batchId,ID);
 assert.equal(q.cloudWriteCommitted,false);
 assert.deepEqual(f.calls.map(x=>x[0]),['outbox.create','primary.read','enqueue']);
 assert.equal((await f.bridge.pending()).outstanding,1);
});
test('one single PG RPC commits all sizes; ACK remains separate from queue success',async()=>{
 const f=fixture({enabled:true});
 await f.bridge.queue({items:item(),batchId:ID,operatorApproved:true});
 const a=await f.bridge.send({operatorApproved:true});
 assert.equal(a.status,'BATCH_ATOMIC_COMMIT_ACKED');
 assert.equal(a.changedSizes,2);
 assert.equal(f.rows.get(ID).status,'acked');
 assert.equal(f.calls.filter(x=>x[1]==='xb_primary_stocktake_batch_draft').length,1);
});
test('lost response read-only receipt recovers same ID without sending another batch',async()=>{
 const f=fixture({enabled:true,ackLost:true});
 await f.bridge.queue({items:item(),batchId:ID,operatorApproved:true});
 assert.equal((await f.bridge.send({operatorApproved:true})).status,'BATCH_ACK_RECOVERED');
 assert.equal(f.rows.get(ID).status,'acked');
 assert.equal(f.calls.filter(x=>x[1]==='xb_primary_stocktake_batch_draft').length,1);
});
test('previously committed batch request requires only receipt ACK, never retransmits SQL write',async()=>{
 const f=fixture({enabled:true,alreadyCommitted:true});
 await f.bridge.queue({items:item(),batchId:ID,operatorApproved:true});
 assert.equal((await f.bridge.send({operatorApproved:true})).status,'BATCH_ACK_RECOVERED');
 assert.equal(f.calls.some(x=>x[1]==='xb_primary_stocktake_batch_draft'),false);
});
test('two-size stale revision conflicts keep original durable event and no partial success',async()=>{
 const f=fixture({enabled:true,conflict:true});
 await f.bridge.queue({items:item(),batchId:ID,operatorApproved:true});
 assert.equal((await f.bridge.send({operatorApproved:true})).status,
  'BATCH_REVISION_CONFLICT_MANUAL_REVIEW');
 assert.equal(f.rows.get(ID).status,'conflict');
});
test('offline, missing primary and stale revisions are fail-closed without SQL DML',async()=>{
 const offline=fixture({enabled:true,offline:true});
 assert.equal((await offline.bridge.queue({items:item(),batchId:ID,
  operatorApproved:true})).status,'BATCH_OFFLINE_NOT_ACCEPTED');
 const missing=fixture({enabled:true,selected:false});
 assert.equal((await missing.bridge.queue({items:item(),batchId:ID,
  operatorApproved:true})).status,'BATCH_QUEUE_UNVERIFIED_KEEP_ID');
 const stale=fixture({enabled:true});
 assert.equal((await stale.bridge.queue({items:[{size:'S',count:150,
  expectedRevision:1}],batchId:ID,operatorApproved:true})).status,
  'BATCH_QUEUE_UNVERIFIED_KEEP_ID');
 assert.equal(stale.calls.some(x=>x[0]==='enqueue'),false);
});
