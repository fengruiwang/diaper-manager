const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const Overlay=require('../sync/primary-documents-overlay.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const KINDS=['quotes','reference','growth','profile','settings'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const nextTick=()=>new Promise(resolve=>setImmediate(resolve));
const clone=x=>JSON.parse(JSON.stringify(x));
function snapshot(actor='A',valid=true){
 const body={
  quotes:{items:[]},reference:{referenceOverrides:{}},
  growth:{items:[]},
  profile:{babyProfile:{name:'宝宝'},dueDate:'2027-01-08',birthDate:''},
  settings:{target:{NB:90},daily:{NB:8},currentSize:'NB'}
 };
 const documents=Object.fromEntries(KINDS.map(kind=>[kind,{
  status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind,familyId:FAMILY,
  childId:CHILD,revision:0,body:clone(body[kind])
 }]));
 if(!valid)delete documents.settings.body.daily;
 return {status:'PRIMARY_DOCUMENTS_FULLY_READ',canWrite:false,documents};
}
function fixture({readAll=async()=>snapshot(),timeoutMs=80,onSharedRender}={}){
 let actor='A',loggedIn=true,docReads=0,currentReadAll=readAll,refreshReads=0,currentOne=null;
 let currentChild=CHILD,documentClients=0;const acceptedScopes=[];
 const elements=new Map(),handlers=new Map(),shows=[],clears=[],timeouts=[];
 const element=id=>{
  if(!elements.has(id))elements.set(id,{
   id,hidden:false,disabled:false,value:'',textContent:'',
   addEventListener:(name,fn)=>handlers.set(id+':'+name,fn)
  });
  return elements.get(id);
 };
 const dom={
  body:{dataset:{}},visibilityState:'visible',
  getElementById:element,
  addEventListener:(name,fn)=>handlers.set('doc:'+name,fn)
 };
 const host={
  navigator:{onLine:true},
  crypto:{randomUUID:()=> '04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'},
  setTimeout:(fn,ms)=>{
   timeouts.push(ms);
   return setTimeout(fn,ms===60000?timeoutMs:ms);
  },
  clearTimeout,addEventListener:(name,fn)=>handlers.set('host:'+name,fn)
 };
 const sdk={auth:{getSession:async()=>({
  data:{user:{id:actor,email:actor+'@example.com'},
   session:{user:{id:actor}}}
 })}};
 const context=()=>loggedIn?{app:sdk,actorUid:actor,familyId:FAMILY}:null;
 const primaryRead=async()=>({status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,
  familyId:FAMILY,childId:currentChild,actorUid:actor});
 const projection=()=>({
  status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  familyId:FAMILY,childId:currentChild,actorUid:actor,
  canWrite:false,revisions:{NB:1,S:1,M:1,L:1,XL:1,XXL:1},
  state:{inventory:{NB:0,S:0,M:0,L:0,XL:0,XXL:0},
   transactions:[],quotes:[],weightRecords:[],babyProfile:{}}
 });
 const app=Formal.create({
  host,doc:dom,
  loginController:{create:()=>({
   connect:async()=>loggedIn?'CLOUD_READ_ONLY_CONNECTED':'LOGIN_REQUIRED',
   verifiedContext:context,
   confirmOtp:async()=> 'CLOUD_READ_ONLY_CONNECTED',
   requestOtp:async()=> 'OTP_REQUESTED',
   signOut:async()=>{loggedIn=false;return 'LOGIN_REQUIRED';}
  })},
  readModelFactory:()=>({read:primaryRead}),
  primaryFactory:()=>({
   activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
   pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0})
  }),
  commandsFactory:{create:()=>({submit:async()=>({status:'NO_WRITE'})})},
  actionsFactory:{create:()=>({attach:()=>({detach(){}})})},
  projection:{project:projection},
  ui:{defaults:()=>({}),show:data=>{
   const shared=data.sharedBusinessDocumentsVerified===true;
   shows.push({actor:data.actorUid,shared});
   if(shared)onSharedRender?.();
  },clear:()=>clears.push(actor)},
  documentsFactory:()=>{
   documentClients++;
   return {acceptVerifiedPrimary:verified=>{acceptedScopes.push({
     actor:verified.actorUid,child:verified.childId});return true;},
    readAll:()=>{docReads++;return currentReadAll(actor);},
    read:async({kind})=>{
     refreshReads++;return currentOne?currentOne({kind,actor}):snapshot(actor).documents[kind];
    }};
  },
  documentsOverlay:Overlay,scriptLoader:async()=>{},
  documentWritesEnabled:false
 });
 const status=()=>element('formalSyncState').textContent;
 const uiVerified=()=>/^(云端数据已更新 ·|上次完整获取：)/.test(status());
 async function clickRefresh(){
  const cb=handlers.get('formalRefresh:click');
  assert.equal(typeof cb,'function');
  cb();
  await sleep(12);
 }
 return {app,status,uiVerified,shows,clears,host,timeouts,element,handlers,
  clickRefresh,setActor:value=>actor=value,setChild:value=>currentChild=value,
  setReadAll:handler=>currentReadAll=handler,setReadOne:handler=>currentOne=handler,
  get docReads(){return docReads;},
  get refreshReads(){return refreshReads;},
  get documentClients(){return documentClients;},
  get acceptedScopes(){return acceptedScopes;}
 };
}
test('B1 single-pass five-doc read can exceed 12s without false early sync',{timeout:5000},async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const reads=KINDS.map(kind=>{
  let complete;
  const done=new Promise(resolve=>{complete=resolve;});
  return {kind,done,complete};
 });
 const completed=[];
 let renderVerified;
 const verified=new Promise(resolve=>{renderVerified=resolve;});
 const expected=snapshot();
 const f=fixture({
  timeoutMs:60000,
  onSharedRender:renderVerified,
  readAll:async()=>{
   const documents={};
   for(const {kind,done} of reads){
    documents[kind]=await done;
    completed.push(kind);
   }
   return {...expected,documents};
  }
 });
 const assertPending=()=>{
  assert.match(f.status(),/正在核验共享数据/);
  assert.equal(f.uiVerified(),false);
  assert.equal(f.shows.filter(x=>x.shared).length,0);
 };
 assert.equal(await f.app.start(),'ready');
 assertPending();
 for(const [index,{kind,done,complete}] of reads.slice(0,-1).entries()){
  complete(expected.documents[kind]);
  await done;
  assert.deepEqual(completed,KINDS.slice(0,index+1));
  assertPending();
 }
 t.mock.timers.tick(12001);
 await nextTick();
 assertPending();
 const last=reads.at(-1);
 last.complete(expected.documents[last.kind]);
 await verified;
 assert.deepEqual(completed,KINDS);
 assert.equal(f.docReads,1);
 assert.equal(f.uiVerified(),true);
 assert.equal(f.shows.filter(x=>x.shared).length,1);
 assert.ok(f.timeouts.includes(60000),'complete read timeout must be 60s');
 assert.ok(!f.timeouts.includes(12000),'old 12s overall timeout must be removed');
});
test('P4-02B failed first read must permit explicit refresh and successful retry',async()=>{
 const f=fixture();
 f.setReadAll(async()=>f.docReads===1
  ?{status:'PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE'}:snapshot());
 await f.app.start();
 await nextTick();
 assert.match(f.status(),/读取失败或超时/);
 assert.equal(f.uiVerified(),false);
 assert.equal(f.docReads,1);
 await f.clickRefresh();
 assert.equal(f.docReads,2);
 assert.equal(f.uiVerified(),true);
});
test('P4-02B timed-out read releases same-account retry; late reply cannot fake PASS',async()=>{
 let oldResolve;
 const stale=new Promise(resolve=>{oldResolve=resolve;});
 const f=fixture({timeoutMs:12});
 f.setReadAll(async()=>f.docReads===1?stale:snapshot());
 await f.app.start();
 assert.match(f.status(),/正在核验/);
 await sleep(22);
 assert.match(f.status(),/读取失败或超时/);
 assert.equal(f.uiVerified(),false);
 await f.clickRefresh();
 assert.equal(f.docReads,2);
 assert.equal(f.uiVerified(),true);
 oldResolve({status:'PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE'});
 await nextTick();
 assert.equal(f.uiVerified(),true);
});
test('P4-02B a slow in-flight read is not duplicated by a visibility refresh',async()=>{
 let resolveFirst;
 const pending=new Promise(resolve=>{resolveFirst=resolve;});
 const f=fixture({timeoutMs:100,readAll:()=>pending});
 await f.app.start();
 assert.equal(f.docReads,1);
 f.handlers.get('doc:visibilitychange')();
 await sleep(8);
 assert.equal(f.docReads,1);
 assert.match(f.status(),/正在核验/);
 resolveFirst(snapshot());
 await nextTick();
 assert.equal(f.uiVerified(),true);
});
test('P4-02B a late read from actor A can never render into actor B scope',async()=>{
 let resolveA;
 const aRequest=new Promise(resolve=>{resolveA=resolve;});
 const f=fixture({readAll:actor=>actor==='A'?aRequest:Promise.resolve(snapshot('B'))});
 await f.app.start();
 assert.equal(f.docReads,1);
 f.setActor('B');
 assert.equal(await f.app.restore(),'ready');
 await nextTick();
 assert.equal(f.docReads,2);
 assert.equal(f.uiVerified(),true);
 const prior=f.shows.length;
 resolveA(snapshot('A'));
 await nextTick();
 assert.equal(f.shows.length,prior);
 assert.equal(f.shows.at(-1).actor,'B');
 assert.equal(f.uiVerified(),true);
});
test('P4-02B an incomplete or malformed snapshot can never mark five docs verified',async()=>{
 const f=fixture({readAll:async()=>({status:'PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE'})});
 await f.app.start();
 await nextTick();
 assert.equal(f.uiVerified(),false);
 assert.match(f.status(),/未完全同步/);
 f.setReadAll(async()=>snapshot('A',false));
 await f.clickRefresh();
 assert.equal(f.uiVerified(),false);
 assert.match(f.status(),/读取失败或超时/);
 assert.equal(f.shows.filter(x=>x.shared).length,0);
});
test('P4-02B a verified snapshot is refreshed from cloud and keeps revisions checked',async()=>{
 const f=fixture();
 await f.app.start();
 await nextTick();
 assert.equal(f.uiVerified(),true);
 await f.clickRefresh();
 assert.equal(f.refreshReads,5);
 assert.equal(f.uiVerified(),true);
 assert.ok(f.shows.filter(x=>x.shared).length>=2);
});
test('P4-02B SDK load 404->200 is an intended sequential URL fallback, not a document RPC error',()=>{
 const code=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/m1-controller.js'),'utf8');
 assert.match(code,/for\(const url of SDK_URLS\)/);
 assert.match(code,/await scriptLoader\(url\)/);
 assert.match(code,/catch\(_\)\{\}/);
 assert.match(code,/sdk_unavailable/);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_DOCUMENT_WRITE_ENABLED,true);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,true);
});

test('P4-04C-02 manual refresh gives immediate feedback and cannot show stale success while five reads are pending',async()=>{
 const f=fixture();await f.app.start();await nextTick();
 assert.equal(f.uiVerified(),true);
 let release;
 const slow=new Promise(resolve=>{release=resolve;});
 f.setReadOne(async({kind})=>{await slow;return snapshot().documents[kind];});
 f.handlers.get('formalRefresh:click')();
 await nextTick();
 assert.match(f.status(),/正在刷新/);
 assert.equal(f.element('formalRefresh').disabled,true);
 assert.equal(f.uiVerified(),false,'prior success cannot represent an in-flight refresh');
 // A second click must not create another set of five reads.
 f.handlers.get('formalRefresh:click')();
 await sleep(5);assert.equal(f.refreshReads,5);
 release();await sleep(12);
 assert.equal(f.uiVerified(),true);
 assert.equal(f.element('formalRefresh').disabled,false);
 assert.match(f.status(),/^云端数据已更新 · \d{2}\/\d{2}/);
});
test('P4-04C-02 incomplete refresh must not update full-success status',async()=>{
 const f=fixture();await f.app.start();await nextTick();
 assert.equal(f.uiVerified(),true);
 f.setReadOne(async()=>null);
 f.setReadAll(async()=>({status:'PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE'}));
 f.handlers.get('formalRefresh:click')();
 await sleep(25);
 assert.equal(f.uiVerified(),false);
 assert.match(f.status(),/未完全同步/);
 assert.equal(f.element('formalRefresh').disabled,false);
});

test('B1 startup and refresh reuse one current-session documents client',async()=>{
 const f=fixture();
 await f.app.start();await nextTick();
 assert.equal(f.documentClients,1);
 assert.equal(f.docReads,1);
 assert.deepEqual(f.acceptedScopes[0],{actor:'A',child:CHILD});
 await f.clickRefresh();await nextTick();
 assert.equal(f.documentClients,1,'refresh cannot rebuild five independent scope clients');
 assert.equal(f.refreshReads,5,'one new RPC per document in refresh');
 assert.equal(f.acceptedScopes.length,2);
 f.setActor('B');
 assert.equal(await f.app.restore(),'ready');
 await nextTick();
 assert.equal(f.documentClients,2,'account change discards old document client');
 assert.equal(f.acceptedScopes.at(-1).actor,'B');
});
test('B1 changed primary child invalidates session scope and old rendered snapshot',async()=>{
 const f=fixture();
 await f.app.start();await nextTick();
 const previous=f.shows.length;
 f.setChild('89918bcb-a7bc-4b2b-a9eb-f160475fd339');
 assert.equal(await f.app.restore(),'unverified');
 assert.equal(f.documentClients,1);
 assert.equal(f.shows.length,previous);
 assert.ok(f.clears.length>0);
});
