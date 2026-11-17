const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Batch=require('../sync/primary-stocktake-batch-client.js');
const Durable=require('../sync/idb-outbox.js');
const Contract=require('../sync/outbox-contract.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const A='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const B='79192488-bd70-4b88-8c66-3c5b5fb29ef5';
const NEXT='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6';
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const testSource=fs.readFileSync(path.join(__dirname,'idb-outbox.test.cjs'),'utf8');
const first=testSource.indexOf('function fakeIndexedDB(){'),end=testSource.indexOf('function make(',first);
const fakeIndexedDB=new Function('clone','queueMicrotask','setTimeout',
 testSource.slice(first,end)+'\nreturn fakeIndexedDB;')(clone,queueMicrotask,setTimeout);
const aItems=()=>[{size:'NB',count:120,expectedRevision:1},
 {size:'S',count:180,expectedRevision:2}];
const bItems=()=>[{size:'NB',count:130,expectedRevision:1},
 {size:'S',count:190,expectedRevision:2}];
function fixture(){
 const idb=fakeIndexedDB(),stock={NB:100,S:200,M:0,L:0,XL:0,XXL:0},
  revisions={NB:1,S:2,M:0,L:0,XL:0,XXL:0};
 const receipts=new Map(),calls=[];
 let receiptMode='normal',readMode='normal';
 const make=actor=>{
  const identity={familyId:F,childId:CHILD,actorUid:actor};
  const app={rdb:()=>({rpc:async(name,args)=>{
   calls.push([actor,name,clone(args)]);
   if(name==='xb_read_primary_stocktake_batch_receipt_draft'){
    if(receiptMode==='network')throw Error('network failure');
    if(receiptMode==='denied')return {error:{code:'42501'}};
    if(receiptMode==='unverified')return {data:{status:'NO_RECEIPT',family_id:'other'}};
    const prior=receipts.get(args.p_batch_id);
    return {data:prior?{status:'COMMITTED',family_id:F,child_id:CHILD,
     batch_id:args.p_batch_id,result:prior.result}:
     {status:'NO_RECEIPT',family_id:F,child_id:CHILD,batch_id:args.p_batch_id}};
   }
   assert.equal(name,'xb_primary_stocktake_batch_draft');
   if(args.p_items.some(x=>revisions[x.size]!==x.expectedRevision))
    return {error:{code:'DATABASE_40001'}};
   const changes=args.p_items.map(x=>({size:x.size,new_quantity:x.count,
    revision:x.expectedRevision+1}));
   for(const item of args.p_items){stock[item.size]=item.count;revisions[item.size]++;}
   const result={status:'APPLIED',changed_sizes:changes.length,changes};
   receipts.set(args.p_batch_id,{result});
   return {data:{saved:true,family_id:F,child_id:CHILD,
    batch_id:args.p_batch_id,result}};
  }})};
  const controller={verifiedContext:()=>({...identity,app})};
  const primary={selectedScope:()=>identity,
   read:async()=>readMode==='unverified'?{status:'PRIMARY_READ_UNVERIFIED'}:
    {status:'PRIMARY_CLOUD_READ_VERIFIED',inventory:{...stock},revisions:{...revisions}}};
  const bridge=Batch.create({controller,primary,host:{indexedDB:idb,navigator:{onLine:true}},
   outboxFactory:Durable,contract:Contract,cloudWritesEnabled:true});
  const storage=Durable.create({indexedDB:idb,contract:Contract,
   dbName:Batch.DB_NAME});
  return {bridge,storage,identity};
 };
 const a=make('A'),b=make('B');
 async function race(){
  assert.equal((await a.bridge.queue({items:aItems(),batchId:A,operatorApproved:true})).status,
   'BATCH_DURABLY_QUEUED');
  assert.equal((await b.bridge.queue({items:bItems(),batchId:B,operatorApproved:true})).status,
   'BATCH_DURABLY_QUEUED');
  assert.equal((await b.bridge.send({operatorApproved:true})).status,
   'BATCH_ATOMIC_COMMIT_ACKED');
  assert.equal((await a.bridge.send({operatorApproved:true})).status,
   'BATCH_REVISION_CONFLICT_MANUAL_REVIEW');
 }
 return {a,b,race,stock,revisions,receipts,calls,
  setReceiptMode:x=>receiptMode=x,setReadMode:x=>readMode=x};
}
test('P4-04C-03 RED: A/B revision race leaves original batch outstanding and blocks new stocktake',async()=>{
 const f=fixture();await f.race();
 const op=await f.a.storage.get(f.a.identity,A);
 assert.equal(op.status,'conflict');assert.equal(op.error,'conflict');
 assert.equal(op.receipt,null);assert.equal(op.id,A);
 assert.deepEqual(op.payload.items,aItems());
 assert.equal((await f.a.bridge.pending()).outstanding,1);
 assert.equal((await f.a.storage.ready(f.a.identity)).length,0);
 assert.equal((await f.a.bridge.queue({items:bItems(),batchId:NEXT,operatorApproved:true})).status,
  'BATCH_PENDING_REVIEW_FIRST');
 assert.equal(f.stock.NB,130);assert.equal(f.stock.S,190);
});
test('P4-04C-03 user-confirmed, receipt-absent conflict archives same UUID, then fresh revision can requeue',async()=>{
 const f=fixture();await f.race();
 assert.equal((await f.a.bridge.abandonConflict({batchId:A,operatorApproved:true,userConfirmed:false})).status,
  'BATCH_CONFLICT_USER_CONFIRMATION_REQUIRED');
 const before=f.calls.filter(x=>x[1]==='xb_primary_stocktake_batch_draft').length;
 const result=await f.a.bridge.abandonConflict({batchId:A,operatorApproved:true,userConfirmed:true});
 assert.equal(result.status,'BATCH_CONFLICT_ABANDONED');
 const op=await f.a.storage.get(f.a.identity,A);
 assert.equal(op.status,'abandoned');assert.equal(op.id,A);
 assert.equal(op.receipt,null);assert.deepEqual(op.payload.items,aItems());
 assert.equal(op.error,'conflict_abandoned');assert.ok(op.abandonedAt);
 assert.equal((await f.a.bridge.pending()).outstanding,0);
 assert.equal((await f.a.storage.list(f.a.identity)).length,0);
 assert.equal((await f.a.storage.list(f.a.identity,{includeAcked:true})).length,1);
 assert.equal(f.calls.filter(x=>x[1]==='xb_primary_stocktake_batch_draft').length,before);
 const retry=await f.a.bridge.queue({items:[
  {size:'NB',count:140,expectedRevision:2},{size:'S',count:185,expectedRevision:3}
 ],batchId:NEXT,operatorApproved:true});
 assert.equal(retry.status,'BATCH_DURABLY_QUEUED');
 assert.equal((await f.a.bridge.send({operatorApproved:true})).status,'BATCH_ATOMIC_COMMIT_ACKED');
 assert.equal(f.stock.NB,140);assert.equal(f.stock.S,185);
});
test('P4-04C-03 unknown, denied, committed receipts or stale/unverified stock must not be discarded',async()=>{
 for(const mode of ['network','denied','unverified']){
  const f=fixture();await f.race();f.setReceiptMode(mode);
  const r=await f.a.bridge.abandonConflict({batchId:A,operatorApproved:true,userConfirmed:true});
  assert.notEqual(r.status,'BATCH_CONFLICT_ABANDONED',mode);
  assert.equal((await f.a.bridge.pending()).outstanding,1);
 }
 const committed=fixture();await committed.race();
 committed.receipts.set(A,{result:{status:'APPLIED',changed_sizes:2,changes:[]}});
 assert.notEqual((await committed.a.bridge.abandonConflict({
  batchId:A,operatorApproved:true,userConfirmed:true})).status,'BATCH_CONFLICT_ABANDONED');
 const unreadable=fixture();await unreadable.race();unreadable.setReadMode('unverified');
 assert.notEqual((await unreadable.a.bridge.abandonConflict({
  batchId:A,operatorApproved:true,userConfirmed:true})).status,'BATCH_CONFLICT_ABANDONED');
});
test('P4-04C-03 batch archival is isolated from 009 and 026 and keeps document-only API unchanged',async()=>{
 const f=fixture(),store=f.a.storage,s=f.a.identity;
 for(const [id,type,payload] of [
  [A,'inventory.count',{childId:CHILD,kind:'stocktake_batch',items:aItems()}],
  [B,'inventory.count',{childId:CHILD,kind:'stocktake',size:'NB',count:70}],
  [NEXT,'reference.patch',{childId:CHILD,kind:'reference',nextBody:{}}]
 ]){
  const op=Contract.createOperation({id,type,familyId:F,actorUid:'A',
   payload,expectedRevision:0,createdAt:'2026-11-17T04:00:00Z'});
  await store.enqueue(op);await store.recordResult(s,id,{kind:'conflict'});
 }
 await assert.rejects(()=>store.abandonDocumentConflict(s,A),/not_uncommitted_document_conflict/);
 for(const id of [B,NEXT])
  await assert.rejects(()=>store.abandonStocktakeBatchConflict(s,id),/not_uncommitted_batch_conflict/);
 assert.equal((await store.stats(s)).outstanding,3);
});

test('P4-04C-03 only a hidden recovery button is added; 009/026 controls and old rc3 stay frozen',()=>{
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 const source=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 const actions=fs.readFileSync(path.join(__dirname,
  '../sync/primary-formal-ui-actions.js'),'utf8');
 const frozen=fs.readFileSync(path.join(__dirname,
  '../release-candidate/pages-v1.2.0-rc3/index.html'),'utf8');
 assert.match(html,/id="formalResolveBatchConflict"[^>]*hidden disabled/);
 assert.match(source,/on\('formalResolveBatchConflict'/);
 assert.match(source,/batchGuard\.abandonConflict\(/);
 assert.match(source,/userConfirmed:true/);
 assert.match(actions,/formalResolveBatchConflict/);
 assert.match(source,/on\('formalResolveDocumentConflict'/);
 assert.doesNotMatch(frozen,/id="formalResolveBatchConflict"/);
});
