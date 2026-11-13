const test=require('node:test'),assert=require('node:assert/strict');
const Client=require('../sync/primary-documents-client.js');
const Ops=require('../sync/primary-documents-operations.js');
const Commands=require('../sync/primary-documents-business-commands.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID1='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const ID2='79192488-bd70-4b88-8c66-3c5b5fb29ef5';
const KEY='好奇|小森林|NB';
const OTHER='Babycare|皇室Pro|S';
function fixture({enabled=true,loseAck=false,hideReceipt=0}={}){
 const doc={referenceOverrides:{[OTHER]:1.23}};
 let revision=0,uuidCalls=0,putCalls=0,readCalls=0;
 const receipts=new Map(),queued=new Map(),calls=[];
 const original={
  inventory:{NB:100,S:200},transactions:[{type:'buy',pieces:30}],
  legacyMigration:[{kind:'transaction',id:'original'}]
 };
 const originalJson=JSON.stringify(original);
 function app(actor){
  return {auth:{getSession:async()=>({data:{user:{id:actor}}})},
   rdb:()=>({rpc:async(name,args)=>{
    calls.push({name,args,actor});
    assert.equal(args.p_family_id,F);assert.equal(args.p_child_id,C);
    if(name==='xb_read_primary_document_draft'){
     readCalls++;
     assert.equal(args.p_kind,'reference');
     return {data:{complete:true,kind:'reference',
      family_id:F,child_id:C,revision,body:JSON.parse(JSON.stringify(doc)),
      can_upload:false}};
    }
    if(name==='xb_check_primary_document_request_draft'){
     const receipt=receipts.get(args.p_request_id);
     if(receipt&&hideReceipt-->0)return {data:{
      status:'NO_RECEIPT',family_id:F,child_id:C,
      request_id:args.p_request_id}};
     return {data:receipt?{status:'COMMITTED',family_id:F,child_id:C,
      request_id:args.p_request_id,kind:'reference',
      resulting_revision:receipt.revision}:
      {status:'NO_RECEIPT',family_id:F,child_id:C,
       request_id:args.p_request_id}};
    }
    assert.equal(name,'xb_put_primary_document_draft');
    assert.equal(args.p_kind,'reference');
    putCalls++;
    const previous=receipts.get(args.p_request_id);
    if(previous)return {data:{saved:true,duplicate:true,
     request_id:args.p_request_id,kind:'reference',family_id:F,
     child_id:C,revision:previous.revision}};
    if(args.p_expected_revision!==revision)
     return {error:{code:'40001'}};
    const next=args.p_next_body;
    assert.equal(typeof next.referenceOverrides,'object');
    // Full JSON document CAS: only the targeted override may change.
    for(const value of Object.values(next.referenceOverrides))
     assert.ok(value>0&&value<=100);
    for(const key of Object.keys(doc))delete doc[key];
    Object.assign(doc,JSON.parse(JSON.stringify(next)));
    revision++;
    receipts.set(args.p_request_id,{revision});
    if(loseAck){loseAck=false;throw Error('ACK lost after server commit');}
    return {data:{saved:true,duplicate:false,
     request_id:args.p_request_id,kind:'reference',family_id:F,
     child_id:C,revision}};
   }})};
 }
 function client(actor){
  return Client.create({app:app(actor),
   accessPreflight:{create:()=>({verifyAccess:async()=>({
    familyId:F,actorUid:actor,member:true,appCode:'xb'})})},
   childReader:{create:()=>({inspectLegacyTarget:async()=>({
    familyId:F,childId:C,readyForMigration:false})})},
   scopeGuard:{requireLegacyMigrationTarget(){}},
   cloudWritesEnabled:enabled});
 }
 const scope={familyId:F,actorUid:'dad'};
 let shown={kind:'reference',revision:0,
  body:JSON.parse(JSON.stringify(doc))};
 const outbox={
  async enqueue(op){assert.equal(op.type,'reference.patch');
   if(queued.has(op.id))throw Error('duplicate UUID');
   queued.set(op.id,{...op});return{duplicate:false};},
  async ready(){return [...queued.values()].filter(op=>op.status==='pending'||op.status==='retry');},
  async stats(){
   const rows=[...queued.values()];
   return {total:rows.length,outstanding:rows.filter(op=>op.status!=='acked').length,
    pending:rows.filter(op=>op.status==='pending').length,
    conflict:rows.filter(op=>op.status==='conflict').length,acked:rows.filter(op=>op.status==='acked').length,
    retry:0,blocked:0};
  },
  async get(_s,id){return queued.get(id)||null;},
  async recordResult(_s,id,answer){
   const op=queued.get(id);assert.ok(op);
   op.status=answer.kind==='accepted'?'acked':'conflict';
  }
 };
 const documentClient=client('dad');
 const createOps=()=>Ops.create({
  controller:{verifiedContext:()=>scope},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:documentClient,
  outboxFactory:{create:()=>outbox},
  contract:require('../sync/outbox-contract.js'),
  cloudWritesEnabled:enabled,referenceOnly:true
 });
 const queue=createOps();
 const domain=Commands.create({client:documentClient,queue,
  uuid:()=>{uuidCalls++;return [ID1,ID2][uuidCalls-1]||'unexpected';}});
 const events=[];
 const ui=Actions.create({
  commands:{submit:async()=>{throw Error('stock RPC must not run')}},
  primary:{read:async()=>{throw Error('inventory must not be read')}},
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  formalModeSelected:()=>true,notify:x=>events.push(x),
  buildAllowsWrites:enabled,operatorApproved:()=>enabled,
  purchaseOnly:true,allowReference:true,
  documentCommands:domain,documentQueue:queue,
  readReferenceBaseline:()=>shown,
  readDocumentInput:el=>el.id==='restoreDefaultReference'
   ||el.dataset?.action==='resetref'
   ?{kind:'reference',action:'reset',record:{key:KEY}}
   :{kind:'reference',action:'set',record:{key:KEY,value:1.125}},
  onReferenceReadback:async({requestId,record,action,expectedRevision})=>{
   const receipt=await queue.checkSavedRequest(requestId);
   if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
   const fresh=await documentClient.read({
    familyId:F,actorUid:'dad',kind:'reference',readEnabled:true});
   assert.equal(fresh.status,'PRIMARY_DOCUMENT_READ_VERIFIED');
   if(fresh.revision<=expectedRevision)return 'pending';
   if(action==='set'&&fresh.body.referenceOverrides[record.key]!==record.value)
    return 'pending';
   if(action==='reset'&&Object.hasOwn(fresh.body.referenceOverrides,record.key))
    return 'pending';
   shown=fresh;return 'ready';
  }
 });
 const invoke=(id='saveEditedReference',action='')=>ui.handle({
  id,dataset:{action}},{getElementById:()=>null});
 const readAs=actor=>client(actor).read({
  familyId:F,actorUid:actor,kind:'reference',readEnabled:true});
 return {invoke,readAs,client,queue,createOps,domain,doc,queued,calls,
  receipts,events,original,originalJson,
  get revision(){return revision;},
  get putCalls(){return putCalls;},
  get readCalls(){return readCalls;},
  get shown(){return shown;},
  get uuidCalls(){return uuidCalls;},
  externalEdit(key,value){
   doc.referenceOverrides[key]=value;revision++;
  }
 };
}
test('P3-01 original editor set -> durable request UUID -> 026 CAS -> receipt -> authoritative two-account read',async()=>{
 const f=fixture();
 const direct=await f.readAs('dad');
 assert.equal(direct.status,'PRIMARY_DOCUMENT_READ_VERIFIED',JSON.stringify({direct,calls:f.calls}));
 const r=await f.invoke();
 assert.equal(r.status,'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.equal(r.requestId,ID1);assert.equal(f.uuidCalls,1);
 assert.equal(f.queued.size,1);assert.equal(f.queued.get(ID1).status,'acked');
 assert.equal(f.queued.get(ID1).expectedRevision,0);
 assert.equal(f.queued.get(ID1).type,'reference.patch');
 assert.equal(f.putCalls,1);assert.equal(f.receipts.size,1);
 const a=await f.readAs('dad'),b=await f.readAs('mom');
 assert.deepEqual(a.body,b.body);assert.equal(a.revision,b.revision);
 assert.equal(a.body.referenceOverrides[KEY],1.125);
 assert.equal(a.body.referenceOverrides[OTHER],1.23);
 assert.equal(f.shown.body.referenceOverrides[KEY],1.125);
 assert.equal(JSON.stringify(f.original),f.originalJson);
 assert.equal(f.calls.filter(c=>c.name==='xb_apply_inventory_operation').length,0);
});
test('P3-01 reset default deletes only target override and preserves other price entries',async()=>{
 const f=fixture();
 assert.equal((await f.invoke()).status,'REFERENCE_CLOUD_READBACK_VERIFIED');
 const r=await f.invoke('restoreDefaultReference');
 assert.equal(r.status,'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.equal(r.requestId,ID2);
 assert.equal(f.doc.referenceOverrides[KEY],undefined);
 assert.equal(Object.hasOwn(f.doc.referenceOverrides,KEY),false);
 assert.equal(f.doc.referenceOverrides[OTHER],1.23);
 assert.equal((await f.readAs('mom')).revision,2);
 assert.equal(f.queued.size,2);assert.equal(f.putCalls,2);
});
test('P3-01 stale rendered reference revision cannot overwrite spouse edit or allocate UUID',async()=>{
 const f=fixture();
 f.externalEdit(KEY,1.09);
 const r=await f.invoke();
 assert.equal(r.status,'DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED');
 assert.equal(f.doc.referenceOverrides[KEY],1.09);
 assert.equal(f.uuidCalls,0);assert.equal(f.queued.size,0);assert.equal(f.putCalls,0);
});
test('P3-01 CAS version conflict between durable enqueue and send preserves ID and latest value',async()=>{
 const f=fixture();
 const q=await f.domain.submit({familyId:F,actorUid:'dad',
  kind:'reference',action:'set',record:{key:KEY,value:1.125},
  expectedRevision:0,operatorApproved:true});
 assert.equal(q.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 f.externalEdit(KEY,1.09);
 const r=await f.queue.send({operatorApproved:true});
 assert.equal(r.status,'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 assert.equal(r.requestId,ID1);assert.equal(f.doc.referenceOverrides[KEY],1.09);
 assert.equal(f.queued.get(ID1).status,'conflict');
 assert.equal(f.queued.size,1);assert.equal(f.putCalls,1);
});
test('P3-01 HTTP ACK loss recovers only original request ID with no second CAS',async()=>{
 const f=fixture({loseAck:true});
 const r=await f.invoke();
 assert.equal(r.status,'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.putCalls,1);assert.equal(f.queued.size,1);
 assert.equal(f.receipts.size,1);assert.equal(f.queued.get(ID1).status,'acked');
});
test('P3-01 receipt uncertainty retains queued UUID across queue recreation; receipt-first retry',async()=>{
 const f=fixture({hideReceipt:1});
 const r=await f.invoke();
 assert.equal(r.requestId,ID1);
 assert.equal(r.status,'DOCUMENT_RECEIPT_READBACK_REQUIRED_KEEP_ID');
 assert.equal(f.queued.get(ID1).status,'pending');
 const next=f.createOps();
 const recovered=await next.send({operatorApproved:true});
 assert.equal(recovered.status,'DOCUMENT_SYNC_CONFIRMED');
 assert.equal(f.queued.get(ID1).status,'acked');
 assert.equal(f.queued.size,1);assert.equal(f.putCalls,1);
});
test('P3-01 other four document writes and formally disabled writes stay closed',async()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const f=fixture();
 for(const kind of ['quotes','growth','profile','settings']){
  const res=await f.queue.queue({kind,nextBody:{},expectedRevision:0,
   requestId:ID1,operatorApproved:true});
  assert.equal(res.status,'INVALID_DOCUMENT_OPERATION',kind);
 }
 const blocked=fixture({enabled:false});
 assert.equal((await blocked.invoke()).status,'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(blocked.queued.size,0);assert.equal(blocked.putCalls,0);
});
