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
  async function scope(input){
   if(!input||!UUID.test(String(input.familyId))
     ||typeof input.actorUid!=='string'||!input.actorUid)
    throw Error('primary_docs:invalid_scope');
   const {familyId,actorUid}=input;
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
   return {familyId,actorUid,childId:primary.childId};
  }
  async function rpc(name,args){
   const response=await db.rpc(name,args);
   if(response?.error||!response)
    throw Error('primary_docs:rpc_unverified');
   const value=Array.isArray(response.data)?
    (response.data.length===1?response.data[0]:null):response.data;
   if(!object(value))throw Error('primary_docs:invalid_reply');
   return value;
  }
  async function read(input={}){
   if(!KINDS.includes(input.kind))return result('INVALID_DOCUMENT_KIND');
   if(input.readEnabled!==true)return result('DOCUMENT_READ_DISABLED');
   try{
    const who=await scope(input);
    const d=await rpc('xb_read_primary_document_draft',{
     p_family_id:who.familyId,p_child_id:who.childId,p_kind:input.kind
    });
    if(d.complete!==true||d.family_id!==who.familyId
      ||d.child_id!==who.childId||d.kind!==input.kind
      ||!Number.isSafeInteger(d.revision)||d.revision<0
      ||!object(d.body)||d.can_upload!==false)
     return result('PRIMARY_DOCUMENT_READ_UNVERIFIED');
    return result('PRIMARY_DOCUMENT_READ_VERIFIED',{
     kind:input.kind,familyId:who.familyId,childId:who.childId,
     revision:d.revision,body:d.body,canWrite:false
    });
   }catch(_){return result('PRIMARY_DOCUMENT_READ_UNVERIFIED');}
  }
  async function readAll(input={}){
   const values={};
   for(const kind of KINDS){
    const doc=await read({...input,kind,readEnabled:true});
    if(doc.status!=='PRIMARY_DOCUMENT_READ_VERIFIED')
     return result('PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE');
    values[kind]=doc;
   }
   // Reject a mixed A/B snapshot if a document changed between page reads.
   for(const kind of KINDS){
    const check=await read({...input,kind,readEnabled:true});
    if(check.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
      ||check.revision!==values[kind].revision)
     return result('PRIMARY_DOCUMENT_SNAPSHOT_CHANGED');
   }
   return result('PRIMARY_DOCUMENTS_FULLY_READ',{
    documents:Object.freeze(values),canWrite:false
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
    const who=await scope(input);
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
     duplicate:d.duplicate===true,requestId:input.requestId
    });
   }catch(_){
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
   get cloudWritesEnabled(){return cloudWritesEnabled===true;}});
 }
 const api=Object.freeze({create,KINDS});
 if(root)root.XBPrimaryDocumentsClient=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
