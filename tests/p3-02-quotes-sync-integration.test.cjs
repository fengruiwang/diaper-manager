const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Client=require('../sync/primary-documents-client.js');
const Ops=require('../sync/primary-documents-operations.js');
const Business=require('../sync/primary-documents-business-commands.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const IDS=['04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',
 '79192488-bd70-4b88-8c66-3c5b5fb29ef5',
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6',
 '6b3d0e45-bf18-4c95-889c-6f19731a8ae5'];
const QUOTE={id:'migrated-q1',brand:'好奇',series:'小森林',size:'S',
 per:50,packs:2,pieces:100,price:150,unit:1.5,date:'2026-10-22',
 migratedExtra:'preserve'};
const NEXT={id:'new-q2',brand:'Babycare',series:'皇室Pro',size:'NB',
 per:60,packs:2,pieces:120,price:180,unit:1.5,date:'2026-11-14'};
function fixture({enabled=true,loseAck=false,hideReceipts=0,legacy=[QUOTE]}={}){
 let revision=0,idCalls=0,putCalls=0;
 let editingId=null,price=180,confirmClear=true,finishCalls=[];
 const body={items:JSON.parse(JSON.stringify(legacy))};
 const references={referenceOverrides:{'好奇|小森林|S':1.125}};
 const inventory={NB:100,S:200,M:0,L:0,XL:0,XXL:0};
 const purchases=[{id:'purchase-old',pieces:60}];
 const legacyAudit=[{id:'audit-q1',record_kind:'quote',payload:{...QUOTE}}];
 const immutable=JSON.stringify({references,inventory,purchases,legacyAudit});
 const receipts=new Map(),outboxRows=new Map(),rpc=[],p2=[];
 let shown={familyId:F,actorUid:'dad',childId:C,
  kind:'quotes',revision,body:JSON.parse(JSON.stringify(body))};
 function app(actor){
  return {auth:{getSession:async()=>({data:{user:{id:actor}}})},
   rdb:()=>({rpc:async(name,args)=>{
    rpc.push({name,args,actor});
    assert.equal(args.p_family_id,F);assert.equal(args.p_child_id,C);
    if(name==='xb_read_primary_document_draft'){
     assert.ok(['quotes','reference'].includes(args.p_kind));
     const isQuote=args.p_kind==='quotes';
     return {data:{complete:true,kind:args.p_kind,
      family_id:F,child_id:C,revision:isQuote?revision:0,
      body:JSON.parse(JSON.stringify(isQuote?body:references)),
      can_upload:false}};
    }
    if(name==='xb_check_primary_document_request_draft'){
     const hit=receipts.get(args.p_request_id);
     if(hit&&hideReceipts-->0)return {data:{status:'NO_RECEIPT',
      family_id:F,child_id:C,request_id:args.p_request_id}};
     return {data:hit?{status:'COMMITTED',family_id:F,child_id:C,
      request_id:args.p_request_id,kind:hit.kind,
      resulting_revision:hit.revision}:
      {status:'NO_RECEIPT',family_id:F,child_id:C,
       request_id:args.p_request_id}};
    }
    assert.equal(name,'xb_put_primary_document_draft');
    assert.equal(args.p_kind,'quotes');
    putCalls++;
    const prior=receipts.get(args.p_request_id);
    if(prior)return {data:{saved:true,duplicate:true,
     kind:'quotes',family_id:F,child_id:C,
     request_id:args.p_request_id,revision:prior.revision}};
    if(args.p_expected_revision!==revision)return {error:{code:'40001'}};
    assert.ok(Array.isArray(args.p_next_body.items));
    body.items=JSON.parse(JSON.stringify(args.p_next_body.items));
    revision++;
    receipts.set(args.p_request_id,{kind:'quotes',revision});
    if(loseAck){loseAck=false;throw Error('synthetic response lost after DB commit');}
    return {data:{saved:true,duplicate:false,
     kind:'quotes',family_id:F,child_id:C,
     request_id:args.p_request_id,revision}};
   }})};
 }
 function client(actor){
  return Client.create({app:app(actor),cloudWritesEnabled:enabled,
   accessPreflight:{create:()=>({verifyAccess:async()=>({
    familyId:F,actorUid:actor,member:true,appCode:'xb'})})},
   childReader:{create:()=>({inspectLegacyTarget:async()=>({
    familyId:F,childId:C,readyForMigration:false})})},
   scopeGuard:{requireLegacyMigrationTarget(){}}
  });
 }
 const documentClient=client('dad'),scope={familyId:F,actorUid:'dad'};
 const outbox={
  async enqueue(op){
   if(outboxRows.has(op.id))throw Error('request_id_reused');
   outboxRows.set(op.id,{...op});return {duplicate:false};
  },
  async ready(){return [...outboxRows.values()].filter(op=>op.status==='pending'||op.status==='retry');},
  async stats(){
   const rows=[...outboxRows.values()];
   return {total:rows.length,
    outstanding:rows.filter(op=>op.status!=='acked').length,
    pending:rows.filter(op=>op.status==='pending').length,
    conflict:rows.filter(op=>op.status==='conflict').length,
    acked:rows.filter(op=>op.status==='acked').length,retry:0,blocked:0};
  },
  async recordResult(_scope,id,result){
   const op=outboxRows.get(id);assert.ok(op);
   op.status=result.kind==='accepted'?'acked':'conflict';
  },
  async get(_scope,id){return outboxRows.get(id)||null;}
 };
 function createQueue(){
  return Ops.create({
   controller:{verifiedContext:()=>scope},
   host:{indexedDB:{open(){}},navigator:{onLine:true}},
   documentsClient,outboxFactory:{create:()=>outbox},
   contract:require('../sync/outbox-contract.js'),
   cloudWritesEnabled:enabled,referenceAndQuotes:true
  });
 }
 const queue=createQueue();
 const domain=Business.create({client:documentClient,queue,
  uuid:()=>IDS[idCalls++]||'unexpected-request'});
 function formAction(el){
  if(el.id==='saveQuote')return{kind:'quotes',action:editingId?'edit':'add',
   record:{...NEXT,id:editingId||NEXT.id,price,
    unit:price/NEXT.pieces,date:'2026-11-14'}};
  if(el.dataset?.action==='deletequote')
   return{kind:'quotes',action:'delete',record:{id:el.dataset.id}};
  if(el.id==='clearQuotes')return{kind:'quotes',action:'clear',record:null};
  return null;
 }
 const controllerReadback=async({requestId,record,action,expectedRevision})=>{
  const receipt=await queue.checkSavedRequest(requestId);
  if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
  const current=await documentClient.read({
   ...scope,kind:'quotes',readEnabled:true
  });
  if(current.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
    ||current.revision<=expectedRevision)return 'pending';
  const row=current.body.items.find(x=>x.id===record?.id);
  if(action==='add'||action==='edit'){
   if(!row||!Object.entries(record).every(([key,val])=>row[key]===val))
    return 'pending';
  }else if(action==='delete'){
   if(row)return 'pending';
  }else if(action==='clear'&&current.body.items.length)return 'pending';
  shown={...current,actorUid:'dad'};
  if(['add','edit','clear'].includes(action)
    ||(action==='delete'&&editingId===record?.id))editingId=null;
  finishCalls.push(action);return 'ready';
 };
 const actions=Actions.create({
  commands:{submit:async(action,value)=>{
   p2.push([action,value]);
   return{status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:IDS[3]};}},
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'}),
   flush:async()=>({status:'PRIMARY_CLOUD_SYNCED_VERIFIED'})},
  formalModeSelected:()=>true,notify:()=>{},
  buildAllowsWrites:enabled,operatorApproved:()=>enabled,
  purchaseOnly:true,allowQuotes:true,allowReference:true,
  documentCommands:domain,documentQueue:queue,
  readQuotesBaseline:()=>shown,
  confirmQuoteClear:()=>confirmClear,
  onQuotesReadback:controllerReadback,
  readDocumentInput:formAction,
  prepareQuoteEdit:id=>{
   if(!shown.body.items.find(q=>q.id===id))return{status:'QUOTE_NOT_FOUND'};
   editingId=id;return{status:'QUOTE_FIELDS_READY_TO_EDIT'};
  },
  readPurchase:()=>null,readQuote:id=>shown.body.items.find(q=>q.id===id),
  readTransaction:()=>null,
  onPurchaseReadback:async()=> 'ready'
 });
 async function click(id='',dataset={}){
  return actions.handle({id,dataset},{getElementById:()=>null});
 }
 const readAs=actor=>client(actor).read({familyId:F,actorUid:actor,
  kind:'quotes',readEnabled:true});
 return {
  click,readAs,createQueue,domain,queue,body,receipts,outboxRows,
  references,inventory,purchases,legacyAudit,rpc,p2,immutable,
  get revision(){return revision;},get shown(){return shown;},
  get puts(){return putCalls;},get requestIds(){return idCalls;},
  get editingId(){return editingId;},get finishCalls(){return finishCalls;},
  setPrice:v=>{price=v;},setConfirm:v=>{confirmClear=v;},
  externalEdit:q=>{body.items.push(q);revision++;},
  unchanged:()=>assert.equal(JSON.stringify({
   references,inventory,purchases,legacyAudit}),immutable)
 };
}
test('P3-02 original Add -> durable quote UUID -> CAS receipt -> shared A/B readback; no P2 mutation',async()=>{
 const f=fixture();
 const r=await f.click('saveQuote');
 assert.equal(r.status,'QUOTES_CLOUD_READBACK_VERIFIED');
 assert.equal(r.requestId,IDS[0]);assert.equal(f.requestIds,1);
 assert.equal(f.puts,1);assert.equal(f.outboxRows.get(IDS[0]).status,'acked');
 assert.equal(f.outboxRows.get(IDS[0]).type,'quote.upsert');
 assert.equal(f.outboxRows.get(IDS[0]).expectedRevision,0);
 assert.equal(f.body.items.length,2);assert.equal(f.body.items[0].id,QUOTE.id);
 assert.deepEqual((await f.readAs('dad')).body,(await f.readAs('mom')).body);
 assert.equal(f.shown.revision,1);assert.equal(f.finishCalls[0],'add');
 assert.equal(f.p2.length,0);f.unchanged();
});
test('P3-02 Edit reuses record ID, preserves unknown migrated fields; next save creates rather than overwrites',async()=>{
 const f=fixture();
 assert.equal((await f.click('',{action:'editquote',id:QUOTE.id})).status,
  'QUOTE_FIELDS_READY_TO_EDIT');
 f.setPrice(120);
 const r=await f.click('saveQuote');
 assert.equal(r.status,'QUOTES_CLOUD_READBACK_VERIFIED');
 assert.equal(f.body.items.length,1);
 assert.equal(f.body.items[0].id,QUOTE.id);
 assert.equal(f.body.items[0].migratedExtra,'preserve');
 assert.equal(f.body.items[0].price,120);
 assert.equal(f.editingId,null);
 assert.equal((await f.click('saveQuote')).status,'QUOTES_CLOUD_READBACK_VERIFIED');
 assert.equal(f.body.items.length,2);
 assert.equal(f.body.items[1].id,NEXT.id);
 assert.equal(f.body.items[0].id,QUOTE.id);f.unchanged();
});
test('P3-02 delete only chosen quote, leaves other migrated and new quote intact',async()=>{
 const f=fixture({legacy:[QUOTE,NEXT]});
 const r=await f.click('',{action:'deletequote',id:QUOTE.id});
 assert.equal(r.status,'QUOTES_CLOUD_READBACK_VERIFIED');
 assert.deepEqual(f.body.items.map(x=>x.id),[NEXT.id]);
 assert.equal(f.outboxRows.get(IDS[0]).type,'quote.delete');
 assert.deepEqual((await f.readAs('mom')).body.items.map(x=>x.id),[NEXT.id]);
 f.unchanged();
});
test('P3-02 clear confirmation cancel does nothing; approve clears shared list only',async()=>{
 const f=fixture();
 f.setConfirm(false);
 assert.equal((await f.click('clearQuotes')).status,'QUOTES_CLEAR_CANCELLED');
 assert.equal(f.puts,0);assert.equal(f.requestIds,0);
 assert.equal(f.body.items.length,1);
 f.setConfirm(true);
 assert.equal((await f.click('clearQuotes')).status,'QUOTES_CLOUD_READBACK_VERIFIED');
 assert.equal(f.body.items.length,0);
 assert.equal((await f.readAs('mom')).body.items.length,0);
 assert.equal((await f.click('clearQuotes')).status,'QUOTES_ALREADY_EMPTY');
 assert.equal(f.puts,1);f.unchanged();
});
test('P3-02 stale displayed revision cannot allocate UUID or overwrite spouse records',async()=>{
 const f=fixture();
 f.externalEdit({...NEXT,id:'wife-q2'});
 const r=await f.click('saveQuote');
 assert.equal(r.status,'DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED');
 assert.equal(f.puts,0);assert.equal(f.requestIds,0);
 assert.equal(f.body.items.length,2);f.unchanged();
});
test('P3-02 CAS race after durable queue rejects stale version, retains request ID',async()=>{
 const f=fixture();
 const submitted=await f.domain.submit({familyId:F,actorUid:'dad',
  kind:'quotes',action:'add',record:NEXT,
  expectedRevision:0,operatorApproved:true});
 assert.equal(submitted.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 f.externalEdit({...NEXT,id:'wife-q2'});
 const sent=await f.queue.send({operatorApproved:true});
 assert.equal(sent.status,'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 assert.equal(sent.requestId,IDS[0]);
 assert.equal(f.outboxRows.get(IDS[0]).status,'conflict');
 assert.equal(f.body.items.length,2);assert.equal(f.puts,1);
 f.unchanged();
});
test('P3-02 lost server reply recovers same request UUID without reapplying quote edit',async()=>{
 const f=fixture({loseAck:true});
 const r=await f.click('saveQuote');
 assert.equal(r.status,'QUOTES_CLOUD_READBACK_VERIFIED');
 assert.equal(f.puts,1);assert.equal(f.receipts.size,1);
 assert.equal(f.outboxRows.get(IDS[0]).status,'acked');
 assert.equal(f.body.items.length,2);
});
test('P3-02 unreadable first receipt preserves original ID for reopening the durable queue',async()=>{
 const f=fixture({hideReceipts:1});
 const q=await f.click('saveQuote');
 assert.equal(q.status,'DOCUMENT_RECEIPT_READBACK_REQUIRED_KEEP_ID');
 assert.equal(q.requestId,IDS[0]);assert.equal(f.puts,1);
 assert.equal(f.outboxRows.get(IDS[0]).status,'pending');
 const retry=await f.createQueue().send({operatorApproved:true});
 assert.equal(retry.status,'DOCUMENT_SYNC_CONFIRMED');
 assert.equal(f.outboxRows.get(IDS[0]).status,'acked');
 assert.equal(f.puts,1);assert.equal(f.body.items.length,2);
});
test('P3-02 quotes do not auto-buy; existing Buy quote still invokes P2 purchase',async()=>{
 const f=fixture();
 assert.equal((await f.click('saveQuote')).status,'QUOTES_CLOUD_READBACK_VERIFIED');
 assert.equal(f.p2.length,0);
 const r=await f.click('',{action:'buyquote',id:NEXT.id});
 assert.equal(r.status,'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.p2.length,1);assert.equal(f.p2[0][0],'purchase');
 assert.equal(f.p2[0][1].id,NEXT.id);f.unchanged();
});
test('P3-02 reference remains allowed, other three kinds remain blocked; formal switches off',async()=>{
 const f=fixture();
 for(const kind of ['growth','profile','settings']){
  const q=await f.queue.queue({kind,nextBody:{},expectedRevision:0,
   requestId:IDS[0],operatorApproved:true});
  assert.equal(q.status,'INVALID_DOCUMENT_OPERATION',kind);
 }
 const q=await f.queue.queue({kind:'reference',
  nextBody:{referenceOverrides:{'好奇|小森林|S':1.125}},
  expectedRevision:0,requestId:IDS[0],operatorApproved:true});
 assert.equal(q.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 assert.equal(f.puts,0);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const off=fixture({enabled:false});
 assert.equal((await off.click('saveQuote')).status,
  'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(off.puts,0);
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 const controller=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(html,/function finishFormalQuoteEdit/);
 assert.match(html,/finishQuoteEdit:finishFormalQuoteEdit/);
 assert.match(html,/formalEditingQuoteId=null/);
 assert.match(controller,/referenceAndQuotes:true/);
 assert.match(controller,/expectedQuotes/);
 assert.match(controller,/confirmQuoteClear/);
});
