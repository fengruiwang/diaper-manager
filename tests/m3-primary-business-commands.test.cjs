const test=require('node:test'),assert=require('node:assert/strict');
const Commands=require('../sync/primary-business-commands.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const UUID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const OLD='3984f752-5b02-4f81-bd15-5eb9e4b126b7';
const fresh={status:'PRIMARY_CLOUD_READ_VERIFIED',
 inventory:{NB:10,S:140,M:0,L:0,XL:0,XXL:0},
 revisions:{NB:1,S:2,M:1,L:1,XL:1,XXL:1}};
function fixture({enabled=false,selected=true,verified=true,queued=true}={}){
 const log=[];let created=0;
 const primary={
  cloudWritesEnabled:enabled,
  selectedScope:()=>selected?{familyId:F,childId:CHILD,actorUid:'dad'}:null,
  read:async()=>{log.push('read');return verified?fresh:{status:'PRIMARY_NOT_READY'}},
  queue:async(op,flags)=>{
   log.push({op,flags});
   return queued?{status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:op.id}
    :{status:'PRIMARY_QUEUE_UNVERIFIED'};
  }
 };
 const commands=Commands.create({primary,
  uuid:()=>{created++;return UUID},
  clock:()=> '2026-11-12T08:30:00.000Z'});
 return {commands,log,get ids(){return created}};
}
test('formal business writes disabled by default before any read, UUID generation or queue',async()=>{
 const f=fixture();
 const r=await f.commands.submit('purchase',{size:'S',brand:'好奇',
  series:'小森林',pieces:60,price:60},{operatorApproved:true});
 assert.equal(r.status,'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(f.log.length,0);assert.equal(f.ids,0);
});
test('original buy action uses P2 purchase payload, exact fen, one stable UUID',async()=>{
 const f=fixture({enabled:true});
 const r=await f.commands.submit('purchase',{size:'S',brand:'好奇',
  series:'小森林',pieces:60,price:129.95},{operatorApproved:true});
 assert.equal(r.status,'PRIMARY_OPERATION_DURABLY_QUEUED');
 assert.equal(r.cloudWriteCommitted,false);
 assert.equal(r.operationId,UUID);assert.equal(f.ids,1);
 const x=f.log[1].op;
 assert.equal(x.id,UUID);assert.equal(x.familyId,F);
 assert.equal(x.payload.childId,CHILD);assert.equal(x.payload.kind,'buy');
 assert.equal(x.payload.amount,60);assert.deepEqual(x.payload.purchase,{
  brand:'好奇',series:'小森林',totalFen:12995,purchaseDate:'2026-11-12'});
 assert.equal(f.log[1].flags.operatorApproved,true);
});
test('original consume action maps to use, not legacy transaction replay',async()=>{
 const f=fixture({enabled:true});
 await f.commands.submit('consume',{size:'NB',count:4},{operatorApproved:true});
 const op=f.log[1].op;
 assert.equal(op.type,'inventory.delta');
 assert.equal(op.payload.kind,'use');assert.equal(op.payload.amount,4);
 assert.equal('purchase' in op.payload,false);
});
test('original stock editor uses server revision and skips unchanged stock',async()=>{
 const f=fixture({enabled:true});
 assert.equal((await f.commands.submit('stocktake',{size:'S',count:140},
  {operatorApproved:true})).status,'PRIMARY_STOCK_UNCHANGED');
 assert.equal(f.ids,0);
 await f.commands.submit('stocktake',{size:'S',count:142},
  {operatorApproved:true});
 const op=f.log.at(-1).op;
 assert.equal(op.type,'inventory.count');
 assert.equal(op.expectedRevision,2);
 assert.equal(op.payload.count,142);
});
test('old migrated buy/use can never be reversed as new live operation',async()=>{
 const f=fixture({enabled:true});
 const r=await f.commands.submit('reverse',{size:'S',origin:'legacy_migration',
  reversesOperationId:OLD},{operatorApproved:true});
 assert.equal(r.status,'PRIMARY_OPERATION_REVIEW_REQUIRED');
 assert.equal(f.log.length,1);
 assert.equal(f.ids,0);
});
test('post-migration purchase is reversed via audited reverse operation UUID',async()=>{
 const f=fixture({enabled:true});
 const r=await f.commands.submit('reverse',{size:'S',origin:'cloud_post_migration',
  reversesOperationId:OLD},{operatorApproved:true});
 assert.equal(r.status,'PRIMARY_OPERATION_DURABLY_QUEUED');
 const op=f.log.at(-1).op;
 assert.equal(op.type,'transaction.reverse');
 assert.equal(op.payload.reversesOperationId,OLD);
 assert.equal(op.payload.childId,CHILD);
});
test('new browser action cannot write to a child not ready or a stale server view',async()=>{
 for(const changes of [{selected:false},{verified:false}]){
  const f=fixture({enabled:true,...changes});
  const r=await f.commands.submit('consume',{size:'S',count:2},
   {operatorApproved:true});
  assert.ok(['PRIMARY_NOT_SELECTED','PRIMARY_FRESH_STOCK_UNVERIFIED'].includes(r.status));
  assert.equal(f.ids,0);
 }
});
test('unknown ACK remains visibly uncertain and operation UUID is retained',async()=>{
 const f=fixture({enabled:true,queued:false});
 const r=await f.commands.submit('purchase',{size:'S',brand:'好奇',
  series:'小森林',pieces:5,price:6.20},{operatorApproved:true});
 assert.equal(r.status,'PRIMARY_QUEUE_UNVERIFIED_PRESERVE_ORIGINAL_ID');
 assert.equal(r.operationId,UUID);
 assert.equal(f.ids,1);
});
test('reject purchase with sub-cent totals and bad inventory sizes',async()=>{
 const f=fixture({enabled:true});
 assert.equal((await f.commands.submit('purchase',{size:'S',brand:'好奇',
  series:'小森林',pieces:10,price:0.001},{operatorApproved:true})).status,
  'PRIMARY_OPERATION_REVIEW_REQUIRED');
 assert.equal((await f.commands.submit('consume',{size:'INVALID',count:1},
  {operatorApproved:true})).status,'PRIMARY_OPERATION_REVIEW_REQUIRED');
 assert.equal(f.ids,0);
});
