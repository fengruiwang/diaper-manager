/* XiaoBao v1.2.0 P3: on-launch CloudBase v3 session recovery.
 * The SDK owns secure session persistence/refresh tokens. Never copy tokens
 * to the diaper state, custom localStorage keys or the outbox.
 * No requests or timers on module import; no OTP issued automatically.
 */
(function(root){
 'use strict';
 const AUTH_LOSS=new Set(['invalid_refresh_token','refresh_token_expired',
  'user_not_found','invalid_grant','not_authenticated']);
 const TRANSIENT=new Set(['unreachable','network_error','network_unavailable',
  'timeout','service_unavailable','rate_limited','resource_exhausted']);
 function errorCode(error){
  const code=String(error?.code||error?.errorCode||'unknown').toLowerCase();
  return /^[a-z0-9_]{1,60}$/.test(code)?code:'unknown';
 }
 function create({auth,thresholdSeconds=300}={}){
  if(!auth||typeof auth.getSession!=='function')
   throw Error('session_recovery:cloudbase_auth_required');
  if(!Number.isInteger(thresholdSeconds)||thresholdSeconds<0||thresholdSeconds>3600)
   throw Error('session_recovery:invalid_threshold');
  let inFlight=null;
  function actorFrom(response){
   const d=response?.data;
   if(!d?.session)return null;
   const ids=[d.user?.id,d.session.user?.id].filter(x=>x!==undefined&&x!==null);
   if(!ids.length||ids.some(x=>typeof x!=='string'||!x||x.length>128)
      ||new Set(ids).size!==1)return null;
   return ids[0];
  }
  function authenticated(response,refresh,withActorUid){
   const result={status:'authenticated',refresh};
   if(withActorUid){
    const id=actorFrom(response);
    if(id)result.actorUid=id;
   }
   return result; // Never expose SDK token or raw session.
  }
  async function read(withActorUid=false){
   let response;
   try{response=await auth.getSession();}
   catch(_){return {status:'degraded',reason:'network-or-sdk-failure'};}
   if(response?.error){
    const code=errorCode(response.error);
    if(AUTH_LOSS.has(code))return {status:'auth-required',reason:'session_expired'};
    if(code==='token_expired'&&typeof auth.refreshSession==='function')
     return refresh('expired',withActorUid);
    return {status:'degraded',reason:TRANSIENT.has(code)?'network-unavailable':'session-check-failed'};
   }
   const current=response?.data?.session||null;
   if(!current)return {status:'auth-required',reason:'no_session'};
   // Refresh only when the SDK provides a trustworthy remaining lifetime;
   // otherwise let SDK-owned token lifecycle manage it.
   const seconds=current.expires_in;
   if(Number.isFinite(seconds)&&seconds>=0&&seconds<thresholdSeconds
      &&typeof auth.refreshSession==='function')
    return refresh('near-expiry',withActorUid);
   return authenticated(response,'not-needed',withActorUid);
  }
  async function refresh(why,withActorUid=false){
   let response;
   try{response=await auth.refreshSession();}
   catch(_){return {status:'degraded',reason:'refresh-unavailable'};}
   if(response?.error){
    const code=errorCode(response.error);
    return AUTH_LOSS.has(code)?
     {status:'auth-required',reason:'refresh_expired'}:
     {status:'degraded',reason:'refresh-unavailable'};
   }
   if(!response?.data?.session)
    return {status:'auth-required',reason:'session_missing_after_refresh'};
   return authenticated(response,why,withActorUid);
  }
  async function restore({online=true,withActorUid=false}={}){
   // Offline PWA access to an already-existing local snapshot remains possible,
   // but no server authorization or fresh family permission is asserted.
   if(!online)return {status:'degraded',reason:'offline'};
   if(inFlight)return inFlight;
   inFlight=read(withActorUid);
   try{return await inFlight;}
   finally{inFlight=null;}
  }
  return Object.freeze({restore});
 }
 const api=Object.freeze({create});
 if(root)root.XBSessionRecovery=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
