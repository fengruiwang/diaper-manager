const test=require('node:test'),assert=require('node:assert/strict');
const Operations=require('../sync/primary-documents-operations.js');
const Commands=require('../sync/primary-documents-business-commands.js');
const Client=require('../sync/primary-documents-client.js');
const Bridge=require('../sync/primary-formal-ui-actions.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const clone=x=>JSON.parse(JSON.stringify(x));
function fastFixture(kind,action,record){
 let actorUid='A',revision=3,body=kind==='growth'?{
  items:[{id:'old-weight',date:'2026-11-14',time:'10:00',
   weight:3.2,legacyExtra:{keep:true}}],
  futureSchema:{nested:['retain']},unknownTop:'keep'
 }:{
  dueDate:'2027-01-08',birthDate:'',
  babyProfile:{name:'原名',sex:'',birthTime:'',birthWeight:'',
   birthLength:'',legacyUnknown:{keep:true}},
  futureSchema:{nested:['retain']},unknownTop:'keep'
 };
 const trace=[],rows=new Map();
 const scope=()=>({familyId:F,actorUid});
 const baseline=()=>({status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind,
  familyId:F,actorUid,childId:C,revision,body:clone(body)});
 const store={
  async get(_scope,id){trace.push('idb.get');return rows.get(id)||null;},
  async enqueue(op){trace.push('idb.enqueue');rows.set(op.id,{...clone(op),status:'pending'});return{duplicate:false};},
  async ready(sc){trace.push('idb.ready');return [...rows.values()].filter(
   x=>x.status==='pending'&&x.actorUid===sc.actorUid);},
  async stats(sc){trace.push('idb.stats');const list=[...rows.values()].filter(
   x=>x.actorUid===sc.actorUid);
   return{outstanding:list.filter(x=>x.status!=='acked').length};},
  async recordResult(_scope,id,result){trace.push('idb.result');
   rows.get(id).status=result.kind==='accepted'?'acked':'conflict';}
 };
 const client={
  async read(){trace.push('rpc.read');return baseline();},
  async put(input){trace.push('rpc.put');assert.equal(input.fastDocument,true);
   body=clone(input.nextBody);revision++;
   return{status:'PRIMARY_DOCUMENT_COMMITTED',kind:input.kind,
    requestId:input.requestId,familyId:F,childId:C,
    revision,duplicate:false};},
  async checkRequest(){trace.push('rpc.receipt');
   return{status:'REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY'};}
 };
 const queue=Operations.create({
  controller:{verifiedContext:scope},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:client,outboxFactory:{create:()=>store},
  contract:{createOperation:input=>clone(input)},
  cloudWritesEnabled:true,referenceAndQuotes:true,
  fastGrowthEnabled:kind==='growth',fastProfileEnabled:kind==='profile',
  allowGrowth:true,allowProfile:true,allowSettings:false
 });
 const commands=Commands.create({client,queue,uuid:()=>ID});
 const submit=()=>commands.submit({...scope(),kind,action,record,
  expectedRevision:3,verifiedBaseline:baseline(),operatorApproved:true});
 const send=()=>queue.send({operatorApproved:true,
  fastDocumentId:ID,fastDocumentKind:kind});
 return{submit,send,trace,rows,get body(){return body;},get revision(){return revision;}};
}
function assertFast(f,answer,kind){
 assert.equal(answer.status,'DOCUMENT_'+kind.toUpperCase()+'_ACK_CONFIRMED');
 assert.equal(answer.requestId,ID);assert.equal(answer.kind,kind);
 assert.equal(answer.familyId,F);assert.equal(answer.actorUid,'A');
 assert.equal(answer.childId,C);assert.equal(answer.expectedRevision,3);
 assert.equal(answer.revision,4);
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,1);
 assert.equal(f.trace.filter(x=>x==='rpc.read').length,0);
 assert.equal(f.trace.filter(x=>x==='rpc.receipt').length,0);
 assert.ok(f.trace.indexOf('idb.enqueue')<f.trace.indexOf('rpc.put'));
 assert.equal(f.rows.get(ID).status,'acked');
}
test('B2-03 growth add uses full baseline, one 026 PUT and preserves document extensions',async()=>{
 const record={id:'new-weight',date:'2026-11-17',time:'09:30',weight:4.1,note:'复查'};
 const f=fastFixture('growth','add',record);
 assert.equal((await f.submit()).status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 const ack=await f.send();assertFast(f,ack,'growth');
 assert.equal(f.body.items.length,2);
 assert.deepEqual(f.body.items[0].legacyExtra,{keep:true});
 assert.equal(f.body.items[1].id,'new-weight');
 assert.deepEqual(f.body.futureSchema,{nested:['retain']});
 assert.equal(f.body.unknownTop,'keep');
});
test('B2-03 growth edit preserves the original record ID and unknown fields',async()=>{
 const f=fastFixture('growth','edit',{id:'old-weight',weight:4.0});
 assert.equal((await f.submit()).status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 const ack=await f.send();assertFast(f,ack,'growth');
 assert.equal(f.body.items.length,1);
 assert.equal(f.body.items[0].id,'old-weight');
 assert.equal(f.body.items[0].weight,4.0);
 assert.deepEqual(f.body.items[0].legacyExtra,{keep:true});
 assert.deepEqual(f.body.futureSchema,{nested:['retain']});
});
test('B2-03 growth delete removes only the selected record',async()=>{
 const f=fastFixture('growth','delete',{id:'old-weight'});
 assert.equal((await f.submit()).status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 const ack=await f.send();assertFast(f,ack,'growth');
 assert.deepEqual(f.body.items,[]);
 assert.deepEqual(f.body.futureSchema,{nested:['retain']});
});
test('B2-03 profile patch changes only submitted fields and preserves unknown fields',async()=>{
 const f=fastFixture('profile','patch',{babyProfile:{name:'新名'}});
 assert.equal((await f.submit()).status,'DOCUMENT_OPERATION_DURABLY_QUEUED');
 const ack=await f.send();assertFast(f,ack,'profile');
 assert.equal(f.body.babyProfile.name,'新名');
 assert.equal(f.body.babyProfile.sex,'');
 assert.deepEqual(f.body.babyProfile.legacyUnknown,{keep:true});
 assert.deepEqual(f.body.futureSchema,{nested:['retain']});
 assert.equal(f.body.unknownTop,'keep');
 assert.equal(f.body.dueDate,'2027-01-08');
});
test('B2-03 actual document client accepts fast growth/profile ACKs from verified primary scope',async()=>{
 for(const kind of ['growth','profile']){
  let preflight=0,discovery=0,call=null;
  const client=Client.create({
   app:{auth:{getSession:async()=>({})},rdb:()=>({rpc:async(_name,args)=>{
    call=args;return{data:{saved:true,kind,family_id:F,child_id:C,
     request_id:args.p_request_id,revision:4,duplicate:false}};
   }})},
   accessPreflight:{create:()=>({verifyAccess:async()=>{
    preflight++;throw Error('unexpected_preflight');}})},
   childReader:{create:()=>({inspectLegacyTarget:async()=>{
    discovery++;throw Error('unexpected_discovery');}})},
   scopeGuard:{requireLegacyMigrationTarget(){}},cloudWritesEnabled:true
  });
  client.acceptVerifiedPrimary({status:'PRIMARY_READ_ONLY_READY',
   source:'cloudbase-primary-receipt-verified',canWrite:false,
   familyId:F,actorUid:'A',childId:C});
  const ack=await client.put({familyId:F,actorUid:'A',kind,requestId:ID,
   expectedRevision:3,operatorApproved:true,fastDocument:true,
   nextBody:kind==='growth'?{items:[]}:{babyProfile:{name:'新名'}}});
  assert.equal(ack.status,'PRIMARY_DOCUMENT_COMMITTED',kind);
  assert.equal(ack.revision,4);assert.equal(ack.kind,kind);
  assert.equal(preflight,0);assert.equal(discovery,0);
  assert.equal(call.p_kind,kind);
 }
});
test('B2-03 profile business action submits only changed fields and applies ACK without readback',async()=>{
 const baseline={familyId:F,actorUid:'A',revision:3,body:{
  dueDate:'2027-01-08',birthDate:'',
  babyProfile:{name:'原名',legacyUnknown:'保留'}
 }};
 let submitted=null,readbacks=0;
 const actions=Bridge.create({
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  commands:{submit:async()=>({status:'UNEXPECTED_PRIMARY_WRITE'})},
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  notify:()=>{},formalModeSelected:()=>true,
  buildAllowsWrites:false,operatorApproved:()=>false,
  buildAllowsDocumentWrites:true,documentOperatorApproved:()=>true,
  purchaseOnly:true,allowReference:false,allowQuotes:false,
  allowGrowth:false,allowProfile:true,allowSettings:false,
  documentCommands:{submit:async input=>{
   submitted=clone(input.record);
   return{status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:ID};
  }},
  documentQueue:{send:async()=>({status:'DOCUMENT_PROFILE_ACK_CONFIRMED',
   kind:'profile',requestId:ID,familyId:F,actorUid:'A',childId:C,
   expectedRevision:3,revision:4,nextBody:{}})},
  readProfileBaseline:()=>baseline,
  readDocumentInput:()=>({kind:'profile',action:'patch',record:{
   dueDate:'2027-01-08',birthDate:'',
   babyProfile:{name:'新名',sex:'',birthTime:'',birthWeight:'',birthLength:''}
  }}),
  onProfileAck:async()=> 'ready',
  onProfileReadback:async()=>{readbacks++;return 'ready';}
 });
 const result=await actions.handle({id:'saveProfile',dataset:{}},{getElementById:()=>null});
 assert.equal(result.status,'PROFILE_CLOUD_ACK_APPLIED');
 assert.deepEqual(submitted,{babyProfile:{name:'新名'}});
 assert.equal(readbacks,0);
});
test('B2-03 growth business action applies exact ACK without full restore',async()=>{
 let readbacks=0;
 const actions=Bridge.create({
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  commands:{submit:async()=>({status:'UNEXPECTED_PRIMARY_WRITE'})},
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  notify:()=>{},formalModeSelected:()=>true,
  buildAllowsWrites:false,operatorApproved:()=>false,
  buildAllowsDocumentWrites:true,documentOperatorApproved:()=>true,
  purchaseOnly:true,allowReference:false,allowQuotes:false,
  allowGrowth:true,allowProfile:false,allowSettings:false,
  documentCommands:{submit:async()=>({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',
   requestId:ID})},
  documentQueue:{send:async()=>({status:'DOCUMENT_GROWTH_ACK_CONFIRMED',
   kind:'growth',requestId:ID,familyId:F,actorUid:'A',childId:C,
   expectedRevision:3,revision:4,nextBody:{items:[]}})},
  readGrowthBaseline:()=>({familyId:F,actorUid:'A',revision:3,
   body:{items:[]}}),
  readDocumentInput:()=>({kind:'growth',action:'add',
   record:{id:'new-weight',date:'2026-11-17',time:'09:30',weight:4.1}}),
  onGrowthAck:async()=> 'ready',
  onGrowthReadback:async()=>{readbacks++;return 'ready';}
 });
 const result=await actions.handle({id:'saveWeight',dataset:{}},{getElementById:()=>null});
 assert.equal(result.status,'GROWTH_CLOUD_ACK_APPLIED');
 assert.equal(readbacks,0);
});


const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

// The real profile ACK callback is private to the formal controller. Exercise
// its unchanged production body, including profileChangeVisible(), from the
// actual business bridge through the existing 026 queue and UI render hook.
function auditedProfileSave(original,form){
 const trace=[],rows=new Map(),rendered=[];
 let body=clone(original),revision=3,ackRecord=null,readbacks=0;
 const base={status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind:'profile',
  familyId:F,actorUid:'A',childId:C,revision:3,body:clone(original)};
 const untouched={
  reference:{status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind:'reference',
   familyId:F,childId:C,revision:2,body:{referenceOverrides:{'brand|series|S':1.6}}},
  quotes:{status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind:'quotes',
   familyId:F,childId:C,revision:1,body:{items:[{id:'q',price:80}]}},
  growth:{status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind:'growth',
   familyId:F,childId:C,revision:1,body:{items:[{id:'g',weight:3.2}]}},
  settings:{status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind:'settings',
   familyId:F,childId:C,revision:0,body:{currentSize:'NB'}}
 };
 const snapshot={status:'PRIMARY_DOCUMENTS_FULLY_READ',
  documents:{...untouched,profile:base}};
 const identity=()=>({familyId:F,actorUid:'A'});
 const environment={
  controller:{verifiedContext:identity},
  ctx:identity(),actor:'A',family:F,mode:'ready',
  identityEpoch:1,documentEpoch:1,
  documentScope:'A\x00'+F,documentSnapshot:snapshot,
  primaryViewBase:{primaryReady:true},
  documentsOverlay:{apply(_primary,next){
   trace.push('ui.overlay');
   for(const [kind,doc] of Object.entries(untouched))
    assert.strictEqual(next.documents[kind],doc,
     'fast profile ACK must not change '+kind);
   return {sharedBusinessDocumentsVerified:true,
    cloudDocumentsActorScope:{childId:C},
    babyProfile:next.documents.profile.body.babyProfile,
    dueDate:next.documents.profile.body.dueDate};
  }},
  showCloudView(view,current){
   assert.equal(current.familyId,F);
   trace.push('ui.render');rendered.push(clone(view));
  }
 };
 const controllerSource=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 const begin=controllerSource.indexOf('function profileChangeVisible(');
 const end=controllerSource.indexOf('function settingsChangeVisible(',begin);
 assert.ok(begin>=0&&end>begin,'production profile verifier required');
 vm.runInNewContext(controllerSource.slice(begin,end),environment);
 const callbackStart=controllerSource.indexOf('onProfileAck:async(ack)=>{');
 const callbackEnd=controllerSource.indexOf(
  'onProfileReadback:async(expected)=>{',callbackStart);
 assert.ok(callbackStart>=0&&callbackEnd>callbackStart,
  'production profile ACK handler required');
 const callbackSource=controllerSource.slice(callbackStart+
  'onProfileAck:'.length,callbackEnd).trim().replace(/,\s*$/,'');
 const realProfileAck=vm.runInNewContext('('+callbackSource+')',environment);
 const storage={
  async get(_scope,id){trace.push('idb.get');return rows.get(id)||null;},
  async enqueue(op){trace.push('idb.enqueue');
   rows.set(op.id,{...clone(op),status:'pending'});return{duplicate:false};},
  async ready(){trace.push('idb.ready');
   return [...rows.values()].filter(x=>x.status==='pending');},
  async stats(){return{outstanding:[...rows.values()]
   .filter(x=>x.status!=='acked').length};},
  async recordResult(_scope,id,result){trace.push('idb.ack');
   rows.get(id).status=result.kind==='accepted'?'acked':'conflict';}
 };
 const client={
  async read(){trace.push('rpc.read');throw Error('unexpected document read');},
  async checkRequest(){trace.push('rpc.receipt');
   throw Error('unexpected receipt query');},
  async put(op){trace.push('rpc.put');
   assert.equal(op.fastDocument,true);
   assert.equal(op.kind,'profile');
   assert.equal(op.expectedRevision,3);
   body=clone(op.nextBody);revision++;
   return {status:'PRIMARY_DOCUMENT_COMMITTED',kind:'profile',
    requestId:op.requestId,familyId:F,childId:C,revision,duplicate:false};
  }
 };
 const queue=Operations.create({
  controller:{verifiedContext:identity},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:client,outboxFactory:{create:()=>storage},
  contract:{createOperation:clone},cloudWritesEnabled:true,
  referenceAndQuotes:true,fastProfileEnabled:true,
  allowGrowth:false,allowProfile:true,allowSettings:false
 });
 const commands=Commands.create({client,queue,uuid:()=>ID});
 let submitted=null;
 const actions=Bridge.create({
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  commands:{submit:async()=>{throw Error('unexpected purchase write');}},
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  notify:()=>{},formalModeSelected:()=>true,
  buildAllowsWrites:false,operatorApproved:()=>false,
  buildAllowsDocumentWrites:true,documentOperatorApproved:()=>true,
  purchaseOnly:true,allowReference:false,allowQuotes:false,
  allowGrowth:false,allowProfile:true,allowSettings:false,
  documentCommands:{submit:async input=>{
   submitted=clone(input.record);return commands.submit(input);
  }},
  documentQueue:queue,
  readProfileBaseline:()=>({...base,actorUid:'A'}),
  readDocumentInput:()=>({kind:'profile',action:'patch',record:clone(form)}),
  onProfileAck:async ack=>{
   ackRecord=clone(ack.record);return realProfileAck(ack);
  },
  onProfileReadback:async()=>{readbacks++;return 'pending';}
 });
 return {save:()=>actions.handle({id:'saveProfile',dataset:{}},
   {getElementById:()=>null}),
  trace,rendered,rows,environment,
  get submitted(){return submitted;},get ackRecord(){return ackRecord;},
  get body(){return body;},get revision(){return revision;},
  get readbacks(){return readbacks;}};
}
function assertAuditAck(f,patch){
 assert.deepEqual(f.submitted,patch);
 assert.deepEqual(f.ackRecord,patch,
  'ACK verification must expect exactly the committed patch');
 assert.equal(f.trace.filter(x=>x==='rpc.put').length,1);
 assert.equal(f.trace.filter(x=>x==='rpc.read').length,0);
 assert.equal(f.trace.filter(x=>x==='rpc.receipt').length,0);
 assert.ok(f.trace.indexOf('idb.enqueue')<f.trace.indexOf('rpc.put'));
 assert.equal(f.trace.filter(x=>x==='ui.render').length,1);
 assert.equal(f.readbacks,0);
 assert.equal(f.rendered.length,1);
 assert.equal(f.environment.documentSnapshot.documents.profile.revision,4);
 assert.equal(f.rows.get(ID).status,'acked');
}
test('B2-03 audit A: missing legacy optionals, dueDate-only patch passes real controller ACK to page',async()=>{
 const f=auditedProfileSave(
  {dueDate:'2027-01-08',babyProfile:{name:'小宝'},unknownTop:{keep:'yes'}},
  {dueDate:'2027-01-10',birthDate:'',
   babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''}}
 );
 const result=await f.save();
 assert.equal(result.status,'PROFILE_CLOUD_ACK_APPLIED');
 assertAuditAck(f,{dueDate:'2027-01-10'});
 assert.equal(f.body.dueDate,'2027-01-10');
 assert.deepEqual(f.body.babyProfile,{name:'小宝'});
 assert.deepEqual(f.body.unknownTop,{keep:'yes'});
 assert.equal(f.rendered[0].dueDate,'2027-01-10');
});
test('B2-03 audit B: numeric strings remain unchanged on name-only patch and ACK renders immediately',async()=>{
 const f=auditedProfileSave(
  {dueDate:'2027-01-08',babyProfile:{name:'小宝',
    birthWeight:'3.250',birthLength:'50.0',unknown:'keep'}},
  {dueDate:'2027-01-08',birthDate:'',
   babyProfile:{name:'小宝二',sex:'',birthTime:'',
    birthWeight:3.25,birthLength:50}}
 );
 const result=await f.save();
 assert.equal(result.status,'PROFILE_CLOUD_ACK_APPLIED');
 assertAuditAck(f,{babyProfile:{name:'小宝二'}});
 assert.equal(f.body.babyProfile.name,'小宝二');
 assert.equal(f.body.babyProfile.birthWeight,'3.250');
 assert.equal(f.body.babyProfile.birthLength,'50.0');
 assert.equal(f.body.babyProfile.unknown,'keep');
 assert.equal(f.rendered[0].babyProfile.name,'小宝二');
});
