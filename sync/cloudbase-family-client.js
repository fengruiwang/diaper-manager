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
  if(!app||typeof app.auth!=='function'||typeof app.rdb!=='function')fail('unsupported_cloudbase_app');
  const auth=app.auth();
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
   const data=unwrap(await auth.signInWithOtp({email:normalized,shouldCreateUser:true}));
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
  return Object.freeze({session,requestCode,confirmCode,logout,createFamily,createInvite,acceptInvite});
 }
 const api=Object.freeze({create});
 if(root)root.XBCloudbaseFamilyClient=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
