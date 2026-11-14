const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Client=require('../sync/primary-documents-client.js');
const Ops=require('../sync/primary-documents-operations.js');
const Business=require('../sync/primary-documents-business-commands.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Growth=require('../growth.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const IDS=['04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',
 '79192488-bd70-4b88-8c66-3c5b5fb29ef5',
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6',
 '6b3d0e45-bf18-4c95-889c-6f19731a8ae5'];
const OLD={id:'legacy-w1',date:'2026-11-07',time:'09:30',
 weight:3.65,note:'原儿保记录',legacyExtra:'unchanged'};
const NEW={id:'new-w2',date:'2026-11-13',time:'10:10',
 weight:4.1,note:'复查'};
function fixture({enabled=true,lostAck=false,hiddenReceipts=0,
 old=[OLD]}={}){
 let revision=0,uuidCount=0,puts=0,editingId=null,weight=4.1,allowedDelete=true;
 const body={items:JSON.parse(JSON.stringify(old))};
 const reference={referenceOverrides:{'好奇|小森林|S':1.125}};
 const quotes={items:[{id:'q1',size:'NB',price:100}]};
 const inventory={NB:100,S:200,M:0,L:0,XL:0,XXL:0};
 const purchases=[{operationId:'buy-1',size:'NB',pieces:50}];
 const profile={babyProfile:{name:'小宝',birthWeight:3.2},
  dueDate:'2027-01-08',birthDate:'2026-10-20',babyWeight:''};
 const settings={currentSize:'NB',sizeMode:'auto',autoSize:'NB'};
 const audit=[{id:'audit-w1',kind:'weight',payload:{...OLD}}];
 const immutable=JSON.stringify({reference,quotes,inventory,purchases,profile,settings,audit});
 const receipts=new Map(),queued=new Map(),rpc=[],p2=[],events=[];
 const scope={familyId:F,actorUid:'dad'};
 let shown={familyId:F,actorUid:'dad',childId:C,
  kind:'growth',revision,body:JSON.parse(JSON.stringify(body))};
 let rendered={weightRecords:JSON.parse(JSON.stringify(body.items)),
  ...JSON.parse(JSON.stringify(profile)),inventory,transactions:purchases,
  ...settings};
 function app(actor){
  return {auth:{getSession:async()=>({data:{user:{id:actor}}})},
   rdb:()=>({rpc:async(name,args)=>{
    rpc.push({name,args,actor});
    assert.equal(args.p_family_id,F);assert.equal(args.p_child_id,C);
    if(name==='xb_read_primary_document_draft'){
     const kinds={growth:body,reference,quotes};
     const data=kinds[args.p_kind];
     assert.ok(data);
     return {data:{complete:true,kind:args.p_kind,
      family_id:F,child_id:C,revision:args.p_kind==='growth'?revision:0,
      body:JSON.parse(JSON.stringify(data)),can_upload:false}};
    }
    if(name==='xb_check_primary_document_request_draft'){
     const found=receipts.get(args.p_request_id);
     if(found&&hiddenReceipts-->0)return {data:{status:'NO_RECEIPT',
      family_id:F,child_id:C,request_id:args.p_request_id}};
     return {data:found?{status:'COMMITTED',family_id:F,child_id:C,
      request_id:args.p_request_id,kind:found.kind,
      resulting_revision:found.revision}:
      {status:'NO_RECEIPT',family_id:F,child_id:C,
       request_id:args.p_request_id}};
    }
    assert.equal(name,'xb_put_primary_document_draft');
    assert.equal(args.p_kind,'growth');
    puts++;
    const prior=receipts.get(args.p_request_id);
    if(prior)return{data:{saved:true,duplicate:true,
     family_id:F,child_id:C,kind:'growth',
     request_id:args.p_request_id,revision:prior.revision}};
    if(args.p_expected_revision!==revision)return{error:{code:'40001'}};
    assert.ok(Array.isArray(args.p_next_body.items));
    body.items=JSON.parse(JSON.stringify(args.p_next_body.items));
    revision++;
    receipts.set(args.p_request_id,{kind:'growth',revision});
    if(lostAck){lostAck=false;throw Error('network failed after commit');}
    return{data:{saved:true,kind:'growth',family_id:F,child_id:C,
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
 const documentClient=client('dad');
 const store={
  async enqueue(op){assert.ok(['weight.upsert','weight.delete','reference.patch','quote.upsert'].includes(op.type));
   if(queued.has(op.id))throw Error('reused_request_id');
   queued.set(op.id,{...op});return{duplicate:false};},
  async ready(){return [...queued.values()].filter(x=>['pending','retry'].includes(x.status));},
  async stats(){const rows=[...queued.values()];return{
   outstanding:rows.filter(x=>x.status!=='acked').length,
   total:rows.length,pending:rows.filter(x=>x.status==='pending').length,
   conflict:rows.filter(x=>x.status==='conflict').length,acked:rows.filter(x=>x.status==='acked').length,
   retry:0,blocked:0};},
  async get(_scope,id){return queued.get(id)||null;},
  async recordResult(_scope,id,result){
   const x=queued.get(id);assert.ok(x);
   x.status=result.kind==='accepted'?'acked':'conflict';
  }
 };
 const createQueue=()=>Ops.create({
  controller:{verifiedContext:()=>scope},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:documentClient,outboxFactory:{create:()=>store},
  contract:require('../sync/outbox-contract.js'),
  cloudWritesEnabled:enabled,referenceAndQuotes:true,allowGrowth:true
 });
 const queue=createQueue(),domain=Business.create({
  client:documentClient,queue,uuid:()=>IDS[uuidCount++]||'unexpected_uuid'
 });
 function readInput(el){
  const action=el.dataset?.action;
  if(action==='deleteweight')
   return {kind:'growth',action:'delete',record:{id:el.dataset.id}};
  if(el.id==='saveWeight'){
   const isEdit=Boolean(editingId);
   return {kind:'growth',action:isEdit?'edit':'add',
    record:{...NEW,id:editingId||NEW.id,weight,note:'复查'}};
  }
  return null;
 }
 const actions=Actions.create({
  commands:{submit:async(action,value)=>{p2.push({action,value});return{
   status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:IDS[3]};}},
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'}),
   flush:async()=>({status:'PRIMARY_CLOUD_SYNCED_VERIFIED'})},
  notify:result=>events.push(result),formalModeSelected:()=>true,
  buildAllowsWrites:enabled,operatorApproved:()=>enabled,
  purchaseOnly:true,allowGrowth:true,allowQuotes:true,allowReference:true,
  documentCommands:domain,documentQueue:queue,
  readGrowthBaseline:()=>shown,
  readDocumentInput:readInput,
  confirmGrowthDelete:()=>allowedDelete,
  onGrowthReadback:async({requestId,action,record,expectedRevision})=>{
   const receipt=await queue.checkSavedRequest(requestId);
   if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
   const fresh=await documentClient.read({
    ...scope,kind:'growth',readEnabled:true});
   if(fresh.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
     ||fresh.revision<=expectedRevision)return 'pending';
   const row=fresh.body.items.find(x=>x.id===record.id);
   if(action==='delete'&&row)return 'pending';
   if(action!=='delete'&&(!row||!Object.entries(record).every(
    ([k,v])=>row[k]===v)))return 'pending';
   shown={...fresh,actorUid:'dad'};
   rendered={...rendered,weightRecords:JSON.parse(JSON.stringify(fresh.body.items))};
   if(action!=='delete'||editingId===record.id)editingId=null;
   return 'ready';
  },
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null
 });
 async function click(id='',dataset={}){return actions.handle({id,dataset},{
  getElementById:()=>null});}
 const readAs=actor=>client(actor).read({
  familyId:F,actorUid:actor,kind:'growth',readEnabled:true});
 return {click,readAs,domain,queue,createQueue,client,body,queued,receipts,rpc,p2,
  get rendered(){return rendered;},profile,reference,quotes,inventory,purchases,settings,audit,immutable,events,
  get revision(){return revision;},get uuidCount(){return uuidCount;},
  get putCount(){return puts;},get shown(){return shown;},
  get editingId(){return editingId;},
  setWeight:x=>{weight=x;},setDeleteAllowed:x=>{allowedDelete=x;},
  startEdit:id=>{editingId=id;},
  externalEdit:x=>{body.items.push(x);revision++;},
  unchanged:()=>assert.equal(JSON.stringify({reference,quotes,inventory,purchases,profile,settings,audit}),immutable),
  visible:()=>Growth.latestWeight(rendered)
 };
}
test('P3-03 add measure -> durable UUID -> CAS -> receipt -> A/B readback and curve/stats',async()=>{
 const f=fixture();
 const before=Growth.latestWeight(f.rendered).weight;
 assert.equal(before,3.65);
 const r=await f.click('saveWeight');
 assert.equal(r.status,'GROWTH_CLOUD_READBACK_VERIFIED');
 assert.equal(r.requestId,IDS[0]);assert.equal(f.uuidCount,1);
 assert.equal(f.queued.get(IDS[0]).type,'weight.upsert');
 assert.equal(f.queued.get(IDS[0]).status,'acked');
 assert.equal(f.queued.get(IDS[0]).expectedRevision,0);
 assert.equal(f.putCount,1);
 assert.deepEqual((await f.readAs('dad')).body,(await f.readAs('mom')).body);
 assert.equal(f.shown.revision,1);
 assert.equal(f.visible().weight,4.1);
 assert.equal(Growth.measurements(f.rendered).length,3); // birth + 2 records
 assert.match(Growth.history(f.rendered),/复查/);
 assert.match(Growth.chart(f.rendered,'all'),/<svg/);
 assert.equal(f.p2.length,0);f.unchanged();
});
test('P3-03 edit existing migrated measurement preserves ID and unknown original fields',async()=>{
 const f=fixture();
 f.startEdit(OLD.id);f.setWeight(4.0);
 const r=await f.click('saveWeight');
 assert.equal(r.status,'GROWTH_CLOUD_READBACK_VERIFIED');
 assert.equal(f.body.items.length,1);
 assert.equal(f.body.items[0].id,OLD.id);
 assert.equal(f.body.items[0].weight,4.0);
 assert.equal(f.body.items[0].legacyExtra,'unchanged');
 assert.equal(f.editingId,null);
 assert.equal((await f.click('saveWeight')).status,'GROWTH_CLOUD_READBACK_VERIFIED');
 assert.equal(f.body.items.length,2);
 assert.equal(f.body.items[1].id,NEW.id);
 assert.equal(f.body.items[0].id,OLD.id);f.unchanged();
});
test('P3-03 remove single measurement and maintain others and historical audit',async()=>{
 const f=fixture({old:[OLD,NEW]});
 const r=await f.click('',{action:'deleteweight',id:OLD.id});
 assert.equal(r.status,'GROWTH_CLOUD_READBACK_VERIFIED');
 assert.deepEqual(f.body.items.map(x=>x.id),[NEW.id]);
 assert.equal(f.queued.get(IDS[0]).type,'weight.delete');
 assert.deepEqual((await f.readAs('mom')).body.items.map(x=>x.id),[NEW.id]);
 assert.equal(Growth.latestWeight(f.rendered).weight,4.1);f.unchanged();
});
test('P3-03 cancel deletion writes neither queue nor cloud',async()=>{
 const f=fixture();
 f.setDeleteAllowed(false);
 const r=await f.click('',{action:'deleteweight',id:OLD.id});
 assert.equal(r.status,'GROWTH_DELETE_CANCELLED');
 assert.equal(f.putCount,0);assert.equal(f.uuidCount,0);
 assert.equal(f.body.items.length,1);assert.equal(f.queued.size,0);
});
test('P3-03 stale page document revision rejects before generating request UUID',async()=>{
 const f=fixture();
 f.externalEdit({...NEW,id:'wife-w2'});
 const r=await f.click('saveWeight');
 assert.equal(r.status,'DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED');
 assert.equal(f.putCount,0);assert.equal(f.uuidCount,0);
 assert.equal(f.body.items.length,2);f.unchanged();
});
test('P3-03 CAS conflict after queue keeps one durable request and spouse latest data',async()=>{
 const f=fixture();
 const q=await f.domain.submit({familyId:F,actorUid:'dad',
  kind:'growth',action:'add',record:NEW,expectedRevision:0,
  operatorApproved:true});
 assert.equal(q.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 f.externalEdit({...NEW,id:'wife-w2'});
 const sent=await f.queue.send({operatorApproved:true});
 assert.equal(sent.status,'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 assert.equal(sent.requestId,IDS[0]);
 assert.equal(f.queued.get(IDS[0]).status,'conflict');
 assert.equal(f.body.items.length,2);assert.equal(f.putCount,1);f.unchanged();
});
test('P3-03 lost write response resolves same request ID without duplicate measurement',async()=>{
 const f=fixture({lostAck:true});
 const r=await f.click('saveWeight');
 assert.equal(r.status,'GROWTH_CLOUD_READBACK_VERIFIED');
 assert.equal(f.putCount,1);assert.equal(f.receipts.size,1);
 assert.equal(f.body.items.length,2);
 assert.equal(f.queued.get(IDS[0]).status,'acked');
});
test('P3-03 uncertain receipt remains queued; replay checks same UUID first',async()=>{
 const f=fixture({hiddenReceipts:1});
 const r=await f.click('saveWeight');
 assert.equal(r.status,'DOCUMENT_RECEIPT_READBACK_REQUIRED_KEEP_ID');
 assert.equal(r.requestId,IDS[0]);
 assert.equal(f.putCount,1);assert.equal(f.queued.get(IDS[0]).status,'pending');
 const again=await f.createQueue().send({operatorApproved:true});
 assert.equal(again.status,'DOCUMENT_SYNC_CONFIRMED');
 assert.equal(f.putCount,1);assert.equal(f.queued.get(IDS[0]).status,'acked');
 assert.equal(f.body.items.length,2);
});
test('P3-03 only growth plus P3-01/02 document kinds authorized; profile/settings and formal gates off',async()=>{
 const f=fixture();
 for(const kind of ['profile','settings']){
  const x=await f.queue.queue({kind,requestId:IDS[0],
   nextBody:{},expectedRevision:0,operatorApproved:true});
  assert.equal(x.status,'INVALID_DOCUMENT_OPERATION',kind);
 }
 const b=await f.queue.queue({kind:'quotes',requestId:IDS[0],
  nextBody:{items:[]},expectedRevision:0,operatorApproved:true});
 assert.equal(b.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 const rec=f.queued.get(IDS[0]);
 assert.equal(rec.payload.kind,'quotes');
 assert.equal(f.putCount,0);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const off=fixture({enabled:false});
 assert.equal((await off.click('saveWeight')).status,'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(off.putCount,0);assert.equal(off.queued.size,0);
});
test('P3-03 formal growth UI wiring, original validation and source mirror remain intact',()=>{
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 const ctl=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(html,/function finishFormalGrowthEdit/);
 assert.match(html,/finishGrowthEdit:finishFormalGrowthEdit/);
 assert.match(html,/clearWeightForm\(\)/);
 assert.match(html,/XBGrowth\.dateOK\(date\)/);
 assert.match(html,/XBGrowth\.timeOK\(time\)/);
 assert.match(html,/state\.birthDate&&date<state\.birthDate/);
 assert.match(html,/XBGrowth\.chart\(state/);
 assert.match(html,/XBGrowth\.history\(state/);
 assert.match(ctl,/allowGrowth:true/);
 assert.match(ctl,/expectedGrowth/);
 assert.match(ctl,/confirmGrowthDelete/);
 for(const filename of [
  'primary-formal-ui-actions.js','primary-documents-operations.js',
  'primary-documents-business-commands.js']){
  assert.ok(html.includes(fs.readFileSync(path.join(__dirname,
   '../sync',filename),'utf8')),filename+' not mirrored in HTML');
 }
});
