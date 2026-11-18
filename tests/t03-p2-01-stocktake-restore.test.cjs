'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Projection=require('../sync/primary-ui-projection.js');

const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const OTHER_FAMILY='39b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const OTHER_CHILD='69918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ACTOR='dad';
const OP='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const BATCH='79192488-bd70-4b88-8c66-3c5b5fb29ef5';
const SIZES=['NB','S','M','L','XL','XXL'];

const clone=value=>JSON.parse(JSON.stringify(value));
function model(overrides={}){
 const base={
  status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',
  canWrite:false,familyId:FAMILY,childId:CHILD,actorUid:ACTOR,
  inventory:{NB:100,S:140,M:0,L:0,XL:0,XXL:0},
  revisions:{NB:3,S:2,M:1,L:1,XL:1,XXL:1},
  settings:{currentSize:'S',target:{},daily:{}},
  profileData:{babyProfile:{name:'正式宝宝'},dueDate:'2027-01-08',
   birthDate:'',babyWeight:''},
  legacyHistory:{complete:true,hasMore:false,total:0,rows:[]},
  livePurchases:[],liveUses:[]
 };
 return {...base,...overrides,
  inventory:{...base.inventory,...(overrides.inventory||{})},
  revisions:{...base.revisions,...(overrides.revisions||{})},
  settings:{...base.settings,...(overrides.settings||{})},
  profileData:{...base.profileData,...(overrides.profileData||{})},
  legacyHistory:{...base.legacyHistory,...(overrides.legacyHistory||{})}
 };
}
function makeHarness({latest=null,flushStatus='PRIMARY_CLOUD_SYNCED_VERIFIED',
 batchSendStatus='BATCH_ATOMIC_COMMIT_ACKED'}={}){
 const initial=model();
 const latestRead=latest===null?clone(initial):clone(latest);
 const scope={familyId:FAMILY,childId:CHILD,actorUid:ACTOR};
 const elements=new Map(),listeners=new Map();
 let readCalls=0,flushCalls=0,batchSendCalls=0;
 let currentView=null;
 function element(id){
  if(!elements.has(id)){
   elements.set(id,{
    id,value:'',textContent:'',hidden:false,disabled:false,dataset:{},
    style:{},classList:{contains:()=>false},
    addEventListener(){},removeEventListener(){},
    closest(){return this;},querySelectorAll(){return [];}
   });
  }
  return elements.get(id);
 }
 const doc={
  body:{dataset:{}},visibilityState:'hidden',
  getElementById:element,
  addEventListener(type,fn){
   if(!listeners.has(type))listeners.set(type,[]);
   listeners.get(type).push(fn);
  },
  removeEventListener(type,fn){
   listeners.set(type,(listeners.get(type)||[]).filter(x=>x!==fn));
  },
  fireClick(id){
   const target=element(id);
   const event={target,preventDefault(){},stopImmediatePropagation(){}};
   for(const fn of listeners.get('click')||[])fn(event);
  }
 };
 const host={
  navigator:{onLine:true,userAgent:'Node test'},
  crypto:{randomUUID:()=>BATCH},
  Date,Intl,console,setTimeout,clearTimeout,setInterval,clearInterval,
  addEventListener(){},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  confirm:()=>true
 };
 const ui={
  defaults:()=>({inventory:{},transactions:[],quotes:[],weightRecords:[],
   referenceOverrides:{},target:{},daily:{},babyProfile:{}}),
  show(view){currentView=view;},
  clear(){currentView=null;}
 };
 const primary={
  activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
  selectedScope:()=>({...scope}),
  pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0}),
  read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{...initial.inventory},revisions:{...initial.revisions}}),
  syncVerifiedReadModel:async({verifiedReadModel})=>{
   if(verifiedReadModel?.familyId!==FAMILY
     ||verifiedReadModel?.actorUid!==ACTOR
     ||verifiedReadModel?.childId!==CHILD)
    return {status:'PRIMARY_LOCAL_BASELINE_SCOPE_MISMATCH'};
   return {status:'PRIMARY_LOCAL_BASELINE_SYNCED'};
  },
  flush:async()=>{
   flushCalls++;
   return typeof flushStatus==='function'?flushStatus():{status:flushStatus};
  }
 };
 const batchGuard={
  pending:async()=>({status:'BATCH_QUEUE_VERIFIED',outstanding:0}),
  conflicts:async()=>({status:'BATCH_CONFLICTS_VERIFIED',items:[]}),
  queue:async()=>({status:'BATCH_DURABLY_QUEUED'}),
  send:async()=>{
   batchSendCalls++;
   return typeof batchSendStatus==='function'
    ?batchSendStatus():{status:batchSendStatus};
  }
 };
 const commands={
  submit:async()=>({status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:OP})
 };
 const loginController={
  create:()=>({
   connect:async()=> 'CLOUD_READ_ONLY_CONNECTED',
   verifiedContext:()=>({...scope,app:{formalTestApp:true}}),
   signOut:async()=> 'LOGIN_REQUIRED'
  })
 };
 const app=Formal.create({
  host,doc,loginController,
  readModelFactory:()=>({read:async()=>{
   readCalls++;
   return clone(readCalls===1?initial:latestRead);
  }}),
  primaryFactory:()=>primary,
  commandsFactory:{create:()=>commands},
  actionsFactory:{create:options=>Actions.create(options)},
  projection:Projection,ui,scriptLoader:async()=>{},
  batchStocktakeFactory:()=>batchGuard,
  purchaseReleaseEnabled:true,
  purchaseOperatorApproved:()=>true,
  documentWritesEnabled:false
 });
 async function clickStocktake(changes){
  for(const size of SIZES){
   const value=Object.prototype.hasOwnProperty.call(changes,size)
    ?changes[size]:initial.inventory[size];
   element('inv_'+size).value=String(value);
  }
  doc.fireClick('saveStocks');
  for(let i=0;i<100;i++){
   await new Promise(resolve=>setImmediate(resolve));
   const feedback=element('formalStocktakeActionFeedback').textContent||'';
   if(feedback.includes('库存已更新')||feedback.includes('待核验'))return feedback;
   if(readCalls>=2&&app.mode==='unverified')return feedback;
  }
  throw Error('formal stocktake action did not settle');
 }
 return {
  app,doc,element,ui,primary,batchGuard,
  get currentView(){return currentView;},
  get readCalls(){return readCalls;},
  get flushCalls(){return flushCalls;},
  get batchSendCalls(){return batchSendCalls;},
  clickStocktake
 };
}
async function start(h){
 assert.equal(await h.app.start(),'ready');
 assert.equal(h.readCalls,1);
 assert.ok(h.currentView,'initial formal cloud view must render');
}

test('T03-P2-01 single-size stocktake restores after confirmed receipt with no later operation',async()=>{
 const latest=model({inventory:{S:135},revisions:{S:3}});
 const h=makeHarness({latest});await start(h);
 const feedback=await h.clickStocktake({S:135});
 assert.match(feedback,/库存已更新/);
 assert.equal(h.flushCalls,1);
 assert.equal(h.readCalls,2);
 assert.equal(h.currentView.state.inventory.S,135);
 assert.equal(h.currentView.revisions.S,3);
});
test('T03-P2-01 single-size stocktake restores after another device purchases and displays latest stock',async()=>{
 const latest=model({inventory:{S:145},revisions:{S:4}});
 const h=makeHarness({latest});await start(h);
 const feedback=await h.clickStocktake({S:135});
 assert.match(feedback,/库存已更新/);
 assert.equal(h.currentView.state.inventory.S,145);
 assert.equal(h.currentView.revisions.S,4);
});
test('T03-P2-01 single-size stocktake restores after another device consumes and displays latest stock',async()=>{
 const latest=model({inventory:{S:132},revisions:{S:4}});
 const h=makeHarness({latest});await start(h);
 const feedback=await h.clickStocktake({S:135});
 assert.match(feedback,/库存已更新/);
 assert.equal(h.currentView.state.inventory.S,132);
 assert.equal(h.currentView.revisions.S,4);
});
test('T03-P2-01 multi-size batch restores after confirmed receipt with no later operation',async()=>{
 const latest=model({inventory:{NB:120,S:180},revisions:{NB:4,S:3}});
 const h=makeHarness({latest});await start(h);
 const feedback=await h.clickStocktake({NB:120,S:180});
 assert.match(feedback,/库存已更新/);
 assert.equal(h.batchSendCalls,1);
 assert.equal(h.readCalls,2);
 assert.equal(h.currentView.state.inventory.NB,120);
 assert.equal(h.currentView.state.inventory.S,180);
 assert.equal(h.currentView.revisions.NB,4);
 assert.equal(h.currentView.revisions.S,3);
});
test('T03-P2-01 multi-size batch restores all sizes after another device changes one affected size',async()=>{
 const latest=model({inventory:{NB:125,S:180},revisions:{NB:5,S:3}});
 const h=makeHarness({latest});await start(h);
 const feedback=await h.clickStocktake({NB:120,S:180});
 assert.match(feedback,/库存已更新/);
 assert.equal(h.currentView.state.inventory.NB,125);
 assert.equal(h.currentView.state.inventory.S,180);
 assert.equal(h.currentView.revisions.NB,5);
 assert.equal(h.currentView.revisions.S,3);
});
test('T03-P2-01 single-size stocktake remains pending when its revision did not advance',async()=>{
 const latest=model({inventory:{S:135},revisions:{S:2}});
 const h=makeHarness({latest});await start(h);
 const feedback=await h.clickStocktake({S:135});
 assert.match(feedback,/待核验/);
 assert.equal(h.currentView.state.inventory.S,135);
 assert.equal(h.currentView.revisions.S,2);
});
test('T03-P2-01 batch remains pending when any affected size revision did not advance',async()=>{
 const latest=model({inventory:{NB:120,S:180},revisions:{NB:3,S:3}});
 const h=makeHarness({latest});await start(h);
 const feedback=await h.clickStocktake({NB:120,S:180});
 assert.match(feedback,/待核验/);
 assert.equal(h.currentView.state.inventory.NB,120);
 assert.equal(h.currentView.state.inventory.S,180);
});
test('T03-P2-01 unconfirmed 009 receipt does not enter formal restore and remains pending',async()=>{
 const h=makeHarness({flushStatus:'PRIMARY_ACK_UNKNOWN_PRESERVE_ID_AND_QUEUE'});
 await start(h);
 const feedback=await h.clickStocktake({S:135});
 assert.match(feedback,/待核验/);
 assert.equal(h.flushCalls,1);
 assert.equal(h.readCalls,1,'no second formal read without confirmed original 009 receipt');
});
test('T03-P2-01 unconfirmed 027 receipt does not enter formal restore and keeps original batch pending',async()=>{
 const h=makeHarness({batchSendStatus:'BATCH_ACK_UNKNOWN_KEEP_ORIGINAL_ID'});
 await start(h);
 const feedback=await h.clickStocktake({NB:120,S:180});
 assert.match(feedback,/待核验/);
 assert.equal(h.batchSendCalls,1);
 assert.equal(h.readCalls,1,'no second formal read without confirmed original 027 receipt');
});
test('T03-P2-01 incomplete six-size server read remains pending and cannot claim recovery',async()=>{
 const latest=model({inventory:{S:135},revisions:{S:3}});
 delete latest.inventory.XXL;
 const h=makeHarness({latest});await start(h);
 const feedback=await h.clickStocktake({S:135});
 assert.match(feedback,/待核验/);
 assert.equal(h.readCalls,2);
 assert.equal(h.currentView.state.inventory.S,140,'incomplete read must not replace the last verified view');
});
test('T03-P2-01 family identity mismatch rejects single-size stocktake recovery',async()=>{
 const latest=model({familyId:OTHER_FAMILY,inventory:{S:135},revisions:{S:3}});
 const h=makeHarness({latest});await start(h);
 await h.clickStocktake({S:135});
 assert.equal(h.app.mode,'unverified');
 assert.equal(h.currentView,null);
});
test('T03-P2-01 baby identity mismatch rejects batch stocktake recovery',async()=>{
 const latest=model({childId:OTHER_CHILD,inventory:{NB:120,S:180},revisions:{NB:4,S:3}});
 const h=makeHarness({latest});await start(h);
 await h.clickStocktake({NB:120,S:180});
 assert.equal(h.app.mode,'unverified');
 assert.equal(h.currentView,null);
});
test('T03-P2-01 formal page loads the modified controller from its existing relative resource path',()=>{
 const htmlPath=path.resolve(__dirname,'../preview/v1.2.0/formal/index.html');
 const controllerPath=path.resolve(__dirname,'../preview/v1.2.0/formal-controller.js');
 const html=fs.readFileSync(htmlPath,'utf8');
 assert.match(html,/<script src="\.\.\/formal-controller\.js" defer><\/script>/);
 assert.equal(path.resolve(path.dirname(htmlPath),'../formal-controller.js'),controllerPath);
 assert.ok(fs.existsSync(controllerPath));
});
