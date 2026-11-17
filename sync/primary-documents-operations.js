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
 fastReferenceEnabled=false,fastQuotesEnabled=false,
 fastGrowthEnabled=false,fastProfileEnabled=false,
 allowGrowth=false,allowProfile=false,allowSettings=false}={}){
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
 // Volatile proof of a fresh IDB enqueue, never persisted or reused after reload.
 const freshDocumentIds=new Map(); // scoped, volatile first-send proof
 const fastKind=kind=>({
  reference:fastReferenceEnabled,quotes:fastQuotesEnabled,
  growth:fastGrowthEnabled,profile:fastProfileEnabled
 })[kind]===true;
 const enabledKind=kind=>referenceAndQuotes===true
  ?kind==='reference'||kind==='quotes'||(allowGrowth===true&&kind==='growth')
    ||(allowProfile===true&&kind==='profile')
    ||(allowSettings===true&&kind==='settings')
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
  operatorApproved=false,action='upsert',verifiedBaseline=null}={}){
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
   let state;
   if(fastKind(kind)&&verifiedBaseline!==null){
    const body=verifiedBaseline.body;
    const bodyValid=kind==='reference'
     ?body&&body.referenceOverrides&&typeof body.referenceOverrides==='object'
       &&!Array.isArray(body.referenceOverrides)
     :kind==='profile'
      ?body&&body.babyProfile&&typeof body.babyProfile==='object'
       &&!Array.isArray(body.babyProfile)
      :body&&Array.isArray(body.items);
    if(verifiedBaseline.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
      ||verifiedBaseline.kind!==kind||verifiedBaseline.familyId!==scope.familyId
      ||verifiedBaseline.actorUid!==scope.actorUid
      ||!UUID.test(String(verifiedBaseline.childId))
      ||verifiedBaseline.revision!==expectedRevision
      ||!body||typeof body!=='object'||Array.isArray(body)||!bodyValid)
     return ans('DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED');
    state=verifiedBaseline;
   }else state=await documentsClient.read({...scope,kind,readEnabled:true});
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
   // An old queued operation or a reused UUID is never a "first send".
   const previous=fastKind(kind)&&verifiedBaseline!==null
    ?await outbox.get(scope,requestId):null;
   const inserted=await outbox.enqueue(op);
   if(fastKind(kind)&&verifiedBaseline!==null&&!previous
      &&inserted?.duplicate!==true)
    freshDocumentIds.set(op.id,Object.freeze({
     scope:scope.familyId+'\\x00'+scope.actorUid,kind
    }));
   return ans('DOCUMENT_OPERATION_DURABLY_QUEUED',{
    requestId:op.id,duplicate:Boolean(previous)||inserted?.duplicate===true,
    cloudWriteCommitted:false
   });
  }catch(_){return ans('DOCUMENT_LOCAL_QUEUE_UNVERIFIED_KEEP_REQUEST_ID',
   {requestId});}
  finally{busy=false;}
 }
 async function send({operatorApproved=false,fastReferenceId=null,
  fastDocumentId=null,fastDocumentKind='quotes'}={}){
  if(cloudWritesEnabled!==true||operatorApproved!==true)
   return ans('DOCUMENT_WRITES_NOT_AUTHORIZED');
  if(!online())return ans('DOCUMENT_OFFLINE_QUEUE_PRESERVED');
  if(busy)return ans('DOCUMENT_QUEUE_BUSY');
  busy=true;
  try{
   const scope=identity(),items=await outbox.ready(scope);
   const fastId=fastReferenceId??fastDocumentId;
   const wantedKind=fastReferenceId!==null?'reference':fastDocumentKind;
   const fastAllowed=fastKind(wantedKind);
   const candidate=freshDocumentIds.get(fastId);
   const fastDocument=fastAllowed&&typeof fastId==='string'
    &&candidate?.scope===scope.familyId+'\\x00'+scope.actorUid
    &&candidate.kind===wantedKind
    &&items.length===1&&items[0].id===fastId
    &&items[0].payload?.kind===wantedKind;
   if(fastAllowed&&fastId!==null&&!fastDocument)
    return ans('DOCUMENT_PENDING_REVIEW_REQUIRED',{requestId:fastId});
   // A later send or session keeps the existing original-UUID receipt recovery.
   if(fastDocument)freshDocumentIds.delete(fastId);
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
     requestId:op.id,operatorApproved:true,
     fastDocument:fastDocument&&op.id===fastId};
    // First writes with a complete displayed baseline need only one 026 PUT.
    // Ambiguous and later-session retries retain the original receipt path.
    if(strictReceipt&&!fastDocument){
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
    let recoveredFromReceipt=false;
    if(!acknowledged &&
      result.status==='PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID'){
     const check=await documentsClient.checkRequest({
      ...scope,requestId:op.id,readEnabled:true
     });
     acknowledged=check.status==='REQUEST_COMMITTED_VERIFIED'
       &&check.kind===op.payload.kind
       &&(!fastDocument||check.revision===op.expectedRevision+1);
     if(acknowledged)recoveredFromReceipt=true;
     if(!acknowledged)return ans('DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID',
      {requestId:op.id});
    }
    const code=String(op.payload.kind).toUpperCase();
    if(fastDocument&&result.status==='PRIMARY_DOCUMENT_'+code+'_PERMISSION_DENIED')
     return ans('DOCUMENT_'+code+'_PERMISSION_DENIED_KEEP_ID',{requestId:op.id});
    if(result.status==='PRIMARY_DOCUMENT_VERSION_CONFLICT'){
     await outbox.recordResult(scope,op.id,{kind:'conflict'});
     return ans('DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW',
      {requestId:op.id});
    }
    if(!acknowledged)return ans('DOCUMENT_ACK_NOT_VERIFIED',
     {requestId:op.id});
    if(strictReceipt&&!fastDocument){
     const verified=await documentsClient.checkRequest({
      ...scope,requestId:op.id,readEnabled:true
     });
     if(verified.status!=='REQUEST_COMMITTED_VERIFIED'
        ||verified.kind!==op.payload.kind
        ||verified.revision!==op.expectedRevision+1)
      return ans('DOCUMENT_RECEIPT_READBACK_REQUIRED_KEEP_ID',
       {requestId:op.id});
    }
    if(fastDocument){
     // Apply a body only when the direct ACK echoes the exact CAS scope.
     const exact=result.status==='PRIMARY_DOCUMENT_COMMITTED'
      &&result.kind===op.payload.kind&&result.requestId===op.id
      &&result.familyId===scope.familyId
      &&result.childId===op.payload.childId
      &&result.revision===op.expectedRevision+1;
     if(!exact&&!recoveredFromReceipt)
      return ans('DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID',{requestId:op.id});
     try{await outbox.recordResult(scope,op.id,{
      kind:'accepted',receiptId:op.id
     });}catch(_){
      return ans('DOCUMENT_'+code+'_ACK_LOCAL_PENDING',{requestId:op.id});
     }
     if(!exact||result.duplicate===true||recoveredFromReceipt)
      return ans('DOCUMENT_'+code+'_ACK_RECOVERED_NEEDS_REFRESH',{
       requestId:op.id,receiptVerified:recoveredFromReceipt
      });
     return ans('DOCUMENT_'+code+'_ACK_CONFIRMED',{
      requestId:op.id,kind:op.payload.kind,familyId:scope.familyId,
      actorUid:scope.actorUid,childId:op.payload.childId,
      revision:result.revision,expectedRevision:op.expectedRevision,
      nextBody:op.payload.nextBody
     });
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
 // Read-only discovery; scoped by the same actor/family as the original IDB
 // entries. A conflict is never an ACK, and it is never automatically resent.
 async function conflicts(){
  if(cloudWritesEnabled!==true)return ans('DOCUMENT_WRITES_NOT_AUTHORIZED');
  try{
   if(typeof outbox.list!=='function')return ans('DOCUMENT_CONFLICT_LIST_UNAVAILABLE');
   const rows=await outbox.list(identity(),{includeAcked:true});
   const items=rows.filter(op=>op.status==='conflict'
     &&op.error==='conflict'&&enabledKind(op.payload?.kind))
    .map(op=>({requestId:op.id,kind:op.payload.kind,
     expectedRevision:op.expectedRevision}));
   return ans('DOCUMENT_CONFLICTS_VERIFIED',{items});
  }catch(_){return ans('DOCUMENT_CONFLICT_LIST_UNVERIFIED');}
 }
 // Only an explicit user-confirmed, DEFINITELY NOT committed CAS conflict
 // can become a non-outstanding terminal record. Never release an uncertain
 // ACK, timeout, forbidden, or any successful PUT via this path.
 async function abandonConflict({requestId,operatorApproved=false,
  userConfirmed=false}={}){
  if(cloudWritesEnabled!==true||operatorApproved!==true)
   return ans('DOCUMENT_WRITES_NOT_AUTHORIZED');
  if(userConfirmed!==true)return ans('DOCUMENT_CONFLICT_USER_CONFIRMATION_REQUIRED');
  if(!online())return ans('DOCUMENT_CONFLICT_OFFLINE_KEEP_ID');
  if(busy)return ans('DOCUMENT_QUEUE_BUSY');
  if(!UUID.test(String(requestId)))return ans('INVALID_REQUEST_ID');
  busy=true;
  try{
   if(typeof outbox.abandonDocumentConflict!=='function')
    return ans('DOCUMENT_CONFLICT_ABANDON_UNSUPPORTED');
   const scope=identity(),op=await outbox.get(scope,requestId);
   if(!op||op.status!=='conflict'||op.error!=='conflict'
     ||op.receipt!==null||!enabledKind(op.payload?.kind)
     ||!DOC_TYPES[op.payload?.kind]
     ||!Number.isSafeInteger(op.expectedRevision)
     ||!UUID.test(op.payload?.childId))
    return ans('DOCUMENT_NOT_DEFINITE_CONFLICT_KEEP_ID');
   const check=()=>documentsClient.checkRequest({
    ...scope,requestId,readEnabled:true
   });
   // Re-check the original receipt both before and after the remote read.
   // Unknown, permission errors, and confirmed receipts all remain blocked.
   const before=await check();
   if(before?.status!=='REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY')
    return ans('DOCUMENT_CONFLICT_RECEIPT_UNVERIFIED_KEEP_ID');
   const currentDoc=await documentsClient.read({
    ...scope,kind:op.payload.kind,readEnabled:true
   });
   if(currentDoc?.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
     ||currentDoc.kind!==op.payload.kind
     ||currentDoc.familyId!==scope.familyId
     ||currentDoc.childId!==op.payload.childId
     ||!Number.isSafeInteger(currentDoc.revision)
     ||currentDoc.revision<=op.expectedRevision)
    return ans('DOCUMENT_CONFLICT_LATEST_REVISION_UNVERIFIED_KEEP_ID');
   const after=await check();
   if(after?.status!=='REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY')
    return ans('DOCUMENT_CONFLICT_RECEIPT_UNVERIFIED_KEEP_ID');
   const discarded=await outbox.abandonDocumentConflict(scope,requestId);
   if(discarded?.status!=='abandoned'||discarded.id!==requestId)
    return ans('DOCUMENT_CONFLICT_ABANDON_UNVERIFIED_KEEP_ID');
   return ans('DOCUMENT_CONFLICT_ABANDONED',{
    requestId,kind:op.payload.kind,latestRevision:currentDoc.revision
   });
  }catch(_){return ans('DOCUMENT_CONFLICT_RESOLUTION_UNVERIFIED_KEEP_ID');}
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
 return Object.freeze({queue,send,pending,checkSavedRequest,conflicts,abandonConflict,
  get cloudWritesEnabled(){return cloudWritesEnabled===true;}});
}
const api=Object.freeze({create,DB_NAME});
if(root)root.XBPrimaryDocumentsOperations=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
