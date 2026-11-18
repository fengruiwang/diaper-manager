const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sandbox={module:{exports:{}},window:{
 XBPrimaryBusinessDate:{fromTimestamp:()=> '2026-11-18'}
},setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal-controller.js'),'utf8'),sandbox);
const Formal=sandbox.module.exports;
const Overlay=require('../sync/primary-documents-overlay.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='26e2fa06-b355-4a98-bc5e-44dcdf8a2d63';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function docs(){
 const bodies={quotes:{items:[]},reference:{referenceOverrides:{}},
  growth:{items:[]},profile:{babyProfile:{name:'宝宝'}},
  settings:{target:{S:90},daily:{S:9},currentSize:'S'}};
 return {status:'PRIMARY_DOCUMENTS_FULLY_READ',documents:Object.fromEntries(
  Object.entries(bodies).map(([kind,body])=>[kind,{
   status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind,familyId:F,childId:C,
   revision:1,body}]))};
}
function setup({hold=true,holdRefresh=false,holdBusinessRefresh=false,
 initialTransactions=[],otherServerSize=false}={}){
 let actor='A',child=C,resolveDoc,readCalls=0,ackOptions,latest;
 const slow=new Promise(resolve=>{resolveDoc=resolve;});
 let resolveRefresh;
 const slowRefresh=new Promise(resolve=>{resolveRefresh=resolve;});
 let refreshCalls=0,businessCalls=0,releaseBusinessRead;
 const delayedBusinessRead=new Promise(resolve=>{releaseBusinessRead=resolve;});
 const views=[],events=new Map(),elements=new Map();
 const get=id=>{
  if(!elements.has(id))elements.set(id,{id,disabled:false,hidden:false,
   textContent:'',value:'',addEventListener:(name,fn)=>events.set(id+':'+name,fn)});
  return elements.get(id);
 };
 const host={navigator:{onLine:true},crypto:{randomUUID:()=>{throw Error('unexpected UUID');}},
  addEventListener:(name,fn)=>events.set('host:'+name,fn)};
 const document={body:{dataset:{}},getElementById:get,addEventListener:(name,fn)=>events.set('doc:'+name,fn)};
 const cloud={auth:{getSession:async()=>({data:{user:{id:actor,email:'a@example.com'}}})}};
 const controller={verifiedContext:()=>({actorUid:actor,familyId:F,app:cloud}),
  connect:async()=> 'CLOUD_READ_ONLY_CONNECTED'};
 const primaryView=(incoming)=>({status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,familyId:F,
  actorUid:actor,childId:incoming?.childId||child,
  revisions:incoming?.revisions||{NB:1,S:2,M:1,L:1,XL:1,XXL:1},
  state:{inventory:incoming?.inventory||{NB:0,S:80,M:0,L:0,XL:0,XXL:0},
   transactions:incoming?.transactions||initialTransactions,
   quotes:[],weightRecords:[]}});
 const primary={activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
  selectedScope:()=>({familyId:F,actorUid:actor,childId:child}),
  pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0})};
 const instance=Formal.create({host,doc:document,
  loginController:{create:()=>controller},
  readModelFactory:()=>({read:async()=>{
   businessCalls++;
   const snapshot={status:'PRIMARY_READ_ONLY_READY',canWrite:false,
    childId:child,familyId:F,actorUid:actor,
    inventory:{NB:0,S:80,M:otherServerSize&&businessCalls>1?33:0,L:0,XL:0,XXL:0},
    revisions:{NB:1,S:2,M:otherServerSize&&businessCalls>1?5:1,L:1,XL:1,XXL:1},
    transactions:initialTransactions.map(t=>({...t}))};
   if(holdBusinessRefresh&&businessCalls===2)await delayedBusinessRead;
   return snapshot;
  }}),
  primaryFactory:()=>primary,commandsFactory:{create:()=>({})},
  actionsFactory:{create:options=>{ackOptions=options;return{
   attach:()=>({detach(){}})};}},
  projection:{project:primaryView},
  ui:{defaults:()=>({}),show:v=>{latest=v;views.push(v);},
   clear:()=>{latest=null;}},
  documentsFactory:()=>({
   acceptVerifiedPrimary:()=>true,
   readAll:async()=>{readCalls++;return hold?slow:docs();},
   read:async({kind})=>{refreshCalls++;if(holdRefresh)await slowRefresh;
    return docs().documents[kind];}
  }),
  documentsOverlay:Overlay,scriptLoader:async()=>{},
  documentWritesEnabled:false
 });
 function op(kind,quantity){
  const operation={id:ID,familyId:F,actorUid:actor,
   type:'inventory.delta',payload:{kind,childId:child,size:'S',
    amount:kind==='buy'?60:9,
    ...(kind==='buy'?{purchase:{brand:'好奇',series:'小森林',
     totalFen:6000,purchaseDate:'2026-11-18'}}:
     {occurredAt:'2026-11-18T10:00:00.000Z'})}};
  return {operation,operationId:ID,actorUid:actor,familyId:F,
   childId:child,receipt:{operationId:ID,childId:child,size:'S',
    quantity,revision:3,duplicate:false}};
 }
 return {instance,views,get,op,
  ack:async(kind,n)=>ackOptions.onPurchaseAck(op(kind,n)),
  ackRaw:async packet=>ackOptions.onPurchaseAck(packet),
  batchAck:async packet=>ackOptions.onBatchAck(packet),
  ackSettings:async()=>ackOptions.onSettingsAck({kind:'settings',familyId:F,
   actorUid:actor,childId:child,requestId:'original-setting-request',
   expectedRevision:1,revision:2,record:{daily:{S:12}},
   nextBody:{target:{S:90},daily:{S:12},currentSize:'S'}}),
  releaseRefresh:()=>resolveRefresh(),
  releaseBusinessRead:()=>releaseBusinessRead(),
  get refreshCalls(){return refreshCalls;},
  get businessCalls(){return businessCalls;},
  release:()=>resolveDoc(docs()),
  get latest(){return latest;},
  get readCalls(){return readCalls;},
  setActor:v=>{actor=v;},
  setChild:v=>{child=v;}
 };
}
for(const [kind,stock,type] of [['buy',140,'buy'],['use',71,'use']]){
 test('F-01 late five-document overlay preserves ACK '+kind+' inventory, revision and history',async()=>{
  const f=setup();await f.instance.start();
  assert.equal(f.readCalls,1);
  assert.equal(f.latest.state.inventory.S,80);
  assert.equal(await f.ack(kind,stock),'ready');
  assert.equal(f.latest.state.inventory.S,stock);
  assert.equal(f.latest.revisions.S,3);
  f.release();await tick();await tick();
  assert.equal(f.latest.state.inventory.S,stock);
  assert.equal(f.latest.revisions.S,3);
  assert.equal(f.latest.state.transactions[0].type,type);
  assert.equal(f.latest.state.transactions[0].operationId,ID);
  assert.equal(f.latest.state.daily.S,9,'five-document settings remain visible');
  assert.equal(f.readCalls,1,'no extra network read');
 });
}
test('F-01 late five-document overlay cannot overwrite stocktake ACK state',async()=>{
 const f=setup();await f.instance.start();
 const ack=f.op('buy',95);
 ack.operation.type='inventory.count';
 ack.operation.payload.kind='stocktake';
 ack.operation.payload.count=95;
 ack.operation.expectedRevision=2;
 assert.equal(await f.ackRaw(ack),'ready');
 assert.equal(f.latest.state.inventory.S,95);
 f.release();await tick();await tick();
 assert.equal(f.latest.state.inventory.S,95);
 assert.equal(f.latest.revisions.S,3);
 assert.equal(f.latest.state.daily.S,9);
 assert.equal(f.readCalls,1);
});
test('F-01 normal first read still overlays five documents without an extra request',async()=>{
 const f=setup({hold:false});await f.instance.start();
 await tick();await tick();
 assert.equal(f.latest.state.inventory.S,80);
 assert.equal(f.latest.state.daily.S,9);
 assert.equal(f.readCalls,1);
});
test('F-01 late document response cannot cross actor scope',async()=>{
 const f=setup();await f.instance.start();f.setActor('B');
 await f.instance.restore();
 f.release();await tick();await tick();
 assert.equal(f.latest.actorUid,'B');
 assert.ok(f.views.slice(1).every(x=>x.actorUid==='B'));
 assert.equal(f.latest.state.inventory.S,80);
});

test('F-01 cached five-document refresh does not roll back an intervening purchase ACK',async()=>{
 const f=setup({hold:false,holdRefresh:true});
 await f.instance.start();await tick();await tick();
 assert.equal(f.latest.state.inventory.S,80);
 const refresh=f.instance.restore();
 await tick();
 assert.equal(f.refreshCalls,5);
 assert.equal(await f.ack('buy',140),'ready');
 f.releaseRefresh();
 await refresh;await tick();
 assert.equal(f.latest.state.inventory.S,140);
 assert.equal(f.latest.revisions.S,3);
 assert.equal(f.latest.state.transactions[0].operationId,ID);
 assert.equal(f.refreshCalls,5);
});
test('F-01 stale five-document refresh cannot roll back newly ACKed settings revision',async()=>{
 const f=setup({hold:false,holdRefresh:true});
 await f.instance.start();await tick();await tick();
 const refresh=f.instance.restore();
 await tick();
 assert.equal(f.refreshCalls,5);
 assert.equal(await f.ackSettings(),'ready');
 assert.equal(f.latest.state.daily.S,12);
 f.releaseRefresh();
 await refresh;await tick();
 assert.equal(f.latest.state.daily.S,12);
 assert.equal(f.latest.documentRevisions.settings,2);
 assert.equal(f.refreshCalls,5);
});
test('F-01 old child read cannot render after current child changes',async()=>{
 const f=setup();await f.instance.start();
 f.setChild('e7d936c8-00c1-45c9-8d2e-6f1424f97c91');
 await f.instance.restore();
 f.release();await tick();await tick();
 assert.notEqual(f.latest?.childId,C);
 assert.ok(f.views.slice(1).every(v=>v.childId!==C));
});

const ORIGINAL='07b3f860-a480-446b-a774-c6b67e9343f1';
test('T02-P1-01 delayed primary read cannot roll back confirmed purchase; other server size stays newer',async()=>{
 const f=setup({hold:false,holdBusinessRefresh:true,otherServerSize:true});
 await f.instance.start();await tick();await tick();
 assert.equal(f.latest.state.inventory.S,80);
 const slowRead=f.instance.restore();
 await tick();await tick();
 assert.equal(f.businessCalls,2);
 assert.equal(await f.ack('buy',140),'ready');
 assert.equal(f.latest.state.inventory.S,140);
 f.releaseBusinessRead();
 await slowRead;await tick();await tick();
 assert.equal(f.latest.state.inventory.S,140);
 assert.equal(f.latest.revisions.S,3);
 assert.equal(f.latest.state.transactions.some(t=>t.operationId===ID&&t.type==='buy'),true);
 assert.equal(f.latest.state.inventory.M,33,'newer authoritative M revision cannot be lost');
 assert.equal(f.latest.revisions.M,5);
 assert.equal(f.instance.mode,'ready');
 assert.equal(f.businessCalls,2,'no extra full cloud read');
 assert.equal(f.refreshCalls,5,'existing five-document refresh unchanged');
});
test('T02-P1-01 delayed primary read cannot roll back confirmed use ACK',async()=>{
 const f=setup({hold:false,holdBusinessRefresh:true});
 await f.instance.start();await tick();await tick();
 const read=f.instance.restore();await tick();await tick();
 assert.equal(await f.ack('use',71),'ready');
 assert.equal(f.latest.state.inventory.S,71);
 f.releaseBusinessRead();await read;await tick();
 assert.equal(f.latest.state.inventory.S,71);
 assert.equal(f.latest.revisions.S,3);
 assert.equal(f.latest.state.transactions.some(t=>t.operationId===ID&&t.type==='use'),true);
 assert.equal(f.businessCalls,2);
});
test('T02-P1-01 delayed primary read cannot reopen confirmed reversed purchase',async()=>{
 const bought={id:'cloud:'+ORIGINAL,type:'buy',size:'S',pieces:5,
  date:'2026-11-18',price:10,brand:'好奇',series:'小森林',
  origin:'cloud_post_migration',operationId:ORIGINAL,
  reversed:false,reversedByOperationId:null};
 const f=setup({hold:false,holdBusinessRefresh:true,initialTransactions:[bought]});
 await f.instance.start();await tick();await tick();
 const read=f.instance.restore();await tick();await tick();
 const ack=f.op('buy',75);
 ack.operation.type='transaction.reverse';
 ack.operation.payload={childId:C,size:'S',reversesOperationId:ORIGINAL};
 assert.equal(await f.ackRaw(ack),'ready');
 assert.equal(f.latest.state.inventory.S,75);
 assert.equal(f.latest.state.transactions[0].reversed,true);
 f.releaseBusinessRead();await read;await tick();
 assert.equal(f.latest.state.inventory.S,75);
 assert.equal(f.latest.revisions.S,3);
 assert.equal(f.latest.state.transactions[0].reversed,true);
 assert.equal(f.latest.state.transactions[0].reversedByOperationId,ID);
 assert.equal(f.businessCalls,2);
});
test('T02-P1-01 delayed primary read cannot roll back confirmed single or multi-size stocktake',async()=>{
 for(const batch of [false,true]){
  const f=setup({hold:false,holdBusinessRefresh:true});
  await f.instance.start();await tick();await tick();
  const read=f.instance.restore();await tick();await tick();
  if(batch){
   assert.equal(await f.batchAck({familyId:F,actorUid:'A',childId:C,
    items:[{size:'S',count:95,expectedRevision:2},
     {size:'M',count:15,expectedRevision:1}],
    changes:[{size:'S',new_quantity:95,revision:3},
     {size:'M',new_quantity:15,revision:2}]}),'ready');
  }else{
   const ack=f.op('buy',95);
   ack.operation.type='inventory.count';
   ack.operation.payload.kind='stocktake';
   ack.operation.payload.count=95;
   ack.operation.expectedRevision=2;
   assert.equal(await f.ackRaw(ack),'ready');
  }
  f.releaseBusinessRead();await read;await tick();
  assert.equal(f.latest.state.inventory.S,95);
  assert.equal(f.latest.revisions.S,3);
  if(batch){
   assert.equal(f.latest.state.inventory.M,15);
   assert.equal(f.latest.revisions.M,2);
  }
  assert.equal(f.businessCalls,2);
 }
});
test('T02-P1-01 no ACK intersection adopts fresh server primary revision',async()=>{
 const f=setup({hold:false,holdBusinessRefresh:true,otherServerSize:true});
 await f.instance.start();await tick();await tick();
 const read=f.instance.restore();await tick();await tick();
 f.releaseBusinessRead();await read;await tick();
 assert.equal(f.latest.state.inventory.S,80);
 assert.equal(f.latest.revisions.S,2);
 assert.equal(f.latest.state.inventory.M,33);
 assert.equal(f.latest.revisions.M,5);
 assert.equal(f.businessCalls,2);
 assert.equal(f.refreshCalls,5);
});
test('T02-P1-01 old delayed read cannot cross a switched actor or child',async()=>{
 for(const change of ['actor','child']){
  const f=setup({hold:false,holdBusinessRefresh:true});
  await f.instance.start();await tick();await tick();
  const count=f.views.length,read=f.instance.restore();
  await tick();await tick();
  if(change==='actor')f.setActor('B');
  else f.setChild('e7d936c8-00c1-45c9-8d2e-6f1424f97c91');
  f.releaseBusinessRead();await read;await tick();
  assert.equal(f.views.length,count,'old read must not render after scope changed');
  assert.equal(f.businessCalls,2);
 }
});
