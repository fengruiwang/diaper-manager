/* XiaoBao P2-4E: read-only, owner-gated migration receipt preview adapter.
 * Draft SQL 021 is NOT installed in real CloudBase. This adapter is not
 * loaded by production. No call at import/create; request is explicit only.
 * All outputs permanently forbid commit, upload and local state replacement.
 * The SOURCE DIGEST is only an advisory preview lookup. It is not server
 * proof that the actual backed-up legacy state passed migration validation.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const DIGEST=/^[0-9a-f]{64}$/;
 const STATUS=new Set([
  'PLAN_ONLY_EMPTY_TARGET','ALREADY_RECEIPTED_SAME_SOURCE',
  'CHILD_HAS_DIFFERENT_RECEIPT','SOURCE_RECEIPTED_FOR_OTHER_CHILD',
  'TARGET_ALREADY_HAS_BUSINESS_DATA'
 ]);
 function answer(status){return Object.freeze({
  status,canUpload:false,canCommit:false,canReplaceLocalState:false,
  receiptCommitted:false,requiresSeparateApproval:true
 });}
 function create(app){
  if(!app||!app.auth||typeof app.auth.getSession!=='function'
     ||typeof app.rdb!=='function')throw Error('migration_preview:sdk_required');
  const db=app.rdb();
  if(!db||typeof db.rpc!=='function')
   throw Error('migration_preview:rpc_required');
  async function inspect({familyId,childId,sourceSha256,readEnabled=false}={}){
   if(readEnabled!==true)return answer('DISABLED');
   if(typeof familyId!=='string'||!UUID.test(familyId)
      ||typeof childId!=='string'||!UUID.test(childId)
      ||typeof sourceSha256!=='string'||!DIGEST.test(sourceSha256))
    return answer('INVALID_PREVIEW_SCOPE');
   let response;
   try{response=await app.auth.getSession();}
   catch(_){return answer('SESSION_UNVERIFIED');}
   if(!response||response.error)return answer('SESSION_UNVERIFIED');
   const session=response.data?.session;
   if(!session)return answer('LOGIN_REQUIRED');
   const ids=[response.data?.user?.id,session.user?.id]
    .filter(x=>x!==null&&x!==undefined);
   if(!ids.length||ids.some(x=>typeof x!=='string'||!x||x.length>128)
      ||new Set(ids).size!==1)return answer('SESSION_IDENTITY_UNVERIFIED');
   let result;
   try{
    result=await db.rpc('xb_preview_legacy_migration_receipt',{
     p_family_id:familyId,p_child_id:childId,
     p_source_sha256:sourceSha256,p_source_format:'xiaobao-diapers:v1'
    });
   }catch(_){return answer('CLOUD_READ_UNVERIFIED');}
   if(!result||result.error){
    const code=String(result?.error?.code||result?.error?.errorCode||'');
    if(['42501','DATABASE_42501'].includes(code))
     return answer('OWNER_PERMISSION_DENIED');
    return answer('CLOUD_READ_UNVERIFIED');
   }
   const data=Array.isArray(result.data)?result.data[0]:result.data;
   if(!data||!STATUS.has(data.status)||data.can_upload!==false
      ||data.can_commit!==false||data.receipt_committed!==false
      ||data.requires_separate_approval!==true)
    return answer('UNEXPECTED_SERVER_PREVIEW');
   return answer(data.status);
  }
  return Object.freeze({inspect});
 }
 const api=Object.freeze({create});
 if(root)root.XBMigrationReceiptPreview=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
