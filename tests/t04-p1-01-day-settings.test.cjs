'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Commands=require('../sync/primary-business-commands.js');
const Projection=require('../sync/primary-ui-projection.js');
const Overlay=require('../sync/primary-documents-overlay.js');
// Use the same browser root dependency that the production controller uses
// for its fast 009 ACK. No real CloudBase or IndexedDB is invoked.
const oldWindow=global.window;
global.window={XBPrimaryBusinessDate:require('../sync/primary-business-date.js')};
const Formal=require('../preview/v1.2.0/formal-controller.js');
if(oldWindow===undefined)delete global.window;else global.window=oldWindow;
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const OTHER_CHILD='69918bcb-a7bc-4b2b-a9eb-f160475fd339';
const SIZES=['NB','S','M','L','XL','XXL'];
const uuid=n=>'04e4577d-8a3d-4dd1-a7d3-'+String(n).padStart(12,'0');
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function eventually(predicate){
 for(let i=0;i<60;i++){if(predicate())return;await tick();}
 assert.fail('expected async formal cloud state was not reached');
}
function harness({daily=12,stock=140,mode='ready'}={}){
 const scope={familyId:F,childId:CHILD,actorUid:'dad'};
 const elements=new Map(),listeners=new Map();
 const operations=[],flushes=[];
 let currentView=null,readCalls=0,readAllCalls=0,settingsRevision=1;
 let remoteDaily=daily,readMode=mode,serverStock=stock,serverRevision=2,ids=0;
 let actions=null,callbacks=null;
 const pending=[];
 function el(id){
  if(!elements.has(id))elements.set(id,{
   id,value:'',textContent:'',hidden:false,disabled:false,dataset:{},
   style:{},classList:{contains:()=>false},addEventListener(){},
   removeEventListener(){},querySelectorAll(){return [];},closest(){return this;}
  });
  return elements.get(id);
 }
 const doc={
  body:{dataset:{}},visibilityState:'hidden',
  getElementById:el,
  addEventListener(type,fn){const a=listeners.get(type)||[];a.push(fn);listeners.set(type,a);},
  removeEventListener(type,fn){
   listeners.set(type,(listeners.get(type)||[]).filter(item=>item!==fn));
  },
  click(id,dataset,textContent=''){
   const target=el(id);target.dataset=dataset;target.textContent=textContent;
   const event={target,preventDefault(){},stopImmediatePropagation(){}};
   for(const listener of listeners.get('click')||[])listener(event);
  }
 };
 const host={
  navigator:{onLine:true},
  crypto:{randomUUID:()=>{ids++;return uuid(ids);}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  setTimeout,clearTimeout,setInterval,clearInterval,Date,Intl,console,
  addEventListener(){},confirm:()=>true
 };
 const ui={
  defaults:()=>({transactions:[],quotes:[],weightRecords:[],
   inventory:{},referenceOverrides:{},babyProfile:{},target:{},daily:{}}),
  show(view){currentView=view;},clear(){currentView=null;}
 };
 const sessionApp={auth:{getSession:async()=>({data:{session:{user:{id:scope.actorUid}}}})}};
 const currentContext=()=>({...scope,app:sessionApp});
 function readModel(){
  const inventory={NB:20,S:serverStock,M:0,L:0,XL:0,XXL:0};
  const revisions={NB:1,S:serverRevision,M:1,L:1,XL:1,XXL:1};
  return {status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
   canWrite:false,...scope,inventory,revisions,
   settings:{currentSize:'S',daily:{S:8},target:{S:100},sizeMode:'manual'},
   profileData:{babyProfile:{name:'测试宝宝'},dueDate:'2027-01-08',
    birthDate:'',babyWeight:''},
   legacyHistory:{complete:true,total:0,hasMore:false,rows:[]},
   livePurchases:[],liveUses:[]};
 }
 function document(kind){
  const body=kind==='settings'
   ?{currentSize:'S',daily:{S:remoteDaily},target:{S:100}}
   :kind==='profile'
   ?{babyProfile:{name:'测试宝宝'},dueDate:'2027-01-08',birthDate:'',babyWeight:''}
   :kind==='reference'?{referenceOverrides:{}}:{items:[]};
  return {status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind,
   familyId:scope.familyId,childId:scope.childId,
   revision:kind==='settings'?settingsRevision:1,body};
 }
 const kinds=['reference','quotes','growth','profile','settings'];
 const snapshot=()=>({status:'PRIMARY_DOCUMENTS_FULLY_READ',
  documents:Object.fromEntries(kinds.map(kind=>[kind,document(kind)]))});
 const documentsClient={
  acceptVerifiedPrimary:()=>true,
  async readAll(){
   readAllCalls++;
   if(readMode==='delay')return new Promise((resolve,reject)=>pending.push({resolve,reject}));
   if(readMode==='fail')throw Error('synthetic five-document read failure');
   return snapshot();
  },
  async read({kind}){return document(kind);}
 };
 const primary={
  cloudWritesEnabled:true,
  selectedScope:()=>({...scope}),
  activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
  pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0}),
  read:async()=>{
   const model=readModel();
   return {status:'PRIMARY_CLOUD_READ_VERIFIED',
    inventory:model.inventory,revisions:model.revisions};
  },
  syncVerifiedReadModel:async({verifiedReadModel})=>
   verifiedReadModel?.familyId===scope.familyId
    &&verifiedReadModel?.actorUid===scope.actorUid
    &&verifiedReadModel?.childId===scope.childId
    ?{status:'PRIMARY_LOCAL_BASELINE_SYNCED'}
    :{status:'PRIMARY_LOCAL_BASELINE_SCOPE_MISMATCH'},
  queue:async op=>{
   operations.push(op);
   return {status:'PRIMARY_OPERATION_DURABLY_QUEUED',
    operationId:op.id,fastConsume:op.payload.kind==='use'};
  },
  flush:async ()=>{
   const op=operations.at(-1);
   assert.ok(op,'cannot flush without durable operation');
   const n=op.payload.amount;
   assert.ok(n>0&&n<=serverStock,'no overconsumption');
   serverStock-=n;serverRevision++;
   flushes.push(op);
   return {status:'PRIMARY_USE_ACK_CONFIRMED',operationId:op.id,
    operation:op,cloudWriteCommitted:true,
    familyId:scope.familyId,actorUid:scope.actorUid,childId:scope.childId,
    receipt:{operationId:op.id,childId:scope.childId,size:op.payload.size,
     quantity:serverStock,revision:serverRevision,duplicate:false}};
  }
 };
 const loginController={create:()=>({
  connect:async()=> 'CLOUD_READ_ONLY_CONNECTED',
  verifiedContext:currentContext,
  signOut:async()=> 'LOGIN_REQUIRED'
 })};
 const app=Formal.create({
  host,doc,loginController,
  readModelFactory:()=>({read:async()=>{readCalls++;return clone(readModel());}}),
  primaryFactory:()=>primary,
  commandsFactory:Commands,
  actionsFactory:{create:options=>{
   callbacks=options;actions=Actions.create(options);return actions;
  }},
  projection:Projection,documentsOverlay:Overlay,
  documentsFactory:()=>documentsClient,
  ui,scriptLoader:async()=>{},
  purchaseReleaseEnabled:true,purchaseOperatorApproved:()=>true,
  documentWritesEnabled:false
 });
 const day={id:'',dataset:{action:'consume',useMode:'day',size:'S',count:'8'},
  textContent:'记 1 天'};
 const piece={id:'',dataset:{action:'consume',useMode:'piece',size:'S',count:'1'},
  textContent:'用 1 片'};
 return {
  app,doc,day,piece,operations,flushes,primary,
  get ids(){return ids;},get readCalls(){return readCalls;},
  get readAllCalls(){return readAllCalls;},
  get currentView(){return currentView;},
  get serverStock(){return serverStock;},
  get actions(){return actions;},get callbacks(){return callbacks;},
  setReadMode(next){readMode=next;},
  setRemoteDaily(next){remoteDaily=next;settingsRevision++;},
  switchScope(actor,child){scope.actorUid=actor;scope.childId=child;},
  releaseRead(){readMode='ready';for(const p of pending.splice(0))p.resolve(snapshot());},
  failRead(){readMode='fail';for(const p of pending.splice(0))p.reject(Error('read failed'));}
 };
}
async function ready(h){
 assert.equal(await h.app.start(),'ready');
 assert.equal(h.currentView.state.inventory.S,h.serverStock);
}
const settled=h=>eventually(()=>h.currentView?.sharedBusinessDocumentsVerified===true);

test('T04 delayed cloud settings 12 never permits migrated daily 8 or a 009 UUID',async()=>{
 const h=harness({mode:'delay',daily:12});await ready(h);
 assert.equal(h.currentView.state.daily.S,8,'old migration value may still be displayed');
 const ans=await h.actions.handle(h.day,{});
 assert.equal(ans.status,'PRIMARY_DAILY_SETTINGS_LOADING');
 assert.equal(h.ids,0);assert.equal(h.operations.length,0);assert.equal(h.flushes.length,0);
 assert.equal(h.currentView.state.inventory.S,140);
 h.doc.click('',h.day.dataset,'记 1 天');
 await eventually(()=>h.doc.getElementById('formalConsumeActionFeedback').textContent.includes('日用量加载中'));
 assert.equal(h.ids,0);
 h.releaseRead();await settled(h);
 assert.equal(h.currentView.state.daily.S,12);
 const saved=await h.actions.handle(h.day,{});
 assert.equal(saved.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(h.operations[0].payload.amount,12);
 assert.equal(h.serverStock,128);
 assert.equal(h.readCalls,1,'fast 009 ACK must not cause full restore');
});
test('T04 failed settings refuses day without queuing and succeeds after retry',async()=>{
 const h=harness({mode:'fail'});await ready(h);
 await eventually(()=>h.readAllCalls===1);await tick();await tick();
 const blocked=await h.actions.handle(h.day,{});
 assert.equal(blocked.status,'PRIMARY_DAILY_SETTINGS_UNVERIFIED');
 assert.equal(h.ids,0);assert.equal(h.operations.length,0);
 h.doc.click('',h.day.dataset,'记 1 天');
 await eventually(()=>h.doc.getElementById('formalConsumeActionFeedback').textContent.includes('日用量尚未获取'));
 h.setReadMode('ready');
 assert.equal(await h.app.restore(),'ready');await settled(h);
 const result=await h.actions.handle(h.day,{});
 assert.equal(result.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(h.operations.at(-1).payload.amount,12);
});
test('T04 one-piece consumption still uses current inventory while cloud settings are delayed',async()=>{
 const h=harness({mode:'delay'});await ready(h);
 const ans=await h.actions.handle(h.piece,{});
 assert.equal(ans.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(h.ids,1);assert.equal(h.operations.length,1);
 assert.equal(h.operations[0].payload.amount,1);
 assert.equal(h.serverStock,139);assert.equal(h.readCalls,1);
 assert.equal(h.currentView.state.inventory.S,139);
 h.releaseRead();await settled(h);
});
test('T04 member B uses its refreshed server setting after member A changes 8 to 12',async()=>{
 const h=harness({daily:8,mode:'ready'});await ready(h);await settled(h);
 assert.equal(h.currentView.state.daily.S,8);
 h.setRemoteDaily(12);
 assert.equal(await h.app.restore(),'ready');
 assert.equal(h.currentView.state.daily.S,12);
 const saved=await h.actions.handle(h.day,{});
 assert.equal(saved.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(h.operations[0].payload.amount,12);
 assert.equal(h.readCalls,2,'no extra restore after fast use ACK');
});
test('T04 same account 026 settings ACK updates next day consumption without restore',async()=>{
 const h=harness({daily:8,mode:'ready'});await ready(h);await settled(h);
 const before=h.readCalls;
 const ack=await h.callbacks.onSettingsAck({
  kind:'settings',familyId:F,actorUid:'dad',childId:CHILD,
  requestId:uuid(500),expectedRevision:1,revision:2,
  record:{daily:{S:12}},
  nextBody:{currentSize:'S',target:{S:100},daily:{S:12}}
 });
 assert.equal(ack,'ready');
 assert.equal(h.readCalls,before,'settings ACK refreshes overlay without full restore');
 const saved=await h.actions.handle(h.day,{});
 assert.equal(saved.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(h.operations[0].payload.amount,12);
 assert.equal(h.readCalls,before,'009 fast ACK remains local');
});
test('T04 actor/child changes cannot reuse a previous cloud daily setting',async()=>{
 const h=harness({daily:12,mode:'ready'});await ready(h);await settled(h);
 h.switchScope('mom',OTHER_CHILD);
 const rejected=await h.actions.handle(h.day,{});
 assert.equal(rejected.status,'PRIMARY_DAILY_SETTINGS_UNVERIFIED');
 assert.equal(h.ids,0);
 h.setReadMode('delay');
 assert.equal(await h.app.restore(),'ready');
 assert.equal(h.currentView.actorUid,'mom');
 assert.equal(h.currentView.childId,OTHER_CHILD);
 const waiting=await h.actions.handle(h.day,{});
 assert.equal(waiting.status,'PRIMARY_DAILY_SETTINGS_LOADING');
 assert.equal(h.operations.length,0);
 h.releaseRead();await settled(h);
 const saved=await h.actions.handle(h.day,{});
 assert.equal(saved.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(h.operations[0].actorUid,'mom');
 assert.equal(h.operations[0].payload.childId,OTHER_CHILD);
 assert.equal(h.operations[0].payload.amount,12);
});
test('T04 stock below trusted daily amount is capped; empty stock remains blocked',async()=>{
 const small=harness({stock:5,daily:12});await ready(small);await settled(small);
 const saved=await small.actions.handle(small.day,{});
 assert.equal(saved.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(small.operations[0].payload.amount,5);
 assert.equal(small.serverStock,0);
 const zero=harness({stock:0,daily:12});await ready(zero);await settled(zero);
 assert.equal((await zero.actions.handle(zero.day,{})).status,'PRIMARY_INSUFFICIENT_STOCK');
 assert.equal(zero.ids,0);assert.equal(zero.operations.length,0);
});
test('T04 invalid verified daily quantity cannot create UUID or queue',async()=>{
 const h=harness({daily:0});await ready(h);await settled(h);
 assert.equal((await h.actions.handle(h.day,{})).status,'PRIMARY_DAILY_SETTINGS_INVALID');
 assert.equal(h.ids,0);assert.equal(h.operations.length,0);
});
test('T04 fallback path cannot use day count from dataset or call commands.submit',async()=>{
 let submitted=0;
 const b=Actions.create({
  commands:{submit:async()=>{submitted++;return {status:'PRIMARY_OPERATION_DURABLY_QUEUED'};}},
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{S:140},revisions:{S:2}})},
  readConsumeBaseline:()=>null,formalModeSelected:()=>true,
  buildAllowsWrites:true,operatorApproved:()=>true,purchaseOnly:true,allowConsume:true,
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,notify:()=>{}
 });
 assert.equal((await b.handle({id:'',dataset:{
  action:'consume',size:'S',count:'8',useMode:'day'}},{})).status,
  'PRIMARY_DAILY_SETTINGS_UNVERIFIED');
 assert.equal(submitted,0);
});
