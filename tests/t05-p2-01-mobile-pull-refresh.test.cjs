'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Projection=require('../sync/primary-ui-projection.js');

const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD_A='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const CHILD_B='69918bcb-a7bc-4b2b-a9eb-f160475fd339';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){
 for(let i=0;i<100;i++){if(fn())return;await tick();}
 assert.fail('expected actual formal controller stage not reached');
}
function cloudModel(scope){
 return {
  status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,
  ...scope,
  inventory:{NB:116,S:140,M:0,L:0,XL:0,XXL:0},
  revisions:{NB:2,S:2,M:1,L:1,XL:1,XXL:1},
  settings:{currentSize:'S',daily:{S:8},target:{S:100}},
  profileData:{babyProfile:{name:'合成宝宝'},
   dueDate:'2027-01-08',birthDate:'',babyWeight:''},
  legacyHistory:{complete:true,hasMore:false,total:0,rows:[]},
  livePurchases:[],liveUses:[]
 };
}
function harness({session=true,connectResult=null,offline=false,
 readError=false,baselineStatus='PRIMARY_LOCAL_BASELINE_SYNCED',hold=[],mobile=true,
 cached=null,cloudInventory=null}={}){
 const scope={familyId:FAMILY,childId:CHILD_A,actorUid:'actor-A'};
 const events=[],messages=[],elements=new Map(),listeners=new Map(),pauses=new Set(hold);
 const waiters=new Map();
 let loggedIn=session,connected=false,failRead=readError,
  connectStatus=connectResult,networkOnline=!offline,
  currentView=null,actions=null,submitted=0,readCount=0,activateCount=0,
  baselineCount=0,loginCount=0,clears=0,currentBaselineStatus=baselineStatus,
  cacheReads=0;
 let businessBusy=false,actionCallbacks=null;
 const docEvents=new Map();
 const item=id=>{
  if(!elements.has(id)){
   const node={id,value:'',hidden:false,disabled:false,dataset:{},
    style:{},classList:{contains:()=>false},
    addEventListener(type,fn){listeners.set(id+':'+type,fn);},
    removeEventListener(){},closest(){return this;},
    querySelectorAll(){return [];},querySelector(){return null;}};
   let value='';
   Object.defineProperty(node,'textContent',{
    get(){return value;},
    set(next){value=String(next);if(id==='formalGateMessage')messages.push(value);}
   });
   elements.set(id,node);
  }
  return elements.get(id);
 };
 const doc={
  body:{dataset:{formalState:'boot'},scrollTop:0},
  documentElement:{scrollTop:0},activeElement:{tagName:'BODY'},
  visibilityState:'hidden',querySelector:()=>null,
  getElementById:item,
  addEventListener(type,fn){
   if(!docEvents.has(type))docEvents.set(type,[]);
   docEvents.get(type).push(fn);
   listeners.set('document:'+type,fn);
  },
  removeEventListener(type,fn){
   if(listeners.get('document:'+type)===fn)
    listeners.delete('document:'+type);
  }
 };
 const pause=async name=>{
  events.push(name+'.entered');
  if(pauses.has(name))await new Promise(resolve=>waiters.set(name,resolve));
 };
 const host={
  navigator:{get onLine(){return networkOnline;}},
  matchMedia:()=>({matches:mobile}),scrollY:0,
  location:{reload(){throw Error('FORBIDDEN_PAGE_RELOAD');}},
  crypto:{randomUUID:()=> '04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'},
  Date,Intl,console,setTimeout,clearTimeout,setInterval,clearInterval,
  addEventListener(type,fn){listeners.set('host:'+type,fn);},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  confirm:()=>true
 };
 const cloud={auth:{getSession:async()=>({data:{session:{user:{id:scope.actorUid}}}})}};
 // Use five fully verified synthetic documents: full refresh MUST NOT claim
 // success on a stock-only read. No real network or family data is accessed.
 const kinds=['reference','quotes','growth','profile','settings'];
 const document=(kind)=>({
  status:'PRIMARY_DOCUMENT_READ_VERIFIED',...scope,kind,revision:2,
  body:kind==='reference'?{referenceOverrides:{}}:
   kind==='profile'?{babyProfile:{name:'合成宝宝'}}:
   kind==='settings'?{target:{S:100},daily:{S:8}}:{items:[]}
 });
 const documentsFactory=()=>({
  acceptVerifiedPrimary(){},
  async read({kind}){return document(kind);},
  async readAll(){return {status:'PRIMARY_DOCUMENTS_FULLY_READ',
   documents:Object.fromEntries(kinds.map(k=>[k,document(k)]))};}
 });
 const documentsOverlay={apply(data,snapshot){return {
  ...data,sharedBusinessDocumentsVerified:true,
  cloudDocumentsActorScope:{familyId:scope.familyId,childId:scope.childId},
  documentRevisions:Object.fromEntries(kinds.map(k=>[k,2])),
  state:{...data.state,referenceOverrides:{}}
 };}};
 const login={
  async connect(){
   loginCount++;
   await pause('connect');
   const status=connectStatus||(loggedIn?'CLOUD_READ_ONLY_CONNECTED':'LOGIN_REQUIRED');
   connected=status==='CLOUD_READ_ONLY_CONNECTED';
   return status;
  },
  verifiedContext:()=>connected?{...scope,app:cloud}:null,
  async confirmOtp(){
   events.push('otp.confirmed');loggedIn=true;connected=true;
   return 'CLOUD_READ_ONLY_CONNECTED';
  },
  signOut:async()=>{loggedIn=false;connected=false;return 'LOGIN_REQUIRED';}
 };
 const ui={
  defaults:()=>({inventory:{},transactions:[],quotes:[],weightRecords:[],
   referenceOverrides:{},target:{},daily:{},babyProfile:{}}),
  show(view){currentView=view;events.push('ui.show');},
  clear(){currentView=null;clears++;events.push('ui.clear');}
 };
 const app=Formal.create({
  host,doc,loginController:{create:()=>login},
  readModelFactory:()=>({read:async()=>{
   readCount++;await pause('read');
   if(failRead)throw Error('synthetic cloud read failure');
   const data=cloudModel(scope);
   if(cloudInventory)data.inventory={...data.inventory,...cloudInventory};
   return data;
  }}),
  primaryFactory:()=>{
   const activatedScope={...scope};
   return {
    cloudWritesEnabled:true,
    selectedScope:()=>({...activatedScope}),
    async lastConfirmedInventory(){
     cacheReads++;await pause('cache');
     const snapshot=cached?{status:'PRIMARY_LAST_CONFIRMED_INVENTORY',
      ...activatedScope,
      inventory:{NB:0,S:90,M:0,L:0,XL:0,XXL:0},
      revisions:{NB:1,S:1,M:1,L:1,XL:1,XXL:1},
      ...cached}:null;
     // Mirror the primary bridge's active-child IDB key check.
     return snapshot?.childId===activatedScope.childId?snapshot:null;
    },
    async activate(){
     activateCount++;await pause('activate');
     return {status:'PRIMARY_OUTBOX_READ_ONLY_READY'};
    },
    async syncVerifiedReadModel(){
     baselineCount++;await pause('sync');
     return {status:currentBaselineStatus};
    },
    pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0}),
    read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
     inventory:cloudModel(scope).inventory,revisions:cloudModel(scope).revisions})
   };
  },
  commandsFactory:{create:()=>({submit:async()=>{
   submitted++;await pause('command');
   return {status:'PRIMARY_OPERATION_DURABLY_QUEUED'};
  }})},
  actionsFactory:{create:options=>{
   actionCallbacks=options;
   actions=Actions.create(options);
   return{attach(document){
    const actual=actions.attach(document);
    return Object.freeze({...actual,
     hasActiveBusinessAction:()=>businessBusy||actual.hasActiveBusinessAction()});
   }};
  }},
  projection:Projection,ui,scriptLoader:async()=>{},
  documentsFactory,documentsOverlay,
  purchaseReleaseEnabled:true,
  purchaseOperatorApproved:()=>true,
  documentWritesEnabled:false
 });
 item('priceEditor').hidden=true;
 item('formalResolveDocumentConflict').hidden=true;
 item('formalResolveBatchConflict').hidden=true;
 return {
  app,doc,host,events,messages,item,listeners,
  captureSave(id,dataset={}){
   const button={id,dataset,closest:()=>button};
   docEvents.get('click')?.[0]?.({target:button});
  },
  settleSave(status,extra={}){actionCallbacks?.notify({status,...extra});},
  get currentView(){return currentView;},
  get actions(){return actions;},
  get readCount(){return readCount;},
  get activateCount(){return activateCount;},
  get baselineCount(){return baselineCount;},
  get cacheReads(){return cacheReads;},
  get loginCount(){return loginCount;},
  get submitted(){return submitted;},
  get clears(){return clears;},
  hold(name){pauses.add(name);},
  async release(name){
   await until(()=>waiters.has(name));
   pauses.delete(name);waiters.get(name)();waiters.delete(name);
  },
  setConnected(value){connected=value;},
  setSession(value){loggedIn=value;},
  setConnectResult(value){connectStatus=value;},
  setReadError(value){failRead=value;},
  setOnline(value){networkOnline=value;},
  setBusinessBusy(value){businessBusy=value;},
  setBaselineStatus(value){currentBaselineStatus=value;},
  switchAccount(actorUid,childId){scope.actorUid=actorUid;scope.childId=childId;}
 };
}

function touch(h,{dy=100,dx=0,target=null,finishDy=dy,
 fingers=1,cancelable=true}={}){
 const x=60,y=90,el=target||{closest:()=>null};
 const t=(px,py)=>({clientX:px,clientY:py});
 const touches=Array.from({length:fingers},(_,i)=>t(x+i*30,y));
 let prevented=0;
 h.listeners.get('document:touchstart')?.({
  touches,target:el
 });
 h.listeners.get('document:touchmove')?.({
  touches:Array.from({length:fingers},(_,i)=>t(x+dx+i*30,y+dy)),
  cancelable,preventDefault(){prevented++;}
 });
 h.listeners.get('document:touchend')?.({
  changedTouches:[t(x+dx,y+finishDy)]
 });
 return {prevented};
}
async function ready(h){
 assert.equal(await h.app.start(),'ready');
 await until(()=>/云端数据已更新|上次完整获取/.test(
  h.item('formalSyncState').textContent));
}
test('T05-P2-01 Android top pull over threshold triggers one real complete cloud refresh and keeps the home',async()=>{
 const h=harness({hold:[]});await ready(h);
 h.hold('read');
 const previous=h.currentView;
 const response=touch(h,{dy:104});
 assert.equal(response.prevented,1,'nonpassive touchmove owns eligible top overscroll');
 await until(()=>h.readCount===2);
 assert.equal(h.currentView,previous,'existing home stays shown before server read returns');
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.item('formalCloudSyncFeedback').textContent,'正在获取云端最新数据…');
 assert.equal(h.events.filter(x=>x==='ui.clear').length,1,'no new application boot');
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 assert.equal(h.readCount,2);
 assert.equal(h.activateCount,1,'primary not activated again for same scope');
 assert.equal(h.baselineCount,2,'same restore path performs fresh IDB baseline check');
 assert.equal(h.doc.body.dataset.formalState,'ready');
});
test('T05-P2-01 small downward pull, reverse pull and horizontally dominant gesture are ignored',async()=>{
 const h=harness();await ready(h);
 const initial=h.readCount;
 assert.equal(touch(h,{dy:49}).prevented,1);
 assert.equal(touch(h,{dy:-120}).prevented,0);
 assert.equal(touch(h,{dy:60,dx:135}).prevented,0);
 await tick();await tick();
 assert.equal(h.readCount,initial);
});
test('T05-P2-01 middle-page scroll does not intercept touchmove or refresh',async()=>{
 const h=harness();await ready(h);
 h.host.scrollY=250;
 assert.equal(touch(h,{dy:155}).prevented,0);
 assert.equal(h.readCount,1);
 h.host.scrollY=0;
 h.doc.documentElement.scrollTop=60;
 assert.equal(touch(h,{dy:155}).prevented,0);
 assert.equal(h.readCount,1);
});
test('T05-P2-01 during in-flight pull, repeated pulls and toolbar refresh cannot launch concurrent reads',async()=>{
 const h=harness();await ready(h);
 h.hold('read');
 touch(h,{dy:103});
 await until(()=>h.readCount===2);
 assert.equal(touch(h,{dy:103}).prevented,0);
 h.listeners.get('formalGetCloudLatest:click')?.();
 await tick();await tick();
 assert.equal(h.readCount,2);
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 assert.equal(h.readCount,2);
});
test('T05-P2-01 both existing refresh buttons and pull use same read/restore path',async()=>{
 const h=harness();await ready(h);
 touch(h,{dy:90});
 await until(()=>h.readCount===2&&h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 h.listeners.get('formalRefresh:click')();
 await until(()=>h.readCount===3&&h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 h.listeners.get('formalGetCloudLatest:click')();
 await until(()=>h.readCount===4&&h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 assert.equal(h.activateCount,1);
 assert.equal(h.baselineCount,4);
 assert.equal(h.doc.body.dataset.formalState,'ready');
});
test('T05-P2-01 read failure after a valid same-household session keeps the old home but never claims success',async()=>{
 const h=harness();await ready(h);
 const view=h.currentView;
 h.setReadError(true);
 touch(h,{dy:110});
 await until(()=>h.readCount===2&&h.item('formalCloudSyncFeedback').textContent.includes('失败'));
 assert.equal(h.item('formalCloudSyncFeedback').textContent,'获取云端数据失败，请检查网络后重试');
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.currentView,view);
 assert.equal(h.item('formalLoadingCard').hidden,true);
});
test('T05-P2-01 offline top pull reports failure without cloud reads, dropping home or using reload',async()=>{
 const h=harness();await ready(h);
 const view=h.currentView;
 h.setOnline(false);
 assert.equal(touch(h,{dy:130}).prevented,1);
 await until(()=>h.item('formalCloudSyncFeedback').textContent.includes('失败'));
 assert.equal(h.item('formalCloudSyncFeedback').textContent,
  '获取云端数据失败，请检查网络后重试');
 assert.equal(h.item('formalSyncState').textContent,
  '获取云端数据失败，请检查网络后重试');
 assert.equal(h.readCount,1);
 assert.equal(h.currentView,view);
 assert.equal(h.doc.body.dataset.formalState,'ready');
});
test('T05-P2-01 editing field, open reference dialog, form controls and horizontal tables cannot trigger gesture',async()=>{
 const h=harness();await ready(h);
 h.doc.activeElement={tagName:'INPUT',value:'未保存的草稿'};
 assert.equal(touch(h,{dy:140}).prevented,0);
 assert.equal(h.readCount,1);
 h.doc.activeElement={tagName:'BODY'};
 h.item('priceEditor').hidden=false;
 assert.equal(touch(h,{dy:140}).prevented,0);
 h.item('priceEditor').hidden=true;
 assert.equal(touch(h,{dy:140,target:{closest:s=>s.includes('input')?{}:null}}).prevented,0);
 assert.equal(touch(h,{dy:140,target:{closest:s=>s.includes('.table-wrap')?{}:null}}).prevented,0);
 assert.equal(touch(h,{dy:140,fingers:2}).prevented,0);
 assert.equal(h.readCount,1);
});
test('T05-P2-01 UI-reported in-flight business work and conflict controls block pull',async()=>{
 const h=harness();await ready(h);
 h.setBusinessBusy(true);
 assert.equal(touch(h,{dy:120}).prevented,0);
 assert.equal(h.readCount,1);
 h.setBusinessBusy(false);
 h.item('formalResolveDocumentConflict').hidden=false;
 assert.equal(touch(h,{dy:120}).prevented,0);
 assert.equal(h.readCount,1);
});
test('T05-P2-01 blurred but unsaved input prevents pull until its draft node is replaced',async()=>{
 const h=harness();await ready(h);
 const draft={tagName:'INPUT',value:'尚未保存的采购偏好',isConnected:true};
 h.listeners.get('document:input')({target:draft});
 assert.equal(touch(h,{dy:130}).prevented,0);
 assert.equal(h.readCount,1);
 assert.equal(draft.value,'尚未保存的采购偏好');
 draft.isConnected=false;
 h.hold('read');touch(h,{dy:130});
 await until(()=>h.readCount===2);
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 assert.equal(h.readCount,2);
});
test('T05-P2-01 account scope changes during a pull never preserve the prior family view',async()=>{
 const h=harness();await ready(h);
 h.hold('read');
 touch(h,{dy:120});
 await until(()=>h.readCount===2);
 h.switchAccount('actor-B',CHILD_B);
 await h.release('read');
 await until(()=>h.doc.body.dataset.formalState!=='ready'||h.currentView===null);
 assert.notEqual(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.currentView,null,'old actor stock removed by the existing scope guard');
});
test('T05-P2-01 desktop and noncoarse devices register no mobile gesture handlers',async()=>{
 const h=harness({mobile:false});await ready(h);
 assert.equal(h.listeners.has('document:touchstart'),false);
 assert.equal(h.listeners.has('document:touchmove'),false);
 assert.equal(h.readCount,1);
});
test('T05-P2-01 source keeps isolated mobile CSS and uses the existing app refresh (no reload)',()=>{
 const controller=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 const module=fs.readFileSync(path.join(__dirname,
  '../sync/primary-formal-ui-actions.js'),'utf8').trim();
 assert.match(controller,/void fetchCloudLatest\(\)/);
 assert.match(controller,/restore\(\{requireComplete:true\}\)/);
 assert.match(controller,/on\('formalRefresh',fetchCloudLatest\)/);
 assert.match(controller,/on\('formalGetCloudLatest',fetchCloudLatest\)/);
 assert.match(controller,/const threshold=76/);
 assert.doesNotMatch(controller,/location\.reload\(|location\.replace\(/);
 assert.match(html,/@media \(pointer:coarse\) and \(hover:none\)/);
 assert.match(html,/overscroll-behavior-y:contain/);
 assert.ok(html.includes(module),'inlined capture module must stay identical');
});

function syntheticEdit(h,id,value,tagName='INPUT'){
 const field=h.item(id);field.tagName=tagName;field.isConnected=true;
 h.listeners.get('document:focusin')?.({target:field});
 field.value=value;
 h.listeners.get('document:input')?.({target:field});
 return field;
}
async function expectOneMorePull(h){
 const next=h.readCount+1;
 touch(h,{dy:120});
 await until(()=>h.readCount===next&&h.item('formalCloudSyncFeedback')
  .textContent==='云端数据已更新');
 assert.equal(h.readCount,next);
}
test('T05-P2-01A unsaved settings prevents pull; confirmed save releases static fields',async()=>{
 const h=harness();await ready(h);
 const input=syntheticEdit(h,'goalPrice','1.20');
 assert.equal(touch(h,{dy:120}).prevented,0);
 h.captureSave('saveSizePreferences');
 h.settleSave('SETTINGS_CLOUD_ACK_APPLIED');
 assert.equal(input.isConnected,true);
 await expectOneMorePull(h);
});
test('T05-P2-01A confirmed quote save releases qPrice; subsequent edit blocks again',async()=>{
 const h=harness();await ready(h);
 const field=syntheticEdit(h,'qPrice','128.90');
 h.captureSave('saveQuote');
 h.settleSave('QUOTES_CLOUD_READBACK_VERIFIED');
 assert.equal(field.isConnected,true);
 await expectOneMorePull(h);
 field.value='130.00';h.listeners.get('document:input')({target:field});
 assert.equal(touch(h,{dy:120}).prevented,0);
 assert.equal(h.readCount,2);
});
test('T05-P2-01A failure and unknown original UUID never release draft',async()=>{
 const h=harness();await ready(h);
 syntheticEdit(h,'goalPrice','1.45');
 h.captureSave('saveSizePreferences');
 h.settleSave('SETTINGS_FORM_INVALID');
 assert.equal(touch(h,{dy:120}).prevented,0);
 h.captureSave('saveSizePreferences');
 h.settleSave('SETTINGS_ACK_UNKNOWN_KEEP_REQUEST_ID',{requestId:'original-id'});
 assert.equal(touch(h,{dy:120}).prevented,0);
 h.settleSave('SETTINGS_COMMITTED_READBACK_REQUIRED',{requestId:'original-id'});
 assert.equal(touch(h,{dy:120}).prevented,0);
 assert.equal(h.readCount,1);
});
test('T05-P2-01A successful save leaves independent unsaved profile protected',async()=>{
 const h=harness();await ready(h);
 syntheticEdit(h,'goalPrice','1.60');
 syntheticEdit(h,'babyName','尚未保存的昵称');
 h.captureSave('saveSizePreferences');
 h.settleSave('SETTINGS_CLOUD_ACK_APPLIED');
 assert.equal(touch(h,{dy:130}).prevented,0);
 h.captureSave('saveProfile');
 h.settleSave('PROFILE_CLOUD_ACK_APPLIED');
 await expectOneMorePull(h);
});
test('T05-P2-01A edit during ACK and distinct settings subsection stay guarded',async()=>{
 const h=harness();await ready(h);
 const field=syntheticEdit(h,'goalPrice','1.30');
 syntheticEdit(h,'target_NB','150');
 h.captureSave('saveSizePreferences');
 field.value='1.10';h.listeners.get('document:input')({target:field});
 h.settleSave('SETTINGS_CLOUD_ACK_APPLIED');
 assert.equal(touch(h,{dy:110}).prevented,0);
 h.captureSave('savePlans');
 h.settleSave('SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.equal(touch(h,{dy:110}).prevented,0);
 assert.equal(h.readCount,1);
});
test('T05-P2-01A revert to focused baseline permits refresh without save',async()=>{
 const h=harness();await ready(h);
 const field=h.item('goalPrice');field.tagName='INPUT';field.value='1.50';field.isConnected=true;
 h.listeners.get('document:focusin')({target:field});
 field.value='1.70';h.listeners.get('document:input')({target:field});
 assert.equal(touch(h,{dy:110}).prevented,0);
 field.value='1.50';h.listeners.get('document:input')({target:field});
 await expectOneMorePull(h);
});

test('T05-P2-02A previously confirmed stock appears while cloud read is still running',async()=>{
 const h=harness({cached:{},hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.app.mode,'boot');
 assert.equal(h.doc.body.dataset.formalState,'boot');
 assert.equal(h.item('formalCachedInventory').hidden,false);
 assert.match(h.item('formalGateMessage').textContent,/上次已确认库存.*正在同步云端.*暂不可修改/);
 assert.equal(h.item('formalLoadingCard').hidden,true);
 assert.equal(h.currentView,null,'no fake full five-page projection');
 assert.equal(h.cacheReads,1);
 await h.release('read');assert.equal(await started,'ready');
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.currentView.state.inventory.S,140,'server replaces cached S=90');
});
test('T05-P2-02A cached gate never exposes business actions, even with queued UUID',async()=>{
 const h=harness({cached:{},hold:['read','cache']});
 const started=h.app.start();await h.release('cache');
 await until(()=>h.item('formalCachedInventory').hidden===false);
 assert.equal(h.app.mode,'boot');
 assert.equal(h.actions,null,'formal business action handlers not installed');
 assert.equal(h.submitted,0);
 assert.equal(h.item('formalRefresh').disabled,true);
 assert.equal(h.item('formalSubmitPending').disabled,true);
 assert.equal(h.readCount,1);
 await h.release('read');await started;
});
test('T05-P2-02A no cache preserves original boot and ready lifecycle',async()=>{
 const h=harness({hold:['read']});
 const started=h.app.start();
 await until(()=>h.readCount===1);
 await tick();
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.item('formalLoadingCard').hidden,false);
 await h.release('read');assert.equal(await started,'ready');
});
test('T05-P2-02A login required never reads or displays prior account cache',async()=>{
 const h=harness({session:false,cached:{}});
 assert.equal(await h.app.start(),'login');
 assert.equal(h.cacheReads,0);
 assert.equal(h.item('formalCachedInventory').hidden,true);
});
test('T05-P2-02A wrong actor or family cache never renders',async()=>{
 for(const change of [{actorUid:'actor-B'},{familyId:'4b3ac16f-25fb-4fbd-8df8-0c7f9f390146'}]){
  const h=harness({cached:change,hold:['read']});
  const started=h.app.start();await until(()=>h.cacheReads===1);await tick();
  assert.equal(h.item('formalCachedInventory').hidden,true);
  await h.release('read');assert.equal(await started,'ready');
 }
});
test('T05-P2-02A wrong active baby cache never renders',async()=>{
 const h=harness({cached:{childId:CHILD_B},hold:['read']});
 const started=h.app.start();await until(()=>h.cacheReads===1);await tick();
 assert.equal(h.item('formalCachedInventory').hidden,true);
 await h.release('read');await started;
});
test('T05-P2-02A read failure retains same-scope old stock only as unsynced gate',async()=>{
 const h=harness({cached:{},readError:true,hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedInventory').hidden===false);
 await h.release('read');
 assert.equal(await started,'cached');
 assert.equal(h.app.mode,'cached');
 assert.match(h.item('formalGateMessage').textContent,/云端暂未同步/);
 assert.equal(h.currentView,null);
 assert.equal(h.submitted,0);
});
test('T05-P2-02A network loss while cache is visible cannot fake sync success',async()=>{
 const h=harness({cached:{},hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedInventory').hidden===false);
 h.setOnline(false);h.setReadError(true);
 await h.release('read');
 assert.equal(await started,'cached');
 assert.match(h.item('formalGateMessage').textContent,/暂未同步/);
 assert.equal(h.item('formalCachedInventory').hidden,false);
});
test('T05-P2-02A changed account while loading erases cached stock immediately',async()=>{
 const h=harness({cached:{},hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedInventory').hidden===false);
 h.switchAccount('actor-B',CHILD_B);
 await h.release('read');await started;
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.item('formalCachedStockGrid').innerHTML,'');
 assert.notEqual(h.app.mode,'ready');
});
test('T05-P2-02A late IDB cache cannot replace already verified current cloud stock',async()=>{
 const h=harness({cached:{},hold:['cache']});
 const started=h.app.start();assert.equal(await started,'ready');
 assert.equal(h.currentView.state.inventory.S,140);
 await h.release('cache');await tick();await tick();
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.app.mode,'ready');
 assert.equal(h.currentView.state.inventory.S,140);
});
test('T05-P2-02A cached counts cannot populate expense or profile fields',async()=>{
 const h=harness({cached:{},hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedInventory').hidden===false);
 assert.equal(h.currentView,null);
 assert.ok(!h.item('formalCachedStockGrid').innerHTML.includes('合成宝宝'));
 assert.ok(!h.item('formalCachedStockGrid').innerHTML.includes('¥'));
 await h.release('read');await started;
});
