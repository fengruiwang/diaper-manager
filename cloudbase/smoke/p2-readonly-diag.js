/* XiaoBao v1.2.0 P2-3A: intentional, read-only CloudBase smoke checks.
 * No network or storage activity until caller explicitly invokes runAnonymous/
 * runAuthenticated. No inventory write RPC or direct DML methods exist here.
 * This is an independent diagnostic module, never included in production PWA.
 */
(function(root){
 'use strict';
 const SAFE_CHILD='00000000-0000-4000-8000-000000000000';
 const SAFE_OTHER_FAMILY='00000000-0000-4000-8000-000000000001';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const READ_TABLES=Object.freeze([
  ['xb_children','id'],
  ['xb_inventory','family_id'],
  ['xb_inventory_operations','family_id'],
  ['xb_transactions','family_id']
 ]);
 function diagnosticError(error){
  const raw=String(error&&error.code||error&&error.errorCode||'UNKNOWN').slice(0,48);
  if(!/^[a-zA-Z0-9_-]{1,48}$/.test(raw))return 'UNKNOWN';
  return raw;
 }
 function denyReason(error,expected){
  const msg=String(error&&error.message||'').toLowerCase();
  if(msg.includes(expected.toLowerCase()))return 'EXPECTED_DENIAL';
  const code=diagnosticError(error);
  if(/^(?:DATABASE_)?42501$/.test(code)||/^(?:HTTP_)?(?:401|403)$/.test(code))
   return 'DENIED_UNCLASSIFIED';
  return 'ERROR_'+code;
 }
 function makeStep(name,status,detail){
  return Object.freeze({name,status,detail});
 }
 function summary(steps){
  const names=steps.map(x=>x.status);
  return Object.freeze({
   status:names.includes('FAIL')?'FAIL':
          names.includes('INCONCLUSIVE')?'INCONCLUSIVE':
          names.includes('BLOCKED')?'BLOCKED':'PASS',
   steps:Object.freeze(steps)
  });
 }
 function create(app){
  if(!app||!app.auth||typeof app.auth.getSession!=='function'||
     typeof app.rdb!=='function')throw new Error('DIAG_SDK_REQUIRED');
  const db=app.rdb();
  if(!db||typeof db.from!=='function'||typeof db.rpc!=='function')
   throw new Error('DIAG_DATABASE_REQUIRED');
  async function hasSession(){
   const response=await app.auth.getSession();
   if(response&&response.error)throw new Error('DIAG_SESSION_UNAVAILABLE');
   return !!(response&&response.data&&response.data.session);
  }
  async function runRead(table,select,modify){
   let query=db.from(table).select(select);
   if(modify)query=modify(query);
   const response=await query.limit(3);
   if(response&&response.error)return {error:response.error};
   if(!Array.isArray(response&&response.data))
    return {error:{code:'INVALID_READ_RESPONSE'}};
   return {data:response.data};
  }
  async function rpcProbe(familyId,childId){
   try{
    const response=await db.rpc('xb_read_inventory_reconciliation',{
     p_family_id:familyId,p_child_id:childId,p_operation_ids:[]
    });
    if(response&&response.error)return {error:response.error};
    return {data:response&&response.data};
   }catch(error){return {error};}
  }
  function expectDenial(name,result,expected){
   if(!result.error)return makeStep(name,'FAIL','RPC_ACCEPTED_UNEXPECTEDLY');
   const reason=denyReason(result.error,expected);
   return reason==='EXPECTED_DENIAL'?
    makeStep(name,'PASS',reason):
    makeStep(name,'INCONCLUSIVE',reason);
  }
  function readEmpty(name,result){
   if(result.error){
    const code=diagnosticError(result.error);
    return /^(?:DATABASE_)?42501$/.test(code)||
       /^(?:HTTP_)?(?:401|403)$/.test(code)?
      makeStep(name,'PASS','DENIED_NO_ROWS'):
      makeStep(name,'INCONCLUSIVE','READ_'+code);
   }
   return result.data.length===0?
    makeStep(name,'PASS','ZERO_VISIBLE_ROWS'):
    makeStep(name,'FAIL','UNEXPECTED_VISIBLE_ROWS');
  }
  async function runAnonymous(){
   const steps=[];
   let active;
   try{active=await hasSession();}
   catch(_){return summary([makeStep('anonymous_session','BLOCKED','SESSION_UNKNOWN')]);}
   if(active)return summary([makeStep('anonymous_session','BLOCKED','LOGIN_SESSION_PRESENT_USE_PRIVATE_WINDOW')]);
   steps.push(makeStep('anonymous_session','PASS','NO_SESSION'));
   steps.push(readEmpty('anonymous_families',await runRead('families','id')));
   for(const [table,column] of READ_TABLES)
    steps.push(readEmpty('anonymous_'+table,await runRead(table,column)));
   steps.push(expectDenial('anonymous_reconciliation_rpc',
    await rpcProbe(null,SAFE_CHILD),'authentication_required'));
   return summary(steps);
  }
  async function runAuthenticated(){
   const steps=[];
   let active;
   try{active=await hasSession();}
   catch(_){return summary([makeStep('authenticated_session','BLOCKED','SESSION_UNKNOWN')]);}
   if(!active)return summary([makeStep('authenticated_session','BLOCKED','LOGIN_REQUIRED')]);
   steps.push(makeStep('authenticated_session','PASS','SESSION_PRESENT'));
   const family=await runRead('families','id');
   if(family.error)return summary([...steps,makeStep('member_family','INCONCLUSIVE',
    'FAMILY_'+diagnosticError(family.error))]);
   if(family.data.length!==1||!UUID.test(String(family.data[0].id)))
    return summary([...steps,makeStep('member_family','FAIL','EXPECTED_ONE_FAMILY')]);
   const familyId=family.data[0].id; // never returned or logged
   steps.push(makeStep('member_family','PASS','ONE_FAMILY_VISIBLE'));
   const members=await runRead('family_members','member_role',q=>q.eq('family_id',familyId));
   if(members.error)steps.push(makeStep('member_rows','INCONCLUSIVE','MEMBER_'+diagnosticError(members.error)));
   else steps.push(makeStep('member_rows',members.data.length===2?'PASS':'FAIL',
    members.data.length===2?'TWO_MEMBERS_VISIBLE':'EXPECTED_TWO_MEMBERS'));
   const grants=await runRead('family_app_access','app_code',
    q=>q.eq('family_id',familyId).eq('app_code','xb'));
   if(grants.error)steps.push(makeStep('xb_grants','INCONCLUSIVE','GRANT_'+diagnosticError(grants.error)));
   else steps.push(makeStep('xb_grants',grants.data.length===2?'PASS':'FAIL',
    grants.data.length===2?'TWO_XB_GRANTS_VISIBLE':'EXPECTED_TWO_XB_GRANTS'));
   for(const [table,column] of READ_TABLES)
    steps.push(readEmpty('authenticated_'+table,await runRead(table,column,
     q=>q.eq('family_id',familyId))));
   // Reconciliation RPC is SECURITY DEFINER but STABLE / read-only.
   // Probe only with a guaranteed-nonexistent synthetic child. An accepted
   // result would be a security/schema regression, never a test purchase.
   steps.push(expectDenial('nonexistent_child_rejected',
    await rpcProbe(familyId,SAFE_CHILD),'child_unavailable'));
   steps.push(expectDenial('other_family_rejected',
    await rpcProbe(SAFE_OTHER_FAMILY,SAFE_CHILD),'permission_denied'));
   return summary(steps);
  }
  return Object.freeze({runAnonymous,runAuthenticated});
 }
 const api=Object.freeze({create});
 if(root)root.XBReadonlyCloudDiag=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
