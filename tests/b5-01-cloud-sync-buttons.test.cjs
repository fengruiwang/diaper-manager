const test=require('node:test'),assert=require('node:assert/strict');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const wait=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<7;i++)await wait();}
function fixture({q9=0,q26=0,q27=0,offline=false,unknown26=false,conflict26=false,
 readFailure=false}={}){
 const events=new Map(),nodes=new Map(),trace=[];
 const get=id=>{
  if(!nodes.has(id))nodes.set(id,{id,disabled:false,hidden:false,
   textContent:'',value:'',addEventListener:(kind,fn)=>events.set(id+':'+kind,fn)});
  return nodes.get(id);
 };
 const doc={body:{dataset:{}},getElementById:get,
  addEventListener:(type,fn)=>events.set('doc:'+type,fn)};
 const host={navigator:{onLine:!offline},
  crypto:{randomUUID:()=>{throw Error('recovery must never allocate new UUID');}},
  addEventListener:(k,fn)=>events.set('host:'+k,fn)};
 let actor='A',loggedIn=true,remoteS=80,child=CHILD;
 let documentsFail=readFailure,actionHandlers=null;
 const ctx=()=>loggedIn?{familyId:F,actorUid:actor,app:sdk}:null;
 const sdk={auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})}};
 const inventory=()=>({NB:100,S:remoteS,M:0,L:0,XL:0,XXL:0});
 const revisions=()=>({NB:2,S:3,M:1,L:1,XL:1,XXL:1});
 const docs=()=>Object.fromEntries(['reference','quotes','growth','profile','settings']
  .map(kind=>[kind,{kind,status:'PRIMARY_DOCUMENT_READ_VERIFIED',
   familyId:F,actorUid:actor,childId:child,revision:1,
   body:kind==='reference'?{referenceOverrides:{}}:{}}]));
 const documentClient={
  readAll:async()=>{trace.push('documents.readAll');
   if(documentsFail)throw Error('simulated full document read failure');
   return {
   status:'PRIMARY_DOCUMENTS_FULLY_READ',documents:docs()
  }},
  read:async({kind})=>{trace.push('documents.read.'+kind);
   return documentsFail?null:docs()[kind];}
 };
 const queue9={activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
  selectedScope:()=>({familyId:F,actorUid:actor,childId:child}),
  pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:q9}),
  flush:async()=>{trace.push('009:'+('original-operation-id'));q9=0;
   return {status:'PRIMARY_CLOUD_SYNCED_VERIFIED'};},
  cloudWritesEnabled:true};
 const queue26={
  pending:async()=>({status:'DOCUMENT_QUEUE_COUNTS_VERIFIED',outstanding:q26}),
  send:async()=>{trace.push('026:original-request-id');
   if(unknown26)return {status:'DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID'};
   if(conflict26)return {status:'DOCUMENT_CONFLICT_REVIEW_REQUIRED'};
   q26=0;return {status:'DOCUMENT_SYNC_CONFIRMED'};},
  conflicts:async()=>({status:'DOCUMENT_CONFLICT_LIST_VERIFIED',items:[]})
 };
 const queue27={
  pending:async()=>({status:'BATCH_QUEUE_VERIFIED',outstanding:q27}),
  send:async()=>{trace.push('027:original-batch-id');q27=0;
   return {status:'BATCH_ATOMIC_COMMIT_ACKED',
    items:[{size:'NB',count:100,expectedRevision:1},
      {size:'S',count:remoteS,expectedRevision:2}]};},
  conflicts:async()=>({status:'BATCH_CONFLICTS_VERIFIED',items:[]})
 };
 const controller={verifiedContext:ctx,
  connect:async()=>loggedIn?'CLOUD_READ_ONLY_CONNECTED':'LOGIN_REQUIRED',
  requestOtp:async()=> 'OTP_REQUESTED',confirmOtp:async()=> 'CLOUD_READ_ONLY_CONNECTED'};
 const app=Formal.create({
  host,doc,loginController:{create:()=>controller},
  readModelFactory:()=>({read:async()=>{
   trace.push('primary.read');return {status:'PRIMARY_READ_ONLY_READY',
    familyId:F,actorUid:actor,childId:child,canWrite:false,
    inventory:inventory(),revisions:revisions()};
  }}),
  primaryFactory:()=>queue9,commandsFactory:{create:()=>({submit(){}})},
  actionsFactory:{create:handlers=>{
   actionHandlers=handlers;return {attach:()=>({detach(){}})};
  }},
  projection:{project:v=>({status:'PRIMARY_READ_ONLY_READY',
   familyId:v.familyId,actorUid:v.actorUid,childId:v.childId,
   canWrite:false,state:{inventory:v.inventory,transactions:[]},
   revisions:v.revisions})},
  ui:{defaults:()=>({}),clear:()=>trace.push('ui.clear'),
   show:data=>trace.push('ui.show.S='+data.state.inventory.S)},
  documentsFactory:()=>documentClient,
  documentsOverlay:{apply:(base)=>({...base,sharedBusinessDocumentsVerified:true,
   cloudDocumentsActorScope:{familyId:F,childId:child}})},
  documentOpsFactory:()=>queue26,
  documentCommandsFactory:{create:()=>({submit(){}})},
  batchStocktakeFactory:()=>queue27,
  scriptLoader:async()=>{},
  purchaseReleaseEnabled:true,purchaseOperatorApproved:()=>true,
  documentWritesEnabled:true
 });
 const tap=id=>{const fn=events.get(id+':click');assert.ok(fn,id);fn();};
 const click=async id=>{tap(id);await settle();};
 return {app,host,get,trace,click,tap,setRemoteS:n=>remoteS=n,
  setActor:a=>actor=a,setChild:c=>child=c,setDocumentsFail:x=>documentsFail=x,
  actions:()=>actionHandlers,setLoggedIn:x=>loggedIn=x,
  setQueue:(kind,n)=>{if(kind===9)q9=n;else if(kind===26)q26=n;else q27=n;},
  counts:()=>({q9,q26,q27})};
}
test('B5-01 settings buttons appear at end after profile and below account',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 const account=html.indexOf('id="formalAccountSection"');
 const section=html.indexOf('id="formalCloudSyncSection"');
 const profile=html.indexOf('id="babyName"');
 assert.ok(profile<account&&account<section,'T07 settings order should place account/sync after profile');
 for(const id of ['formalGetCloudLatest','formalSubmitPending','formalPendingCount',
  'formalCloudSyncFeedback'])assert.ok(html.includes('id="'+id+'"'));
});
test('B5-01 empty 009/026/027 disables submit; full refresh gets remote stock and documents without writes',async()=>{
 const f=fixture();await f.app.start();await settle();
 assert.equal(f.get('formalSubmitPending').disabled,true);
 assert.match(f.get('formalPendingCount').textContent,/0 项/);
 f.setRemoteS(140);
 await f.click('formalGetCloudLatest');
 assert.equal(f.trace.at(-1).startsWith('documents.read.'),false); // no forced write
 assert.ok(f.trace.includes('ui.show.S=140'));
 assert.equal(f.get('formalCloudSyncFeedback').textContent,'云端数据已更新');
 assert.ok(f.trace.filter(x=>x.startsWith('documents.read.')).length>=5);
 assert.equal(f.trace.some(x=>/^(009:|026:|027:)/.test(x)),false);
});
for(const [kind,label] of [[9,'009:original-operation-id'],
 [26,'026:original-request-id'],[27,'027:original-batch-id']]){
 test('B5-01 '+kind+' pending enables existing UUID recovery once',async()=>{
  const f=fixture({['q'+kind]:1});await f.app.start();await settle();
  assert.equal(f.get('formalSubmitPending').disabled,false);
  await f.click('formalSubmitPending');
  assert.equal(f.trace.filter(x=>x===label).length,1);
  assert.equal(f.get('formalSubmitPending').disabled,true);
  assert.match(f.get('formalPendingCount').textContent,/0 项/);
 });
}
test('B5-01 026, 027 and 009 pending are processed sequentially in one click',async()=>{
 const f=fixture({q9:1,q26:1,q27:1});await f.app.start();await settle();
 await f.click('formalSubmitPending');
 assert.deepEqual(f.trace.filter(x=>/^(009:|026:|027:)/.test(x)),[
  '026:original-request-id','027:original-batch-id','009:original-operation-id']);
 assert.equal(f.get('formalSubmitPending').disabled,true);
});
test('B5-01 offline never submits and account switch clears stale pending button state',async()=>{
 const f=fixture({q9:1});await f.app.start();await settle();
 f.host.navigator.onLine=false;
 await f.click('formalSubmitPending');
 assert.equal(f.trace.some(x=>x.startsWith('009:')),false);
 assert.equal(f.get('formalSubmitPending').disabled,true);
 f.host.navigator.onLine=true;
 f.setLoggedIn(false);await f.app.restore();await settle();
 assert.equal(f.get('formalSubmitPending').disabled,true);
});

test('B5-01 repeated submit click cannot start two runs or create new UUID',async()=>{
 const f=fixture({q9:1});await f.app.start();await settle();
 f.tap('formalSubmitPending');f.tap('formalSubmitPending');
 await settle();
 assert.equal(f.trace.filter(x=>x==='009:original-operation-id').length,1);
 assert.equal(f.get('formalSubmitPending').disabled,true);
});
test('B5-01 unknown 026 ACK retains original request and never reports full success',async()=>{
 const f=fixture({q26:1,unknown26:true});
 await f.app.start();await settle();
 await f.click('formalSubmitPending');
 assert.equal(f.trace.filter(x=>x==='026:original-request-id').length,1);
 assert.equal(f.counts().q26,1);
 assert.equal(f.get('formalSubmitPending').disabled,false);
 assert.match(f.get('formalCloudSyncFeedback').textContent,/待核验/);
});
test('B5-01 definite 026 conflict stops that queue and reports conflict',async()=>{
 const f=fixture({q26:1,conflict26:true,q9:1});
 await f.app.start();await settle();
 await f.click('formalSubmitPending');
 assert.equal(f.trace.filter(x=>x==='026:original-request-id').length,1);
 assert.equal(f.trace.filter(x=>x.startsWith('009:')).length,0);
 assert.equal(f.counts().q26,1);
 assert.match(f.get('formalCloudSyncFeedback').textContent,/数据冲突/);
});

test('B5-01 capture guard passes both new sync buttons to the shared controller',()=>{
 const Actions=require('../sync/primary-formal-ui-actions.js');
 const handlers={};
 const guard=Actions.create({
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  commands:{submit:async()=>({status:'NOT_EXPECTED'})},
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  notify:()=>{},formalModeSelected:()=>true,
  operatorApproved:()=>true,documentOperatorApproved:()=>true
 });
 const doc={addEventListener:(name,fn,capture)=>{
   assert.equal(capture,true);handlers[name]=fn;
  },removeEventListener(){},getElementById:()=>null};
 const binding=guard.attach(doc);
 for(const id of ['formalGetCloudLatest','formalSubmitPending']){
  let blocked=false;
  const el={id,dataset:{},classList:{contains:()=>false},closest(){return this;}};
  handlers.click({target:el,preventDefault(){blocked=true;},
   stopImmediatePropagation(){blocked=true;}});
  assert.equal(blocked,false,id+' must reach the controller');
 }
 binding.detach();
});


test('F-03 026 reference ACK changes only its overlay and preserves last complete read proof',async()=>{
 const f=fixture();await f.app.start();await settle();
 const original=f.get('formalSyncState').textContent;
 assert.match(original,/云端数据已更新 ·/);
 const ack={
  kind:'reference',familyId:F,actorUid:'A',childId:CHILD,
  requestId:'f03-ref-original-request',expectedRevision:1,revision:2,
  action:'set',record:{key:'example-size',value:1.5},
  nextBody:{referenceOverrides:{'example-size':1.5}}
 };
 const before=f.trace.filter(x=>/^(primary.read|documents.read)/.test(x)).length;
 assert.equal(await f.actions().onReferenceAck(ack),'ready');
 await settle();
 assert.equal(f.get('formalSyncState').textContent,original,
  'single ACK must not restart or change the last full-read notice');
 assert.equal(f.trace.filter(x=>/^(primary.read|documents.read)/.test(x)).length,before,
  'single ACK must not add a primary or document read');
 f.actions().notify({status:'REFERENCE_CLOUD_ACK_APPLIED'});
 await settle();
 assert.match(f.get('formalSyncState').textContent,/参考价保存成功/);
 assert.doesNotMatch(f.get('formalSyncState').textContent,/云端数据已更新|已同步 ·/);
});
test('F-03 009 purchase ACK and 026 business feedback are not global read completion',async()=>{
 const f=fixture();await f.app.start();await settle();
 const initial=f.get('formalSyncState').textContent;
 const before=f.trace.filter(x=>/^(primary.read|documents.read)/.test(x)).length;
 const op={
  id:'f03-buy-original-operation',familyId:F,actorUid:'A',type:'inventory.delta',
  payload:{kind:'buy',childId:CHILD,size:'S',amount:20,
   purchase:{brand:'F03',series:'test',purchaseDate:'2026-11-18',totalFen:1000}}
 };
 assert.equal(await f.actions().onPurchaseAck({
  familyId:F,actorUid:'A',childId:CHILD,operationId:op.id,operation:op,
  receipt:{operationId:op.id,childId:CHILD,size:'S',quantity:100,revision:4,
   duplicate:false}
 }), 'ready');
 assert.equal(f.get('formalSyncState').textContent,initial);
 assert.equal(f.trace.filter(x=>/^(primary.read|documents.read)/.test(x)).length,before);
 f.actions().notify({status:'PRIMARY_PURCHASE_CLOUD_ACK_APPLIED'});
 assert.match(f.get('formalSyncState').textContent,/云端操作已确认/);
 f.actions().notify({status:'SETTINGS_CLOUD_ACK_APPLIED'});
 await settle();
 assert.match(f.get('formalSyncState').textContent,/设置已由云端确认/);
 assert.doesNotMatch(f.get('formalSyncState').textContent,/云端数据已更新|已同步 ·/);
});
test('F-03 queues at zero do not imply full cloud read when five documents fail',async()=>{
 const f=fixture({readFailure:true});
 await f.app.start();await settle();
 assert.equal(f.app.mode,'ready');
 assert.match(f.get('formalPendingCount').textContent,/待同步：0 项/);
 assert.equal(f.get('formalSubmitPending').disabled,true);
 assert.doesNotMatch(f.get('formalSyncState').textContent,/已同步 ·|云端数据已更新|上次完整获取/);
 assert.match(f.get('formalSyncState').textContent,/未完全同步|暂不可用/);
});
test('F-03 submit pending completes without piggybacking on full cloud read',async()=>{
 const f=fixture({q26:1,readFailure:true});
 await f.app.start();await settle();
 assert.match(f.get('formalPendingCount').textContent,/1 项/);
 await f.click('formalSubmitPending');
 assert.equal(f.counts().q26,0);
 assert.match(f.get('formalPendingCount').textContent,/0 项/);
 assert.equal(f.get('formalCloudSyncFeedback').textContent,'待同步操作已处理完成');
 assert.doesNotMatch(f.get('formalSyncState').textContent,/云端数据已更新|已同步 ·/);
});
test('F-03 complete cloud fetch and partial failure have separate feedback',async()=>{
 const f=fixture();await f.app.start();await settle();
 f.setDocumentsFail(true);
 await f.click('formalGetCloudLatest');
 assert.match(f.get('formalCloudSyncFeedback').textContent,/获取云端数据失败，请检查网络后重试/);
 assert.doesNotMatch(f.get('formalSyncState').textContent,/云端数据已更新 ·|已同步 ·/);
 f.setDocumentsFail(false);
 await f.click('formalGetCloudLatest');
 assert.equal(f.get('formalCloudSyncFeedback').textContent,'云端数据已更新');
 assert.match(f.get('formalSyncState').textContent,/云端数据已更新 ·/);
});
test('F-03 switching actor or baby clears prior scoped full-read labels',async()=>{
 const f=fixture();await f.app.start();await settle();
 assert.match(f.get('formalSyncState').textContent,/云端数据已更新 ·/);
 f.setActor('B');f.setDocumentsFail(true);
 await f.app.restore();await settle();
 assert.doesNotMatch(f.get('formalSyncState').textContent,/云端数据已更新|已同步 ·|上次完整获取/);
 assert.equal(f.get('formalCloudSyncFeedback').textContent,'');
 f.setDocumentsFail(false);await f.click('formalGetCloudLatest');
 assert.equal(f.get('formalCloudSyncFeedback').textContent,'云端数据已更新');
 f.setChild('f03-second-baby');
 await f.app.restore();await settle();
 assert.equal(f.app.mode,'unverified');
 assert.equal(f.get('formalCloudSyncFeedback').textContent,'');
 assert.doesNotMatch(f.get('formalSyncState').textContent,/云端数据已更新|已同步 ·|上次完整获取/);
});
test('F-03 asynchronous queue checks do not overwrite domain-specific success',async()=>{
 const f=fixture({q26:0});await f.app.start();await settle();
 f.actions().notify({status:'QUOTES_CLOUD_ACK_APPLIED'});
 await settle();
 assert.match(f.get('formalSyncState').textContent,/候选价操作已由云端确认/);
 assert.match(f.get('formalPendingCount').textContent,/0 项/);
 assert.doesNotMatch(f.get('formalSyncState').textContent,/云端数据已更新|已同步 ·/);
});
