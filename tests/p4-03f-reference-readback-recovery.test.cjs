const test=require('node:test'),assert=require('node:assert/strict');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const UI=require('../sync/primary-formal-ui-actions.js');
const Overlay=require('../sync/primary-documents-overlay.js');
const next=()=>new Promise(resolve=>setImmediate(resolve));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clone=x=>JSON.parse(JSON.stringify(x));
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const KEY='好奇|小森林|NB';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const KINDS=['reference','quotes','growth','profile','settings'];

function fixture({ambiguous=false}={}){
 let actor='A',submits=0,readAllCalls=0,receiptCalls=0;
 let networkAckKnown=!ambiguous,failSettings=false,failReadAll=false;
 let outstanding=0,confirmed=false,view=null;
 const shows=[],events=new Map(),nodes=new Map(),bridges=[],statusMessages=[];
 let actionOptions=null;
 let oldPrice=1.20,revision=0,referenceOverrides={};
 const els=id=>{
  if(!nodes.has(id))nodes.set(id,{
   id,dataset:{},disabled:false,hidden:false,value:'',textContent:'',
   classList:{contains:()=>false},closest(){return this},
   addEventListener(type,fn){events.set(id+':'+type,fn)}
  });
  return nodes.get(id);
 };
 const doc={
  body:{dataset:{}},visibilityState:'visible',
  getElementById:els,
  querySelectorAll:()=>[],
  addEventListener(type,fn,capture){events.set('doc:'+type,fn)},
  removeEventListener(){}
 };
 els('saveEditedReference').textContent='保存新价格';
 els('saveProfile').textContent='保存宝宝基本资料';
 els('savePlans').textContent='保存目标与日均用量';
 const host={
  navigator:{onLine:true},
  crypto:{randomUUID:()=>ID},
  setTimeout,clearTimeout,addEventListener(type,fn){events.set('host:'+type,fn)}
 };
 function full(){
  const bodies={
   reference:{referenceOverrides:clone(referenceOverrides)},
   quotes:{items:[]},growth:{items:[]},
   profile:{babyProfile:{name:'宝宝'},dueDate:'2027-01-08',birthDate:''},
   settings:{target:{NB:90},daily:{NB:8},currentSize:'NB'}
  };
  const documents={};
  for(const kind of KINDS)documents[kind]={
   kind,status:'PRIMARY_DOCUMENT_READ_VERIFIED',
   familyId:FAMILY,childId:CHILD,revision:kind==='reference'?revision:0,
   body:clone(bodies[kind])
  };
  return {status:'PRIMARY_DOCUMENTS_FULLY_READ',canWrite:false,documents};
 }
 const client={
  async readAll(){
   readAllCalls++;
   return failReadAll?{status:'PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE'}:full();
  },
  async read({kind}){
   if(kind==='settings'&&failSettings)
    return {status:'PRIMARY_DOCUMENT_READ_UNVERIFIED'};
   return clone(full().documents[kind]);
  }
 };
 const queue={
  async pending(){
   return {status:'DOCUMENT_QUEUE_COUNTS_VERIFIED',outstanding};
  },
  async send(){
   if(!confirmed)return {status:'DOCUMENT_QUEUE_EMPTY'};
   if(!networkAckKnown)return {status:'DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID'};
   outstanding=0;return {status:'DOCUMENT_SYNC_CONFIRMED'};
  },
  async checkSavedRequest(id){
   assert.equal(id,ID);
   receiptCalls++;
   return networkAckKnown&&confirmed
    ?{status:'REQUEST_ACK_RECOVERED',requestId:ID}
    :{status:'REQUEST_NOT_VERIFIED_KEEP_PENDING'};
  }
 };
 const command={
  async submit(payload){
   assert.equal(payload.kind,'reference');
   assert.equal(payload.expectedRevision,revision);
   submits++;
   referenceOverrides[KEY]=1.21;revision++;
   confirmed=true;outstanding=ambiguous?0:1;
   return {status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:ID};
  }
 };
 const login={
  create:()=>({
   connect:async()=> 'CLOUD_READ_ONLY_CONNECTED',
   verifiedContext:()=>({actorUid:actor,familyId:FAMILY,app:{
    auth:{getSession:async()=>({data:{user:{id:actor}}})}
   }}),
   signOut:async()=> 'LOGIN_REQUIRED'
  })
 };
 const app=Formal.create({
  host,doc,loginController:login,documentWritesEnabled:true,
  primaryFactory:()=>({read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'}),
   activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
   pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0})}),
  commandsFactory:{create:()=>({submit:async()=>({status:'DENIED'})})},
  readModelFactory:()=>({read:async()=>({status:'PRIMARY_READ_ONLY_READY',canWrite:false})}),
  projection:{project:()=>({
   status:'PRIMARY_READ_ONLY_READY',
   source:'cloudbase-primary-receipt-verified',
   familyId:FAMILY,childId:CHILD,actorUid:actor,
   canWrite:false,revisions:{NB:0,S:0,M:0,L:0,XL:0,XXL:0},
   state:{referenceOverrides:{},inventory:{NB:0,S:0,M:0,L:0,XL:0,XXL:0},
    transactions:[],quotes:[],weightRecords:[],babyProfile:{}}
  })},
  ui:{
   defaults:()=>({}),
   show:data=>{
    view=clone(data);shows.push(view);
   },
   clear:()=>{view=null}
  },
  documentsFactory:()=>client,documentsOverlay:Overlay,
  documentOpsFactory:()=>queue,
  documentCommandsFactory:{create:()=>command},
  actionsFactory:{create:options=>{
   actionOptions=options;
   const bridge=UI.create({...options,
    readDocumentInput:el=>({
     kind:'reference',action:'set',record:{key:KEY,value:1.21}
    })
   });
   bridges.push(bridge);
   return bridge;
  }},
  scriptLoader:async()=>{}
 });
 function clickSave(){
  const target=els('saveEditedReference');
  const ev={target,preventDefault(){},stopImmediatePropagation(){}};
  const fn=events.get('doc:click');assert.equal(typeof fn,'function');fn(ev);
 }
 function submitForm(){
  const fn=events.get('doc:submit');assert.equal(typeof fn,'function');
  fn({target:{id:'priceEditForm'},preventDefault(){},stopImmediatePropagation(){}});
 }
 async function clickRetry(){
  const fn=events.get('formalSyncNow:click');assert.equal(typeof fn,'function');
  fn();await pause(20);await next();
 }
 async function ready(){
  assert.equal(await app.start(),'ready');
  await next();await next();
  assert.equal(view?.sharedBusinessDocumentsVerified,true,'starting page shows all five docs');
  assert.equal(view.state.referenceOverrides[KEY],undefined);
 }
 const getStatus=()=>els('formalSyncState').textContent;
 return {
  app,ready,clickSave,submitForm,clickRetry,shows,bridges,els,getStatus,queue,
  get view(){return view;},
  get actionOptions(){return actionOptions;},
  get submits(){return submits;},
  get receiptCalls(){return receiptCalls;},
  get readAllCalls(){return readAllCalls;},
  setAck:v=>networkAckKnown=v,
  setSettingsFailure:v=>failSettings=v,
  setReadAllFailure:v=>failReadAll=v,
  setOutstanding:v=>outstanding=v,
  setActor:v=>actor=v,
  get actor(){return actor;},
  get version(){return revision;}
 };
}
test('P4-03F R2: PUT committed + receipt+target read correct but settings refresh fails: NO false save PASS',async()=>{
 const f=fixture();await f.ready();
 f.setSettingsFailure(true);f.setReadAllFailure(true);
 f.clickSave();await pause(22);
 assert.equal(f.version,1,'cloud CAS commit exists');
 assert.equal(f.view.state.referenceOverrides[KEY],undefined,'fallback rendered old primary state');
 assert.notEqual(f.getStatus().includes('参考价保存成功'),true,
  'ready page must not imply reference overlay success');
 assert.equal(f.els('saveEditedReference').disabled,true,
  'unverified displayed content must keep original UUID pending');
});
test('P4-03F R2: only full five-doc overlay with target revision and rendered value counts as success',async()=>{
 const f=fixture();await f.ready();
 f.clickSave();await pause(22);
 assert.equal(f.view.state.referenceOverrides[KEY],1.21);
 assert.equal(f.view.documentRevisions.reference,1);
 assert.match(f.getStatus(),/参考价保存成功/);
 assert.equal(f.els('saveEditedReference').disabled,false);
});
test('P4-03F R3: ambiguous original ACK then verified content and retry unlocks reference',async()=>{
 const f=fixture({ambiguous:true});await f.ready();
 f.clickSave();await pause(12);
 assert.equal(f.version,1);
 assert.equal(f.els('saveEditedReference').disabled,true);
 assert.match(f.els('saveEditedReference').textContent,/待确认/);
 f.setAck(true);f.setOutstanding(0);
 await f.clickRetry();
 assert.equal(f.view.state.referenceOverrides[KEY],1.21);
 assert.equal(f.view.documentRevisions.reference,1);
 assert.equal(f.els('saveEditedReference').disabled,false,
  'verified original UUID and actual rendered price should release the button');
 assert.equal(f.els('saveEditedReference').textContent,'保存新价格');
 assert.equal(f.submits,1);
});
test('P4-03F R3: original ACK unknown keeps button locked and cannot create second UUID',async()=>{
 const f=fixture({ambiguous:true});await f.ready();
 f.clickSave();await pause(12);
 await f.clickRetry();
 assert.equal(f.els('saveEditedReference').disabled,true);
 f.clickSave();f.submitForm();await next();
 assert.equal(f.submits,1);
});
test('P4-03F R3: receipt known but failed shared overlay never unlocks the reference button',async()=>{
 const f=fixture({ambiguous:true});await f.ready();
 f.clickSave();await pause(12);
 f.setAck(true);f.setOutstanding(0);
 f.setSettingsFailure(true);f.setReadAllFailure(true);
 await f.clickRetry();
 assert.equal(f.view.state.referenceOverrides[KEY],undefined);
 assert.equal(f.els('saveEditedReference').disabled,true);
 assert.equal(f.submits,1);
});
test('P4-03F R3: a pending reference with outstanding queue 0 still takes explicit original UUID recovery route',async()=>{
 const f=fixture({ambiguous:true});await f.ready();
 f.clickSave();await pause(12);
 assert.equal((await f.queue.pending()).outstanding,0);
 f.setAck(true);
 await f.clickRetry();
 assert.ok(f.receiptCalls>=1);
 assert.equal(f.els('saveEditedReference').disabled,false);
});
test('P4-03F click and submit same action cannot allocate a second request',async()=>{
 const f=fixture();await f.ready();
 f.clickSave();f.submitForm();f.clickSave();await pause(22);
 assert.equal(f.submits,1);
});
test('P4-03F account switch cannot unlock or render A pending request into B scope',async()=>{
 const f=fixture({ambiguous:true});await f.ready();
 f.clickSave();await pause(12);
 assert.equal(f.els('saveEditedReference').disabled,true);
 f.setActor('B');
 await f.app.restore();await pause(12);
 assert.equal(f.view.actorUid,'B');
 f.setAck(true);
 await f.clickRetry();
 assert.equal(f.view.actorUid,'B');
 assert.equal(f.submits,1);
});
test('P4-03F P4-03E profile/settings recovery and stock purchase gates remain intact',()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const source=require('node:fs').readFileSync(
  require('node:path').join(__dirname,'../sync/primary-formal-ui-actions.js'),'utf8');
 assert.match(source,/recoverDocumentButtons/);
 assert.match(source,/documentProgress\(kind,'checking'\)/);
 assert.match(source,/const purchaseAuthorized=\(\)=>buildAllowsWrites===true/);
});

test('B2-01 confirmed ACK updates reference overlay without reading any other document or restoring inventory',async()=>{
 const f=fixture();await f.ready();
 const baseline=f.actionOptions.readReferenceBaseline();
 assert.equal(baseline.revision,0);
 const readAll=f.readAllCalls,receipt=f.receiptCalls,shown=f.shows.length;
 const applied=await f.actionOptions.onReferenceAck({
  kind:'reference',familyId:FAMILY,actorUid:'A',childId:CHILD,
  requestId:ID,expectedRevision:0,revision:1,action:'set',
  record:{key:KEY,value:1.21},
  nextBody:{referenceOverrides:{[KEY]:1.21},
   futureField:{nested:{keep:'all'}}}
 });
 assert.equal(applied,'ready');
 assert.equal(f.view.state.referenceOverrides[KEY],1.21);
 assert.equal(f.actionOptions.readReferenceBaseline().revision,1);
 assert.deepEqual(f.actionOptions.readReferenceBaseline().body.futureField,
  {nested:{keep:'all'}});
 assert.equal(f.shows.length,shown+1,'local view re-render only');
 assert.equal(f.readAllCalls,readAll,'no five-doc reload');
 assert.equal(f.receiptCalls,receipt,'no additional receipt request');
 const stale=await f.actionOptions.onReferenceAck({
  kind:'reference',familyId:FAMILY,actorUid:'A',childId:CHILD,
  requestId:ID,expectedRevision:0,revision:1,action:'set',
  record:{key:KEY,value:1.20},
  nextBody:{referenceOverrides:{[KEY]:1.20}}
 });
 assert.equal(stale,'pending','old revision cannot roll back newer UI');
 assert.equal(f.view.state.referenceOverrides[KEY],1.21);
 f.setActor('B');
 assert.equal(await f.actionOptions.onReferenceAck({
  kind:'reference',familyId:FAMILY,actorUid:'A',childId:CHILD,
  requestId:ID,expectedRevision:1,revision:2,action:'set',
  record:{key:KEY,value:1.30},
  nextBody:{referenceOverrides:{[KEY]:1.30}}
 }), 'pending','A callback cannot mutate B account');
 assert.equal(f.view.state.referenceOverrides[KEY],1.21);
});

test('B2-02 quotes ACK updates only local full-document projection for add/edit/delete/clear',async()=>{
 const f=fixture();await f.ready();
 const readAll=f.readAllCalls,receipt=f.receiptCalls,shows=f.shows.length;
 let version=0;
 const ack=async(action,record,items)=>{
  const next={items,unexpectedRoot:{keep:'latest'}};
  const response=await f.actionOptions.onQuotesAck({
   kind:'quotes',familyId:FAMILY,actorUid:'A',childId:CHILD,
   requestId:ID,expectedRevision:version,revision:version+1,
   action,record,nextBody:next
  });
  assert.equal(response,'ready',action+' should apply the 026 ACK directly');
  version++;
  assert.equal(f.actionOptions.readQuotesBaseline().revision,version);
  assert.deepEqual(f.actionOptions.readQuotesBaseline().body.unexpectedRoot,
   {keep:'latest'});
  assert.equal(f.readAllCalls,readAll,'no whole-document restore for '+action);
  assert.equal(f.receiptCalls,receipt,'no receipt lookup for '+action);
 };
 const q={id:'q1',brand:'好奇',price:55};
 await ack('add',q,[q]);
 assert.equal(f.view.state.quotes.length,1);
 await ack('edit',{id:'q1',price:60},[{...q,price:60}]);
 assert.equal(f.view.state.quotes[0].price,60);
 await ack('delete',{id:'q1'},[]);
 assert.equal(f.view.state.quotes.length,0);
 await ack('add',{id:'q2',brand:'大王'},[{id:'q2',brand:'大王'}]);
 await ack('clear',null,[]);
 assert.equal(f.view.state.quotes.length,0);
 assert.equal(f.shows.length,shows+5);
 assert.equal(await f.actionOptions.onQuotesAck({
  kind:'quotes',familyId:FAMILY,actorUid:'A',childId:CHILD,
  requestId:ID,expectedRevision:0,revision:1,
  action:'add',record:q,nextBody:{items:[q]}}),'pending');
 assert.equal(f.view.state.quotes.length,0,'stale ACK cannot roll back the list');
 f.setActor('B');
 assert.equal(await f.actionOptions.onQuotesAck({
  kind:'quotes',familyId:FAMILY,actorUid:'A',childId:CHILD,
  requestId:ID,expectedRevision:version,revision:version+1,
  action:'add',record:q,nextBody:{items:[q]}}),'pending');
 assert.equal(f.view.state.quotes.length,0,'old A response never updates B');
});
