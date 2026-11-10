/* XiaoBao v1.2.0 P1: CloudBase v3 family authentication adapter.
 * NO automatic login, writes, storage migration or network calls at module load.
 * SDK instance is injected; this file is not loaded by production index.html.
 * CloudBase Web v3: auth.signInWithOtp({email}) -> data.verifyOtp({token}),
 * auth.getSession() -> data.session, app.rdb().rpc(name,params).
 */
(function(root){
 'use strict';
 const uuidRx=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const emailRx=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 function fail(message){throw new Error('family_client: '+message)}
 function unwrap(response){
  if(!response||typeof response!=='object')fail('invalid_sdk_response');
  // No raw response, email or token included in thrown messages.
  if(response.error)fail('cloudbase_request_failed');
  return response.data;
 }
 function create(app){
  if(!app||!app.auth||typeof app.rdb!=='function')fail('unsupported_cloudbase_app');
  const auth=app.auth;
  const db=app.rdb();
  if(typeof auth.signInWithOtp!=='function'||typeof auth.getSession!=='function'||typeof db.rpc!=='function')
   fail('requires_cloudbase_v3');
  let verifier=null;
  let pendingEmail=null;
  async function session(){
   const data=unwrap(await auth.getSession());
   return data&&data.session?data.session:null;
  }
  async function requireLogin(){
   const current=await session();
   if(!current)fail('login_required');
   return current;
  }
  async function requestCode(email){
   const normalized=String(email||'').trim().toLowerCase();
   if(normalized.length>254||!emailRx.test(normalized))fail('invalid_email');
   // OTP is sent only by explicit user action, not on page render.
   const data=unwrap(await auth.signInWithOtp({email:normalized,options:{shouldCreateUser:true}}));
   if(!data||typeof data.verifyOtp!=='function')fail('invalid_verifier');
   verifier=data.verifyOtp;
   pendingEmail=normalized;
   return {sent:true};
  }
  async function confirmCode(code){
   if(!verifier||!pendingEmail)fail('verification_not_started');
   const value=String(code||'').trim();
   if(!/^\d{6}$/.test(value))fail('invalid_verification_code');
   const data=unwrap(await verifier({token:value}));
   verifier=null;
   pendingEmail=null;
   if(!data||!data.session)fail('session_not_issued');
   return {authenticated:true};
  }
  async function logout(){
   verifier=null;pendingEmail=null;
   unwrap(await auth.signOut());
   return {signedOut:true};
  }
  async function rpc(name,params){
   await requireLogin();
   const data=unwrap(await db.rpc(name,params));
   return data;
  }
  async function createFamily(name){
   const safe=String(name||'').trim();
   if(!safe||safe.length>80)fail('invalid_family_name');
   return rpc('xb_create_family',{p_name:safe});
  }
  async function createInvite(familyId){
   if(!uuidRx.test(String(familyId||'')))fail('invalid_family_id');
   return rpc('xb_create_invite',{p_family_id:familyId});
  }
  async function acceptInvite(token){
   if(!uuidRx.test(String(token||'')))fail('invalid_invite_token');
   return rpc('xb_accept_invite',{p_token:token});
  }
  async function listMembers(familyId){
   if(!uuidRx.test(String(familyId||'')))fail('invalid_family_id');
   await requireLogin();
   // Read-only query. Actual access is controlled by public.family_members RLS.
   if(typeof db.from!=='function')fail('database_select_unavailable');
   const response=await db.from('family_members')
    .select('user_uid,member_role,member_alias,alias_revision')
    .eq('family_id',familyId);
   const rows=unwrap(response);
   if(!Array.isArray(rows))fail('invalid_members_response');
   return rows.map(row=>({
    user_uid:row.user_uid,
    member_role:row.member_role,
    member_alias:row.member_alias??null,
    alias_revision:row.alias_revision
   }));
  }
  async function setMemberAlias({familyId,memberUid,alias,expectedRevision}){
   if(!uuidRx.test(String(familyId||'')))fail('invalid_family_id');
   if(typeof memberUid!=='string'||memberUid.length<1||memberUid.length>128)
    fail('invalid_member_id');
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
    fail('invalid_alias_revision');
   if(typeof alias!=='string')fail('invalid_alias');
   const cleaned=alias.trim();
   if(Array.from(cleaned).length>24||/[\u0000-\u001f\u007f]/u.test(cleaned))
    fail('invalid_alias');
   await requireLogin();
   const response=await db.rpc('xb_set_member_alias',{
    p_family_id:familyId,p_member_uid:memberUid,
    p_alias:cleaned,p_expected_revision:expectedRevision
   });
   if(response?.error){
    // Permit useful SQLSTATE/CloudBase error codes, never echo backend text.
    const code=String(response.error.code||'UNKNOWN');
    const safe=/^[A-Z0-9_]{1,50}$/.test(code)?code:'UNKNOWN';
    fail('alias_update_failed_'+safe);
   }
   const result=unwrap(response);
   const row=Array.isArray(result)?result[0]:result;
   if(!row||row.saved!==true||!Number.isInteger(row.alias_revision))
    fail('invalid_alias_ack');
   return {saved:true,changed:!!row.changed,
    member_alias:row.member_alias??null,alias_revision:row.alias_revision};
  }
  return Object.freeze({session,requestCode,confirmCode,logout,createFamily,createInvite,acceptInvite,listMembers,setMemberAlias});
 }
 const api=Object.freeze({create});
 if(root)root.XBCloudbaseFamilyClient=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
