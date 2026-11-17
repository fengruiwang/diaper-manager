/* M3 CloudBase primary document client: quotes/reference/growth/profile/settings.
 * Reuses SDK sessions and family preflight, SQL 026 CAS + request receipts.
 * No import-time network, no token storage, no independent local writes.
 * SQL 026 is currently an UNDEPLOYED DRAFT. Write default: OFF.
 */
(function(root){
 'use strict';
 const KINDS=Object.freeze(['quotes','reference','growth','profile','settings']);
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 function result(status,extra={}){return Object.freeze({status,...extra});}
 function create({app,accessPreflight,childReader,scopeGuard,
  cloudWritesEnabled=false}={}){
  if(!app?.auth?.getSession||!app?.rdb||!accessPreflight?.create
    ||!childReader?.create||!scopeGuard?.requireLegacyMigrationTarget)
   throw Error('primary_docs:dependencies_required');
  let busy=false;
  const db=app.rdb();
  if(typeof db.rpc!=='function')throw Error('primary_docs:rpc_required');
  const reader=childReader.create(app,scopeGuard);
  // Volatile read-only scope: the formal controller has already verified a
  // live session, family/primary and migration receipt via the primary model.
  // Server-side document RPC authorization remains mandatory for every read.
  let verifiedReadScope=null;
  function acceptVerifiedPrimary(primary){
   const valid=primary?.status==='PRIMARY_READ_ONLY_READY'
    &&primary.source==='cloudbase-primary-receipt-verified'
    &&primary.canWrite===false
    &&UUID.test(String(primary.familyId))
    &&UUID.test(String(primary.childId))
    &&typeof primary.actorUid==='string'
    &&primary.actorUid.length>0&&primary.actorUid.length<=128;
   verifiedReadScope=valid?Object.freeze({
    familyId:primary.familyId,actorUid:primary.actorUid,childId:primary.childId
   }):null;
   return valid;
  }
  function invalidateReadScope(){verifiedReadScope=null;}
  async function scope(input,{reuseReadScope=false}={}){
   if(!input||!UUID.test(String(input.familyId))
     ||typeof input.actorUid!=='string'||!input.actorUid)
    throw Error('primary_docs:invalid_scope');
   const {familyId,actorUid}=input;
   if(reuseReadScope){
    if(verifiedReadScope?.familyId===familyId
      &&verifiedReadScope.actorUid===actorUid)return verifiedReadScope;
    // No access across account or family switch, even within one client.
    invalidateReadScope();
   }
   const access=await accessPreflight.create(app).verifyAccess({
    familyId,actorUid
   });
   if(access.member!==true||access.familyId!==familyId
     ||access.actorUid!==actorUid||access.appCode!=='xb')
    throw Error('primary_docs:grant_unverified');
   const primary=await reader.inspectLegacyTarget({familyId});
   if(!primary||primary.familyId!==familyId
     ||!UUID.test(String(primary.childId))
     ||primary.readyForMigration!==false)
    throw Error('primary_docs:primary_unverified');
   const who=Object.freeze({familyId,actorUid,childId:primary.childId});
   if(reuseReadScope)verifiedReadScope=who;
   return who;
  }
  async function rpc(name,args){
   const response=await db.rpc(name,args);
   if(response?.error){
    // A failed read must never keep a privileged scope for a later retry.
    if(name==='xb_read_primary_document_draft')invalidateReadScope();
    const code=String(response.error.code||response.error.errorCode||'');
    if(code==='40001')throw Error('primary_docs:revision_conflict');
    if(code==='23505')throw Error('primary_docs:duplicate_request_conflict');
    throw Error('primary_docs:rpc_unverified');
   }
   if(!response)throw Error('primary_docs:rpc_unverified');
   const value=Array.isArray(response.data)?
    (response.data.length===1?response.data[0]:null):response.data;
   if(!object(value))throw Error('primary_docs:invalid_reply');
   return value;
  }
  async function readOne(kind,who){
   try{
    const d=await rpc('xb_read_primary_document_draft',{
     p_family_id:who.familyId,p_child_id:who.childId,p_kind:kind
    });
    if(d.complete!==true||d.family_id!==who.familyId
      ||d.child_id!==who.childId||d.kind!==kind
      ||!Number.isSafeInteger(d.revision)||d.revision<0
      ||!object(d.body)||d.can_upload!==false){
     invalidateReadScope();
     return result('PRIMARY_DOCUMENT_READ_UNVERIFIED');
    }
    return result('PRIMARY_DOCUMENT_READ_VERIFIED',{
     kind,familyId:who.familyId,childId:who.childId,
     revision:d.revision,body:d.body,canWrite:false
    });
   }catch(_){
    invalidateReadScope();
    return result('PRIMARY_DOCUMENT_READ_UNVERIFIED');
   }
  }
  async function read(input={}){
   if(!KINDS.includes(input.kind))return result('INVALID_DOCUMENT_KIND');
   if(input.readEnabled!==true)return result('DOCUMENT_READ_DISABLED');
   try{
    const who=await scope(input,{reuseReadScope:true});
    return await readOne(input.kind,who);
   }catch(_){
    invalidateReadScope();
    return result('PRIMARY_DOCUMENT_READ_UNVERIFIED');
   }
  }
  async function readAll(input={}){
   let who;
   try{who=await scope(input,{reuseReadScope:true});}
   catch(_){
    invalidateReadScope();
    return result('PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE');
   }
   // All five kinds start together, one authenticated RPC per document.
   // The server validates each scope; no second full-body revision pass.
   const docs=await Promise.all(KINDS.map(kind=>readOne(kind,who)));
   if(docs.some((doc,i)=>doc.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
      ||doc.kind!==KINDS[i]||doc.familyId!==who.familyId
      ||doc.childId!==who.childId)){
    invalidateReadScope();
    return result('PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE');
   }
   return result('PRIMARY_DOCUMENTS_FULLY_READ',{
    documents:Object.freeze(Object.fromEntries(
     KINDS.map((kind,i)=>[kind,docs[i]]))),canWrite:false
   });
  }
  async function put(input={}){
   // No RPC/IDB calls or request ID generation unless the build AND user
   // workflow were independently authorized; the active preview always OFF.
   if(cloudWritesEnabled!==true||input.operatorApproved!==true)
    return result('PRIMARY_DOCUMENT_WRITES_NOT_AUTHORIZED');
   if(busy)return result('PRIMARY_DOCUMENT_WRITE_BUSY');
   if(!KINDS.includes(input.kind)||!UUID.test(String(input.requestId))
     ||!Number.isSafeInteger(input.expectedRevision)
     ||input.expectedRevision<0||!object(input.nextBody))
    return result('INVALID_DOCUMENT_COMMAND');
   busy=true;
   try{
    // The current, B1-verified reference scope avoids repeated client SELECT.
    // SQL 026 still enforces authenticated family access and CAS.
    const fast=input.kind==='reference'&&input.fastReference===true
     &&verifiedReadScope?.familyId===input.familyId
     &&verifiedReadScope?.actorUid===input.actorUid;
    const who=fast?verifiedReadScope:await scope(input);
    const d=await rpc('xb_put_primary_document_draft',{
     p_family_id:who.familyId,p_child_id:who.childId,
     p_kind:input.kind,p_expected_revision:input.expectedRevision,
     p_request_id:input.requestId,p_next_body:input.nextBody
    });
    if(d.saved!==true||d.kind!==input.kind
      ||d.family_id!==who.familyId||d.child_id!==who.childId
      ||d.request_id!==input.requestId
      ||!Number.isSafeInteger(d.revision)
      ||d.revision<input.expectedRevision+1)
     return result('PRIMARY_DOCUMENT_ACK_UNVERIFIED_KEEP_REQUEST_ID',
      {requestId:input.requestId});
    return result('PRIMARY_DOCUMENT_COMMITTED',{
     kind:input.kind,revision:d.revision,
     duplicate:d.duplicate===true,requestId:input.requestId,
     familyId:who.familyId,childId:who.childId
    });
   }catch(error){
    // A real 40001 conflict never gets promoted to "maybe committed".
    if(error?.message==='primary_docs:revision_conflict')
     return result('PRIMARY_DOCUMENT_VERSION_CONFLICT',{requestId:input.requestId});
    if(error?.message==='primary_docs:duplicate_request_conflict')
     return result('PRIMARY_DOCUMENT_REQUEST_ID_CONFLICT',{requestId:input.requestId});
    // No auto re-submit with a new UUID. The next action is receipt check.
    return result('PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID',
     {requestId:input.requestId});
   }finally{busy=false;}
  }
  async function checkRequest(input={}){
   if(input.readEnabled!==true||!UUID.test(String(input.requestId)))
    return result('REQUEST_CHECK_DISABLED_OR_INVALID');
   try{
    const who=await scope(input);
    const d=await rpc('xb_check_primary_document_request_draft',{
     p_family_id:who.familyId,p_child_id:who.childId,
     p_request_id:input.requestId
    });
    if(d.family_id!==who.familyId||d.child_id!==who.childId
      ||d.request_id!==input.requestId)
     return result('REQUEST_RECEIPT_UNVERIFIED');
    if(d.status==='NO_RECEIPT')
     return result('REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY');
    if(d.status!=='COMMITTED'||!KINDS.includes(d.kind)
      ||!Number.isSafeInteger(d.resulting_revision)
      ||d.resulting_revision<1)
     return result('REQUEST_RECEIPT_UNVERIFIED');
    return result('REQUEST_COMMITTED_VERIFIED',{
     requestId:input.requestId,kind:d.kind,revision:d.resulting_revision
    });
   }catch(_){return result('REQUEST_RECEIPT_UNVERIFIED');}
  }
  return Object.freeze({read,readAll,put,checkRequest,
   acceptVerifiedPrimary,invalidateReadScope,
   get cloudWritesEnabled(){return cloudWritesEnabled===true;}});
 }
 const api=Object.freeze({create,KINDS});
 if(root)root.XBPrimaryDocumentsClient=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
