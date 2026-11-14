/* M3 CAS document durable queue: SDK + existing P3 IndexedDB/outbox contract.
 * Separate DB from primary inventory so inventory 009 replay cannot consume
 * non-stock commands. Same request UUID is durable BEFORE any server write.
 * Server SQL 026 remains UNDEPLOYED; this module is not in live PWA.
 */
(function(root){
'use strict';
const DB_NAME='xiaobao-primary-documents-v120';
const DOC_TYPES={quotes:'quote.upsert',reference:'reference.patch',
 growth:'weight.upsert',profile:'profile.patch',settings:'settings.patch'};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ans=(status,more={})=>Object.freeze({status,...more});
function create({controller,host,documentsClient,outboxFactory,contract,
 cloudWritesEnabled=false,referenceOnly=false,referenceAndQuotes=false,
 allowGrowth=false}={}){
 if(!controller?.verifiedContext||!documentsClient?.read
   ||!documentsClient?.put||!documentsClient?.checkRequest
   ||!outboxFactory?.create||!contract?.createOperation
   ||!host?.indexedDB)throw Error('primary_docs_outbox:dependencies_required');
 const outbox=outboxFactory.create({indexedDB:host.indexedDB,
  contract,dbName:DB_NAME});
 if(!outbox?.enqueue||!outbox?.ready||!outbox?.stats
   ||!outbox?.recordResult||!outbox?.get)
  throw Error('primary_docs_outbox:outbox_incomplete');
 let busy=false;
 const enabledKind=kind=>referenceAndQuotes===true
  ?kind==='reference'||kind==='quotes'||(allowGrowth===true&&kind==='growth')
  :referenceOnly!==true||kind==='reference';
 const strictReceipt=referenceOnly===true||referenceAndQuotes===true;
 const online=()=>host.navigator?.onLine!==false;
 const current=()=>controller.verifiedContext();
 function identity(){
  const x=current();
  if(!x||!UUID.test(x.familyId)||!x.actorUid)
   throw Error('primary_docs_outbox:identity_unverified');
  return {familyId:x.familyId,actorUid:x.actorUid};
 }
 async function pending(){
  try{
   const scope=identity(),counts=await outbox.stats(scope);
   if(!Number.isSafeInteger(counts.outstanding)||counts.outstanding<0)
    throw Error('counts');
   return ans('DOCUMENT_QUEUE_COUNTS_VERIFIED',{...counts});
  }catch(_){return ans('DOCUMENT_QUEUE_COUNTS_UNVERIFIED');}
 }
 async function queue({kind,nextBody,expectedRevision,requestId,
  operatorApproved=false,action='upsert'}={}){
  if(cloudWritesEnabled!==true||operatorApproved!==true)
   return ans('DOCUMENT_WRITES_NOT_AUTHORIZED');
  if(busy)return ans('DOCUMENT_QUEUE_BUSY');
  if(!online())return ans('DOCUMENT_OFFLINE_REQUIRES_VERIFIED_BASELINE');
  if(!enabledKind(kind)
    ||!DOC_TYPES[kind]||!UUID.test(String(requestId))
    ||!Number.isSafeInteger(expectedRevision)||expectedRevision<0
    ||!nextBody||typeof nextBody!=='object'||Array.isArray(nextBody))
   return ans('INVALID_DOCUMENT_OPERATION');
  busy=true;
  try{
   const scope=identity();
   const state=await documentsClient.read({...scope,kind,readEnabled:true});
   if(state.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
     ||state.revision!==expectedRevision||!UUID.test(state.childId))
    return ans('DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED');
   const op=contract.createOperation({
    id:requestId,type:kind==='quotes'&&action==='delete'?'quote.delete':
     kind==='growth'&&action==='delete'?'weight.delete':DOC_TYPES[kind],
    familyId:scope.familyId,actorUid:scope.actorUid,
    expectedRevision,createdAt:new Date().toISOString(),
    payload:{childId:state.childId,kind,nextBody}
   });
   const inserted=await outbox.enqueue(op);
   return ans('DOCUMENT_OPERATION_DURABLY_QUEUED',{
    requestId:op.id,duplicate:inserted?.duplicate===true,
    cloudWriteCommitted:false
   });
  }catch(_){return ans('DOCUMENT_LOCAL_QUEUE_UNVERIFIED_KEEP_REQUEST_ID',
   {requestId});}
  finally{busy=false;}
 }
 async function send({operatorApproved=false}={}){
  if(cloudWritesEnabled!==true||operatorApproved!==true)
   return ans('DOCUMENT_WRITES_NOT_AUTHORIZED');
  if(!online())return ans('DOCUMENT_OFFLINE_QUEUE_PRESERVED');
  if(busy)return ans('DOCUMENT_QUEUE_BUSY');
  busy=true;
  try{
   const scope=identity(),items=await outbox.ready(scope);
   if(items.some(op=>!enabledKind(op.payload?.kind)))
    return ans('DOCUMENT_KIND_NOT_AUTHORIZED');
   if(!items.length){
    const counts=await outbox.stats(scope);
    return ans(counts.outstanding>0?'DOCUMENT_CONFLICT_REVIEW_REQUIRED':
     'DOCUMENT_QUEUE_EMPTY');
   }
   for(const op of items){
    if(!DOC_TYPES[op.payload?.kind]||!UUID.test(op.payload?.childId))
     return ans('DOCUMENT_INVALID_PENDING_EVENT_BLOCKED',
      {requestId:op.id});
    const command={...scope,kind:op.payload.kind,
     nextBody:op.payload.nextBody,expectedRevision:op.expectedRevision,
     requestId:op.id,operatorApproved:true};
    // P3 shared-document retries inspect the original request receipt
    // before sending. No new request UUID on an ambiguous network ACK.
    if(strictReceipt){
     const prior=await documentsClient.checkRequest({
      ...scope,requestId:op.id,readEnabled:true
     });
     if(prior.status==='REQUEST_COMMITTED_VERIFIED'){
      if(prior.kind!==op.payload.kind
        ||prior.revision!==op.expectedRevision+1)
       return ans('DOCUMENT_RECEIPT_CONFLICT_KEEP_ID',{requestId:op.id});
      await outbox.recordResult(scope,op.id,{
       kind:'accepted',receiptId:op.id
      });
      continue;
     }
     if(prior.status!=='REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY')
      return ans('DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID',{requestId:op.id});
    }
    const result=await documentsClient.put(command);
    let acknowledged=result.status==='PRIMARY_DOCUMENT_COMMITTED';
    if(!acknowledged &&
      result.status==='PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID'){
     const check=await documentsClient.checkRequest({
      ...scope,requestId:op.id,readEnabled:true
     });
     acknowledged=check.status==='REQUEST_COMMITTED_VERIFIED'
       &&check.kind===op.payload.kind;
     if(!acknowledged)return ans('DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID',
      {requestId:op.id});
    }
    if(result.status==='PRIMARY_DOCUMENT_VERSION_CONFLICT'){
     await outbox.recordResult(scope,op.id,{kind:'conflict'});
     return ans('DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW',
      {requestId:op.id});
    }
    if(!acknowledged)return ans('DOCUMENT_ACK_NOT_VERIFIED',
     {requestId:op.id});
    if(strictReceipt){
     const verified=await documentsClient.checkRequest({
      ...scope,requestId:op.id,readEnabled:true
     });
     if(verified.status!=='REQUEST_COMMITTED_VERIFIED'
        ||verified.kind!==op.payload.kind
        ||verified.revision!==op.expectedRevision+1)
      return ans('DOCUMENT_RECEIPT_READBACK_REQUIRED_KEEP_ID',
       {requestId:op.id});
    }
    await outbox.recordResult(scope,op.id,{
     kind:'accepted',receiptId:op.id
    });
   }
   const remaining=await outbox.stats(scope);
   return ans(remaining.outstanding===0?'DOCUMENT_SYNC_CONFIRMED':
    'DOCUMENT_STILL_PENDING',{outstanding:remaining.outstanding});
  }catch(_){return ans('DOCUMENT_SYNC_UNKNOWN_QUEUE_PRESERVED');}
  finally{busy=false;}
 }
 async function checkSavedRequest(requestId){
  if(!UUID.test(String(requestId)))return ans('INVALID_REQUEST_ID');
  try{
   const scope=identity(),op=await outbox.get(scope,requestId);
   if(!op)return ans('ORIGINAL_REQUEST_ID_NOT_FOUND');
   if(!enabledKind(op.payload?.kind))
    return ans('DOCUMENT_KIND_NOT_AUTHORIZED');
   const status=await documentsClient.checkRequest({
    ...scope,requestId,readEnabled:true
   });
   if(status.status!=='REQUEST_COMMITTED_VERIFIED'
     ||status.kind!==op.payload?.kind
     ||(strictReceipt
       &&status.revision!==op.expectedRevision+1))
    return ans('REQUEST_NOT_VERIFIED_KEEP_PENDING');
   await outbox.recordResult(scope,requestId,{
    kind:'accepted',receiptId:requestId
   });
   return ans('REQUEST_ACK_RECOVERED',{requestId});
  }catch(_){return ans('REQUEST_ACK_RECOVERY_UNVERIFIED');}
 }
 return Object.freeze({queue,send,pending,checkSavedRequest,
  get cloudWritesEnabled(){return cloudWritesEnabled===true;}});
}
const api=Object.freeze({create,DB_NAME});
if(root)root.XBPrimaryDocumentsOperations=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
