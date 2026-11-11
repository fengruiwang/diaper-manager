/* XiaoBao v1.2.0 P2-3C access preflight: pure explicit-read adapter.
 * This is intentionally NOT a production upload authorization.
 * It checks session identity + fresh CloudBase RLS SELECT on family/member/grant.
 * Even if all checks succeed, initialized is ALWAYS false until an independently
 * verified, per-child server + durable IDB baseline handshake is implemented.
 * No SDK calls at import, no table mutations, no inventory/write RPC.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function fail(code){throw new Error('access_preflight:'+code);}
 function uid(value){
  return typeof value==='string'&&value.length>0&&value.length<=128?value:null;
 }
 function requireScope(scope){
  if(!scope||typeof scope!=='object'||typeof scope.familyId!=='string'
     ||!UUID.test(scope.familyId)||!uid(scope.actorUid))
   fail('invalid_scope');
  return {familyId:scope.familyId,actorUid:scope.actorUid};
 }
 function create(app){
  if(!app||!app.auth||typeof app.auth.getSession!=='function'
     ||typeof app.rdb!=='function')fail('sdk_required');
  const db=app.rdb();
  if(!db||typeof db.from!=='function')fail('rdb_select_required');
  async function select(table,fields,filters){
   try{
    let q=db.from(table).select(fields);
    for(const [key,value] of filters)q=q.eq(key,value);
    const result=await q.limit(2);
    if(!result||result.error||!Array.isArray(result.data))
     fail('cloud_select_unavailable');
    return result.data;
   }catch(error){
    if(error?.message==='access_preflight:cloud_select_unavailable')throw error;
    fail('cloud_select_unavailable');
   }
  }
  async function verifyAccess(scope){
   const {familyId,actorUid}=requireScope(scope);
   let response;
   try{response=await app.auth.getSession();}
   catch(_){fail('session_unavailable');}
   if(!response||response.error)fail('session_unavailable');
   if(!response.data||!response.data.session)fail('login_required');
   const session=response.data.session;
   // CloudBase Web v3 exposes data.user.id and/or data.session.user.id.
   // If both are present they must match. No assumption that a caller-supplied
   // UID or a cached alias is proof of a gateway-authenticated identity.
   const reported=[response.data.user?.id,session.user?.id]
    .filter(x=>x!==undefined&&x!==null);
   if(!reported.length||reported.some(x=>!uid(x))||
      new Set(reported).size!==1)fail('session_identity_unverified');
   if(reported[0]!==actorUid)fail('actor_session_mismatch');
   const families=await select('families','id',[['id',familyId]]);
   if(families.length!==1||families[0]?.id!==familyId)
    fail('family_not_visible');
   const members=await select('family_members','family_id,user_uid,member_role',
    [['family_id',familyId],['user_uid',actorUid]]);
   if(members.length!==1||members[0]?.family_id!==familyId
      ||members[0]?.user_uid!==actorUid
      ||!['owner','member'].includes(members[0]?.member_role))
    fail('membership_unverified');
   const grants=await select('family_app_access','family_id,user_uid,app_code',
    [['family_id',familyId],['user_uid',actorUid],['app_code','xb']]);
   if(grants.length!==1||grants[0]?.family_id!==familyId
      ||grants[0]?.user_uid!==actorUid||grants[0]?.app_code!=='xb')
    fail('xb_grant_unverified');
   // At this point only the RLS authorization is verified.
   // It is NOT safe to upload until an independently verified, durable
   // child inventory baseline has been created and reconciled.
   return Object.freeze({
    familyId,actorUid,appCode:'xb',member:true,
    initialized:false
   });
  }
  return Object.freeze({verifyAccess});
 }
 const api=Object.freeze({create});
 if(root)root.XBCloudbaseAccessPreflight=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
