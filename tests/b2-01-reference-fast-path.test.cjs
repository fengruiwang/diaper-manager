const test=require('node:test'),assert=require('node:assert/strict');
const Ops=require('../sync/primary-documents-operations.js');
const Cmd=require('../sync/primary-documents-business-commands.js');
const Client=require('../sync/primary-documents-client.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const KEY='好奇|小森林|S';
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture({mode='normal',duplicate=false,localFail=false}={}){
 const trace=[],records=new Map();
 let actorUid='A',ids=0;
 const scope=()=>({familyId:F,actorUid});
 const oldBody={referenceOverrides:{[KEY]:1.21},futureSchema:{
  nested:{keep:true},unknownArray:['keep']},unrelated:'preserve'};
 const currentBaseline=()=>({status:'PRIMARY_DOCUMENT_READ_VERIFIED',
  kind:'reference',familyId:F,actorUid,childId:C,revision:3,body:clone(oldBody)});
 const store={
  async get(sc,id){trace.push('idb.get');return records.get(id)||null;},
  async enqueue(op){trace.push('idb.enqueue');if(records.has(op.id))throw Error('duplicate');
   records.set(op.id,{...clone(op),status:'pending'});return {...op,duplicate:false};},
  async ready(sc){trace.push('idb.ready');return [...records.values()].filter(
   x=>x.status==='pending'&&x.actorUid===sc.actorUid);},
  async stats(sc){trace.push('idb.stats');
   const rows=[...records.values()].filter(x=>x.actorUid===sc.actorUid);
   return {outstanding:rows.filter(x=>x.status!=='acked').length,
    pending:rows.filter(x=>x.status==='pending').length,acked:rows.filter(x=>x.status==='acked').length};},
  async recordResult(sc,id,result){trace.push('idb.result:'+result.kind);
   if(localFail&&result.kind==='accepted')throw Error('idb.write_failed');
   const op=records.get(id);if(op.actorUid!==sc.actorUid)throw Error('wrong_actor');
   op.status=result.kind==='accepted'?'acked':'conflict';}
 };
 const docClient={
  async read(input){trace.push('doc.read');return currentBaseline();},
  async put(input){trace.push('rpc.put');if(mode==='conflict')return {status:'PRIMARY_DOCUMENT_VERSION_CONFLICT'};
   if(mode==='ackLost')return {status:'PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID'};
   return {status:'PRIMARY_DOCUMENT_COMMITTED',kind:'reference',
    requestId:mode==='wrongId'?'another-uuid':input.requestId,
    familyId:F,childId:C,revision:input.expectedRevision+1,duplicate};},
  async checkRequest(input){trace.push('rpc.receipt');
   return {status:'REQUEST_COMMITTED_VERIFIED',kind:'reference',revision:4,
    requestId:input.requestId};}
 };
 const ops=Ops.create({controller:{verifiedContext:scope},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:docClient,outboxFactory:{create:()=>store},
  contract:{createOperation:input=>clone(input)},cloudWritesEnabled:true,
  referenceAndQuotes:true,fastReferenceEnabled:true});
 const cmd=Cmd.create({client:docClient,queue:ops,uuid:()=>{ids++;return ID;}});
 const prepare=(action='set',verified=true)=>cmd.submit({familyId:F,actorUid,
  kind:'reference',action,expectedRevision:3,
  record:action==='reset'?{key:KEY}:{key:KEY,value:1.15},
  verifiedBaseline:verified?currentBaseline():null,operatorApproved:true});
 const send=()=>ops.send({operatorApproved:true,fastReferenceId:ID});
 return {trace,records,oldBody,ops,cmd,prepare,send,scope,
  setActor:a=>actorUid=a,get ids(){return ids;}};
}
test('B2 reference set: preserve unknown JSON, one new UUID, one PUT, no receipt/read/restore',async()=>{
 const f=fixture();
 const queued=await f.prepare();
 assert.equal(queued.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 assert.equal(f.ids,1);assert.equal(f.trace.filter(x=>x==='doc.read').length,0);
 const sent=await f.send();
 assert.equal(sent.status,'DOCUMENT_REFERENCE_ACK_CONFIRMED');
 assert.equal(sent.requestId,ID);assert.equal(sent.revision,4);
 assert.equal(sent.familyId,F);assert.equal(sent.childId,C);
 assert.equal(sent.nextBody.referenceOverrides[KEY],1.15);
 assert.deepEqual(sent.nextBody.futureSchema,f.oldBody.futureSchema);
 assert.equal(sent.nextBody.unrelated,'preserve');
 assert.equal(f.records.get(ID).status,'acked');
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,1);
 assert.equal(f.trace.filter(x=>x==='rpc.receipt').length,0);
 assert.equal(f.trace.filter(x=>x==='doc.read').length,0);
 assert.ok(f.trace.indexOf('idb.enqueue')<f.trace.indexOf('rpc.put'));
});
test('B2 reset default: one PUT and full body retains unknown metadata',async()=>{
 const f=fixture();
 await f.prepare('reset');
 const sent=await f.send();
 assert.equal(sent.status,'DOCUMENT_REFERENCE_ACK_CONFIRMED');
 assert.equal(Object.hasOwn(sent.nextBody.referenceOverrides,KEY),false);
 assert.deepEqual(sent.nextBody.futureSchema,f.oldBody.futureSchema);
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,1);
 assert.equal(f.trace.filter(x=>x==='rpc.receipt').length,0);
});
test('B2 missing cached reference baseline falls back to only one target read',async()=>{
 const f=fixture();
 assert.equal((await f.prepare('set',false)).status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 assert.equal(f.trace.filter(x=>x==='doc.read').length,1);
 assert.equal((await f.send()).status,'DOCUMENT_REFERENCE_ACK_CONFIRMED');
 assert.equal(f.trace.filter(x=>x==='doc.read').length,1);
});
test('B2 bad ACK ID cannot mark queue accepted or update UI',async()=>{
 const f=fixture({mode:'wrongId'});
 await f.prepare();
 const ack=await f.send();
 assert.equal(ack.status,'DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID');
 assert.equal(ack.requestId,ID);
 assert.equal(f.records.get(ID).status,'pending');
});
test('B2 duplicate server ACK is not used as the latest document body',async()=>{
 const f=fixture({duplicate:true});await f.prepare();
 const ack=await f.send();
 assert.equal(ack.status,'DOCUMENT_REFERENCE_ACK_RECOVERED_NEEDS_REFRESH');
 assert.equal(f.records.get(ID).status,'acked');
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,1);
});
test('B2 CAS conflict retains original event and does not claim success',async()=>{
 const f=fixture({mode:'conflict'});await f.prepare();
 const ack=await f.send();
 assert.equal(ack.status,'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 assert.equal(f.records.get(ID).status,'conflict');
});
test('B2 ACK lost checks original receipt, never invents a new UUID or direct success',async()=>{
 const f=fixture({mode:'ackLost'});await f.prepare();
 const ack=await f.send();
 assert.equal(ack.status,'DOCUMENT_REFERENCE_ACK_RECOVERED_NEEDS_REFRESH');
 assert.equal(f.ids,1);
 assert.equal(f.trace.filter(x=>x==='rpc.receipt').length,1);
});
test('B2 local ACK persistence failure holds original durable ID for recovery',async()=>{
 const f=fixture({localFail:true});await f.prepare();
 const ack=await f.send();
 assert.equal(ack.status,'DOCUMENT_REFERENCE_ACK_LOCAL_PENDING');
 assert.equal(ack.requestId,ID);
 assert.equal(f.records.get(ID).status,'pending');
});
test('B2 actor switch cannot send A fresh request in B scope',async()=>{
 const f=fixture();await f.prepare();
 f.setActor('B');
 const wrong=await f.send();
 assert.equal(wrong.status,'DOCUMENT_PENDING_REVIEW_REQUIRED');
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,0);
 f.setActor('A');
 assert.equal((await f.send()).status,'DOCUMENT_REFERENCE_ACK_CONFIRMED');
});
test('B2 actual CloudBase client reference fastScope skips SELECT but still validates ACK echo',async()=>{
 let preflight=0,discovery=0;
 const db={rpc:async(name,args)=>({data:{saved:true,kind:'reference',
  request_id:args.p_request_id,family_id:F,child_id:C,revision:4,
  duplicate:false}})};
 const client=Client.create({app:{auth:{getSession:async()=>({})},rdb:()=>db},
  accessPreflight:{create:()=>({verifyAccess:async()=>{
   preflight++;return {member:true,appCode:'xb',familyId:F,actorUid:'A'};}})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>{
   discovery++;return {familyId:F,childId:C,readyForMigration:false};}})},
  scopeGuard:{requireLegacyMigrationTarget(){}},cloudWritesEnabled:true});
 client.acceptVerifiedPrimary({status:'PRIMARY_READ_ONLY_READY',canWrite:false,
  source:'cloudbase-primary-receipt-verified',familyId:F,actorUid:'A',childId:C});
 const result=await client.put({familyId:F,actorUid:'A',kind:'reference',
  requestId:ID,operatorApproved:true,expectedRevision:3,fastReference:true,
  nextBody:{referenceOverrides:{[KEY]:1.15}}});
 assert.equal(result.status,'PRIMARY_DOCUMENT_COMMITTED');
 assert.equal(result.familyId,F);assert.equal(result.childId,C);
 assert.equal(result.requestId,ID);assert.equal(result.revision,4);
 assert.equal(preflight,0);assert.equal(discovery,0);
});
