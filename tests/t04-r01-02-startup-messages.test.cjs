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
 readError=false,baselineStatus='PRIMARY_LOCAL_BASELINE_SYNCED',hold=[]}={}){
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
  body:{dataset:{formalState:'boot'}},visibilityState:'hidden',
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
   submitted++;return {status:'PRIMARY_OPERATION_DURABLY_QUEUED'};
  }})},
  actionsFactory:{create:options=>{actions=Actions.create(options);return actions;}},
  projection:Projection,ui,scriptLoader:async()=>{},
  purchaseReleaseEnabled:true,
  purchaseOperatorApproved:()=>true,
  documentWritesEnabled:false
 });
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
function stage(h,message){
 assert.equal(h.doc.body.dataset.formalState,'boot');
 assert.equal(h.item('formalLoadingCard').hidden,false);
 assert.equal(h.item('formalGateMessage').textContent,message);
 assert.equal(h.item('formalLoginCard').hidden,true);
}
test('R01-02 first-time no session: spinner checks login, then real OTP screen without reading stock',async()=>{
 const h=harness({session:false,hold:['connect']});
 const starting=h.app.start();
 await until(()=>h.events.includes('connect.entered'));
 stage(h,'正在进入小宝管家…');
 assert.equal(h.readCount,0);
 await h.release('connect');
 assert.equal(await starting,'login');
 assert.equal(h.doc.body.dataset.formalState,'login');
 assert.equal(h.item('formalLoginCard').hidden,false);
 assert.equal(h.item('formalLoadingCard').hidden,true);
 assert.equal(h.item('formalGateMessage').textContent,
  '欢迎使用小宝管家，请使用邮箱验证码登录。');
 assert.equal(h.readCount,0);
});
test('T06-P1-01 remembered session: connect, cloud read, activate and IDB sync keep one stable spinner',async()=>{
 const h=harness({hold:['connect','read','activate','sync']});
 const running=h.app.start();
 await until(()=>h.events.includes('connect.entered'));
 stage(h,'正在进入小宝管家…');
 await h.release('connect');
 await until(()=>h.events.includes('read.entered'));
 stage(h,'正在进入小宝管家…');
 assert.equal(h.item('formalRefresh').disabled,true);
 assert.equal(h.currentView,null);
 await h.release('read');
 await until(()=>h.events.includes('activate.entered'));
 stage(h,'正在进入小宝管家…');
 assert.equal(h.currentView,null);
 await h.release('activate');
 await until(()=>h.events.includes('sync.entered'));
 stage(h,'正在进入小宝管家…');
 assert.equal(h.currentView,null);
 await h.release('sync');
 assert.equal(await running,'ready');
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.item('formalLoadingCard').hidden,true);
 assert.equal(h.currentView.state.inventory.NB,116);
 assert.deepEqual(h.messages.filter(m=>m.startsWith('正在')),[
  '正在进入小宝管家…'
 ]);
 assert.equal(h.readCount,1);assert.equal(h.activateCount,1);
 assert.equal(h.baselineCount,1);
});
test('R01-02 expired session is ordinary unauthenticated login, not a network error or stock read',async()=>{
 const h=harness({session:true,connectResult:'LOGIN_REQUIRED'});
 assert.equal(await h.app.start(),'login');
 assert.equal(h.readCount,0);
 assert.equal(h.item('formalGateMessage').textContent,
  '欢迎使用小宝管家，请使用邮箱验证码登录。');
 assert.equal(h.item('formalLoginCard').hidden,false);
});
test('R01-02 offline and cloud authorization failure stop spinner and retain retry, not falsely log out',async()=>{
 const offline=harness({offline:true});
 assert.equal(await offline.app.start(),'offline');
 assert.equal(offline.loginCount,0);assert.equal(offline.readCount,0);
 assert.equal(offline.item('formalLoadingCard').hidden,true);
 assert.match(offline.item('formalGateMessage').textContent,/离线/);
 assert.equal(offline.item('formalGateActions').hidden,false);
 const denied=harness({connectResult:'CONNECT_FAILED'});
 assert.equal(await denied.app.start(),'unverified');
 assert.equal(denied.readCount,0);
 assert.equal(denied.item('formalLoadingCard').hidden,true);
 assert.match(denied.item('formalGateMessage').textContent,/网络|连接/);
 assert.equal(denied.item('formalGateActions').hidden,false);
 const broken=harness({readError:true});
 assert.equal(await broken.app.start(),'unverified');
 assert.equal(broken.item('formalLoadingCard').hidden,true);
 assert.match(broken.item('formalGateMessage').textContent,/核实|家庭/);
});
test('T06-P1-01 family access denied ends boot without old stock or a writable home',async()=>{
 const denied=harness({connectResult:'NO_VISIBLE_FAMILY'});
 assert.equal(await denied.app.start(),'unverified');
 assert.equal(denied.item('formalLoadingCard').hidden,true);
 assert.equal(denied.item('formalLoginCard').hidden,true);
 assert.equal(denied.item('formalGateActions').hidden,false);
 assert.match(denied.item('formalGateMessage').textContent,/家庭|授权/);
 assert.equal(denied.currentView,null);
 assert.equal(denied.readCount,0);
 assert.equal(denied.submitted,0);
});
test('R01-02 OTP success immediately loads household without a second session check',async()=>{
 const h=harness({session:false,hold:['read']});
 assert.equal(await h.app.start(),'login');
 h.item('formalOtp').value='123456';
 const click=h.listeners.get('formalConfirmOtp:click');
 assert.equal(typeof click,'function');
 click();
 await until(()=>h.events.includes('read.entered'));
 stage(h,'正在进入小宝管家…');
 assert.equal(h.loginCount,1,'verified OTP reuses existing authenticated context');
 assert.equal(h.messages.slice(-1)[0],'正在进入小宝管家…');
 await h.release('read');
 await until(()=>h.app.mode==='ready');
 assert.equal(h.currentView.state.inventory.NB,116);
});
test('R01-02 pending local baseline never reveals an operable 009 consume action',async()=>{
 const h=harness({baselineStatus:'PRIMARY_LOCAL_BASELINE_PENDING_OPERATIONS',hold:['sync']});
 const start=h.app.start();
 await until(()=>h.events.includes('sync.entered'));
 stage(h,'正在进入小宝管家…');
 assert.equal(h.currentView,null);
 await h.release('sync');
 assert.equal(await start,'ready','trusted stock may display as before');
 const answer=await h.actions.handle({id:'',dataset:{action:'consume',
  size:'NB',count:'1',useMode:'piece'},textContent:'用 1 片'},{});
 assert.match(answer.status,/PRIMARY_LOCAL_BASELINE_UNVERIFIED/);
 assert.equal(h.submitted,0);
 assert.equal(h.currentView.state.inventory.NB,116);
});
test('R01-02 same-account in-page refresh retains visible home and never reopens full-screen gate',async()=>{
 const h=harness();
 assert.equal(await h.app.start(),'ready');
 const original=h.currentView;
 h.hold('read');
 const refresh=h.app.restore();
 await until(()=>h.readCount===2&&h.events.filter(e=>e==='read.entered').length===2);
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.item('formalLoadingCard').hidden,true);
 assert.equal(h.currentView,original);
 assert.equal(h.messages.filter(m=>m==='正在进入小宝管家…').length,1);
 await h.release('read');
 assert.equal(await refresh,'ready');
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.activateCount,1,'existing primary bridge not activated twice');
});
test('R01-02 account switch clears old home and uses the new account loading stage',async()=>{
 const h=harness();
 assert.equal(await h.app.start(),'ready');
 h.switchAccount('actor-B',CHILD_B);
 h.hold('read');
 const switching=h.app.restore();
 await until(()=>h.events.filter(e=>e==='read.entered').length===2);
 stage(h,'正在进入小宝管家…');
 assert.equal(h.currentView,null,'prior account data is hidden on identity change');
 assert.equal(h.item('formalCurrentAccount').textContent,'—');
 await h.release('read');
 assert.equal(await switching,'ready');
 assert.equal(h.doc.body.dataset.formalState,'ready');
 assert.equal(h.currentView.childId,CHILD_B);
 assert.equal(h.currentView.actorUid,'actor-B');
 assert.equal(h.activateCount,2);
});
test('T06-P1-01 HTML paints a neutral loading label before scripts run',()=>{
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 assert.match(html,/<body data-formal-state="boot">/);
 assert.match(html,/<div class="formal-spinner" aria-hidden="true"><\/div>/);
 assert.match(html,/<p id="formalGateMessage" role="status" aria-live="polite">正在进入小宝管家…<\/p>/);
 assert.match(html,/body:not\(\[data-formal-state="ready"\]\) \.wrap\{display:none!important\}/);
 assert.match(html,/<div id="formalLoginCard" hidden>/);
});
