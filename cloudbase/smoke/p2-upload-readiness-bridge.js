/* XiaoBao P2-3C browser-only read readiness bridge.
 * Calls only auth.getSession() and SELECT; never any write RPC or DML.
 * Deliberately never activates upload, even when A/B grant checks succeed.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function step(name,status,code){return Object.freeze({name,status,code});}
 function report(status,steps){return Object.freeze({status,steps:Object.freeze(steps)});}
 function create(app){
  if(!app||!app.auth||typeof app.auth.getSession!=='function'
     ||typeof app.rdb!=='function'
     ||!root||!root.XBCloudbaseAccessPreflight
     ||typeof root.XBCloudbaseAccessPreflight.create!=='function')
   throw Error('readiness:DEPENDENCY_MISSING');
  const verifier=root.XBCloudbaseAccessPreflight.create(app);
  const db=app.rdb();
  async function run(){
   let sessionResponse;
   try{sessionResponse=await app.auth.getSession();}
   catch(_){return report('INCONCLUSIVE',[step('session','INCONCLUSIVE','SDK_SESSION_ERROR')]);}
   if(!sessionResponse||sessionResponse.error)
    return report('INCONCLUSIVE',[step('session','INCONCLUSIVE','SDK_SESSION_ERROR')]);
   const data=sessionResponse.data,session=data?.session;
   if(!session)return report('BLOCKED',[step('session','BLOCKED','LOGIN_REQUIRED')]);
   const ids=[data?.user?.id,session.user?.id].filter(x=>x!=null);
   if(ids.length===0||ids.some(x=>typeof x!=='string'||x.length<1||x.length>128)
      ||new Set(ids).size!==1)
    return report('INCONCLUSIVE',[step('session','INCONCLUSIVE','IDENTITY_UNVERIFIED')]);
   const actorUid=ids[0];
   let families;
   try{const response=await db.from('families').select('id').limit(2);
    if(!response||response.error||!Array.isArray(response.data))
     throw Error('READ_FAILED');
    families=response.data;
   }catch(_){return report('INCONCLUSIVE',[
    step('session','PASS','SESSION_PRESENT'),
    step('family','INCONCLUSIVE','FAMILY_READ_ERROR')]);}
   if(families.length!==1||!UUID.test(String(families[0].id)))
    return report('BLOCKED',[
     step('session','PASS','SESSION_PRESENT'),
     step('family','BLOCKED','EXPECTED_EXACTLY_ONE_FAMILY')]);
   let verified;
   try{verified=await verifier.verifyAccess({
    familyId:families[0].id,actorUid
   });}
   catch(error){
    const known=String(error?.message||'');
    const code=/^access_preflight:[a-z_]+$/.test(known)?
     known.slice('access_preflight:'.length).toUpperCase():'PRECHECK_FAILED';
    return report('INCONCLUSIVE',[
     step('session','PASS','SESSION_PRESENT'),
     step('family','PASS','ONE_VISIBLE_FAMILY'),
     step('grant','INCONCLUSIVE',code)]);
   }
   if(verified.initialized!==false)
    return report('INCONCLUSIVE',[step('upload_gate','INCONCLUSIVE','UNEXPECTED_UPLOAD_STATE')]);
   return report('AUTH_PASS_UPLOAD_BLOCKED',[
    step('session','PASS','SESSION_PRESENT'),
    step('family','PASS','ONE_VISIBLE_FAMILY'),
    step('member','PASS','MEMBERSHIP_VERIFIED'),
    step('grant','PASS','XB_GRANT_VERIFIED'),
    step('upload_gate','BLOCKED','DURABLE_BASELINE_NOT_VERIFIED')
   ]);
  }
  return Object.freeze({run});
 }
 const api=Object.freeze({create});
 if(root)root.XBReadinessBridge=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
