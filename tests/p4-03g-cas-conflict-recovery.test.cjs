const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Contract=require('../sync/outbox-contract.js');
const Durable=require('../sync/idb-outbox.js');
const Ops=require('../sync/primary-documents-operations.js');
const Business=require('../sync/primary-documents-business-commands.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const IDS=['04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',
 '79192488-bd70-4b88-8c66-3c5b5fb29ef5',
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6'];
const scopeA={familyId:F,actorUid:'A'},scopeB={familyId:F,actorUid:'B'};
const clone=x=>JSON.parse(JSON.stringify(x));
const source=fs.readFileSync(path.join(__dirname,'idb-outbox.test.cjs'),'utf8');
const begin=source.indexOf('function fakeIndexedDB(){'),end=source.indexOf('function make(',begin);
assert.ok(begin>=0&&end>begin);
const fakeIndexedDB=new Function('clone','queueMicrotask','setTimeout',
 source.slice(begin,end)+'\nreturn fakeIndexedDB;')(clone,queueMicrotask,setTimeout);
function fixture(){
 const indexedDB=fakeIndexedDB();
 const storage=Durable.create({indexedDB,contract:Contract,
  dbName:'p4-03g-documents-real-idb'});
 const docs={
  reference:{revision:0,body:{referenceOverrides:{}}},
  settings:{revision:0,body:{target:{NB:90},daily:{NB:8}}},
  quotes:{revision:0,body:{items:[]}},
  growth:{revision:0,body:{items:[]}},
  profile:{revision:0,body:{babyProfile:{name:'宝宝'}}}
 };
 const receipts=new Map(),calls=[];
 let checkMode='normal',readMode='normal',putMode='normal';
 const client={
  async read({kind,familyId}){
   if(readMode!=='normal')return {status:'PRIMARY_DOCUMENT_READ_UNVERIFIED'};
   if(familyId!==F)throw Error('scope mismatch');
   const d=docs[kind];
   return {status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind,
    familyId:F,childId:CHILD,revision:d.revision,body:clone(d.body)};
  },
  async checkRequest({requestId}){
   calls.push(['receipt',requestId]);
   if(checkMode==='timeout')throw Error('network timeout');
   if(checkMode==='denied')return {status:'PRIMARY_DOCUMENT_REQUEST_FORBIDDEN'};
   if(checkMode==='ambiguous')return {status:'REQUEST_READ_UNVERIFIED'};
   const receipt=receipts.get(requestId);
   return receipt?{status:'REQUEST_COMMITTED_VERIFIED',
    kind:receipt.kind,revision:receipt.revision}:
    {status:'REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY'};
  },
  async put(input){
   calls.push(['put',input.kind,input.requestId,input.expectedRevision]);
   if(putMode!=='normal')return {status:'PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID'};
   const d=docs[input.kind];
   if(d.revision!==input.expectedRevision)
    return {status:'PRIMARY_DOCUMENT_VERSION_CONFLICT'};
   d.body=clone(input.nextBody);d.revision++;
   receipts.set(input.requestId,{kind:input.kind,revision:d.revision});
   return {status:'PRIMARY_DOCUMENT_COMMITTED'};
  }
 };
 function queue(actorUid){
  return Ops.create({controller:{verifiedContext:()=>({familyId:F,actorUid})},
   host:{indexedDB,navigator:{onLine:true}},documentsClient:client,
   outboxFactory:{create:()=>storage},contract:Contract,
   cloudWritesEnabled:true,referenceAndQuotes:true,
   allowGrowth:true,allowProfile:true,allowSettings:true});
 }
 const a=queue('A'),b=queue('B');
 const commands=Business.create({client,queue:a,uuid:()=>IDS[2]});
 async function createConflict(){
  const aQueued=await a.queue({kind:'reference',nextBody:{
   referenceOverrides:{'好奇|小森林|NB':1.21}},expectedRevision:0,
   requestId:IDS[0],operatorApproved:true});
  assert.equal(aQueued.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
  const bQueued=await b.queue({kind:'reference',nextBody:{
   referenceOverrides:{'好奇|小森林|NB':1.22}},expectedRevision:0,
   requestId:IDS[1],operatorApproved:true});
  assert.equal(bQueued.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
  assert.equal((await b.send({operatorApproved:true})).status,'DOCUMENT_SYNC_CONFIRMED');
  assert.equal((await a.send({operatorApproved:true})).status,
   'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 }
 return {a,b,storage,commands,docs,receipts,calls,
  createConflict,scopeA,scopeB,
  setCheckMode:x=>checkMode=x,setReadMode:x=>readMode=x,
  setPutMode:x=>putMode=x};
}
test('P4-03G A/B race: explicit CAS conflict never overwrites B or fakes an ACK',async()=>{
 const f=fixture();await f.createConflict();
 assert.equal(f.docs.reference.revision,1);
 assert.equal(f.docs.reference.body.referenceOverrides['好奇|小森林|NB'],1.22);
 const op=await f.storage.get(scopeA,IDS[0]);
 assert.equal(op.status,'conflict');assert.equal(op.receipt,null);
 assert.equal((await f.storage.stats(scopeA)).outstanding,1);
 assert.equal((await f.a.send({operatorApproved:true})).status,
  'DOCUMENT_CONFLICT_REVIEW_REQUIRED');
});
test('P4-03G before explicit consent, definite conflict cannot leave outstanding queue',async()=>{
 const f=fixture();await f.createConflict();
 const r=await f.a.abandonConflict({requestId:IDS[0],operatorApproved:true,
  userConfirmed:false});
 assert.equal(r.status,'DOCUMENT_CONFLICT_USER_CONFIRMATION_REQUIRED');
 assert.equal((await f.storage.stats(scopeA)).outstanding,1);
});
test('P4-03G confirmed uncommitted conflict becomes archived terminal, never ACKed',async()=>{
 const f=fixture();await f.createConflict();
 const r=await f.a.abandonConflict({requestId:IDS[0],
  userConfirmed:true,operatorApproved:true});
 assert.equal(r.status,'DOCUMENT_CONFLICT_ABANDONED');
 assert.equal(r.kind,'reference');assert.equal(r.requestId,IDS[0]);
 const op=await f.storage.get(scopeA,IDS[0]);
 assert.equal(op.status,'abandoned');assert.equal(op.id,IDS[0]);
 assert.equal(op.receipt,null);assert.equal(op.expectedRevision,0);
 assert.equal(op.error,'conflict_abandoned');
 assert.ok(op.abandonedAt);
 assert.equal((await f.storage.stats(scopeA)).outstanding,0);
 assert.equal((await f.storage.stats(scopeA)).abandoned,1);
 assert.equal((await f.storage.ready(scopeA)).length,0);
 assert.deepEqual((await f.storage.list(scopeA)).map(x=>x.id),[]);
 assert.equal((await f.storage.list(scopeA,{includeAcked:true})).length,1);
});
test('P4-03G later fresh revision can save a different shared document',async()=>{
 const f=fixture();await f.createConflict();
 assert.equal((await f.commands.submit({familyId:F,actorUid:'A',
  kind:'settings',action:'patch',record:{currentSize:'S'},
  expectedRevision:0,operatorApproved:true})).status,
  'DOCUMENT_PENDING_REVIEW_REQUIRED');
 assert.equal((await f.a.abandonConflict({requestId:IDS[0],
  userConfirmed:true,operatorApproved:true})).status,'DOCUMENT_CONFLICT_ABANDONED');
 const fresh=await f.commands.submit({familyId:F,actorUid:'A',
  kind:'settings',action:'patch',record:{currentSize:'S'},
  expectedRevision:0,operatorApproved:true});
 assert.equal(fresh.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 assert.equal((await f.a.send({operatorApproved:true})).status,
  'DOCUMENT_SYNC_CONFIRMED');
 assert.equal(f.docs.settings.body.currentSize,'S');
 assert.equal(f.docs.reference.body.referenceOverrides['好奇|小森林|NB'],1.22);
});
test('P4-03G unknown ACK, timeout, denied, or committed receipt cannot be abandoned',async()=>{
 for(const mode of ['ambiguous','timeout','denied']){
  const f=fixture();await f.createConflict();f.setCheckMode(mode);
  const r=await f.a.abandonConflict({requestId:IDS[0],
   userConfirmed:true,operatorApproved:true});
  assert.notEqual(r.status,'DOCUMENT_CONFLICT_ABANDONED',mode);
  assert.equal((await f.storage.get(scopeA,IDS[0])).status,'conflict');
 }
 const f=fixture();await f.createConflict();
 f.receipts.set(IDS[0],{kind:'reference',revision:2});
 assert.notEqual((await f.a.abandonConflict({requestId:IDS[0],
  userConfirmed:true,operatorApproved:true})).status,'DOCUMENT_CONFLICT_ABANDONED');
 assert.equal((await f.storage.stats(scopeA)).outstanding,1);
});
test('P4-03G unverified or unchanged cloud revision blocks abandonment',async()=>{
 const f=fixture();await f.createConflict();
 f.setReadMode('denied');
 assert.notEqual((await f.a.abandonConflict({requestId:IDS[0],
  userConfirmed:true,operatorApproved:true})).status,'DOCUMENT_CONFLICT_ABANDONED');
 assert.equal((await f.storage.stats(scopeA)).outstanding,1);
});
test('P4-03G conflicting UUID is scoped: B cannot abandon A, and accepted cannot abandon',async()=>{
 const f=fixture();await f.createConflict();
 assert.notEqual((await f.b.abandonConflict({requestId:IDS[0],
  userConfirmed:true,operatorApproved:true})).status,'DOCUMENT_CONFLICT_ABANDONED');
 assert.equal((await f.storage.get(scopeA,IDS[0])).status,'conflict');
 assert.notEqual((await f.a.abandonConflict({requestId:IDS[1],
  userConfirmed:true,operatorApproved:true})).status,'DOCUMENT_CONFLICT_ABANDONED');
});
test('P4-03G original conflict survives simulated app reload and resolution is not a write',async()=>{
 const f=fixture();await f.createConflict();
 const before=f.calls.filter(x=>x[0]==='put').length;
 const reopen=await f.a.conflicts();
 assert.equal(reopen.status,'DOCUMENT_CONFLICTS_VERIFIED');
 assert.equal(reopen.items[0].requestId,IDS[0]);
 assert.equal((await f.a.abandonConflict({requestId:IDS[0],
  userConfirmed:true,operatorApproved:true})).status,'DOCUMENT_CONFLICT_ABANDONED');
 assert.equal(f.calls.filter(x=>x[0]==='put').length,before);
 await assert.rejects(()=>f.storage.recordResult(scopeA,IDS[0],{
  kind:'accepted',receiptId:IDS[0]}),/abandoned_operation_immutable/);
});
test('P4-03G inventory conflict states and inventory outbox stay unchanged',async()=>{
 const f=fixture(),id=IDS[2];
 await f.storage.enqueue(Contract.createOperation({
  id,type:'inventory.delta',familyId:F,actorUid:'A',
  payload:{kind:'buy',size:'NB',amount:60},
  createdAt:'2026-11-16T08:00:00Z'}));
 await f.storage.recordResult(scopeA,id,{kind:'conflict'});
 await assert.rejects(()=>f.storage.abandonDocumentConflict(scopeA,id),
  /not_uncommitted_document_conflict/);
 assert.equal((await f.storage.get(scopeA,id)).status,'conflict');
 assert.equal((await f.storage.stats(scopeA)).outstanding,1);
});
test('P4-03G formal source keeps both write flags off and other domain interfaces',()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const text=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(text,/formalResolveDocumentConflict/);
 assert.match(text,/releaseAbandonedDocumentConflict/);
 assert.match(text,/recoverReferenceButton/);
 assert.match(text,/recoverDocumentButtons/);
});
