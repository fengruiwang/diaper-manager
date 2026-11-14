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
const IDS=['04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',
 '79192488-bd70-4b88-8c66-3c5b5fb29ef5',
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6'];
const SIZES=['NB','S','M','L','XL','XXL'];
const clone=x=>JSON.parse(JSON.stringify(x));
const html=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal/index.html'),'utf8');
const from=html.indexOf('function formalDocumentAction(el){');
const to=html.indexOf('\nwindow.XBFormalUIData=',from);
assert.ok(from>=0&&to>from);
const formalCode=html.slice(from,to);
const originalSettings={
 currentSize:'M',sizeMode:'manual',autoSize:'XXL',goalPrice:1.6,
 target:{NB:90,S:70,M:130,L:140,XL:60,XXL:20,legacySizeExtension:444},
 daily:{NB:8,S:9,M:7,L:6,XL:5,XXL:4,legacyDailyExtension:3},
 replenishPolicy:{mode:'custom',days:7,legacyPolicyFlag:'keep'},
 preset:'balanced',plannedBudget:260,legacySetting:{version:1}
};
function pageAction(id,fields={},state={}){
 const values={
  sizeMode:'manual',currentSize:'S',goalPrice:'1.3',
  replenishMode:'custom',replenishDays:'5',
  ...Object.fromEntries(SIZES.flatMap((sz,i)=>[
   ['target_'+sz,String([120,100,80,60,40,20][i])],
   ['daily_'+sz,String([10,9,8,7,6,5][i])]
  ])),
  ...fields
 };
 const element=typeof id==='string'?{id,dataset:{}}:id;
 const result=vm.runInNewContext(formalCode+
  '\nformalDocumentAction(el)',{
  el:element,
  $:key=>({value:values[key]??''}),
  state:{...clone(originalSettings),birthDate:'',...clone(state)},
  XBGrowth:Growth,SIZES,localDate:()=> '2026-11-14'
 });
 return result===null?null:clone(result);
}
function fixture({enabled=true,ackLost=false,hideReceipt=0,born=false}={}){
 let revision=0,generated=0,puts=0,fields={};
 let body=clone(originalSettings);
 const scope={familyId:F,actorUid:'dad'};
 const profile={dueDate:'2027-01-08',
  birthDate:born?'2020-01-08':'',
  babyProfile:{name:'小宝',birthWeight:3.2},legacyProfile:'kept'};
 const growth={items:[
  {id:'w1',date:'2026-11-13',time:'08:30',weight:5.2,note:'record'}]};
 const reference={referenceOverrides:{'好奇|小森林|S':1.125}};
 const quotes={items:[{id:'q1',size:'NB',price:100}]};
 const inventory={NB:100,S:200,M:30,L:0,XL:0,XXL:0};
 const purchases=[{id:'purchase1',size:'NB',pieces:50}];
 const audit=[{id:'migration1',kind:'settings',status:'completed'}];
 const immutable=JSON.stringify({
  profile,growth,reference,quotes,inventory,purchases,audit
 });
 const receipts=new Map(),outbox=new Map(),rpc=[],purchaseCalls=[];
 let shown={familyId:F,actorUid:'dad',childId:C,
  kind:'settings',revision,body:clone(body)};
 let rendered={...clone(body),...clone(profile),
  weightRecords:clone(growth.items),inventory,transactions:purchases};
 function app(actor){
  return {auth:{getSession:async()=>({data:{user:{id:actor}}})},
   rdb:()=>({rpc:async(name,args)=>{
    rpc.push({actor,name,args});
    assert.equal(args.p_family_id,F);
    assert.equal(args.p_child_id,C);
    if(name==='xb_read_primary_document_draft'){
     const docs={settings:body,profile,growth,reference,quotes};
     assert.ok(docs[args.p_kind],args.p_kind);
     return {data:{complete:true,kind:args.p_kind,
      family_id:F,child_id:C,
      revision:args.p_kind==='settings'?revision:0,
      body:clone(docs[args.p_kind]),can_upload:false}};
    }
    if(name==='xb_check_primary_document_request_draft'){
     const item=receipts.get(args.p_request_id);
     if(item&&hideReceipt-->0)return {data:{status:'NO_RECEIPT',
      family_id:F,child_id:C,request_id:args.p_request_id}};
     return {data:item?{status:'COMMITTED',family_id:F,child_id:C,
      request_id:args.p_request_id,kind:item.kind,
      resulting_revision:item.revision}:
      {status:'NO_RECEIPT',family_id:F,child_id:C,
       request_id:args.p_request_id}};
    }
    assert.equal(name,'xb_put_primary_document_draft');
    assert.equal(args.p_kind,'settings');
    puts++;
    const previous=receipts.get(args.p_request_id);
    if(previous)return {data:{saved:true,duplicate:true,
     family_id:F,child_id:C,kind:'settings',
     request_id:args.p_request_id,revision:previous.revision}};
    if(args.p_expected_revision!==revision)return {error:{code:'40001'}};
    body=clone(args.p_next_body);
    revision++;
    receipts.set(args.p_request_id,{kind:'settings',revision});
    if(ackLost){ackLost=false;throw Error('ACK lost after commit');}
    return {data:{saved:true,duplicate:false,kind:'settings',
     family_id:F,child_id:C,request_id:args.p_request_id,revision}};
   }})};
 }
 const client=actor=>Client.create({
  app:app(actor),cloudWritesEnabled:enabled,
  accessPreflight:{create:()=>({verifyAccess:async()=>({
   familyId:F,actorUid:actor,member:true,appCode:'xb'
  })})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>({
   familyId:F,childId:C,readyForMigration:false
  })})},
  scopeGuard:{requireLegacyMigrationTarget(){}}
 });
 const documentClient=client('dad');
 const store={
  async enqueue(op){
   assert.equal(op.type,'settings.patch');
   assert.equal(outbox.has(op.id),false);
   outbox.set(op.id,{...op});return {duplicate:false};
  },
  async ready(){
   return [...outbox.values()].filter(x=>['pending','retry'].includes(x.status));
  },
  async stats(){
   const rows=[...outbox.values()];
   return {total:rows.length,
    outstanding:rows.filter(x=>x.status!=='acked').length,
    pending:rows.filter(x=>x.status==='pending').length,
    conflict:rows.filter(x=>x.status==='conflict').length,
    acked:rows.filter(x=>x.status==='acked').length,
    retry:0,blocked:0};
  },
  async get(_scope,id){return outbox.get(id)||null;},
  async recordResult(_scope,id,result){
   assert.ok(outbox.has(id));
   outbox.get(id).status=result.kind==='accepted'?'acked':'conflict';
  }
 };
 const newQueue=()=>Ops.create({
  controller:{verifiedContext:()=>scope},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:documentClient,outboxFactory:{create:()=>store},
  contract:require('../sync/outbox-contract.js'),
  cloudWritesEnabled:enabled,referenceAndQuotes:true,
  allowGrowth:true,allowProfile:true,allowSettings:true
 });
 const queue=newQueue();
 const business=Business.create({
  client:documentClient,queue,uuid:()=>IDS[generated++]||'unexpected'
 });
 const actions=Actions.create({
  commands:{submit:async(action,value)=>{
   purchaseCalls.push({action,value});return{status:'UNEXPECTED_PURCHASE'};}},
  primary:{read:async()=>{throw Error('inventory read forbidden');}},
  notify:()=>{},formalModeSelected:()=>true,
  buildAllowsWrites:enabled,operatorApproved:()=>enabled,
  purchaseOnly:true,allowReference:true,allowQuotes:true,
  allowGrowth:true,allowProfile:true,allowSettings:true,
  documentCommands:business,documentQueue:queue,
  readSettingsBaseline:()=>shown,
  readDocumentInput:el=>pageAction(el,fields,{
   ...rendered,birthDate:profile.birthDate
  }),
  onSettingsReadback:async({requestId,record,expectedRevision})=>{
   const receipt=await queue.checkSavedRequest(requestId);
   if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
   const fresh=await documentClient.read({...scope,kind:'settings',readEnabled:true});
   if(fresh.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
     ||fresh.revision<=expectedRevision)return 'pending';
   for(const [key,value] of Object.entries(record)){
    const got=fresh.body[key];
    if(key==='target'||key==='daily'||key==='replenishPolicy'){
     if(!Object.entries(value).every(([k,v])=>got?.[k]===v))
      return 'pending';
    }else if(got!==value)return 'pending';
   }
   shown={...fresh,actorUid:'dad'};
   rendered={...rendered,...clone(fresh.body)};
   return 'ready';
  },
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null
 });
 const click=(id,ds={})=>actions.handle({id,dataset:ds},{
  getElementById:()=>null});
 const readAs=actor=>client(actor).read({
  familyId:F,actorUid:actor,kind:'settings',readEnabled:true
 });
 return {click,readAs,newQueue,business,queue,actions,outbox,receipts,rpc,
  profile,growth,reference,quotes,inventory,purchases,audit,purchaseCalls,
  get body(){return body;},get rendered(){return rendered;},
  get shown(){return shown;},get revision(){return revision;},
  get puts(){return puts;},get generated(){return generated;},
  setFields:newFields=>{fields={...fields,...newFields};},
  externalEdit:fields=>{body={...body,...fields};revision++;},
  unchanged:()=>assert.equal(JSON.stringify({
   profile,growth,reference,quotes,inventory,purchases,audit}),immutable)
 };
}
test('P3-05 manual size and price save once via CAS, confirm receipt and match A/B',async()=>{
 const f=fixture();
 const result=await f.click('saveSizePreferences');
 assert.equal(result.status,'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.equal(result.requestId,IDS[0]);
 assert.equal(f.generated,1);assert.equal(f.puts,1);
 assert.equal(f.outbox.get(IDS[0]).type,'settings.patch');
 assert.equal(f.outbox.get(IDS[0]).expectedRevision,0);
 assert.equal(f.outbox.get(IDS[0]).status,'acked');
 assert.equal(f.body.sizeMode,'manual');
 assert.equal(f.body.currentSize,'S');assert.equal(f.body.goalPrice,1.3);
 assert.equal(f.body.legacySetting.version,1);
 assert.deepEqual((await f.readAs('dad')).body,(await f.readAs('mom')).body);
 assert.equal(f.shown.revision,1);assert.equal(f.purchaseCalls.length,0);
 f.unchanged();
});
test('P3-05 auto size does not pin currentSize, original growth algorithm chooses',async()=>{
 const f=fixture({born:true});
 f.setFields({sizeMode:'auto',currentSize:'XL'});
 const a=pageAction('saveSizePreferences',{sizeMode:'auto',currentSize:'XL'});
 assert.ok(a);assert.equal('currentSize' in a.record,false);
 assert.equal((await f.click('saveSizePreferences')).status,'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.equal(f.body.currentSize,'M');
 assert.equal(f.body.sizeMode,'auto');
 assert.equal(Growth.effectiveSize(f.rendered),'S');
 assert.equal(f.body.autoSize,'XXL','historical autoSize remains untouched');
 f.unchanged();
});
test('P3-05 prenatal six-size targets and daily save, preset custom, policy retained',async()=>{
 const f=fixture();
 assert.equal((await f.click('savePlans')).status,'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.deepEqual(SIZES.map(x=>f.body.target[x]),[120,100,80,60,40,20]);
 assert.deepEqual(SIZES.map(x=>f.body.daily[x]),[10,9,8,7,6,5]);
 assert.equal(f.body.preset,'custom');
 assert.equal(f.body.replenishPolicy.mode,'custom');
 assert.equal(f.body.replenishPolicy.days,7);
 assert.equal(f.body.target.legacySizeExtension,444);
 assert.equal(f.body.daily.legacyDailyExtension,3);
 assert.equal(f.body.legacySetting.version,1);
 f.unchanged();
});
test('P3-05 all three prenatal presets patch only NB/S and preserve other sizes',async()=>{
 const pairs=[['cautious',80,60],['balanced',100,60],['relaxed',120,80]];
 for(const [key,nb,s] of pairs){
  const f=fixture();
  const input=pageAction({id:'',dataset:{preset:key}});
  assert.deepEqual(Object.keys(input.record.target),['NB','S']);
  assert.equal((await f.click('',{preset:key})).status,
   'SETTINGS_CLOUD_READBACK_VERIFIED');
  assert.equal(f.body.preset,key);
  assert.equal(f.body.target.NB,nb);assert.equal(f.body.target.S,s);
  assert.equal(f.body.target.M,130);assert.equal(f.body.target.XXL,20);
  assert.equal(f.body.target.legacySizeExtension,444);
  assert.equal(f.body.daily.S,9);
  f.unchanged();
 }
});
test('P3-05 born child cannot activate prenatal preset or generate request ID',async()=>{
 const f=fixture({born:true});
 const r=await f.click('',{preset:'cautious'});
 assert.equal(r.status,'SETTINGS_FORM_INVALID');
 assert.equal(f.puts,0);assert.equal(f.generated,0);assert.equal(f.outbox.size,0);
 f.unchanged();
});
test('P3-05 born day-mode updates daily & policy while preserving old custom target',async()=>{
 const f=fixture({born:true});
 f.setFields({replenishMode:'days',replenishDays:'10',
  target_NB:'250',target_M:'999',daily_NB:'12'});
 const action=pageAction('savePlans',{
  replenishMode:'days',replenishDays:'10',target_NB:'250',daily_NB:'12'
 },{birthDate:'2020-01-08'});
 assert.equal(Object.hasOwn(action.record,'target'),false);
 assert.equal((await f.click('savePlans')).status,
  'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.equal(f.body.target.NB,90);assert.equal(f.body.target.M,130);
 assert.equal(f.body.daily.NB,12);
 assert.equal(f.body.replenishPolicy.mode,'days');
 assert.equal(f.body.replenishPolicy.days,10);
 assert.equal(f.body.replenishPolicy.legacyPolicyFlag,'keep');
 assert.equal(f.body.preset,'balanced');
 const plan=Growth.targetForSize(f.rendered,'NB');
 assert.equal(plan.target,120);assert.equal(plan.source,'days');
 f.unchanged();
});
test('P3-05 born custom mode explicitly updates manual goals and daily only',async()=>{
 const f=fixture({born:true});
 f.setFields({replenishMode:'custom',replenishDays:'5',
  target_NB:'250',daily_NB:'13'});
 assert.equal((await f.click('savePlans')).status,'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.equal(f.body.target.NB,250);assert.equal(f.body.daily.NB,13);
 assert.deepEqual({mode:f.body.replenishPolicy.mode,days:f.body.replenishPolicy.days},
  {mode:'custom',days:5});
 assert.equal(f.body.preset,'balanced');
 assert.equal(f.body.legacySetting.version,1);f.unchanged();
});
test('P3-05 validate missing, out-of-range, fractional fields before command creation',async()=>{
 const invalid=[
  ['saveSizePreferences',{sizeMode:'bad'}],
  ['saveSizePreferences',{sizeMode:'manual',currentSize:'invalid'}],
  ['saveSizePreferences',{goalPrice:''}],
  ['saveSizePreferences',{goalPrice:'101'}],
  ['savePlans',{target_NB:''}],
  ['savePlans',{target_S:'-1'}],
  ['savePlans',{target_M:'10001'}],
  ['savePlans',{daily_NB:'0'}],
  ['savePlans',{daily_S:'31'}],
  ['savePlans',{daily_M:'3.1'}]
 ];
 for(const [id,fields] of invalid){
  assert.equal(pageAction(id,fields),null,JSON.stringify(fields));
 }
 const f=fixture();
 f.setFields({daily_NB:'0'});
 assert.equal((await f.click('savePlans')).status,'SETTINGS_FORM_INVALID');
 assert.equal(f.generated,0);assert.equal(f.puts,0);
});
test('P3-05 stale visible revision blocks request allocation; CAS race retains UUID',async()=>{
 const f=fixture();
 f.externalEdit({goalPrice:2.2});
 const status=await f.click('saveSizePreferences');
 assert.equal(status.status,'DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED');
 assert.equal(f.puts,0);assert.equal(f.generated,0);
 const b=fixture();
 const input=pageAction('saveSizePreferences');
 const queued=await b.business.submit({
  familyId:F,actorUid:'dad',kind:'settings',action:'patch',
  record:input.record,expectedRevision:0,operatorApproved:true
 });
 assert.equal(queued.status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 b.externalEdit({goalPrice:2.2});
 const replay=await b.queue.send({operatorApproved:true});
 assert.equal(replay.status,'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 assert.equal(replay.requestId,IDS[0]);
 assert.equal(b.outbox.get(IDS[0]).status,'conflict');
 assert.equal(b.body.goalPrice,2.2);
});
test('P3-05 lost ACK and uncertain request receipt reuse original ID, no second PUT',async()=>{
 const f=fixture({ackLost:true});
 assert.equal((await f.click('saveSizePreferences')).status,
  'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.equal(f.puts,1);assert.equal(f.generated,1);
 assert.equal(f.outbox.get(IDS[0]).status,'acked');
 const other=fixture({hideReceipt:1});
 const r=await other.click('saveSizePreferences');
 assert.equal(r.status,'DOCUMENT_RECEIPT_READBACK_REQUIRED_KEEP_ID');
 assert.equal(r.requestId,IDS[0]);assert.equal(other.puts,1);
 assert.equal(other.outbox.get(IDS[0]).status,'pending');
 const retry=await other.newQueue().send({operatorApproved:true});
 assert.equal(retry.status,'DOCUMENT_SYNC_CONFIRMED');
 assert.equal(other.puts,1);assert.equal(other.generated,1);
 assert.equal(other.outbox.get(IDS[0]).status,'acked');
});
test('P3-05 resetAll is still blocked; original localStorage handlers captured',async()=>{
 const f=fixture(),handlers=new Map();
 assert.equal((await f.click('resetAll')).status,'FORMAL_PURCHASE_ONLY');
 assert.equal(f.puts,0);assert.equal(f.purchaseCalls.length,0);
 const el={id:'saveSizePreferences',dataset:{},
  classList:{contains:()=>false},closest(){return this}};
 const d={
  addEventListener(name,fn,capture){
   assert.equal(capture,true);handlers.set(name,fn);
  },
  removeEventListener(){},
  getElementById(){return null}
 };
 const denied=fixture({enabled:false});
 const attached=denied.actions.attach(d);
 let stopped=false;
 handlers.get('click')({target:el,
  preventDefault(){stopped=true;},stopImmediatePropagation(){stopped=true;}
 });
 await new Promise(done=>setImmediate(done));
 assert.equal(stopped,true);
 assert.equal(denied.puts,0);
 assert.equal(denied.outbox.size,0);
 const source=fs.readFileSync(path.join(__dirname,
  '../sync/primary-formal-ui-actions.js'),'utf8');
 assert.match(source,/event\.preventDefault\(\);event\.stopImmediatePropagation\(\)/);
 assert.match(source,/const guardedIds=new Set\(\['saveQuote','clearQuotes','saveWeight'/);
 assert.match(source,/'resetAll'/);
 assert.match(source,/if\(settingsWriteEvent\)return invokeSettings/);
 attached.detach();
});
test('P3-05 source mirror, five document kinds and formal switches unchanged',async()=>{
 const controller=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(controller,/allowSettings:true/);
 assert.match(controller,/settingsChangeVisible/);
 assert.match(controller,/expectedSettings/);
 assert.match(controller,/onSettingsReadback/);
 assert.match(controller,/\['reference','quotes','growth','profile','settings'\]/);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 for(const name of ['primary-documents-operations',
  'primary-documents-business-commands','primary-formal-ui-actions']){
  const content=fs.readFileSync(path.join(__dirname,'../sync',name+'.js'),'utf8');
  assert.ok(html.includes(content),name+' must mirror standalone source');
 }
 const off=fixture({enabled:false});
 assert.equal((await off.click('savePlans')).status,'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal(off.outbox.size,0);
});
