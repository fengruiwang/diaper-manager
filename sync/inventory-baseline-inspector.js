/* XiaoBao v1.2.0 P2-3D: explicit, strictly no-write baseline inspector.
 * Uses existing CloudBase reconciliation READ RPC and IDB read APIs.
 * This module CANNOT initialize snapshots, acknowledge ops or enable uploads.
 * Opening the IndexedDB adapter may create its schema on a first access;
 * it must never overwrite existing inventory or operation records.
 * All outcomes have uploadAllowed:false; no automatic jobs at import.
 */
(function(root){
 'use strict';
 const SIZES=Object.freeze(['NB','S','M','L','XL','XXL']);
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const STATUSES=new Set(['pending','retry','conflict','blocked','acked']);
 const LIMIT=50;
 function fail(code){throw new Error('baseline_inspect:'+code);}
 function ident(scope){
  if(!scope||typeof scope!=='object'
    ||typeof scope.familyId!=='string'||!UUID.test(scope.familyId)
    ||typeof scope.childId!=='string'||!UUID.test(scope.childId)
    ||typeof scope.actorUid!=='string'||!scope.actorUid||scope.actorUid.length>128)
   fail('invalid_scope');
  return {familyId:scope.familyId,childId:scope.childId,actorUid:scope.actorUid};
 }
 function result(status,detail={}){
  return Object.freeze({status,uploadAllowed:false,localUnchanged:true,...detail});
 }
 function validatedRows(rows){
  if(!Array.isArray(rows)||rows.length!==SIZES.length)fail('incomplete_six_sizes');
  const inventory={},revisions={};
  for(const row of rows){
   if(!row||!SIZES.includes(row.size)
      ||Object.prototype.hasOwnProperty.call(inventory,row.size)
      ||!Number.isSafeInteger(row.quantity)||row.quantity<0||row.quantity>100000
      ||!Number.isSafeInteger(row.revision)||row.revision<0)
    fail('invalid_server_stock');
   inventory[row.size]=row.quantity;
   revisions[row.size]=row.revision;
  }
  if(SIZES.some(size=>!Object.prototype.hasOwnProperty.call(inventory,size)))
   fail('incomplete_six_sizes');
  return {inventory,revisions};
 }
 function validLocal(snapshot,scope){
  if(snapshot===null)return null;
  if(!snapshot||snapshot.familyId!==scope.familyId
    ||snapshot.childId!==scope.childId||snapshot.actorUid!==scope.actorUid
    ||!Number.isSafeInteger(snapshot.localRevision)||snapshot.localRevision<0)
   fail('local_snapshot_scope_or_revision');
  if(!snapshot.inventory||!snapshot.serverRevisions
    ||Object.keys(snapshot.inventory).length!==SIZES.length
    ||Object.keys(snapshot.serverRevisions).length!==SIZES.length)
   fail('local_snapshot_incomplete');
  for(const size of SIZES){
   const n=snapshot.inventory[size],rev=snapshot.serverRevisions[size];
   if(!Number.isSafeInteger(n)||n<0||n>100000
      ||!Number.isSafeInteger(rev)||rev<0)
    fail('local_snapshot_incomplete');
  }
  if(snapshot.source!=='verified-server')
   fail('local_snapshot_untrusted_source');
  return snapshot;
 }
 function scopedOps(ops,scope){
  if(!Array.isArray(ops)||ops.length>LIMIT)fail('queue_requires_review');
  const ids=new Set(),matched=[];
  for(const op of ops){
   if(!op||op.familyId!==scope.familyId||op.actorUid!==scope.actorUid
     ||typeof op.id!=='string'||!UUID.test(op.id)||ids.has(op.id)
     ||!STATUSES.has(op.status)||!op.payload
     ||typeof op.payload.childId!=='string'||!UUID.test(op.payload.childId))
    fail('queue_corrupt');
   ids.add(op.id);
   if(op.payload.childId===scope.childId)matched.push(op);
  }
  return matched;
 }
 function validateRemote(response,scope,ops){
  if(!response||response.complete!==true
     ||response.familyId!==scope.familyId
     ||response.childId!==scope.childId||response.actorUid!==scope.actorUid
     ||!Array.isArray(response.checkedOperationIds)
     ||!Array.isArray(response.seenOperationIds))
   fail('remote_scope_not_verified');
  const expected=new Set(ops.map(op=>op.id));
  const checked=response.checkedOperationIds,seen=response.seenOperationIds;
  if(checked.length!==expected.size||new Set(checked).size!==checked.length
     ||checked.some(id=>!expected.has(id))
     ||new Set(seen).size!==seen.length
     ||seen.some(id=>!expected.has(id)))
   fail('remote_receipt_set_invalid');
  return {seen:new Set(seen),...validatedRows(response.rows)};
 }
 function create({verifyAccess,children,outbox,remote}={}){
  if(typeof verifyAccess!=='function'
     ||!children||typeof children.listActiveChildren!=='function'
     ||!outbox||typeof outbox.list!=='function'||typeof outbox.readInventory!=='function'
     ||!remote||typeof remote.readReconciliation!=='function')
   fail('dependencies_required');
  async function inspect(input){
   const scope=ident(input);
   if(input.readEnabled!==true)return result('disabled');
   let grant;
   try{grant=await verifyAccess({familyId:scope.familyId,actorUid:scope.actorUid});}
   catch(_){return result('authorization-unverified');}
   if(!grant||grant.familyId!==scope.familyId||grant.actorUid!==scope.actorUid
     ||grant.member!==true||grant.appCode!=='xb')
    return result('authorization-unverified');
   // The P2-3C read-only preflight returns initialized:false intentionally.
   // It must not be turned into a local upload authorization token.
   let visible;
   try{visible=await children.listActiveChildren({familyId:scope.familyId});}
   catch(_){return result('child-read-unverified');}
   if(!visible||visible.familyId!==scope.familyId
     ||!Array.isArray(visible.activeChildren)
     ||visible.activeChildren.some(row=>!row||typeof row.id!=='string'))
    return result('child-scope-unverified');
   if(!visible.activeChildren.some(row=>row.id===scope.childId))
    return result('child-not-active-or-test-excluded');
   let operations,snapshot,matching;
   try{
    operations=await outbox.list({familyId:scope.familyId,actorUid:scope.actorUid},
     {includeAcked:true});
    matching=scopedOps(operations,scope);
    snapshot=validLocal(await outbox.readInventory(
     {familyId:scope.familyId,actorUid:scope.actorUid},scope.childId),scope);
   }catch(_){return result('local-baseline-or-queue-review-required');}
   if(matching.length>LIMIT)return result('queue-requires-pagination');
   let response,verified;
   try{
    response=await remote.readReconciliation({
     familyId:scope.familyId,childId:scope.childId,
     operationIds:matching.map(op=>op.id)
    });
    verified=validateRemote(response,scope,matching);
   }catch(_){return result('cloud-snapshot-or-receipt-unverified');}
   const counts={pending:0,retry:0,conflict:0,blocked:0,acked:0};
   for(const op of matching)counts[op.status]++;
   const summary=Object.freeze({
    sixSizesVerified:true,
    checkedOperations:matching.length,
    serverSeenOperations:verified.seen.size,
    outstandingOperations:matching.length-counts.acked
   });
   // An acknowledged operation missing from server indicates a dangerous
   // backend restore/rollback; do not silently reupload or overwrite it.
   if(matching.some(op=>op.status==='acked'&&!verified.seen.has(op.id)))
    return result('previous-ack-missing-server',summary);
   if(counts.conflict||counts.blocked)
    return result('manual-queue-conflict-review',summary);
   if(counts.pending||counts.retry)
    return result('pending-queue-preserved',summary);
   if(!snapshot)return result('initial-baseline-not-created',summary);
   const mismatch=SIZES.filter(size=>
    snapshot.inventory[size]!==verified.inventory[size]||
    snapshot.serverRevisions[size]!==verified.revisions[size]);
   if(mismatch.length)
    return result('snapshot-differs-from-cloud',Object.freeze({
     ...summary,mismatchSizes:Object.freeze(mismatch)
    }));
   return result('snapshot-matches-cloud-upload-still-disabled',summary);
  }
  return Object.freeze({inspect});
 }
 const api=Object.freeze({create,SIZES});
 if(root)root.XBInventoryBaselineInspector=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
