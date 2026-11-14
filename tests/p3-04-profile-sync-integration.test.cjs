const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Client=require('../sync/primary-documents-client.js');
const Ops=require('../sync/primary-documents-operations.js');
const Business=require('../sync/primary-documents-business-commands.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Growth=require('../growth.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const UUIDS=['04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',
 '79192488-bd70-4b88-8c66-3c5b5fb29ef5'];
const oldProfile={
 dueDate:'2027-01-08',birthDate:'2026-10-20',babyWeight:'',
 babyProfile:{name:'旧昵称',sex:'',birthTime:'08:30:00',
  birthWeight:3.0,birthLength:49,legacyUnknown:'保留'},
 extraRoot:{legacyVersion:1}
};
const fullEdit={dueDate:'2027-01-08',birthDate:'2026-10-20',
 babyProfile:{name:'小宝',sex:'女',birthTime:'09:12:25',
  birthWeight:3.3,birthLength:50}};
const clone=value=>JSON.parse(JSON.stringify(value));
const html=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal/index.html'),'utf8');
function readOriginalProfileForm(overrides={}){
 const begin=html.indexOf('function formalDocumentAction(el){');
 const end=html.indexOf('\nwindow.XBFormalUIData=',begin);
 assert.ok(begin>0&&end>begin,'original formal editor must exist');
 const fields={
  dueDate:'2027-01-08',birthDate:'2026-10-20',
  birthHour:'09',birthMinute:'12',birthSecond:'25',
  birthWeight:'3.3',birthLength:'50',babyName:' 小宝 ',babySex:'女',
  ...overrides
 };
 const box=id=>({value:fields[id]??''});
 // Run the actual HTML function, including its regex and XBGrowth
 // validation. Never reimplement the validation in the test fixture.
 const output=vm.runInNewContext(
  html.slice(begin,end)+'\nformalDocumentAction({id:"saveProfile",dataset:{}})',
  {$:box,XBGrowth:Growth,localDate:()=> '2026-11-14'}
 );
 return output===null?null:clone(output);
}
function fixture({enabled=true,ackLost=false,unknownReceipt=0}={}){
 let revision=0,uuidCalls=0,putCalls=0,edited=clone(fullEdit);
 let body=clone(oldProfile);
 const growth={items:[
  {id:'legacy-weight',date:'2026-11-12',time:'09:10',
   weight:4.4,note:'儿保',unknown:'preserve'}]};
 const quotes={items:[{id:'legacy-q',price:100,size:'NB'}]};
 const reference={referenceOverrides:{'好奇|小森林|S':1.125}};
 const settings={currentSize:'NB',sizeMode:'auto',autoSize:'NB'};
 const inventory={NB:120,S:80,M:0,L:0,XL:0,XXL:0};
 const purchases=[{id:'old-purchase',pieces:80,price:150}];
 const audit=[{id:'legacy-profile-receipt',origin:'migration'}];
 const before=JSON.stringify({growth,quotes,reference,settings,inventory,purchases,audit});
 const receipts=new Map(),queued=new Map(),rpc=[],primaryCommands=[];
 const scope={familyId:F,actorUid:'dad'};
 let shown={familyId:F,actorUid:'dad',childId:C,kind:'profile',
  revision,body:clone(body)};
 let rendered={...clone(body),weightRecords:clone(growth.items),
  inventory,transactions:purchases,...settings};
 function app(actor){
  return {auth:{getSession:async()=>({data:{user:{id:actor}}})},
   rdb:()=>({rpc:async(name,args)=>{
    rpc.push({actor,name,args});
    assert.equal(args.p_family_id,F);
    assert.equal(args.p_child_id,C);
    if(name==='xb_read_primary_document_draft'){
     const docs={profile:body,reference,quotes,growth};
     assert.ok(docs[args.p_kind]);
     return {data:{complete:true,kind:args.p_kind,
      family_id:F,child_id:C,
      revision:args.p_kind==='profile'?revision:0,
      body:clone(docs[args.p_kind]),can_upload:false}};
    }
    if(name==='xb_check_primary_document_request_draft'){
     const found=receipts.get(args.p_request_id);
     if(found&&unknownReceipt-->0)
      return {data:{status:'NO_RECEIPT',family_id:F,child_id:C,
       request_id:args.p_request_id}};
     return {data:found?{status:'COMMITTED',family_id:F,child_id:C,
      request_id:args.p_request_id,kind:found.kind,
      resulting_revision:found.revision}
      :{status:'NO_RECEIPT',family_id:F,child_id:C,
       request_id:args.p_request_id}};
    }
    assert.equal(name,'xb_put_primary_document_draft');
    assert.equal(args.p_kind,'profile');
    putCalls++;
    const prior=receipts.get(args.p_request_id);
    if(prior)return {data:{saved:true,duplicate:true,
     family_id:F,child_id:C,kind:'profile',
     request_id:args.p_request_id,revision:prior.revision}};
    if(args.p_expected_revision!==revision)return {error:{code:'40001'}};
    body=clone(args.p_next_body);
    revision++;
    receipts.set(args.p_request_id,{kind:'profile',revision});
    if(ackLost){ackLost=false;throw Error('ACK lost after commit');}
    return {data:{saved:true,duplicate:false,
     family_id:F,child_id:C,kind:'profile',
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
  async enqueue(op){
   assert.equal(op.type,'profile.patch');
   assert.equal(queued.has(op.id),false,'request UUID must be unique');
   queued.set(op.id,{...op});return{duplicate:false};
  },
  async ready(){
   return [...queued.values()].filter(x=>['pending','retry'].includes(x.status));
  },
  async stats(){
   const rows=[...queued.values()];
   return {total:rows.length,
    outstanding:rows.filter(x=>x.status!=='acked').length,
    pending:rows.filter(x=>x.status==='pending').length,
    conflict:rows.filter(x=>x.status==='conflict').length,
    acked:rows.filter(x=>x.status==='acked').length,retry:0,blocked:0};
  },
  async get(_scope,id){return queued.get(id)||null;},
  async recordResult(_scope,id,result){
   assert.ok(queued.has(id));
   queued.get(id).status=result.kind==='accepted'?'acked':'conflict';
  }
 };
 function makeQueue(){
  return Ops.create({
   controller:{verifiedContext:()=>scope},
   host:{indexedDB:{open(){}},navigator:{onLine:true}},
   documentsClient:documentClient,
   outboxFactory:{create:()=>store},
   contract:require('../sync/outbox-contract.js'),
   cloudWritesEnabled:enabled,referenceAndQuotes:true,
   allowGrowth:true,allowProfile:true
  });
 }
 const queue=makeQueue();
 const business=Business.create({client:documentClient,queue,
  uuid:()=>UUIDS[uuidCalls++]||'unexpected-request'});
 const actions=Actions.create({
  commands:{submit:async(action,value)=>{
   primaryCommands.push({action,value});return{status:'UNEXPECTED_PRIMARY_WRITE'};}},
  primary:{read:async()=>{throw Error('inventory read forbidden for profile');}},
  notify:()=>{},formalModeSelected:()=>true,
  buildAllowsWrites:enabled,operatorApproved:()=>enabled,
  purchaseOnly:true,allowReference:true,allowQuotes:true,
  allowGrowth:true,allowProfile:true,
  documentCommands:business,documentQueue:queue,
  readProfileBaseline:()=>shown,
  readDocumentInput:()=>({kind:'profile',action:'patch',record:edited}),
  onProfileReadback:async({requestId,record,expectedRevision})=>{
   const receipt=await queue.checkSavedRequest(requestId);
   if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
   const fresh=await documentClient.read({...scope,kind:'profile',readEnabled:true});
   if(fresh.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
     ||fresh.revision<=expectedRevision)return 'pending';
   if(fresh.body.dueDate!==record.dueDate
     ||fresh.body.birthDate!==record.birthDate
     ||Object.entries(record.babyProfile).some(
      ([key,value])=>fresh.body.babyProfile[key]!==value))return 'pending';
   shown={...fresh,actorUid:'dad'};
   rendered={...rendered,...clone(fresh.body)};
   return 'ready';
  },
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null
 });
 const click=()=>actions.handle({id:'saveProfile',dataset:{}},{getElementById:()=>null});
 const readAs=actor=>client(actor).read({familyId:F,actorUid:actor,
  kind:'profile',readEnabled:true});
 return {click,readAs,queue,business,makeQueue,actions,queued,receipts,rpc,
  inventory,purchases,audit,reference,growth,quotes,settings,primaryCommands,
  get body(){return body;},get rendered(){return rendered;},
  get shown(){return shown;},get revision(){return revision;},
  get putCount(){return putCalls;},get uuidCalls(){return uuidCalls;},
  setEdit:v=>{edited=clone(v);},
  externalEdit:change=>{body={...body,...change};revision++;},
  unchanged:()=>assert.equal(
   JSON.stringify({growth,quotes,reference,settings,inventory,purchases,audit}),before)
 };
}
test('P3-04 saves all original profile fields through one durable CAS request; A/B reads match',async()=>{
 const f=fixture();
 const r=await f.click();
 assert.equal(r.status,'PROFILE_CLOUD_READBACK_VERIFIED');
 assert.equal(r.requestId,UUIDS[0]);
 assert.equal(f.uuidCalls,1);assert.equal(f.putCount,1);
 assert.equal(f.queued.get(UUIDS[0]).type,'profile.patch');
 assert.equal(f.queued.get(UUIDS[0]).expectedRevision,0);
 assert.equal(f.queued.get(UUIDS[0]).status,'acked');
 const a=await f.readAs('dad'),b=await f.readAs('mom');
 assert.deepEqual(a.body,b.body);assert.equal(a.revision,b.revision);
 assert.equal(a.revision,1);
 assert.equal(a.body.babyProfile.name,'小宝');
 assert.equal(a.body.babyProfile.birthTime,'09:12:25');
 assert.equal(a.body.babyProfile.birthLength,50);
 assert.equal(f.shown.revision,1);
 assert.equal(f.primaryCommands.length,0);f.unchanged();
});
test('P3-04 unborn form permits blank birth date/time/weight/length and default nickname',()=>{
 const form=readOriginalProfileForm({birthDate:'',birthHour:'',
  birthMinute:'',birthSecond:'',birthWeight:'',birthLength:'',
  babyName:' ',babySex:''});
 assert.ok(form);
 assert.equal(form.kind,'profile');assert.equal(form.action,'patch');
 assert.equal(form.record.birthDate,'');
 assert.deepEqual([form.record.babyProfile.birthTime,
  form.record.babyProfile.birthWeight,form.record.babyProfile.birthLength],['','','']);
 assert.equal(form.record.babyProfile.name,'小宝');
 assert.equal(form.record.babyProfile.sex,'');
});
test('P3-04 actual original profile form accepts complete HH:MM:SS and normalized inputs',()=>{
 const form=readOriginalProfileForm({birthHour:'0',birthMinute:'5',
  birthSecond:'9',babyName:' 测试宝宝 ',birthWeight:'3.250'});
 assert.ok(form);
 assert.equal(form.record.babyProfile.birthTime,'00:05:09');
 assert.equal(form.record.babyProfile.birthWeight,3.25);
 assert.equal(form.record.babyProfile.name,'测试宝宝');
 assert.equal(readOriginalProfileForm({babyName:'a'.repeat(60)})
  .record.babyProfile.name.length,30);
});
test('P3-04 rejects invalid dates, partial or invalid time, birth measurements, sex',()=>{
 const invalid=[
  {dueDate:'2027-02-30'}, {birthDate:'2026-11-15'},
  {birthDate:'2026-02-30'}, {birthDate:'',birthHour:'01'},
  {birthDate:'',birthHour:'',birthMinute:'',birthSecond:'',birthWeight:'3.2'},
  {birthDate:'',birthHour:'',birthMinute:'',birthSecond:'',birthLength:'52'},
  {birthHour:'',birthMinute:'12',birthSecond:'09'},
  {birthHour:'12',birthMinute:'',birthSecond:'09'},
  {birthHour:'24'},{birthHour:'-1'},{birthHour:'1.5'},
  {birthHour:'1x'},{birthHour:'1e1'},
  {birthMinute:'60'},{birthSecond:'60'},
  {birthWeight:'0.29'},{birthWeight:'10.01'},
  {birthLength:'19'},{birthLength:'71'},
  {babySex:'未知'}
 ];
 for(const fields of invalid)
  assert.equal(readOriginalProfileForm(fields),null,JSON.stringify(fields));
});
test('P3-04 profile patch preserves unknown top-level and babyProfile migration fields',async()=>{
 const f=fixture();
 assert.equal((await f.click()).status,'PROFILE_CLOUD_READBACK_VERIFIED');
 assert.deepEqual(f.body.extraRoot,{legacyVersion:1});
 assert.equal(f.body.babyProfile.legacyUnknown,'保留');
 assert.equal(f.body.babyWeight,'');
 const a=await f.readAs('mom');
 assert.equal(a.body.babyProfile.legacyUnknown,'保留');
 f.unchanged();
});
test('P3-04 after profile readback original Growth measurements and stats recalculate',async()=>{
 const f=fixture();
 const before=Growth.measurements(f.rendered);
 const beforeChart=Growth.chart(f.rendered,'all');
 assert.equal(before[0].weight,3.0);
 assert.equal(Growth.latestWeight(f.rendered).weight,4.4);
 assert.equal((await f.click()).status,'PROFILE_CLOUD_READBACK_VERIFIED');
 const after=Growth.measurements(f.rendered);
 assert.equal(after.length,before.length);
 assert.equal(after[0].weight,3.3);
 assert.equal(Growth.latestWeight(f.rendered).weight,4.4);
 assert.equal(Number((4.4-after[0].weight).toFixed(2)),1.1);
 assert.notEqual(Growth.chart(f.rendered,'all'),beforeChart);
 assert.match(Growth.history(f.rendered),/出生体重/);
 assert.equal(Growth.effectiveSize(f.rendered),'NB');
 f.unchanged();
});
test('P3-04 stale on-screen profile revision fails before request UUID and server write',async()=>{
 const f=fixture();
 f.externalEdit({babyProfile:{...f.body.babyProfile,name:'老婆更新'}});
 const result=await f.click();
 assert.equal(result.status,'DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED');
 assert.equal(f.uuidCalls,0);assert.equal(f.putCount,0);
 assert.equal(f.body.babyProfile.name,'老婆更新');
});
test('P3-04 CAS conflict after enqueue never overwrites spouse profile',async()=>{
 const f=fixture();
 const q=await f.business.submit({
  familyId:F,actorUid:'dad',kind:'profile',action:'patch',
  record:fullEdit,expectedRevision:0,operatorApproved:true
 });
 assert.equal(q.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 f.externalEdit({babyProfile:{...f.body.babyProfile,name:'老婆更新'}});
 const sent=await f.queue.send({operatorApproved:true});
 assert.equal(sent.status,'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 assert.equal(sent.requestId,UUIDS[0]);
 assert.equal(f.queued.get(UUIDS[0]).status,'conflict');
 assert.equal(f.body.babyProfile.name,'老婆更新');
 assert.equal(f.putCount,1);assert.equal(f.queued.size,1);
});
test('P3-04 lost network ACK retrieves original request receipt with no duplicate write',async()=>{
 const f=fixture({ackLost:true});
 const result=await f.click();
 assert.equal(result.status,'PROFILE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.putCount,1);assert.equal(f.uuidCalls,1);
 assert.equal(f.receipts.size,1);assert.equal(f.queued.size,1);
 assert.equal(f.queued.get(UUIDS[0]).status,'acked');
});
test('P3-04 unresolved receipt persists same UUID and recovers without second PUT',async()=>{
 const f=fixture({unknownReceipt:1});
 const first=await f.click();
 assert.equal(first.status,'DOCUMENT_RECEIPT_READBACK_REQUIRED_KEEP_ID');
 assert.equal(first.requestId,UUIDS[0]);
 assert.equal(f.queued.get(UUIDS[0]).status,'pending');
 const sent=await f.makeQueue().send({operatorApproved:true});
 assert.equal(sent.status,'DOCUMENT_SYNC_CONFIRMED');
 assert.equal(f.putCount,1);assert.equal(f.uuidCalls,1);
 assert.equal(f.queued.get(UUIDS[0]).status,'acked');
});
test('P3-04 no settings writes; source gates and previous shared documents preserved',async()=>{
 const f=fixture();
 const denied=await f.queue.queue({
  kind:'settings',nextBody:{},expectedRevision:0,
  requestId:UUIDS[0],operatorApproved:true
 });
 assert.equal(denied.status,'INVALID_DOCUMENT_OPERATION');
 assert.equal(f.queued.size,0);assert.equal(f.putCount,0);
 const off=fixture({enabled:false});
 assert.equal((await off.click()).status,'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(off.queued.size,0);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const controller=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(controller,/referenceAndQuotes:true,allowGrowth:true,allowProfile:true/);
 assert.match(controller,/expectedProfile/);
 assert.match(controller,/onProfileReadback/);
 assert.match(controller,/profileChangeVisible/);
 for(const filename of ['primary-documents-operations',
  'primary-documents-business-commands','primary-formal-ui-actions']){
  const code=fs.readFileSync(path.join(__dirname,
   '../sync/'+filename+'.js'),'utf8');
  assert.ok(html.includes(code.trim()),filename+' HTML source parity');
 }
});
test('P3-04 formal save button capture prevents legacy localStorage click handler',async()=>{
 const f=fixture({enabled:false}),handlers=new Map();
 const doc={
  addEventListener(name,fn,capture){handlers.set(name,fn);assert.equal(capture,true);},
  removeEventListener(){},
  getElementById(){return null;}
 };
 const attachment=f.actions.attach(doc);
 let prevented=false;
 const el={id:'saveProfile',dataset:{},closest(){return this;},
  classList:{contains:()=>false}};
 handlers.get('click')({
  target:el,
  preventDefault(){prevented=true;},
  stopImmediatePropagation(){prevented=true;}
 });
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(prevented,true);
 assert.equal(f.putCount,0);
 attachment.detach();
});
