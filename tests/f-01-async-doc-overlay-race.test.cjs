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
function setup({hold=true,holdRefresh=false}={}){
 let actor='A',child=C,resolveDoc,readCalls=0,ackOptions,latest;
 const slow=new Promise(resolve=>{resolveDoc=resolve;});
 let resolveRefresh;
 const slowRefresh=new Promise(resolve=>{resolveRefresh=resolve;});
 let refreshCalls=0;
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
 const primaryView=()=>({status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,familyId:F,
  actorUid:actor,childId:child,revisions:{NB:1,S:2,M:1,L:1,XL:1,XXL:1},
  state:{inventory:{NB:0,S:80,M:0,L:0,XL:0,XXL:0},
   transactions:[],quotes:[],weightRecords:[]}});
 const primary={activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
  selectedScope:()=>({familyId:F,actorUid:actor,childId:child}),
  pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0})};
 const instance=Formal.create({host,doc:document,
  loginController:{create:()=>controller},
  readModelFactory:()=>({read:async()=>({
   status:'PRIMARY_READ_ONLY_READY',canWrite:false,childId:child,
   familyId:F,actorUid:actor,inventory:primaryView().state.inventory,
   revisions:primaryView().revisions})}),
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
  ackSettings:async()=>ackOptions.onSettingsAck({kind:'settings',familyId:F,
   actorUid:actor,childId:child,requestId:'original-setting-request',
   expectedRevision:1,revision:2,record:{daily:{S:12}},
   nextBody:{target:{S:90},daily:{S:12},currentSize:'S'}}),
  releaseRefresh:()=>resolveRefresh(),
  get refreshCalls(){return refreshCalls;},
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
