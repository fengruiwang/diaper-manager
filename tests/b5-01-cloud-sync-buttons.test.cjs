const test=require('node:test'),assert=require('node:assert/strict');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const wait=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<7;i++)await wait();}
function fixture({q9=0,q26=0,q27=0,offline=false,unknown26=false,conflict26=false}={}){
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
 let actor='A',loggedIn=true,remoteS=80;
 const ctx=()=>loggedIn?{familyId:F,actorUid:actor,app:sdk}:null;
 const sdk={auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})}};
 const inventory=()=>({NB:100,S:remoteS,M:0,L:0,XL:0,XXL:0});
 const revisions=()=>({NB:2,S:3,M:1,L:1,XL:1,XXL:1});
 const docs=()=>Object.fromEntries(['reference','quotes','growth','profile','settings']
  .map(kind=>[kind,{kind,status:'PRIMARY_DOCUMENT_READ_VERIFIED',
   familyId:F,actorUid:actor,childId:CHILD,revision:1,body:{}}]));
 const documentClient={
  readAll:async()=>{trace.push('documents.readAll');return {
   status:'PRIMARY_DOCUMENTS_FULLY_READ',documents:docs()
  }},
  read:async({kind})=>{trace.push('documents.read.'+kind);return docs()[kind];}
 };
 const queue9={activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
  selectedScope:()=>({familyId:F,actorUid:actor,childId:CHILD}),
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
    familyId:F,actorUid:actor,childId:CHILD,canWrite:false,
    inventory:inventory(),revisions:revisions()};
  }}),
  primaryFactory:()=>queue9,commandsFactory:{create:()=>({submit(){}})},
  actionsFactory:{create:()=>({attach:()=>({detach(){}})})},
  projection:{project:v=>({status:'PRIMARY_READ_ONLY_READY',
   familyId:v.familyId,actorUid:v.actorUid,childId:v.childId,
   canWrite:false,state:{inventory:v.inventory,transactions:[]},
   revisions:v.revisions})},
  ui:{defaults:()=>({}),clear:()=>trace.push('ui.clear'),
   show:data=>trace.push('ui.show.S='+data.state.inventory.S)},
  documentsFactory:()=>documentClient,
  documentsOverlay:{apply:(base)=>({...base,sharedBusinessDocumentsVerified:true,
   cloudDocumentsActorScope:{familyId:F,childId:CHILD}})},
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
  setActor:a=>actor=a,setLoggedIn:x=>loggedIn=x,
  setQueue:(kind,n)=>{if(kind===9)q9=n;else if(kind===26)q26=n;else q27=n;},
  counts:()=>({q9,q26,q27})};
}
test('B5-01 settings buttons exist below account and use identical header entrypoints',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 const account=html.indexOf('id="formalAccountSection"');
 const section=html.indexOf('id="formalCloudSyncSection"');
 const profile=html.indexOf('id="babyName"');
 assert.ok(account<section&&section<profile);
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
