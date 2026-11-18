/* XiaoBao P3: explicit server-to-local inventory reconciliation coordinator.
 * No import side effects. This is separate from the upload runner; caller
 * must first ensure a real CloudBase session and family app permission.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const BATCH_SIZE=50;
 const SIZES=['NB','S','M','L','XL','XXL'];
 function fail(code){throw new Error('inventory_sync_read:'+code);}
 // Every read is a full six-size snapshot for this same actor/family/child.
 // Never combine receipts from two different inventory revisions.
 function verifyBatch(response,requested,{familyId,childId,actorUid}){
  if(!response||response.complete!==true||response.familyId!==familyId
    ||response.childId!==childId||response.actorUid!==actorUid
    ||!Array.isArray(response.checkedOperationIds)
    ||response.checkedOperationIds.length!==requested.length
    ||!Array.isArray(response.seenOperationIds)
    ||!Array.isArray(response.rows)||response.rows.length!==SIZES.length)
   fail('batch_evidence_incomplete');
  const requestedIds=new Set(requested),checked=new Set();
  for(const id of response.checkedOperationIds){
   if(!requestedIds.has(id)||checked.has(id))fail('batch_checked_ids_mismatch');
   checked.add(id);
  }
  const seen=new Set();
  for(const id of response.seenOperationIds){
   if(!checked.has(id)||seen.has(id))fail('batch_seen_ids_mismatch');
   seen.add(id);
  }
  const rows=new Map();
  for(const row of response.rows){
   if(!row||!SIZES.includes(row.size)||rows.has(row.size)
     ||!Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>100000
     ||!Number.isSafeInteger(row.revision)||row.revision<0)
    fail('batch_inventory_invalid');
   rows.set(row.size,{size:row.size,quantity:row.quantity,revision:row.revision});
  }
  return {checked:[...checked],seen:[...seen],rows:SIZES.map(size=>rows.get(size))};
 }
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
   if(!Array.isArray(ids)||new Set(ids).size!==ids.length
      ||ids.some(id=>typeof id!=='string'||!UUID.test(id)))
    return {status:'local-review-required',localUnchanged:true};
   let response;
   try{
    if(ids.length<=BATCH_SIZE){
     // Unchanged normal path: one existing reconciliation RPC, no extra reads.
     response=await remote.readReconciliation({familyId,childId,operationIds:ids});
    }else{
     const checked=[],seen=[];
     let sameRows=null;
     for(let start=0;start<ids.length;start+=BATCH_SIZE){
      const group=ids.slice(start,start+BATCH_SIZE);
      const reply=await remote.readReconciliation({familyId,childId,operationIds:group});
      const verified=verifyBatch(reply,group,{familyId,childId,actorUid});
      if(sameRows&&verified.rows.some((row,i)=>
        row.quantity!==sameRows[i].quantity||row.revision!==sameRows[i].revision))
       fail('batch_snapshot_changed');
      if(!sameRows)sameRows=verified.rows;
      checked.push(...verified.checked);
      seen.push(...verified.seen);
     }
     // The outbox transaction re-reads the current local operation set and
     // rejects a queued UUID inserted/changed during these remote requests.
     response={complete:true,familyId,childId,actorUid,
      checkedOperationIds:checked,seenOperationIds:seen,rows:sameRows};
    }
   }catch(_){return {status:'cloud-read-failed',localUnchanged:true};}
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
