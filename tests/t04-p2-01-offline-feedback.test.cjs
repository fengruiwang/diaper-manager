'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Commands=require('../sync/primary-business-commands.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const fs=require('node:fs'),path=require('node:path');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ORIG='79192488-bd70-4b88-8c66-3c5b5fb29ef5';
const SIZES=['NB','S','M','L','XL','XXL'];
const TIP='当前网络不可用，本次操作未保存，请联网后重新操作。';
const UUID=n=>'04e4577d-8a3d-4dd1-a7d3-'+String(n).padStart(12,'0');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){
 for(let i=0;i<60;i++){if(predicate())return;await tick();}
 assert.fail('async UI did not settle');
}
function harness({online=true,queueMode='normal',flushMode='ack'}={}){
 const scope={familyId:FAMILY,childId:CHILD,actorUid:'dad'};
 const stock={NB:116,S:140,M:0,L:0,XL:0,XXL:0};
 const revisions={NB:2,S:2,M:1,L:1,XL:1,XXL:1};
 const durable=new Map(),committed=new Set(),seen=new Set();
 const notifications=[],calls={uuid:0,read:0,queue:0,flush:0,ack:0,readback:0};
 const elements=new Map(),listeners=new Map();
 let onlineNow=online,queueNow=queueMode,flushNow=flushMode;
 function element(id){
  if(!elements.has(id))elements.set(id,{
   id,textContent:id==='saveStocks'?'保存实际库存':'',value:'',
   disabled:false,hidden:false,dataset:{},style:{},
   classList:{contains:()=>false},
   querySelectorAll(){return [];},querySelector(){return null;},
   closest(){return this;},addEventListener(){},removeEventListener(){}
  });
  return elements.get(id);
 }
 for(const size of SIZES)element('inv_'+size).value=String(stock[size]);
 const doc={
  getElementById:element,
  addEventListener(type,listener){
   const handlers=listeners.get(type)||[];
   handlers.push(listener);listeners.set(type,handlers);
  },
  removeEventListener(type,listener){
   listeners.set(type,(listeners.get(type)||[]).filter(fn=>fn!==listener));
  }
 };
 const baseline=(kind)=>({
  status:kind==='purchase'?'PRIMARY_PURCHASE_BASELINE_VERIFIED':
   kind==='reverse'?'PRIMARY_REVERSE_BASELINE_VERIFIED':
   kind==='stocktake'?'PRIMARY_STOCKTAKE_BASELINE_VERIFIED':
   'PRIMARY_CONSUME_BASELINE_VERIFIED',
  ...scope,inventory:{...stock},revisions:{...revisions},
  ...(kind==='consume'?{daily:{NB:8},dailySettingsStatus:'verified'}:{}),
  ...(kind==='reverse'?{originalId:ORIG,originalType:'buy',originalSize:'NB'}:{})
 });
 const primary={
  cloudWritesEnabled:true,
  selectedScope:()=>({...scope}),
  async read(){calls.read++;return {
   status:'PRIMARY_CLOUD_READ_VERIFIED',inventory:{...stock},revisions:{...revisions}
  };},
  async queue(op){
   calls.queue++;
   // Real primary-cloud-operations returns this exact code before IDB on offline.
   if(queueNow==='offline')return{status:'OFFLINE_FORMAL_QUEUE_NOT_APPROVED'};
   if(queueNow==='uncertain')return{status:'PRIMARY_LOCAL_QUEUE_UNVERIFIED'};
   durable.set(op.id,{...op,status:'pending'});
   return{status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:op.id,
    fastPurchase:op.payload.kind==='buy',
    fastConsume:op.payload.kind==='use',
    fastReverse:op.type==='transaction.reverse',
    fastStocktake:op.type==='inventory.count'};
  },
  async flush(){
   calls.flush++;
   const op=[...durable.values()].at(-1);
   assert.ok(op&&durable.has(op.id),'flush only after durable enqueue');
   if(flushNow==='network-fail')throw Error('network request failed before server commit');
   if(flushNow==='offline-no-upload')return {status:'OFFLINE_NO_UPLOAD'};
   if(!committed.has(op.id)){
    committed.add(op.id);
    if(op.type==='inventory.delta'){
     stock[op.payload.size]+=op.payload.kind==='use'
      ?-op.payload.amount:op.payload.amount;
    }else if(op.type==='inventory.count'){
     stock[op.payload.size]=op.payload.count;
    }else if(op.type==='transaction.reverse'){
     stock[op.payload.size]-=10;
    }
    revisions[op.payload.size]++;
   }
   if(flushNow==='ack-lost')throw Error('server committed but reply lost');
   const status=op.type==='transaction.reverse'?'PRIMARY_REVERSE_ACK_CONFIRMED':
    op.type==='inventory.count'?'PRIMARY_STOCKTAKE_ACK_CONFIRMED':
    op.payload.kind==='use'?'PRIMARY_USE_ACK_CONFIRMED':
    'PRIMARY_PURCHASE_ACK_CONFIRMED';
   return{status,operation:op,operationId:op.id};
  }
 };
 const commands=Commands.create({
  primary,uuid:()=>{calls.uuid++;return UUID(calls.uuid);},
  clock:()=> '2026-11-19T03:00:00.000Z',
  isOnline:()=>onlineNow
 });
 const actions=Actions.create({
  commands,primary,
  readPurchase:()=>({size:'NB',brand:'好奇',series:'小森林',pieces:10,price:20}),
  readQuote:()=>null,
  readTransaction:()=>({
   id:'cloud:'+ORIG,operationId:ORIG,origin:'cloud_post_migration',
   size:'NB',type:'buy',reversed:false
  }),
  readPurchaseBaseline:()=>baseline('purchase'),
  readConsumeBaseline:()=>baseline('consume'),
  readReverseBaseline:()=>baseline('reverse'),
  readStocktakeBaseline:()=>baseline('stocktake'),
  confirmReverse:()=>true,
  onPurchaseAck:async()=>{calls.ack++;return 'ready';},
  onPurchaseReadback:async ({operationId})=>{
   calls.readback++;return committed.has(operationId)?'ready':'pending';
  },
  notify:answer=>notifications.push(answer),
  formalModeSelected:()=>true,
  buildAllowsWrites:true,operatorApproved:()=>true,
  purchaseOnly:true,allowConsume:true,allowReverse:true,allowStocktake:true
 });
 const attached=actions.attach(doc);
 function action(kind){
  if(kind==='purchase')return {id:'buyNow',dataset:{},textContent:'入库'};
  if(kind==='consume')return {id:'',dataset:{action:'consume',
   size:'NB',count:'1',useMode:'piece'},textContent:'用 1 片'};
  if(kind==='day')return {id:'',dataset:{action:'consume',
   size:'NB',count:'8',useMode:'day'},textContent:'记 1 天'};
  if(kind==='reverse')return {id:'',dataset:{action:'deletetx',
   id:'cloud:'+ORIG},textContent:'撤销'};
  return {id:'saveStocks',dataset:{},textContent:'保存实际库存'};
 }
 function nodeFor(kind){
  return element(kind==='purchase'?'formalCompareActionFeedback':
   kind==='consume'||kind==='day'?'formalConsumeActionFeedback':
   kind==='reverse'?'formalReverseActionFeedback':
   'formalStocktakeActionFeedback');
 }
 async function click(kind){
  if(kind==='stocktake')element('inv_NB').value='117';
  const button=action(kind),before=notifications.length;
  // The capture handler needs the browser's closest() button lookup.
  button.closest=()=>button;
  button.classList={contains:()=>false};
  const event={target:button,preventDefault(){},stopImmediatePropagation(){}};
  for(const listener of listeners.get('click')||[])listener(event);
  await until(()=>notifications.length>before);
  return{answer:notifications.at(-1),message:nodeFor(kind).textContent,
   button,kind:kind==='day'?'consume':kind};
 }
 return{
  action,click,actions,attached,primary,commands,calls,durable,committed,
  stock,notifications,element,nodeFor,
  get online(){return onlineNow;},set online(value){onlineNow=value;},
  set queueMode(value){queueNow=value;},set flushMode(value){flushNow=value;}
 };
}
test('T04-P2-01 explicit offline one-piece does not allocate UUID, queue, RPC, or change 116 and button recovers',async()=>{
 const h=harness({online:false});
 const out=await h.click('consume');
 assert.equal(out.answer.status,'OFFLINE_FORMAL_QUEUE_NOT_APPROVED');
 assert.equal(out.answer.operationId,undefined);
 assert.equal(out.message,TIP);
 assert.deepEqual({uuid:h.calls.uuid,queue:h.calls.queue,flush:h.calls.flush},{uuid:0,queue:0,flush:0});
 assert.equal(h.durable.size,0);
 assert.equal(h.stock.NB,116);
 assert.equal(out.button.disabled,false);
 assert.equal(h.attached.hasPendingMinimalReview('consume'),false);
 // Reconnection is a new intentional action, not an automatic offline retry.
 h.online=true;
 const next=await h.click('consume');
 assert.equal(next.answer.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(h.calls.uuid,1);assert.equal(h.stock.NB,115);
 assert.equal(h.calls.readback,0,'fast ACK must not cause a full restore');
});
test('T04-P2-01 explicitly offline purchase, day use, reverse, and one-size stocktake share non-persisted feedback',async()=>{
 for(const kind of ['purchase','day','reverse','stocktake']){
  const h=harness({online:false});
  const result=await h.click(kind);
  assert.equal(result.answer.status,'OFFLINE_FORMAL_QUEUE_NOT_APPROVED',kind);
  assert.equal(result.answer.operationId,undefined,kind);
  assert.equal(result.message,TIP,kind);
  assert.equal(result.button.disabled,false,kind);
  assert.equal(h.calls.uuid,0,kind);assert.equal(h.calls.queue,0,kind);
  assert.equal(h.calls.flush,0,kind);assert.equal(h.durable.size,0,kind);
  assert.equal(h.stock.NB,116,kind);
  assert.equal(h.attached.hasPendingMinimalReview(result.kind),false,kind);
 }
});
test('T04-P2-01 late queue offline refusal after generated UUID is definitively not enqueued',async()=>{
 const h=harness({queueMode:'offline'});
 const result=await h.click('consume');
 assert.equal(h.calls.uuid,1,'connection dropped after initial online preflight');
 assert.equal(h.calls.queue,1);
 assert.equal(h.durable.size,0);assert.equal(h.calls.flush,0);
 assert.equal(h.stock.NB,116);
 assert.equal(result.answer.status,'OFFLINE_FORMAL_QUEUE_NOT_APPROVED');
 assert.equal(result.answer.operationId,undefined);
 assert.equal(result.message,TIP);
 assert.equal(h.attached.hasPendingMinimalReview('consume'),false);
 assert.equal(result.button.disabled,false);
});
test('T04-P2-01 unknown local IDB result stays conservative, never reported as definitely offline',async()=>{
 const h=harness({queueMode:'uncertain'});
 const result=await h.click('consume');
 assert.equal(result.answer.status,'PRIMARY_QUEUE_UNVERIFIED_PRESERVE_ORIGINAL_ID');
 assert.equal(result.answer.operationId,UUID(1));
 assert.match(result.message,/UUID 已保留/);
 assert.equal(h.attached.hasPendingMinimalReview('consume'),true);
 assert.equal(h.calls.flush,0);
});
test('T04-P2-01 durable 009 with network failure preserves original UUID and pending button',async()=>{
 const h=harness({flushMode:'network-fail'});
 const result=await h.click('consume');
 assert.equal(result.answer.status,'PRIMARY_USE_PENDING_REVIEW');
 assert.equal(result.answer.operationId,UUID(1));
 assert.equal(h.durable.size,1);
 assert.equal(h.durable.get(UUID(1)).status,'pending');
 assert.equal(h.stock.NB,116);
 assert.match(result.message,/UUID 已保留/);
 assert.equal(h.attached.hasPendingMinimalReview('consume'),true);
 assert.equal(result.button.disabled,true);
 assert.equal(h.calls.uuid,1);assert.equal(h.calls.queue,1);
});
test('T04-P2-01 offline after durable queue retains the one original UUID for later recovery',async()=>{
 const h=harness({flushMode:'offline-no-upload'});
 const result=await h.click('consume');
 assert.equal(result.answer.status,'PRIMARY_USE_PENDING_REVIEW');
 assert.equal(result.answer.operationId,UUID(1));
 assert.equal(h.durable.size,1,'already persisted operation must remain');
 assert.equal(h.stock.NB,116);
 assert.match(result.message,/UUID 已保留/);
 assert.equal(h.attached.hasPendingMinimalReview('consume'),true);
 assert.equal(result.button.disabled,true);
 assert.equal(h.calls.uuid,1);
});
test('T04-P2-01 server commit with lost ACK retains UUID; original recovery without duplicate deduction',async()=>{
 const h=harness({flushMode:'ack-lost'});
 const first=await h.click('consume');
 assert.equal(first.answer.status,'PRIMARY_USE_PENDING_REVIEW');
 assert.equal(first.answer.operationId,UUID(1));
 assert.equal(h.stock.NB,115);assert.equal(h.committed.size,1);
 assert.equal(h.calls.uuid,1);
 assert.equal(h.attached.hasPendingMinimalReview('consume'),true);
 assert.equal(await h.attached.recoverMinimalButtons({domain:'consume'}),true);
 assert.equal(h.attached.hasPendingMinimalReview('consume'),false);
 assert.equal(h.stock.NB,115);
 assert.equal(h.calls.uuid,1);assert.equal(h.calls.flush,1);
 assert.equal(h.calls.readback,1);
});
test('T04-P2-01 online fast ACK purchase, consume, reverse retain existing no-full-restore path',async()=>{
 for(const kind of ['purchase','consume','reverse']){
  const h=harness();
  const result=await h.click(kind);
  assert.equal(result.answer.status,
   kind==='purchase'?'PRIMARY_PURCHASE_CLOUD_ACK_APPLIED':
   kind==='reverse'?'PRIMARY_REVERSE_CLOUD_ACK_APPLIED':
   'PRIMARY_USE_CLOUD_ACK_APPLIED');
  assert.equal(h.calls.uuid,1);
  assert.equal(h.calls.queue,1);
  assert.equal(h.calls.flush,1);
  assert.equal(h.calls.ack,1);
  assert.equal(h.calls.read,0,'fast baseline avoids remote refresh');
  assert.equal(h.calls.readback,0,'confirmed ACK avoids full restore');
  assert.equal(h.attached.hasPendingMinimalReview(kind),false);
 }
});
test('T04-P2-01 P1 one-day settings gate remains authoritative',async()=>{
 const h=harness();
 const baseline={status:'PRIMARY_CONSUME_BASELINE_VERIFIED',
  familyId:FAMILY,actorUid:'dad',childId:CHILD,inventory:{...h.stock},
  revisions:{NB:2,S:2,M:1,L:1,XL:1,XXL:1},
  daily:{NB:8},dailySettingsStatus:'loading'};
 const x=Actions.create({commands:h.commands,primary:h.primary,
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  readConsumeBaseline:()=>baseline,notify:()=>{},
  formalModeSelected:()=>true,buildAllowsWrites:true,
  operatorApproved:()=>true,purchaseOnly:true,allowConsume:true});
 const ans=await x.handle(h.action('day'),{});
 assert.equal(ans.status,'PRIMARY_DAILY_SETTINGS_LOADING');
 assert.equal(h.calls.uuid,0);assert.equal(h.durable.size,0);
});
test('T04-P2-01 formal source and inline command/action modules remain equivalent',()=>{
 const root=path.resolve(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'preview/v1.2.0/formal/index.html'),'utf8');
 for(const file of ['primary-business-commands.js','primary-formal-ui-actions.js'])
  assert.ok(html.includes(fs.readFileSync(path.join(root,'sync',file),'utf8').trim()),file);
 const controller=fs.readFileSync(path.join(root,'preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(controller,/isOnline:\(\)=>host\.navigator\?\.onLine!==false/);
 assert.match(controller,/当前网络不可用，本次操作未保存，请联网后重新操作/);
});
