const test=require('node:test'),assert=require('node:assert/strict');
const Operations=require('../sync/primary-documents-operations.js');
const Commands=require('../sync/primary-documents-business-commands.js');
const Client=require('../sync/primary-documents-client.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const UUID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const clone=x=>JSON.parse(JSON.stringify(x));
const oldQuote={id:'quote-1',brand:'好奇',series:'小森林',size:'S',price:80,per:60,packs:1,
 pieces:60,unit:1.333,legacy:{coupon:true,unknown:'keep'}};
const nextQuote={id:'quote-2',brand:'Babycare',series:'山茶花',size:'M',price:95,per:80,packs:1,pieces:80,unit:1.1875};
function fixture({mode='normal',duplicate=false,localFail=false,fast=true}={}){
 let actor='A',ids=0,readCount=0;const trace=[],rows=new Map();
 const body={items:[clone(oldQuote)],unknownTop:{extra:['retain']}};
 const scope=()=>({familyId:F,actorUid:actor});
 const baseline=()=>({status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind:'quotes',
  familyId:F,actorUid:actor,childId:C,revision:7,body:clone(body)});
 const store={
  async get(_scope,id){return rows.get(id)||null;},
  async enqueue(op){trace.push('idb.enqueue');rows.set(op.id,{...clone(op),status:'pending'});return {duplicate:false};},
  async ready(x){return [...rows.values()].filter(o=>o.actorUid===x.actorUid&&o.status==='pending');},
  async stats(x){const list=[...rows.values()].filter(o=>o.actorUid===x.actorUid);
   return {outstanding:list.filter(o=>o.status!=='acked').length};},
  async recordResult(_scope,id,res){trace.push('idb.result');
   if(localFail&&res.kind==='accepted')throw Error('idb-write');
   rows.get(id).status=res.kind==='accepted'?'acked':'conflict';}
 };
 const doc={
  async read(){trace.push('rpc.read');readCount++;return baseline();},
  async put(x){trace.push('rpc.put');
   if(mode==='conflict')return {status:'PRIMARY_DOCUMENT_VERSION_CONFLICT'};
   if(mode==='lost')return {status:'PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID'};
   if(mode==='denied')return {status:'PRIMARY_DOCUMENT_QUOTES_PERMISSION_DENIED'};
   return {status:'PRIMARY_DOCUMENT_COMMITTED',kind:x.kind,
    familyId:F,childId:C,requestId:x.requestId,revision:x.expectedRevision+1,duplicate};},
  async checkRequest(){trace.push('rpc.receipt');
   return {status:'REQUEST_COMMITTED_VERIFIED',kind:'quotes',revision:8};}
 };
 const ops=Operations.create({controller:{verifiedContext:scope},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:doc,outboxFactory:{create:()=>store},
  contract:{createOperation:op=>clone(op)},cloudWritesEnabled:true,
  referenceAndQuotes:true,fastReferenceEnabled:true,fastQuotesEnabled:fast});
 const commands=Commands.create({client:doc,queue:ops,uuid:()=>{ids++;return UUID;}});
 const perform=async(action,record,baselinePresent=true)=>{
  const queued=await commands.submit({...scope(),kind:'quotes',action,record,
   verifiedBaseline:baselinePresent?baseline():null,
   expectedRevision:7,operatorApproved:true});
  return queued;
 };
 const send=()=>ops.send({operatorApproved:true,fastDocumentId:UUID});
 return {perform,send,rows,trace,body,baseline,ops,scope,setActor:x=>{actor=x;},
  get ids(){return ids;},get readCount(){return readCount;}};
}
const assertFast=(f,a)=>{
 assert.equal(a.status,'DOCUMENT_QUOTES_ACK_CONFIRMED');
 assert.equal(a.requestId,UUID);assert.equal(a.kind,'quotes');
 assert.equal(a.familyId,F);assert.equal(a.actorUid,'A');assert.equal(a.childId,C);
 assert.equal(a.revision,8);assert.equal(a.expectedRevision,7);
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,1);
 assert.equal(f.trace.filter(x=>x==='rpc.read').length,0);
 assert.equal(f.trace.filter(x=>x==='rpc.receipt').length,0);
 assert.ok(f.trace.indexOf('idb.enqueue')<f.trace.indexOf('rpc.put'));
 assert.equal(f.rows.get(UUID).status,'acked');
 assert.deepEqual(a.nextBody.unknownTop,{extra:['retain']});
};
test('B2-02 add quotes: exactly one PUT, record ID and request UUID each unique',async()=>{
 const f=fixture();assert.equal((await f.perform('add',nextQuote)).status,
  'DOCUMENT_OPERATION_DURABLY_QUEUED');
 const answer=await f.send();assertFast(f,answer);
 assert.equal(f.ids,1);assert.equal(answer.nextBody.items.length,2);
 assert.equal(answer.nextBody.items[1].id,'quote-2');
});
test('B2-02 edit: preserve original per-record legacy and top-level unknowns',async()=>{
 const f=fixture();await f.perform('edit',{id:'quote-1',price:65});
 const answer=await f.send();assertFast(f,answer);
 assert.equal(answer.nextBody.items[0].price,65);
 assert.deepEqual(answer.nextBody.items[0].legacy,oldQuote.legacy);
 assert.equal(f.body.items[0].price,80);
});
test('B2-02 delete: removes only selected quote',async()=>{
 const f=fixture();await f.perform('delete',{id:'quote-1'});
 const a=await f.send();assertFast(f,a);assert.deepEqual(a.nextBody.items,[]);
});
test('B2-02 clear: clears only items, preserves schema extension',async()=>{
 const f=fixture();await f.perform('clear',null);
 const a=await f.send();assertFast(f,a);assert.deepEqual(a.nextBody.items,[]);
});
test('B2-02 missing complete baseline reads quotes only once before PUT',async()=>{
 const f=fixture();await f.perform('add',nextQuote,false);
 assert.equal(f.readCount,1);
 assert.equal((await f.send()).status,'DOCUMENT_QUOTES_ACK_CONFIRMED');
 assert.equal(f.readCount,1);
});
test('B2-02 ACK lost uses original UUID receipt and does not show direct-success ACK',async()=>{
 const f=fixture({mode:'lost'});await f.perform('add',nextQuote);
 const a=await f.send();assert.equal(a.status,'DOCUMENT_QUOTES_ACK_RECOVERED_NEEDS_REFRESH');
 assert.equal(f.ids,1);assert.equal(f.trace.filter(x=>x==='rpc.receipt').length,1);
});
test('B2-02 duplicate ACK cannot roll back a newer quotes revision',async()=>{
 const f=fixture({duplicate:true});await f.perform('add',nextQuote);
 const a=await f.send();assert.equal(a.status,'DOCUMENT_QUOTES_ACK_RECOVERED_NEEDS_REFRESH');
 assert.equal(f.rows.get(UUID).status,'acked');
});
test('B2-02 CAS conflict and local-ACK error never signal quote success',async()=>{
 for(const opts of [{mode:'conflict'},{localFail:true},{mode:'denied'}]){
  const f=fixture(opts);await f.perform('add',nextQuote);
  const a=await f.send();
  const expected=opts.mode==='conflict'?'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW'
   :opts.mode==='denied'?'DOCUMENT_QUOTES_PERMISSION_DENIED_KEEP_ID'
   :'DOCUMENT_QUOTES_ACK_LOCAL_PENDING';
  assert.equal(a.status,expected);
  assert.equal(f.rows.get(UUID).status,opts.mode==='conflict'?'conflict':'pending');
 }
});
test('B2-02 account change blocks original A queued operation under B',async()=>{
 const f=fixture();await f.perform('add',nextQuote);f.setActor('B');
 assert.equal((await f.send()).status,'DOCUMENT_PENDING_REVIEW_REQUIRED');
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,0);
 f.setActor('A');assert.equal((await f.send()).status,'DOCUMENT_QUOTES_ACK_CONFIRMED');
});
test('B2-02 strict opt-in preserves legacy quotes receipt workflow',async()=>{
 const f=fixture({fast:false});await f.perform('add',nextQuote);
 assert.equal((await f.send()).status,'DOCUMENT_SYNC_CONFIRMED');
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,1);
 assert.equal(f.trace.filter(x=>x==='rpc.receipt').length,2);
});
test('B2-02 read-only verified primary scope permits fast quotes PUT without extra client SELECT',async()=>{
 let selects=0;
 const c=Client.create({app:{auth:{getSession:async()=>({})},rdb:()=>({
  rpc:async(name,args)=>({data:{saved:true,kind:'quotes',family_id:F,child_id:C,
   request_id:args.p_request_id,revision:8,duplicate:false}})
 })},
 accessPreflight:{create:()=>({verifyAccess:async()=>{selects++;throw Error('no-preflight');}})},
 childReader:{create:()=>({inspectLegacyTarget:async()=>{selects++;throw Error('no-child');}})},
 scopeGuard:{requireLegacyMigrationTarget(){}},cloudWritesEnabled:true});
 c.acceptVerifiedPrimary({status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,
  familyId:F,childId:C,actorUid:'A'});
 const a=await c.put({familyId:F,actorUid:'A',kind:'quotes',
  nextBody:{items:[]},expectedRevision:7,requestId:UUID,
  operatorApproved:true,fastReference:true});
 assert.equal(a.status,'PRIMARY_DOCUMENT_COMMITTED');
 assert.equal(a.kind,'quotes');assert.equal(a.revision,8);assert.equal(selects,0);
});
