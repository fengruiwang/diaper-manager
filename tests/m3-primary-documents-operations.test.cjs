const test=require('node:test'),assert=require('node:assert/strict');
const Ops=require('../sync/primary-documents-operations.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
function fixture({enabled=false,offline=false,ackLost=false,conflict=false}={}){
 const trace=[],records=new Map();
 const scope={familyId:F,actorUid:'A'};
 const outbox={
  async enqueue(op){trace.push('enqueue');records.set(op.id,{...op,status:'pending'});return {duplicate:false}},
  async ready(){return [...records.values()].filter(x=>x.status==='pending')},
  async stats(){const rows=[...records.values()];return {
   total:rows.length,outstanding:rows.filter(x=>x.status!=='acked').length,
   pending:rows.filter(x=>x.status==='pending').length,
   conflict:0,blocked:0,retry:0,acked:rows.filter(x=>x.status==='acked').length}},
  async recordResult(_scope,id,result){
   trace.push('recordResult:'+result.kind);
   records.get(id).status=result.kind==='accepted'?'acked':'conflict';
  },
  async get(_scope,id){return records.get(id)||null}
 };
 const client={
  read:async()=>{trace.push('read');return{
   status:'PRIMARY_DOCUMENT_READ_VERIFIED',revision:0,childId:C,
   body:{items:[]}}},
  put:async input=>{trace.push('put:'+input.requestId);
   if(conflict)return {status:'PRIMARY_DOCUMENT_VERSION_CONFLICT'};
   return ackLost?{status:'PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID'}:
    {status:'PRIMARY_DOCUMENT_COMMITTED'};
  },
  checkRequest:async input=>{trace.push('receipt:'+input.requestId);
   return {status:'REQUEST_COMMITTED_VERIFIED',kind:'quotes'}}
 };
 const bridge=Ops.create({
  controller:{verifiedContext:()=>scope},host:{indexedDB:{open(){}},
   navigator:{onLine:!offline}},
  documentsClient:client,
  outboxFactory:{create:c=>{trace.push('db:'+c.dbName);return outbox}},
  contract:{createOperation:op=>op},
  cloudWritesEnabled:enabled
 });
 return {bridge,trace,scope,records};
}
test('nonstock durable CAS queue never shares primary inventory IndexedDB and is disabled by default',async()=>{
 const f=fixture();
 assert.equal(f.trace[0],'db:xiaobao-primary-documents-v120');
 assert.notEqual(Ops.DB_NAME,'xiaobao-primary-sync-v120');
 const res=await f.bridge.queue({kind:'quotes',nextBody:{items:[]},
  expectedRevision:0,requestId:ID,operatorApproved:true});
 assert.equal(res.status,'DOCUMENT_WRITES_NOT_AUTHORIZED');
 assert.equal(f.records.size,0);
});
test('authorized queue persists request before explicit send and returns no cloud success',async()=>{
 const f=fixture({enabled:true});
 const q=await f.bridge.queue({kind:'quotes',nextBody:{items:[{id:'q1'}]},
  expectedRevision:0,requestId:ID,operatorApproved:true});
 assert.equal(q.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 assert.deepEqual(f.trace.slice(1),['read','enqueue']);
 assert.equal((await f.bridge.pending()).outstanding,1);
 const sent=await f.bridge.send({operatorApproved:true});
 assert.equal(sent.status,'DOCUMENT_SYNC_CONFIRMED');
 assert.equal((await f.bridge.pending()).outstanding,0);
 assert.ok(f.trace.includes('put:'+ID));
});
test('ACK lost checks original id, never creates second record or UUID',async()=>{
 const f=fixture({enabled:true,ackLost:true});
 await f.bridge.queue({kind:'quotes',nextBody:{items:[{id:'q1'}]},
  expectedRevision:0,requestId:ID,operatorApproved:true});
 const result=await f.bridge.send({operatorApproved:true});
 assert.equal(result.status,'DOCUMENT_SYNC_CONFIRMED');
 assert.ok(f.trace.includes('receipt:'+ID));
 assert.equal(f.records.size,1);
});
test('conflict leaves durable event visible for manual A/B conflict review',async()=>{
 const f=fixture({enabled:true,conflict:true});
 await f.bridge.queue({kind:'quotes',nextBody:{items:[]},
  expectedRevision:0,requestId:ID,operatorApproved:true});
 const r=await f.bridge.send({operatorApproved:true});
 assert.equal(r.status,'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 assert.equal(f.records.get(ID).status,'conflict');
});
test('offline cannot generate new unverified document edits or discard prior pending queue',async()=>{
 const f=fixture({enabled:true,offline:true});
 assert.equal((await f.bridge.queue({kind:'quotes',nextBody:{items:[]},
  expectedRevision:0,requestId:ID,operatorApproved:true})).status,
  'DOCUMENT_OFFLINE_REQUIRES_VERIFIED_BASELINE');
 assert.equal((await f.bridge.send({operatorApproved:true})).status,
  'DOCUMENT_OFFLINE_QUEUE_PRESERVED');
 assert.equal(f.records.size,0);
});
