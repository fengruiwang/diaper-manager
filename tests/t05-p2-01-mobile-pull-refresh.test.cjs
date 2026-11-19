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
 readError=false,baselineStatus='PRIMARY_LOCAL_BASELINE_SYNCED',hold=[],mobile=true}={}){
 const scope={familyId:FAMILY,childId:CHILD_A,actorUid:'actor-A'};
 const events=[],messages=[],elements=new Map(),listeners=new Map(),pauses=new Set(hold);
 const waiters=new Map();
 let loggedIn=session,connected=false,failRead=readError,
  connectStatus=connectResult,networkOnline=!offline,
  currentView=null,actions=null,submitted=0,readCount=0,activateCount=0,
  baselineCount=0,loginCount=0,clears=0,currentBaselineStatus=baselineStatus;
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
  addEventListener(type,fn){listeners.set('document:'+type,fn);},
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
   return cloudModel(scope);
  }}),
  primaryFactory:()=>{
   const activatedScope={...scope};
   return {
    cloudWritesEnabled:true,
    selectedScope:()=>({...activatedScope}),
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
  actionsFactory:{create:options=>{actions=Actions.create(options);return actions;}},
  projection:Projection,ui,scriptLoader:async()=>{},
  purchaseReleaseEnabled:true,
  purchaseOperatorApproved:()=>true,
  documentWritesEnabled:false
 });
 item('priceEditor').hidden=true;
 item('formalResolveDocumentConflict').hidden=true;
 item('formalResolveBatchConflict').hidden=true;
 return {
  app,doc,host,events,messages,item,listeners,
  get currentView(){return currentView;},
  get actions(){return actions;},
  get readCount(){return readCount;},
  get activateCount(){return activateCount;},
  get baselineCount(){return baselineCount;},
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
async function ready(h){assert.equal(await h.app.start(),'ready');}
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
test('T05-P2-01 offline before touch leaves existing home, reports failure, and performs zero cloud reads',async()=>{
 const h=harness();await ready(h);
 const view=h.currentView;
 h.setOnline(false);
 assert.equal(touch(h,{dy:130}).prevented,0);
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
test('T05-P2-01 in-flight purchase command and conflict action block pull until completion',async()=>{
 const h=harness({hold:[]});await ready(h);
 h.hold('command');
 const buy=h.item('buyNow');buy.dataset={action:'purchase'};
 h.listeners.get('document:click')?.({
  target:buy,preventDefault(){},stopImmediatePropagation(){}
 });
 await until(()=>h.events.includes('command.entered'));
 assert.equal(h.actions.attach?true:false,true);
 assert.equal(touch(h,{dy:120}).prevented,0);
 assert.equal(h.readCount,1);
 await h.release('command');
 await tick();await tick();
 h.item('formalResolveDocumentConflict').hidden=false;
 assert.equal(touch(h,{dy:120}).prevented,0);
 assert.equal(h.readCount,1);
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
