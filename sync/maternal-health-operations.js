/* Explicit saves and recovery for the family health IndexedDB queue. */
(function(root){
'use strict';
const commonJs=typeof module!=='undefined'&&module.exports;
const outboxFactory=commonJs?require('./idb-outbox.js'):root.XBDurableOutbox;
const contract=commonJs?require('./outbox-contract.js'):root.XBOutboxContract;
const {isUuid,validBody}=commonJs?require('./maternal-health-client.js'):root.XBMaternalHealthClient;
const DB_NAME='xiaobao-maternal-health-v130';
const TYPE='maternal-health.upsert';
const outcome=(status,fields={})=>Object.freeze({status,...fields});
const sameScope=(scope,other)=>scope.familyId===other?.familyId&&scope.actorUid===other?.actorUid;

function create({controller,client,host=root,cloudWritesEnabled=false,
 uuid=()=>host.crypto.randomUUID()}={}){
 if(typeof controller?.verifiedContext!=='function'||!client?.read||!client?.put||!client?.checkRequest)
  throw Error('maternal_health:dependencies_required');
 const outbox=outboxFactory.create({indexedDB:host?.indexedDB,contract,dbName:DB_NAME});
 const enabled=cloudWritesEnabled===true&&client.cloudWritesEnabled===true;
 const online=()=>host.navigator?.onLine!==false;
 let busy=false;
 function identity(){
  const ctx=controller.verifiedContext();
  if(!ctx?.app||!isUuid(ctx.familyId)||typeof ctx.actorUid!=='string'
    ||!ctx.actorUid||ctx.actorUid.length>128)return null;
  return {familyId:ctx.familyId,actorUid:ctx.actorUid};
 }

 async function pending(){
  const scope=identity();
  if(!scope)return outcome('PERMISSION_DENIED');
  try{
   const counts=await outbox.stats(scope);
   return sameScope(scope,identity())?outcome('QUEUE_VERIFIED',counts):outcome('SCOPE_CHANGED');
  }catch(_){return outcome('QUEUE_UNVERIFIED');}
 }

 // The caller passes the complete next document and its displayed read baseline.
 async function queue({baseline,nextBody}={}){
  if(!enabled)return outcome('WRITES_DISABLED');
  if(!online())return outcome('OFFLINE');
  const scope=identity();
  if(!scope)return outcome('PERMISSION_DENIED');
  const expectedRevision=baseline?.revision;
  if(baseline?.status!=='READ_VERIFIED'||!sameScope(scope,baseline)
    ||!Number.isSafeInteger(expectedRevision)||expectedRevision<0
    ||!Number.isSafeInteger(expectedRevision+1)||!validBody(nextBody))
   return outcome('INVALID_INPUT');
  if(busy)return outcome('BUSY');
  busy=true;
  let requestId;
  try{
   const payload={nextBody:JSON.parse(JSON.stringify(nextBody))};
   if(!validBody(payload.nextBody))return outcome('INVALID_INPUT');
   const [existing]=await outbox.ready(scope);
   if(!sameScope(scope,identity()))return outcome('SCOPE_CHANGED');
   if(existing)return outcome('PENDING_REQUEST',{requestId:existing.id});
   if(!online())return outcome('OFFLINE');
   const id=uuid();
   if(!isUuid(id))return outcome('INVALID_INPUT');
   requestId=id.toLowerCase();
   const op=contract.createOperation({id:requestId,type:TYPE,...scope,
    expectedRevision,payload,createdAt:new Date().toISOString()});
   const queued=await outbox.enqueue(op);
   if(!sameScope(scope,identity()))return outcome('SCOPE_CHANGED');
   return outcome('QUEUED',{requestId,operationStatus:queued.status});
  }catch(_){return outcome('QUEUE_UNVERIFIED',{requestId});}
  finally{busy=false;}
 }

 async function confirm(scope,op,ack){
  const {id:requestId,expectedRevision}=op;
  if(!sameScope(scope,ack)||ack.requestId!==requestId||ack.revision!==expectedRevision+1)
   return outcome('UNKNOWN',{requestId});
  await outbox.recordResult(scope,requestId,{kind:'accepted',receiptId:requestId});
  // An older receipt proves the save, while the fresh read supplies the current document.
  const document=await client.read(scope);
  if(!sameScope(scope,identity()))return outcome('SCOPE_CHANGED');
  if(document.status!=='READ_VERIFIED'||!sameScope(scope,document)||document.revision<ack.revision)
   return outcome('COMMITTED_NEEDS_REFRESH',{requestId,revision:ack.revision});
  return outcome('COMMITTED',{requestId,revision:ack.revision,document});
 }

 // Send the oldest retryable request in the current account and family.
 async function send(){
  if(!enabled)return outcome('WRITES_DISABLED');
  if(!online())return outcome('OFFLINE');
  const scope=identity();
  if(!scope)return outcome('PERMISSION_DENIED');
  if(busy)return outcome('BUSY');
  busy=true;
  let requestId;
  try{
   const [op]=await outbox.ready(scope);
   if(!sameScope(scope,identity()))return outcome('SCOPE_CHANGED');
   if(!op)return outcome('EMPTY');
   requestId=op.id;
   if(op.type!==TYPE)return outcome('QUEUE_UNVERIFIED',{requestId});
   const request={...scope,requestId};
   const prior=await client.checkRequest(request);
   if(!sameScope(scope,identity()))return outcome('SCOPE_CHANGED');
   if(prior.status==='COMMITTED')return await confirm(scope,op,prior);
   if(prior.status!=='NO_RECEIPT'||!sameScope(scope,prior)||prior.requestId!==requestId)
    return outcome(prior.status==='PERMISSION_DENIED'?'PERMISSION_DENIED':'UNKNOWN',{requestId});
   if(!online())return outcome('OFFLINE',{requestId});

   const saved=await client.put({...request,expectedRevision:op.expectedRevision,
    nextBody:op.payload.nextBody});
   if(!sameScope(scope,identity()))return outcome('SCOPE_CHANGED');
   if(saved.status==='COMMITTED')return await confirm(scope,op,saved);
   if(['REVISION_CONFLICT','REQUEST_ID_CONFLICT','INVALID_INPUT'].includes(saved.status)){
    await outbox.recordResult(scope,requestId,{kind:'conflict'});
    return outcome(saved.status,{requestId});
   }
   if(saved.status!=='UNKNOWN')return outcome(saved.status,{requestId});
   const receipt=await client.checkRequest(request);
   if(!sameScope(scope,identity()))return outcome('SCOPE_CHANGED');
   if(receipt.status==='COMMITTED')return await confirm(scope,op,receipt);
   await outbox.recordResult(scope,requestId,{kind:'timeout'});
   return outcome('UNKNOWN',{requestId});
  }catch(_){return outcome('UNKNOWN',{requestId});}
  finally{busy=false;}
 }
 return Object.freeze({queue,send,pending});
}

const api=Object.freeze({create,DB_NAME});
if(root)root.XBMaternalHealthOperations=api;
if(commonJs)module.exports=api;
})(typeof window!=='undefined'?window:null);
