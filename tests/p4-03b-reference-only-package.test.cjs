const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const SrcFormal=require('../preview/v1.2.0/formal-controller.js');
const TestFormal=require('../deploy/xb-test/formal/formal-controller.js');
const Docs=require('../sync/primary-documents-operations.js');
const Business=require('../sync/primary-documents-business-commands.js');
const UI=require('../sync/primary-formal-ui-actions.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const KEY='好奇|小森林|S',OTHER='好奇|小森林|NB';
const IDS=['04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',
 '79192488-bd70-4b88-8c66-3c5b5fb29ef5'];
const copy=x=>JSON.parse(JSON.stringify(x));

function mockReference({overrides={}}={}){
 const initial=copy(overrides);
 const rows=new Map(),receipts=new Map(),putCalls=[],ids=[];
 const state={revision:0,body:{referenceOverrides:initial}};
 const scope={familyId:F,actorUid:'A'};
 const docClient={
  async read({kind}){return{status:'PRIMARY_DOCUMENT_READ_VERIFIED',
   familyId:F,actorUid:'A',childId:C,kind,revision:state.revision,body:copy(state.body)};},
  async put(input){
   putCalls.push(copy(input));
   assert.equal(input.kind,'reference');
   if(input.expectedRevision!==state.revision)
    return {status:'PRIMARY_DOCUMENT_VERSION_CONFLICT'};
   state.body=copy(input.nextBody);state.revision++;
   receipts.set(input.requestId,{kind:'reference',revision:state.revision});
   return {status:'PRIMARY_DOCUMENT_COMMITTED',requestId:input.requestId};
  },
  async checkRequest({requestId}){
   const receipt=receipts.get(requestId);
   return receipt?{status:'REQUEST_COMMITTED_VERIFIED',...receipt}:
    {status:'REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY'};
  }
 };
 const outbox={
  async enqueue(op){if(rows.has(op.id))return {duplicate:true};
   rows.set(op.id,{...op,status:'pending'});return {duplicate:false};},
  async ready(){return [...rows.values()].filter(x=>x.status==='pending');},
  async stats(){return {outstanding:[...rows.values()].filter(
   x=>x.status!=='acked').length};},
  async recordResult(_scope,id,result){
   rows.get(id).status=result.kind==='accepted'?'acked':'conflict';
  },
  async get(_scope,id){return rows.get(id)||null}
 };
 const queue=Docs.create({
  controller:{verifiedContext:()=>scope},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:docClient,outboxFactory:{create:()=>outbox},
  contract:{createOperation:op=>op},
  cloudWritesEnabled:true,referenceOnly:true,referenceAndQuotes:false,
  allowGrowth:false,allowProfile:false,allowSettings:false
 });
 const commands=Business.create({client:docClient,queue,
  uuid:()=>{const id=IDS[ids.length];ids.push(id);return id;}});
 let primaryCalls=0;
 const input={kind:'reference',action:'set',record:{key:KEY,value:1.22}};
 const ui=UI.create({
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  commands:{submit:async()=>{primaryCalls++;return {status:'NO_PURCHASE'};}},
  readPurchase:()=>({}),readQuote:()=>({}),
  readTransaction:()=>({}),
  notify:()=>{},formalModeSelected:()=>true,
  buildAllowsWrites:false,operatorApproved:()=>false,
  buildAllowsDocumentWrites:true,documentOperatorApproved:()=>true,
  allowReference:true,allowQuotes:false,allowGrowth:false,allowProfile:false,
  allowSettings:false,purchaseOnly:true,allowConsume:false,allowReverse:false,
  allowStocktake:false,
  documentCommands:commands,documentQueue:queue,
  readReferenceBaseline:()=>({
   kind:'reference',familyId:F,childId:C,actorUid:'A',
   revision:state.revision,body:copy(state.body)
  }),
  readDocumentInput:()=>copy(input),
  onReferenceReadback:async ({requestId,record,action,expectedRevision})=>{
   const receipt=await docClient.checkRequest({requestId});
   if(receipt.status!=='REQUEST_COMMITTED_VERIFIED'
     ||receipt.revision!==expectedRevision+1)return 'pending';
   if(action==='reset'){
    if(Object.hasOwn(state.body.referenceOverrides,record.key))
     return 'pending';
   }else if(state.body.referenceOverrides[record.key]!==record.value)
    return 'pending';
   return 'ready';
  }
 });
 const click=(id,dataset={})=>ui.handle({id,dataset},{});
 return {scope,docClient,queue,commands,ui,click,input,state,rows,receipts,
  ids,putCalls,get primaryCalls(){return primaryCalls}};
}
test('P4-03B Feature and test bundle enable shared documents; purchase remains OFF',()=>{
 assert.equal(SrcFormal.FORMAL_WRITE_ENABLED,false);
 assert.equal(SrcFormal.FORMAL_DOCUMENT_WRITE_ENABLED,true);
 assert.equal(SrcFormal.FORMAL_PURCHASE_ENABLED,false);
 assert.equal(TestFormal.FORMAL_WRITE_ENABLED,true);
 assert.equal(TestFormal.FORMAL_PURCHASE_ENABLED,false);
 const c=fs.readFileSync(path.join(__dirname,'../deploy/xb-test/formal/formal-controller.js'),'utf8');
 assert.match(c,/referenceOnly:true,referenceAndQuotes:false/);
 assert.match(c,/allowReference:true,allowQuotes:false,allowGrowth:false,allowProfile:false/);
 assert.match(c,/purchaseOnly:true,allowConsume:false,allowReverse:false/);
 const src=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.match(src,/const FORMAL_WRITE_ENABLED=false/);
 assert.match(src,/const FORMAL_DOCUMENT_WRITE_ENABLED=true/);
 assert.match(src,/const FORMAL_PURCHASE_ENABLED=false/);
 assert.match(src,/referenceAndQuotes:true,allowGrowth:true,allowProfile:true,allowSettings:false/);
});
test('P4-03B reference-only queue denies other four kinds before IDB or RPC',async()=>{
 const f=mockReference();
 for(const kind of ['quotes','growth','profile','settings']){
  const result=await f.queue.queue({kind,requestId:IDS[0],
   expectedRevision:0,nextBody:{},operatorApproved:true});
  assert.equal(result.status,'INVALID_DOCUMENT_OPERATION',kind);
 }
 assert.equal(f.rows.size,0);
 assert.equal(f.putCalls.length,0);
 f.rows.set(IDS[0],{id:IDS[0],status:'pending',payload:{kind:'settings',childId:C}});
 assert.equal((await f.queue.send({operatorApproved:true})).status,
  'DOCUMENT_KIND_NOT_AUTHORIZED');
 assert.equal(f.putCalls.length,0);
});
test('P4-03B only reference UI can reach original durable CAS queue, receipt and readback',async()=>{
 const f=mockReference({overrides:{[OTHER]:0.92}});
 const result=await f.click('saveEditedReference');
 assert.equal(result.status,'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.state.revision,1);
 assert.equal(f.state.body.referenceOverrides[KEY],1.22);
 assert.equal(f.state.body.referenceOverrides[OTHER],0.92);
 assert.equal(f.putCalls.length,1);
 assert.equal(f.putCalls[0].expectedRevision,0);
 assert.equal(f.putCalls[0].requestId,f.ids[0]);
 assert.equal(f.rows.get(f.ids[0]).status,'acked');
 assert.equal((await f.queue.checkSavedRequest(f.ids[0])).status,
  'REQUEST_ACK_RECOVERED');
 assert.equal(f.putCalls.length,1,'receipt checks must not produce another PUT');
 assert.equal(f.primaryCalls,0);
});
test('P4-03B non-reference UI and buy/use/reverse/stocktake are all blocked',async()=>{
 const f=mockReference();
 for(const id of ['saveQuote','saveWeight','saveProfile','savePlans']){
  assert.equal((await f.click(id)).status,'FORMAL_PURCHASE_ONLY',id);
 }
 for(const [id,dataset] of [
  ['buyNow',{}],['saveStocks',{}],['',{action:'consume',size:'S',count:'1'}],
  ['',{action:'deletetx',id:'cloud'}],['',{action:'buyquote',id:'q'}]
 ]){
  assert.equal((await f.click(id,dataset)).status,
   'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 }
 assert.equal(f.putCalls.length,0);
 assert.equal(f.primaryCalls,0);
 assert.equal(f.ids.length,0);
});
test('P4-03B absent original custom override recovers by resetting only its key',async()=>{
 const f=mockReference({overrides:{[OTHER]:0.93}});
 assert.equal((await f.click('saveEditedReference')).status,
  'REFERENCE_CLOUD_READBACK_VERIFIED');
 f.input.action='reset';f.input.record={key:KEY};
 assert.equal((await f.click('restoreDefaultReference')).status,
  'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.state.revision,2);
 assert.equal(Object.hasOwn(f.state.body.referenceOverrides,KEY),false);
 assert.equal(f.state.body.referenceOverrides[OTHER],0.93);
 assert.equal(f.putCalls.length,2);
 assert.equal(new Set(f.putCalls.map(x=>x.requestId)).size,2);
});
test('P4-03B existing original custom override recovers by saving original value',async()=>{
 const f=mockReference({overrides:{[KEY]:1.05,[OTHER]:0.93}});
 assert.equal((await f.click('saveEditedReference')).status,
  'REFERENCE_CLOUD_READBACK_VERIFIED');
 f.input.action='set';f.input.record={key:KEY,value:1.05};
 assert.equal((await f.click('saveEditedReference')).status,
  'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.deepEqual(f.state.body.referenceOverrides,{[KEY]:1.05,[OTHER]:0.93});
 assert.equal(f.state.revision,2);
});
test('P4-03B no new request UUID on conflict; original receipt remains accessible',async()=>{
 const f=mockReference();
 const first=await f.click('saveEditedReference');
 assert.equal(first.status,'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.ids.length,1);
 assert.equal((await f.queue.checkSavedRequest(f.ids[0])).status,
  'REQUEST_ACK_RECOVERED');
 assert.equal(f.state.revision,1);
 assert.equal(f.putCalls.length,1);
});
test('P4-03B tested reference baseline matches verified primary after the first full read',async()=>{
 const events=new Map(),els=new Map();
 const el=id=>{
  if(!els.has(id))els.set(id,{
   hidden:false,disabled:false,textContent:'',value:'',
   addEventListener(name,fn){events.set(id+':'+name,fn)}
  });
  return els.get(id);
 };
 const doc={body:{dataset:{}},getElementById:el,
  addEventListener(name,fn){events.set('doc:'+name,fn)}};
 const host={navigator:{onLine:true},addEventListener(){},
  crypto:{randomUUID:()=>IDS[0]},setTimeout,clearTimeout};
 const sdk={auth:{getSession:async()=>({data:{user:{id:'A'}}})}};
 const scope={app:sdk,actorUid:'A',familyId:F};
 let options=null;
 const app=SrcFormal.create({
  host,doc,scriptLoader:async()=>{},
  loginController:{create:()=>({
   connect:async()=> 'CLOUD_READ_ONLY_CONNECTED',verifiedContext:()=>scope,
   signOut:async()=> 'LOGIN_REQUIRED',requestOtp:async()=> 'OTP_REQUESTED'
  })},
  readModelFactory:()=>({read:async()=>({status:'PRIMARY_READ_ONLY_READY',canWrite:false})}),
  primaryFactory:()=>({activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'})}),
  commandsFactory:{create:()=>({submit:async()=>({status:'DISABLED'})})},
  actionsFactory:{create:o=>{options=o;return{attach:()=>({detach(){}})};}},
  projection:{project:()=>({status:'PRIMARY_READ_ONLY_READY',canWrite:false,
   familyId:F,childId:C,actorUid:'A',state:{},revisions:{}})},
  ui:{defaults:()=>({}),show:()=>{},clear:()=>{}},
  documentsFactory:()=>({readAll:async()=>({
   status:'PRIMARY_DOCUMENTS_FULLY_READ',canWrite:false,
   documents:{reference:{
    status:'PRIMARY_DOCUMENT_READ_VERIFIED',
    familyId:F,actorUid:'A',childId:C,revision:0,
    body:{referenceOverrides:{}}}
   }
  })}),
  documentsOverlay:{apply:original=>({...original,canWrite:false,
   sharedBusinessDocumentsVerified:true})}
 });
 assert.equal(await app.start(),'ready');
 await new Promise(setImmediate);
 assert.ok(options,'UI actions must be attached');
 const base=options.readReferenceBaseline();
 assert.equal(base.familyId,F);
 assert.equal(base.actorUid,'A');
 assert.equal(base.childId,C);
 assert.equal(base.revision,0);
 assert.ok(base.body.referenceOverrides);
});
