/* XiaoBao P3: explicit server-to-local inventory reconciliation coordinator.
 * No import side effects. This is separate from the upload runner; caller
 * must first ensure a real CloudBase session and family app permission.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function fail(code){throw new Error('inventory_sync_read:'+code);}
 function create({outbox,remote,verifyAccess}={}){
  if(!outbox||typeof outbox.reconciliationIds!=='function'
    ||typeof outbox.reconcileInventory!=='function')fail('outbox_required');
  if(!remote||typeof remote.readReconciliation!=='function')fail('remote_required');
  if(typeof verifyAccess!=='function')fail('verify_access_required');
  async function reconcile({familyId,childId,actorUid,readEnabled=false}={}){
   if(!UUID.test(String(familyId||''))||!UUID.test(String(childId||''))
     ||typeof actorUid!=='string'||!actorUid||actorUid.length>128)
    fail('scope_required');
   if(readEnabled!==true)return {status:'disabled',localUnchanged:true};
   const scope={familyId,actorUid};
   let grant;
   try{grant=await verifyAccess(scope);}
   catch(_){return {status:'offline-or-auth-unverified',localUnchanged:true};}
   if(!grant||grant.familyId!==familyId||grant.actorUid!==actorUid
     ||grant.appCode!=='xb'||grant.member!==true)
    return {status:'permission-unverified',localUnchanged:true};
   if(grant.initialized!==true)
    return {status:'family-not-initialized',localUnchanged:true};
   let ids;
   try{ids=await outbox.reconciliationIds(scope,childId);}
   catch(_){return {status:'local-review-required',localUnchanged:true};}
   let response;
   try{response=await remote.readReconciliation({familyId,childId,operationIds:ids});}
   catch(_){return {status:'cloud-read-failed',localUnchanged:true};}
   try{
    const committed=await outbox.reconcileInventory(scope,childId,response);
    return {
     status:committed.status,
     acknowledgedCount:committed.acknowledgedIds.length,
     pendingCount:committed.pendingCount,
     localUnchanged:false
    };
   }catch(_){
    // Local state may have changed between server request and IDB transaction,
    // or an unsafe stocktake/undo is awaiting manual resolution. NEVER retry
    // automatically with an old server response, and NEVER erase the queue.
    return {status:'reconcile-review-required',localUnchanged:true};
   }
  }
  return Object.freeze({reconcile});
 }
 const api=Object.freeze({create});
 if(root)root.XBInventorySyncReader=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
