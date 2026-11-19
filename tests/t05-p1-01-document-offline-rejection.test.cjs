'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Cmd=require('../sync/primary-documents-business-commands.js');
const Ops=require('../sync/primary-documents-operations.js');
const UI=require('../sync/primary-formal-ui-actions.js');
const fs=require('node:fs'),path=require('node:path');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const UUID=n=>'04e4577d-8a3d-4dd1-a7d3-'+String(n).padStart(12,'0');
const OFFLINE='DOCUMENT_OFFLINE_REQUIRES_VERIFIED_BASELINE';
const TIP='当前网络不可用，本次操作未保存，请联网后重新操作。';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const until=async(predicate)=>{
 for(let i=0;i<80;i++){if(predicate())return;await tick();}
 assert.fail('async formal document action did not settle');
};
const bases={
 reference:{referenceOverrides:{'好奇|小森林|NB':1.1},other:'keep'},
 quotes:{items:[{id:'q1',price:40,brand:'好奇'}],other:'keep'},
 growth:{items:[{id:'w1',date:'2026-11-01',weight:3.1}],other:'keep'},
 profile:{babyProfile:{name:'原宝宝',sex:'女'},dueDate:'2027-01-08',birthDate:''},
 settings:{currentSize:'NB',target:{NB:100,S:60},daily:{NB:8,S:10},preset:'balanced'}
};
const intents={
 settings:{id:'saveSizePreferences',kind:'settings',action:'patch',record:{target:{NB:105}}},
 plans:{id:'savePlans',kind:'settings',action:'patch',record:{target:{S:70}}},
 preset:{id:'presetBalanced',dataset:{preset:'balanced'},kind:'settings',action:'patch',record:{preset:'lean'}},
 profile:{id:'saveProfile',kind:'profile',action:'patch',record:{babyProfile:{name:'新宝宝'}}},
 growthAdd:{id:'saveWeight',kind:'growth',action:'add',record:{id:'w2',date:'2026-11-15',weight:3.5}},
 growthEdit:{id:'saveWeight',kind:'growth',action:'edit',record:{id:'w1',weight:3.9}},
 growthDelete:{id:'deleteWeight',dataset:{action:'deleteweight'},kind:'growth',action:'delete',record:{id:'w1'}},
 quotesAdd:{id:'saveQuote',kind:'quotes',action:'add',record:{id:'q2',price:42}},
 quotesEdit:{id:'saveQuote',kind:'quotes',action:'edit',record:{id:'q1',price:35}},
 quotesDelete:{id:'deleteQuote',dataset:{action:'deletequote'},kind:'quotes',action:'delete',record:{id:'q1'}},
 quotesClear:{id:'clearQuotes',kind:'quotes',action:'clear',record:null},
 referenceSet:{id:'saveEditedReference',kind:'reference',action:'set',record:{key:'好奇|小森林|NB',value:1.2}},
 referenceReset:{id:'restoreDefaultReference',kind:'reference',action:'reset',record:{key:'好奇|小森林|NB'}}
};
const keys={settings:'saveSizePreferences',plans:'savePlans',preset:'presetBalanced',
 profile:'saveProfile',growthAdd:'saveWeight',growthEdit:'saveWeight',growthDelete:'deleteWeight',
 quotesAdd:'saveQuote',quotesEdit:'saveQuote',quotesDelete:'deleteQuote',
 quotesClear:'clearQuotes',referenceSet:'saveEditedReference',referenceReset:'restoreDefaultReference'};
function setup({online=false,queueMode='normal',sendMode='ack',lateOffline=false}={}){
 let isOnline=online,queueCurrent=queueMode,sendCurrent=sendMode,uuidCount=0,remoteCommits=0;
 const records=new Map(),notifies=[],listeners=new Map(),nodes=new Map(),rpc=[];
 let input=null;
 const scope={familyId:FAMILY,actorUid:'A',childId:CHILD};
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{
   id,textContent:({saveQuote:'加入候选价',clearQuotes:'清空候选价',
    saveWeight:'保存体重记录',saveProfile:'保存宝宝资料',
    saveSizePreferences:'保存尺码与采购偏好',
    savePlans:'保存备货计划',presetBalanced:'均衡方案',
    saveEditedReference:'保存新价格',
    restoreDefaultReference:'恢复默认价',
    deleteWeight:'删除',deleteQuote:'删除'})[id]||'',
   value:'已输入且不可丢失',dataset:{},disabled:false,hidden:false,
   style:{},classList:{contains:()=>false},
   closest(){return this;},querySelectorAll(){return [];},
   addEventListener(){},removeEventListener(){}
  });
  return nodes.get(id);
 };
 for(const i of Object.values(intents)){node(i.id).dataset={...(i.dataset||{})};}
 node('quoteList').querySelectorAll=()=>[node('deleteQuote')];
 const doc={
  body:{dataset:{}},getElementById:node,
  querySelectorAll(selector){return selector==='[data-preset]'?[node('presetBalanced')]:[];},
  addEventListener(name,listener){listeners.set(name,listener);},
  removeEventListener(name,listener){if(listeners.get(name)===listener)listeners.delete(name);}
 };
 const host={navigator:{get onLine(){return isOnline;}},indexedDB:{open(){}},crypto:{randomUUID:()=>UUID(++uuidCount)}};
 const outbox={
  async stats(){
   if(lateOffline)isOnline=false;
   const outstanding=[...records.values()].filter(x=>x.status!=='acked').length;
   return{outstanding,pending:outstanding,blocked:0,conflict:0,retry:0,total:records.size};
  },
  async enqueue(op){
   if(queueCurrent==='uncertain')throw Error('simulated IDB transaction outcome unknown');
   records.set(op.id,{...op,status:'pending'});
   if(queueCurrent==='offline-after-durable')isOnline=false;
   return{duplicate:false};
  },
  async ready(){return [...records.values()].filter(x=>x.status==='pending');},
  async get(_,id){return records.get(id)||null;},
  async recordResult(_,id,event){records.get(id).status=event.kind==='accepted'?'acked':'conflict';}
 };
 const client={
  async read({kind}){return baseline(kind);},
  async put(args){
   rpc.push({type:'put',requestId:args.requestId,kind:args.kind});
   if(sendCurrent==='network-fail')throw Error('network failed after durable queue');
   remoteCommits++;
   if(sendCurrent==='ack-lost')return{status:'PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID'};
   return{status:'PRIMARY_DOCUMENT_COMMITTED',kind:args.kind,
    requestId:args.requestId,familyId:FAMILY,childId:CHILD,
    revision:args.expectedRevision+1};
  },
  async checkRequest(args){
   rpc.push({type:'receipt',requestId:args.requestId});
   if(sendCurrent==='ack-lost')return{status:'REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY'};
   return{status:'REQUEST_COMMITTED_VERIFIED',
    kind:records.get(args.requestId)?.payload?.kind,revision:4};
  }
 };
 function baseline(kind){
  return{status:'PRIMARY_DOCUMENT_READ_VERIFIED',
   ...scope,kind,revision:3,body:JSON.parse(JSON.stringify(bases[kind]))};
 }
 const ops=Ops.create({
  controller:{verifiedContext:()=>({...scope,app:{synthetic:true}})},host,
  documentsClient:client,outboxFactory:{create:()=>outbox},
  contract:{createOperation:x=>x},
  cloudWritesEnabled:true,referenceAndQuotes:true,
  allowGrowth:true,allowProfile:true,allowSettings:true,
  fastReferenceEnabled:true,fastQuotesEnabled:true,
  fastGrowthEnabled:true,fastProfileEnabled:true,fastSettingsEnabled:true
 });
 const command=Cmd.create({client,queue:ops,
  uuid:()=>UUID(++uuidCount),isOnline:()=>isOnline});
 const ui=UI.create({
  commands:{submit:async()=>({status:'NOT_CALLED'})},
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  notify:answer=>{notifies.push(answer);node('formalSyncState').textContent=
   answer?.status===OFFLINE?TIP:String(answer?.status||'');},
  formalModeSelected:()=>true,operatorApproved:()=>true,
  documentOperatorApproved:()=>true,buildAllowsWrites:true,
  buildAllowsDocumentWrites:true,purchaseOnly:true,
  allowReference:true,allowQuotes:true,allowGrowth:true,
  allowProfile:true,allowSettings:true,
  documentCommands:command,documentQueue:ops,
  readDocumentInput:()=>input&&{kind:input.kind,action:input.action,record:input.record},
  readReferenceBaseline:()=>baseline('reference'),
  readQuotesBaseline:()=>baseline('quotes'),
  readGrowthBaseline:()=>baseline('growth'),
  readProfileBaseline:()=>baseline('profile'),
  readSettingsBaseline:()=>baseline('settings'),
  confirmGrowthDelete:()=>true,confirmQuoteClear:()=>true,confirmQuoteDelete:()=>true,
  onReferenceAck:async()=> 'ready',onQuotesAck:async()=> 'ready',
  onGrowthAck:async()=> 'ready',onProfileAck:async()=> 'ready',
  onSettingsAck:async()=> 'ready',
  onReferenceReadback:async()=> 'ready',onQuotesReadback:async()=> 'ready',
  onGrowthReadback:async()=> 'ready',onProfileReadback:async()=> 'ready',
  onSettingsReadback:async()=> 'ready'
 });
 const binding=ui.attach(doc);
 async function click(key){
  input=intents[key];
  const element=node(keys[key]);
  element.dataset={...(input.dataset||{})};
  if(key==='quotesEdit')element.textContent='保存本次修改';
  const previous=notifies.length;
  const event={target:element,preventDefault(){},stopImmediatePropagation(){}};
  listeners.get('click')(event);
  await until(()=>notifies.length>previous);
  return{answer:notifies.at(-1),element,kind:input.kind};
 }
 return{
  click,command,ops,binding,node,records,notifies,rpc,host,
  get uuidCount(){return uuidCount;},
  get remoteCommits(){return remoteCommits;},
  setOnline:v=>{isOnline=v;},setQueueMode:v=>{queueCurrent=v;},
  setSendMode:v=>{sendCurrent=v;}
 };
}
const allKinds=Object.keys(intents);
test('T05 all 13 real five-document UI routes reject known offline without UUID, queue, locks or input loss',async()=>{
 for(const key of allKinds){
  const f=setup();
  const beforeValue=f.node(keys[key]).value;
  const beforeLabel=f.node(keys[key]).textContent;
  const {answer,element,kind}=await f.click(key);
  assert.equal(answer.status,OFFLINE,key);
  assert.equal(answer.requestId,undefined,key);
  assert.equal(f.uuidCount,0,key);
  assert.equal(f.records.size,0,key);
  assert.equal(f.rpc.length,0,key);
  assert.equal(element.disabled,false,key);
  assert.equal(element.value,beforeValue,key);
  assert.equal(f.node('formalSyncState').textContent,TIP,key);
  assert.doesNotMatch(element.textContent,/等待核验|正在保存|正在恢复/,key);
  const flag=kind==='reference'?f.binding.hasPendingReferenceReview():
   kind==='quotes'?f.binding.hasPendingMinimalReview('quotes'):
   f.binding.hasPendingDocumentReview();
  assert.equal(flag,false,key);
  assert.equal(f.notifies.length,1,key);
  assert.ok(beforeLabel,'input label should be present for '+key);
 }
});
test('T05 offline settings save returns original controls, and same-page reconnection requires a new click',async()=>{
 const f=setup(),original=f.node('saveSizePreferences').textContent;
 const failed=await f.click('settings');
 assert.equal(failed.answer.status,OFFLINE);
 assert.equal(f.node('saveSizePreferences').textContent,original);
 assert.equal(f.node('saveSizePreferences').disabled,false);
 assert.equal(f.uuidCount,0);
 f.setOnline(true);
 const success=await f.click('settings');
 assert.equal(success.answer.status,'SETTINGS_CLOUD_ACK_APPLIED');
 assert.equal(f.uuidCount,1);
 assert.equal(f.records.size,1);
 assert.equal(f.records.get(UUID(1)).status,'acked');
 assert.equal(f.rpc.filter(x=>x.type==='put').length,1);
 assert.equal(f.binding.hasPendingDocumentReview(),false);
});
test('T05 underlying queue refuses late offline after UUID: command discards only unqueued ID',async()=>{
 const f=setup({online:true,lateOffline:true});
 const input=intents.settings;
 const answer=await f.command.submit({...input,
  familyId:FAMILY,actorUid:'A',expectedRevision:3,
  operatorApproved:true,verifiedBaseline:{
   status:'PRIMARY_DOCUMENT_READ_VERIFIED',familyId:FAMILY,
   actorUid:'A',childId:CHILD,kind:'settings',revision:3,
   body:bases.settings
  }});
 assert.equal(answer.status,OFFLINE);
 assert.equal(answer.requestId,undefined);
 assert.equal(f.uuidCount,1,'UUID allocated before late connectivity drop');
 assert.equal(f.records.size,0);
 assert.equal(f.rpc.length,0);
});
test('T05 definite queue rejections without persistence never carry a fictitious requestId',async()=>{
 for(const status of ['DOCUMENT_QUEUE_BUSY','INVALID_DOCUMENT_OPERATION',
  'DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED','DOCUMENT_WRITES_NOT_AUTHORIZED']){
  const f=setup({online:true});
  const id=UUID(1),forced=Cmd.create({
   client:{read:async({kind})=>({status:'PRIMARY_DOCUMENT_READ_VERIFIED',
    ...{familyId:FAMILY,actorUid:'A',childId:CHILD},kind,revision:3,body:bases.settings})},
   queue:{cloudWritesEnabled:true,pending:()=>f.ops.pending(),
    queue:async()=>({status})},
   uuid:()=>id,isOnline:()=>true
  });
  const out=await forced.submit({familyId:FAMILY,actorUid:'A',
   kind:'settings',action:'patch',record:{target:{NB:105}},
   expectedRevision:3,operatorApproved:true});
  assert.equal(out.status,status);
  assert.equal(out.requestId,undefined);
 }
});
test('T05 durable document queue followed by offline retains same UUID and UI review',async()=>{
 const f=setup({online:true,queueMode:'offline-after-durable'});
 const x=await f.click('settings');
 assert.equal(x.answer.status,'DOCUMENT_OFFLINE_QUEUE_PRESERVED');
 assert.equal(x.answer.requestId,UUID(1));
 assert.equal(f.records.size,1);
 assert.equal(f.records.get(UUID(1)).status,'pending');
 assert.equal(f.uuidCount,1);
 assert.equal(f.binding.hasPendingDocumentReview(),true);
 assert.equal(x.element.disabled,true);
 assert.match(x.element.textContent,/等待核验/);
 f.setOnline(true);
 const receipt=await f.ops.send({operatorApproved:true});
 assert.equal(receipt.status,'DOCUMENT_SYNC_CONFIRMED');
 assert.equal(f.uuidCount,1,'retry never allocates a new request');
 assert.equal(f.records.size,1);
});
test('T05 lost 026 ACK keeps original ID with pending UI, never silently retries',async()=>{
 const f=setup({online:true,sendMode:'ack-lost'});
 const x=await f.click('quotesAdd');
 assert.equal(x.answer.requestId,UUID(1));
 assert.equal(f.records.get(UUID(1)).status,'pending');
 assert.equal(f.binding.hasPendingMinimalReview('quotes'),true);
 assert.equal(x.element.disabled,true);
 assert.equal(f.remoteCommits,1);
 assert.equal(f.uuidCount,1);
 assert.equal(f.rpc.filter(x=>x.type==='put').length,1);
});
test('T05 ambiguous local IDB outcome remains reviewable with exact original UUID',async()=>{
 const f=setup({online:true,queueMode:'uncertain'});
 const x=await f.click('growthAdd');
 assert.equal(x.answer.status,'DOCUMENT_LOCAL_QUEUE_UNVERIFIED_KEEP_REQUEST_ID');
 assert.equal(x.answer.requestId,UUID(1));
 assert.equal(f.binding.hasPendingDocumentReview(),true);
 assert.equal(x.element.disabled,true);
 assert.equal(f.uuidCount,1);
 assert.equal(f.rpc.length,0);
 assert.match(f.node('growthActionFeedback').textContent,/原请求已保留/);
});
test('T05 cloud receipt identifies commit after ACK loss without a new UUID or 026 PUT',async()=>{
 const f=setup({online:true,sendMode:'ack-lost'});
 const x=await f.click('referenceSet');
 assert.equal(x.answer.requestId,UUID(1));
 assert.equal(f.binding.hasPendingReferenceReview(),true);
 assert.equal(f.remoteCommits,1);
 f.setSendMode('receipt-ready');
 const recovered=await f.ops.checkSavedRequest(UUID(1));
 assert.equal(recovered.status,'REQUEST_ACK_RECOVERED');
 assert.equal(f.records.get(UUID(1)).status,'acked');
 assert.equal(f.remoteCommits,1);
 assert.equal(f.uuidCount,1);
});
test('T05 current Feature HTML embeds the exact repaired command and UI modules',()=>{
 const root=path.resolve(__dirname,'..');
 const html=fs.readFileSync(path.join(root,'preview/v1.2.0/formal/index.html'),'utf8');
 for(const name of ['primary-documents-business-commands.js',
  'primary-formal-ui-actions.js']){
  const source=fs.readFileSync(path.join(root,'sync',name),'utf8').trim();
  assert.ok(html.includes(source),'source mirror mismatch '+name);
 }
 const formal=fs.readFileSync(path.join(root,'preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(formal,/isOnline:\(\)=>host\.navigator\?\.onLine!==false/);
 assert.match(formal,/DOCUMENT_OFFLINE_REQUIRES_VERIFIED_BASELINE/);
});
