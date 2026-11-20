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
 cached=null,cloudInventory=null,sharedStock=null,touchMedia=true}={}){
 const scope={familyId:FAMILY,childId:CHILD_A,actorUid:'actor-A'};
 const events=[],messages=[],elements=new Map(),listeners=new Map(),pauses=new Set(hold);
 const waiters=new Map();
 let loggedIn=session,connected=false,failRead=readError,
  connectStatus=connectResult,networkOnline=!offline,
  currentView=null,actions=null,submitted=0,readCount=0,activateCount=0,
  baselineCount=0,loginCount=0,clears=0,currentBaselineStatus=baselineStatus,
  cacheReads=0;
 let businessBusy=false,actionCallbacks=null,clockOffset=0,
  pollCount=0,pollFail=false,pollResponse=null,pendingOut=0,
  activatedPrimary=null;
 const timers=new Map();let nextTimerId=0;
 const time=()=>Date.now()+clockOffset;
 const setTestInterval=(fn,ms)=>{
  const id=++nextTimerId;timers.set(id,{fn,ms,next:time()+ms});
  return id;
 };
 const clearTestInterval=id=>timers.delete(id);
 const advanceClock=ms=>{
  clockOffset+=ms;
  // At most one callback per elapsed interval, as after an App resume.
  for(const [id,timer] of [...timers]){
   if(!timers.has(id)||time()<timer.next)continue;
   timer.next=time()+timer.ms;timer.fn();
  }
 };
 const docEvents=new Map(),eventOptions=new Map(),rootClasses=new Set();
 const dialogNodes=[];
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
  documentElement:{scrollTop:0,classList:{
   add(name){rootClasses.add(name);},contains(name){return rootClasses.has(name);}
  }},activeElement:{tagName:'BODY'},
  visibilityState:'hidden',querySelector:()=>null,
  querySelectorAll:selector=>selector.includes('[role="dialog"]')?dialogNodes:[],
  getElementById:item,
  addEventListener(type,fn,options){
   if(!docEvents.has(type))docEvents.set(type,[]);
   docEvents.get(type).push(fn);
   listeners.set('document:'+type,fn);
   eventOptions.set(type,options);
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
  navigator:{get onLine(){return networkOnline;},maxTouchPoints:mobile?5:0},
  matchMedia:()=>({matches:mobile&&touchMedia}),scrollY:0,
  location:{reload(){throw Error('FORBIDDEN_PAGE_RELOAD');}},
  crypto:{randomUUID:()=> '04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'},
  Date:{now:time},Intl,console,setTimeout,clearTimeout,
  setInterval:setTestInterval,clearInterval:clearTestInterval,
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
   if(failRead)throw failRead instanceof Error?failRead:Error('synthetic cloud read failure');
   const data=cloudModel(scope);
   if(cloudInventory)data.inventory={...data.inventory,...cloudInventory};
   if(sharedStock){
    data.inventory={...data.inventory,...sharedStock.inventory};
    data.revisions={...data.revisions,...sharedStock.revisions};
   }
   return data;
  }}),
  primaryFactory:()=>{
   const activatedScope={...scope};activatedPrimary=activatedScope;
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
    async checkInventory(){
     pollCount++;await pause('poll');
     if(pollFail)return {status:'PRIMARY_INVENTORY_CHECK_UNVERIFIED'};
     if(pollResponse)return pollResponse;
     const latest=cloudModel(scope);
     return {status:'PRIMARY_INVENTORY_CHECK_VERIFIED',
      ...scope,
      inventory:sharedStock?{...latest.inventory,...sharedStock.inventory}:
       cloudInventory?{...latest.inventory,...cloudInventory}:latest.inventory,
      revisions:sharedStock?{...latest.revisions,...sharedStock.revisions}:latest.revisions};
    },
    pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',
     outstanding:pendingOut}),
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
  // A production build has a separate 027 queue guard. Keep the fixture
  // fully scoped so the periodic check cannot assume an unknown queue empty.
  batchStocktakeFactory:()=>({
   pending:async()=>({status:'BATCH_QUEUE_VERIFIED',outstanding:0})
  }),
  purchaseReleaseEnabled:true,
  purchaseOperatorApproved:()=>true,
  documentWritesEnabled:false
 });
 item('priceEditor').hidden=true;
 item('formalResolveDocumentConflict').hidden=true;
 item('formalResolveBatchConflict').hidden=true;
 return {
  app,doc,host,events,messages,item,listeners,eventOptions,
  setDialogs(nodes){dialogNodes.splice(0,dialogNodes.length,...nodes);},
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
  get pollCount(){return pollCount;},
  get timers(){return timers.size;},
  consumeBaseline(){return actionCallbacks?.readConsumeBaseline?.();},
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
  advance:advanceClock,
  visibility(state){doc.visibilityState=state;
   listeners.get('document:visibilitychange')?.();},
  onlineEvent(){listeners.get('host:online')?.();},
  offlineEvent(){listeners.get('host:offline')?.();},
  businessClick(id,dataset={}){
   const button={id,dataset,classList:{contains:()=>false},closest:()=>button};
   const event={target:button,preventDefault(){},stopImmediatePropagation(){}};
   listeners.get('document:click')?.(event);
  },
  setBaselineStatus(value){currentBaselineStatus=value;},
  setPollFail(value){pollFail=value;},
  setPollResponse(value){pollResponse=value;},
  setPendingCount(value){pendingOut=value;},
  switchAccount(actorUid,childId){scope.actorUid=actorUid;scope.childId=childId;},
  changeSelectedChild(childId){if(activatedPrimary)activatedPrimary.childId=childId;}
 };
}

function touch(h,{dy=100,dx=0,target=null,finishDy=dy,
 fingers=1,cancelable=true,cancel=false}={}){
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
 const phase=h.item('formalNotice').dataset.pullPhase;
 if(cancel)h.listeners.get('document:touchcancel')?.({});
 else h.listeners.get('document:touchend')?.({
  changedTouches:[t(x+dx,y+finishDy)]
 });
 return {prevented,phase};
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
test('T06-P2-01 five page panels all share the same verified pull refresh',async()=>{
 const h=harness();await ready(h);
 const names=['overview','compare','history','growth','settings'];
 for(const tab of names){
  h.doc.body.dataset.activeTab=tab;
  const panel={tagName:'DIV',parentElement:null,closest:()=>null,
   dataset:{panel:tab}};
  const before=h.readCount;
  assert.equal(touch(h,{dy:94,target:panel}).phase,'armed',tab+' should arm');
  await until(()=>h.readCount===before+1
   &&h.item('formalNotice').dataset.pullPhase==='success');
  assert.equal(h.doc.body.dataset.activeTab,tab);
  assert.equal(h.doc.body.dataset.formalState,'ready');
  assert.equal(h.currentView.state.inventory.S,140);
 }
 assert.equal(h.readCount,6,'one initial and one per five panels');
});
test('T06-P2-02 hidden parent of price editor dialog no longer blocks all five top pulls',async()=>{
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 assert.match(html,/id="priceEditor"[^>]*hidden>\\s*<div[^>]*role="dialog"[^>]*aria-modal="true"/,
  'production HTML hides the parent, not the child dialog');
 const h=harness();await ready(h);
 const backdrop={id:'priceEditor',hidden:true};
 const childDialog={hidden:false,
  // Real querySelectorAll matches this node despite the hidden ancestor.
  closest:selector=>selector==='[hidden]'?backdrop:null,
  getClientRects:()=>[]};
 h.setDialogs([childDialog]);
 for(const tab of ['overview','compare','history','growth','settings']){
  h.doc.body.dataset.activeTab=tab;
  const before=h.readCount;
  const result=touch(h,{dy:92,target:{closest:()=>null}});
  assert.equal(result.phase,'armed',tab+' top touchstart must qualify');
  assert.equal(result.prevented,1,tab+' touchmove must be consumed');
  await until(()=>h.readCount===before+1
   &&h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
  assert.equal(h.doc.body.dataset.formalState,'ready');
  assert.equal(h.doc.body.dataset.activeTab,tab);
 }
 assert.equal(h.readCount,6);
});
test('T06-P2-02 truly visible dialog still protects form edits and cloud reads',async()=>{
 const h=harness();await ready(h);
 h.setDialogs([{hidden:false,closest:()=>null,getClientRects:()=>[{}]}]);
 assert.equal(touch(h,{dy:98}).prevented,0,
  'visible dialog must block gesture during editing');
 assert.equal(h.readCount,1);
 h.setDialogs([{hidden:false,closest:()=>null,getClientRects:()=>[]}]);
 assert.equal(touch(h,{dy:98}).prevented,1,
  'CSS display:none dialog is not actually visible; pull must work');
 await until(()=>h.readCount===2
  &&h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 h.setDialogs([]);
 assert.equal(touch(h,{dy:98}).prevented,1);
 await until(()=>h.readCount===3);
});
test('T06-P2-01 partial pull gives guidance, armed pull shows release feedback',async()=>{
 const h=harness();await ready(h);
 const baseline=h.readCount;
 const small=touch(h,{dy:39});
 assert.equal(small.phase,'pulling');
 assert.equal(h.item('formalNotice').dataset.pullPhase,undefined);
 assert.equal(h.readCount,baseline);
 h.hold('read');
 const armed=touch(h,{dy:84});
 assert.equal(armed.phase,'armed');
 assert.equal(h.item('formalNotice').dataset.pullPhase,'refreshing');
 await until(()=>h.readCount===baseline+1);
 assert.equal(h.item('formalCloudSyncFeedback').textContent,
  '正在获取云端最新数据…');
 await h.release('read');
 await until(()=>h.item('formalNotice').dataset.pullPhase==='success');
 assert.equal(h.item('formalCloudSyncFeedback').textContent,'云端数据已更新');
});
test('T06-P2-01 Android touch capability works when strict hover media query mismatches',async()=>{
 const h=harness({touchMedia:false});await ready(h);
 assert.equal(h.host.navigator.maxTouchPoints,5);
 assert.equal(h.doc.documentElement.classList.contains('xiaobao-pull-touch'),true);
 assert.equal(h.eventOptions.get('touchmove')?.passive,false);
 assert.equal(h.eventOptions.get('touchmove')?.capture,true);
 assert.equal(h.eventOptions.get('touchstart')?.capture,true);
 assert.equal(touch(h,{dy:94}).prevented,1);
 await until(()=>h.readCount===2);
});
test('T06-P2-01 scrollingElement is authoritative; an actual scrolled page cannot refresh',async()=>{
 const h=harness();await ready(h);
 h.doc.scrollingElement={scrollTop:120};
 assert.equal(touch(h,{dy:122}).prevented,0);
 assert.equal(h.readCount,1);
 h.doc.scrollingElement.scrollTop=0;
 // Android can retain inconsistent body/documentElement/scrollY fallbacks.
 h.host.scrollY=50;h.doc.body.scrollTop=50;h.doc.documentElement.scrollTop=50;
 assert.equal(touch(h,{dy:94}).prevented,1);
 await until(()=>h.readCount===2);
});
test('T06-P2-01 nested scroll, noncancelable touch, cancel and multitouch never refresh',async()=>{
 const h=harness();await ready(h);
 const scrollable={style:{overflowY:'auto'},scrollHeight:420,
  clientHeight:120,parentElement:null,closest:()=>null};
 assert.equal(touch(h,{dy:105,target:scrollable}).prevented,0);
 assert.equal(touch(h,{dy:108,cancelable:false}).prevented,0);
 assert.equal(touch(h,{dy:110,fingers:2}).prevented,0);
 assert.equal(touch(h,{dy:108,cancel:true}).prevented,1);
 assert.equal(h.item('formalNotice').dataset.pullPhase,undefined);
 await tick();await tick();
 assert.equal(h.readCount,1);
});
test('T06-P2-01 cloud failure and offline pull give explicit terminal feedback',async()=>{
 const h=harness();await ready(h);
 h.setReadError(true);
 assert.equal(touch(h,{dy:99}).phase,'armed');
 await until(()=>h.item('formalNotice').dataset.pullPhase==='failure');
 assert.match(h.item('formalCloudSyncFeedback').textContent,/失败/);
 h.setReadError(false);h.setOnline(false);
 assert.equal(touch(h,{dy:99}).phase,'armed');
 await until(()=>h.item('formalNotice').dataset.pullPhase==='failure');
 assert.equal(h.readCount,2,'offline attempt must not read again');
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
 assert.equal(h.doc.documentElement.classList.contains('xiaobao-pull-touch'),false);
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
 assert.match(controller,/restore\(\{requireComplete:true,automatic\}\)/);
 assert.match(controller,/on\('formalRefresh',fetchCloudLatest\)/);
 assert.match(controller,/on\('formalGetCloudLatest',fetchCloudLatest\)/);
 assert.match(controller,/const threshold=64/);
 assert.doesNotMatch(controller,/location\.reload\(|location\.replace\(/);
 assert.match(html,/@media \(pointer:coarse\), \(any-pointer:coarse\), \(hover:none\)/);
 assert.match(html,/overscroll-behavior-y:contain/);
 assert.ok(html.includes('html.xiaobao-pull-touch:has(body'));
 assert.ok(html.includes('data-pull-phase="armed"'));
 assert.ok(html.includes('content:"松开刷新"'));
 assert.ok(html.includes(module),'inlined capture module must stay identical');
 const primary=fs.readFileSync(path.join(__dirname,
  '../sync/primary-cloud-operations.js'),'utf8');
 assert.ok(html.includes(primary),'formal HTML must inline the exact primary bridge');
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


test('T06-P1-01 cached trusted stock stays hidden during a successful cold start',async()=>{
 const h=harness({cached:{},hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.app.mode,'boot');
 assert.equal(h.doc.body.dataset.formalState,'boot');
 assert.equal(h.item('formalCachedInventory').hidden,true,'no standalone readonly flash');
 assert.equal(h.item('formalGateMessage').textContent,'正在进入小宝管家…');
 assert.equal(h.item('formalLoadingCard').hidden,false);
 assert.equal(h.currentView,null,'no unverified five-page projection');
 assert.equal(h.cacheReads,1);
 await h.release('read');assert.equal(await started,'ready');
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.currentView.state.inventory.S,140,'cloud stock replaces cached S=90');
 assert.deepEqual(h.messages.filter(m=>m.startsWith('正在')),['正在进入小宝管家…']);
});

test('T06-P1-01 background cache lookup cannot unlock business actions before ready',async()=>{
 const h=harness({cached:{},hold:['read','cache']});
 const started=h.app.start();await h.release('cache');
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.app.mode,'boot');
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.item('formalLoadingCard').hidden,false);
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

test('T06-P1-01 failed read can reveal same-scope cached stock as non-operable fallback',async()=>{
 const h=harness({cached:{},readError:true,hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.item('formalCachedInventory').hidden,true);
 await h.release('read');
 assert.equal(await started,'cached');
 assert.equal(h.app.mode,'cached');
 assert.equal(h.item('formalCachedInventory').hidden,false);
 assert.equal(h.item('formalLoadingCard').hidden,true);
 assert.match(h.item('formalGateMessage').textContent,/云端暂未同步/);
 assert.equal(h.currentView,null);
 assert.equal(h.submitted,0);
});

test('T06-P1-01 network loss during pending read keeps cache hidden until fallback',async()=>{
 const h=harness({cached:{},hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.item('formalCachedInventory').hidden,true);
 h.setOnline(false);h.setReadError(true);
 await h.release('read');
 assert.equal(await started,'cached');
 assert.match(h.item('formalGateMessage').textContent,/暂未同步/);
 assert.equal(h.item('formalCachedInventory').hidden,false);
 assert.equal(h.submitted,0);
});

test('T06-P1-01 account switch during cold load clears previous cached scope',async()=>{
 const h=harness({cached:{},hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.item('formalCachedInventory').hidden,true);
 h.switchAccount('actor-B',CHILD_B);
 await h.release('read');await started;
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.item('formalCachedStockGrid').innerHTML,'');
 assert.notEqual(h.app.mode,'ready');
});
test('T06-P1-01 denied cloud read cannot reveal old cached inventory',async()=>{
 const h=harness({cached:{},readError:Error('FAMILY_PERMISSION_DENIED'),hold:['read']});
 const starting=h.app.start();
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.item('formalCachedInventory').hidden,true);
 await h.release('read');
 assert.equal(await starting,'unverified');
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.item('formalCachedStockGrid').innerHTML,'');
 assert.match(h.item('formalGateMessage').textContent,/家庭授权未通过/);
 assert.equal(h.currentView,null);
 assert.equal(h.submitted,0);
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

test('T06-P1-01 pending trusted cache cannot populate visible expense or profile fields',async()=>{
 const h=harness({cached:{},hold:['read']});
 const started=h.app.start();
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.item('formalCachedInventory').hidden,true);
 assert.equal(h.currentView,null);
 assert.ok(!h.item('formalCachedStockGrid').innerHTML.includes('合成宝宝'));
 assert.ok(!h.item('formalCachedStockGrid').innerHTML.includes('¥'));
 await h.release('read');await started;
});
test('T05-P3-01 short App switch keeps the exact view and avoids another cloud read',async()=>{
 const h=harness();await ready(h);
 const previous=h.currentView;
 h.doc.body.dataset.activeTab='growth';h.host.scrollY=211;
 h.visibility('hidden');h.advance(12000);h.visibility('visible');
 await tick();await tick();
 assert.equal(h.readCount,1);
 assert.equal(h.loginCount,1);
 assert.equal(h.currentView,previous);
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.doc.body.dataset.activeTab,'growth');
 assert.equal(h.host.scrollY,211);
 assert.equal(h.events.filter(x=>x==='ui.clear').length,1);
});
test('T05-P3-01 after 45 seconds foreground refresh reads behind retained page',async()=>{
 const h=harness();await ready(h);
 const previous=h.currentView;h.doc.body.dataset.activeTab='settings';
 h.host.scrollY=180;h.hold('read');
 h.visibility('hidden');h.advance(46000);h.visibility('visible');
 await until(()=>h.readCount===2);
 assert.equal(h.currentView,previous);
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.doc.body.dataset.activeTab,'settings');
 assert.equal(h.host.scrollY,180);
 assert.equal(h.loginCount,2,'SDK session may be rechecked invisibly; no full-screen gate');
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 assert.equal(h.readCount,2);assert.equal(h.baselineCount,2);
});
test('T05-P3-01 repeated foreground events and online event coalesce into one read',async()=>{
 const h=harness();await ready(h);
 h.hold('read');h.visibility('hidden');h.advance(47000);
 h.visibility('visible');h.onlineEvent();h.visibility('visible');
 await until(()=>h.readCount===2);
 h.visibility('hidden');h.advance(1000);h.visibility('visible');
 assert.equal(h.readCount,2);
 await h.release('read');await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
 assert.equal(h.readCount,2);
});
test('T05-P3-01 automatic sync and manual Android pull cannot issue concurrent reads',async()=>{
 const h=harness();await ready(h);
 h.hold('read');h.visibility('hidden');h.advance(60000);h.visibility('visible');
 await until(()=>h.readCount===2);
 assert.equal(touch(h,{dy:120}).prevented,0);
 h.listeners.get('formalRefresh:click')?.();
 await tick();await tick();assert.equal(h.readCount,2);
 await h.release('read');await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
});
test('T05-P3-01 unsaved draft on mobile blocks all automatic cloud redraw',async()=>{
 const h=harness();await ready(h);
 const input=h.item('babyName');input.tagName='INPUT';input.isConnected=true;input.value='旧名字';
 h.listeners.get('document:focusin')?.({target:input});
 input.value='未保存的新名字';h.listeners.get('document:input')?.({target:input});
 h.visibility('hidden');h.advance(60000);h.visibility('visible');
 await tick();await tick();
 assert.equal(h.readCount,1);assert.equal(input.value,'未保存的新名字');
 assert.match(h.item('formalSyncState').textContent,/未保存内容.*暂缓自动同步/);
});
test('T05-P3-01 unsaved desktop form is protected even with no touch listeners',async()=>{
 const h=harness({mobile:false});await ready(h);
 const input=h.item('goalPrice');input.tagName='INPUT';input.value='1.3';
 h.listeners.get('document:focusin')?.({target:input});
 input.value='1.7';h.listeners.get('document:change')?.({target:input});
 assert.equal(h.listeners.has('document:touchstart'),false);
 h.visibility('hidden');h.advance(90000);h.visibility('visible');
 await tick();assert.equal(h.readCount,1);assert.equal(input.value,'1.7');
});
test('T05-P3-01 during automatic read all captured business save entrypoints fail closed',async()=>{
 const h=harness();await ready(h);
 h.hold('read');h.visibility('hidden');h.advance(46000);h.visibility('visible');
 await until(()=>h.readCount===2);
 const before=h.submitted;
 for(const id of ['buyNow','saveQuote','saveProfile','saveStocks','savePlans','saveSizePreferences'])
  h.businessClick(id);
 assert.equal(h.submitted,before,'no new 009/026/027 operation was created');
 assert.match(h.item('formalSyncState').textContent,/暂不可修改/);
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
});
test('T05-P3-01 foreground switching during active command or conflict skips automatic refresh',async()=>{
 const h=harness();await ready(h);
 h.setBusinessBusy(true);h.visibility('hidden');h.advance(50000);h.visibility('visible');
 await tick();assert.equal(h.readCount,1);
 h.setBusinessBusy(false);h.item('formalResolveDocumentConflict').hidden=false;
 h.visibility('hidden');h.advance(50000);h.visibility('visible');
 await tick();assert.equal(h.readCount,1);
});
test('T05-P3-01 offline and online recovery keep existing data and never claim false success',async()=>{
 const h=harness();await ready(h);
 const view=h.currentView;
 h.setOnline(false);h.offlineEvent();
 assert.match(h.item('formalSyncState').textContent,/网络已断开/);
 h.visibility('hidden');h.advance(47000);h.visibility('visible');
 assert.equal(h.readCount,1);assert.equal(h.currentView,view);
 h.setOnline(true);h.setReadError(true);h.onlineEvent();
 await until(()=>h.readCount===2&&h.item('formalCloudSyncFeedback').textContent.includes('失败'));
 assert.equal(h.currentView,view);
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.notEqual(h.item('formalCloudSyncFeedback').textContent,'云端数据已更新');
});
test('T05-P3-01 online + visible without any offline event only starts one full read',async()=>{
 const h=harness();await ready(h);
 h.hold('read');h.visibility('hidden');h.advance(48000);
 h.onlineEvent();assert.equal(h.readCount,1,'hidden online event cannot refresh');
 h.visibility('visible');await until(()=>h.readCount===2);
 h.onlineEvent();h.visibility('visible');assert.equal(h.readCount,2);
 await h.release('read');await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
});
test('T05-P3-01 actor or child mismatch on foreground erases stale home',async()=>{
 for(const change of [
  {actorUid:'actor-B',childId:CHILD_B},
  {actorUid:'actor-A',childId:CHILD_B}
 ]){
  const h=harness();await ready(h);
  h.switchAccount(change.actorUid,change.childId);
  h.visibility('hidden');h.advance(46000);h.visibility('visible');
  await until(()=>h.currentView===null);
  assert.equal(h.doc.body.dataset.formalState,'unverified');
  assert.equal(h.readCount,change.actorUid==='actor-B'?1:2,
   'changed actor is blocked locally; changed child is rejected by fresh remote read');
 }
});

test('T05-P3-01 no foreground activation during stable cold-start gate',async()=>{
 const h=harness({cached:{},hold:['read']});
 const initial=h.app.start();
 await until(()=>h.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(h.item('formalCachedInventory').hidden,true);
 h.visibility('hidden');h.advance(90000);h.visibility('visible');
 await tick();
 assert.equal(h.readCount,1,'still the one original startup read');
 assert.equal(h.doc.body.dataset.formalState,'boot');
 await h.release('read');await initial;
 assert.equal(h.item('formalCachedInventory').hidden,true);
});
test('T05-P3-01 no retry or automatic UUID flush when pending queue is declared',async()=>{
 const h=harness();await ready(h);
 h.hold('read');
 h.visibility('hidden');h.advance(47000);
 // The original pending indicators and conflict UI guard remain authoritative.
 h.item('formalResolveBatchConflict').hidden=false;
 h.visibility('visible');await tick();
 assert.equal(h.readCount,1);
 assert.equal(h.submitted,0);
 assert.equal(h.events.filter(x=>x==='ui.clear').length,1);
});

test('T05-P3-01 after a meaningful absence automatically receives newer cloud stock',async()=>{
 const h=harness({cloudInventory:{S:222}});await ready(h);
 assert.equal(h.currentView.state.inventory.S,222);
 h.visibility('hidden');h.advance(47000);
 h.visibility('visible');
 await until(()=>h.readCount===2&&h.baselineCount===2);
 assert.equal(h.currentView.state.inventory.S,222);
 assert.equal(h.doc.body.dataset.formalState,'ready');
});
test('T05-P3-01 after cancelling a draft, a later foreground return can sync',async()=>{
 const h=harness();await ready(h);
 const field=h.item('goalPrice');field.tagName='INPUT';field.value='1.2';
 h.listeners.get('document:focusin')?.({target:field});
 field.value='1.6';h.listeners.get('document:input')?.({target:field});
 h.visibility('hidden');h.advance(46000);h.visibility('visible');
 await tick();assert.equal(h.readCount,1);
 field.value='1.2';h.listeners.get('document:input')?.({target:field});
 h.visibility('hidden');h.advance(46000);h.visibility('visible');
 await until(()=>h.readCount===2);
 assert.equal(h.doc.body.dataset.formalState,'ready');
});

test('T05-P3-01 draft typed while automatic cloud read is in flight is not overwritten',async()=>{
 const h=harness();await ready(h);
 const before=h.currentView;h.hold('read');
 h.visibility('hidden');h.advance(50000);h.visibility('visible');
 await until(()=>h.readCount===2);
 const field=h.item('babyName');field.tagName='INPUT';field.value='云端旧昵称';
 h.listeners.get('document:focusin')?.({target:field});
 field.value='这会刚刚输入的草稿';h.listeners.get('document:input')?.({target:field});
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent.includes('自动同步已暂缓'));
 assert.equal(h.currentView,before);
 assert.equal(field.value,'这会刚刚输入的草稿');
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.baselineCount,1,'draft interrupts before IDB baseline sync');
 assert.notEqual(h.item('formalCloudSyncFeedback').textContent,'云端数据已更新');
});
test('T05-P3-01 a failed background read and unsaved input never produce UUID',async()=>{
 const h=harness();await ready(h);
 h.hold('read');h.visibility('hidden');h.advance(50000);h.visibility('visible');
 await until(()=>h.readCount===2);
 const field=h.item('qPrice');field.tagName='INPUT';field.value='120';
 h.listeners.get('document:focusin')?.({target:field});
 field.value='133';h.listeners.get('document:input')?.({target:field});
 h.businessClick('saveQuote');
 assert.equal(h.submitted,0);
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent.includes('自动同步已暂缓'));
 assert.equal(field.value,'133');
 assert.equal(h.submitted,0);
});

test('T05-P3-02 unchanged stock on visible page uses one small RPC, no full read or DOM render',async()=>{
 const h=harness();await ready(h);
 h.visibility('visible');assert.equal(h.timers,1);
 const view=h.currentView,before=h.events.filter(e=>e==='ui.show').length;
 h.advance(30000);await until(()=>h.pollCount===1);await tick();await tick();
 assert.equal(h.readCount,1);
 assert.equal(h.events.filter(e=>e==='ui.show').length,before);
 assert.equal(h.currentView,view);
 assert.equal(h.baselineCount,1);
});
test('T05-P3-02 two phones see one another inventory change without manual refresh',async()=>{
 const shared={inventory:{S:116},revisions:{S:2}};
 const a=harness({sharedStock:shared}),b=harness({sharedStock:shared});
 await ready(a);await ready(b);
 assert.equal(b.currentView.state.inventory.S,116);
 a.visibility('visible');b.visibility('visible');
 // Phone A's real 009 ACK is represented by the authoritative shared server.
 shared.inventory.S=115;shared.revisions.S=3;
 b.advance(30000);
 await until(()=>b.readCount===2&&b.currentView.state.inventory.S===115);
 assert.equal(a.readCount,1);
 assert.equal(b.currentView.state.inventory.S,115);
 assert.equal(b.currentView.revisions.S,3);
 assert.equal(b.baselineCount,2);
 assert.equal(b.loginCount,2,'same prior full-read path performs existing checks');
 const next=b.consumeBaseline();
 assert.equal(next?.inventory?.S,115,'next consume receives refreshed stock');
 // A second authenticated 009 result remains authoritative, not local 116.
 shared.inventory.S=114;shared.revisions.S=4;
 b.advance(30000);
 await until(()=>b.readCount===3&&b.currentView.state.inventory.S===114);
 assert.equal(b.currentView.revisions.S,4);
 assert.equal(b.submitted,0,'poll itself never generated a UUID');
});
test('T05-P3-02 revision-only change runs existing full read once',async()=>{
 const shared={inventory:{S:140},revisions:{S:2}};
 const h=harness({sharedStock:shared});await ready(h);
 h.visibility('visible');shared.revisions.S=3;
 h.advance(30000);
 await until(()=>h.readCount===2&&h.baselineCount===2
  &&h.currentView.revisions.S===3);
 assert.equal(h.currentView.revisions.S,3);
 assert.equal(h.pollCount,1);
});
test('T05-P3-02 hidden and offline pages stop the timer and issue no RPC',async()=>{
 const h=harness();await ready(h);
 h.visibility('visible');assert.equal(h.timers,1);
 h.visibility('hidden');assert.equal(h.timers,0);
 h.advance(120000);await tick();assert.equal(h.pollCount,0);
 h.setOnline(false);h.offlineEvent();h.visibility('visible');
 h.advance(60000);await tick();
 assert.equal(h.timers,0);assert.equal(h.pollCount,0);
 assert.equal(h.readCount,1);
});
test('T05-P3-02 foreground restore wins over an in-flight light RPC',async()=>{
 const h=harness();await ready(h);h.visibility('visible');h.hold('poll');
 h.advance(30000);await until(()=>h.pollCount===1);
 h.hold('read');
 h.visibility('hidden');h.advance(46000);h.visibility('visible');
 await until(()=>h.readCount===2);
 await h.release('poll');await tick();
 assert.equal(h.readCount,2);
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
});
test('T05-P3-02 manual pull in flight blocks periodic RPC and no duplicate full reads',async()=>{
 const h=harness();await ready(h);h.visibility('visible');h.hold('read');
 touch(h,{dy:105});await until(()=>h.readCount===2);
 h.advance(30000);await tick();await tick();
 assert.equal(h.pollCount,0);
 assert.equal(h.readCount,2);
 await h.release('read');
 await until(()=>h.item('formalCloudSyncFeedback').textContent==='云端数据已更新');
});
test('T05-P3-02 active business and conflict review defer light query',async()=>{
 const h=harness();await ready(h);h.visibility('visible');
 h.setBusinessBusy(true);h.advance(30000);await tick();
 assert.equal(h.pollCount,0);
 h.setBusinessBusy(false);
 h.item('formalResolveDocumentConflict').hidden=false;
 h.advance(30000);await tick();assert.equal(h.pollCount,0);
 h.item('formalResolveDocumentConflict').hidden=true;
 h.advance(30000);await until(()=>h.pollCount===1);
});
test('T05-P3-02 desktop unsaved form and reference modal block polling',async()=>{
 const h=harness({mobile:false});await ready(h);h.visibility('visible');
 const field=h.item('goalPrice');field.tagName='INPUT';field.value='1.2';
 h.listeners.get('document:focusin')({target:field});
 field.value='2.3';h.listeners.get('document:input')({target:field});
 h.advance(30000);await tick();assert.equal(h.pollCount,0);
 field.value='1.2';h.listeners.get('document:input')({target:field});
 h.item('priceEditor').hidden=false;h.advance(30000);await tick();
 assert.equal(h.pollCount,0);
 h.item('priceEditor').hidden=true;h.advance(30000);
 await until(()=>h.pollCount===1);
 assert.equal(h.readCount,1);
});
test('T05-P3-02 outstanding UUID queue defers polling without replay',async()=>{
 const h=harness();h.setPendingCount(1);await ready(h);
 h.visibility('visible');await until(()=>h.item('formalPendingCount').textContent.includes('1'));
 h.advance(60000);await tick();
 assert.equal(h.pollCount,0);assert.equal(h.readCount,1);assert.equal(h.submitted,0);
});
test('T05-P3-02 invalid lightweight response cannot mutate old view',async()=>{
 const h=harness();await ready(h);h.visibility('visible');
 const prior=h.currentView;
 h.setPollFail(true);h.advance(30000);await until(()=>h.pollCount===1);
 await tick();assert.equal(h.currentView,prior);assert.equal(h.readCount,1);
 assert.equal(h.doc.body.dataset.formalState,'ready');
});
test('T05-P3-02 actor or child scope switch clears the stale view',async()=>{
 for(const change of [{actorUid:'actor-B',childId:CHILD_A},
  {actorUid:'actor-A',childId:CHILD_B}]){
  const h=harness();await ready(h);h.visibility('visible');
  if(change.actorUid==='actor-B')h.switchAccount(change.actorUid,CHILD_A);
  else h.changeSelectedChild(CHILD_B);
  h.advance(30000);await until(()=>h.currentView===null);
  assert.equal(h.doc.body.dataset.formalState,'unverified');
  assert.equal(h.readCount,1);
 }
});

test('T05-P3-02 login and cold-start gates have no inventory polls',async()=>{
 const h=harness({session:false});assert.equal(await h.app.start(),'login');
 h.visibility('visible');h.advance(60000);
 assert.equal(h.timers,0);assert.equal(h.pollCount,0);
 const c=harness({cached:{},hold:['read']});
 const start=c.app.start();await until(()=>c.item('formalCachedStockGrid').innerHTML?.includes('90'));
 assert.equal(c.item('formalCachedInventory').hidden,true);
 c.visibility('visible');c.advance(60000);assert.equal(c.pollCount,0);
 await c.release('read');await start;
});
test('T05-P3-02 late lightweight result during an active business action does not refresh',async()=>{
 const shared={inventory:{S:116},revisions:{S:2}};
 const h=harness({sharedStock:shared});await ready(h);
 h.visibility('visible');h.hold('poll');h.advance(30000);
 await until(()=>h.pollCount===1);
 shared.inventory.S=115;shared.revisions.S=3;
 h.setBusinessBusy(true);await h.release('poll');await tick();await tick();
 assert.equal(h.readCount,1);
 h.setBusinessBusy(false);h.advance(30000);
 await until(()=>h.pollCount===2&&h.readCount===2&&h.baselineCount===2
  &&h.currentView.state.inventory.S===115);
 assert.equal(h.currentView.state.inventory.S,115);
});

test('T05-P3-02 interrupted hidden poll does not permanently block future foreground checks',async()=>{
 const h=harness();await ready(h);h.visibility('visible');
 h.hold('poll');h.advance(30000);await until(()=>h.pollCount===1);
 h.visibility('hidden');assert.equal(h.timers,0);
 await h.release('poll');
 h.visibility('visible');assert.equal(h.timers,1);
 h.advance(30000);await until(()=>h.pollCount===2);
 assert.equal(h.readCount,1,'both unchanged checks avoid heavy reads');
});
