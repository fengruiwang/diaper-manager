/* XiaoBao P3: inventory reconciliation plan.
 * Pure and fail-closed. Server quantities are authoritative; only LOCAL
 * operations verified absent on the server may be overlaid for offline UX.
 * This is not the complete cross-device purchase-history merge.
 */
(function(root){
 'use strict';
 const SIZES=Object.freeze(['NB','S','M','L','XL','XXL']);
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const ACTIVE=new Set(['pending','retry']);
 const ALL=new Set(['pending','retry','conflict','blocked','acked']);
 function fail(code){throw new Error('inventory_reconcile:'+code);}
 function number(n){return Number.isSafeInteger(n)&&n>=0&&n<=100000;}
 function safeRev(n){return Number.isSafeInteger(n)&&n>=0;}
 function distinctIds(input,code){
  if(!Array.isArray(input)||input.length>50)fail(code);
  const seen=new Set();
  for(const id of input){
   if(typeof id!=='string'||!UUID.test(id)||seen.has(id))fail(code);
   seen.add(id);
  }
  return seen;
 }
 function build({snapshot,operations,response}={}){
  if(!snapshot||!Array.isArray(operations)||!response
    ||response.complete!==true
    ||snapshot.familyId!==response.familyId||snapshot.childId!==response.childId
    ||snapshot.actorUid!==response.actorUid)
   fail('unverified_scope');
  const checked=distinctIds(response.checkedOperationIds,'invalid_checked_ids');
  const seen=distinctIds(response.seenOperationIds,'invalid_seen_ids');
  const scoped=operations.filter(op=>op?.payload?.childId===snapshot.childId);
  if(scoped.length>50)fail('too_many_operations_for_one_snapshot');
  const actual=new Set();
  for(const op of scoped){
   if(op.familyId!==snapshot.familyId||op.actorUid!==snapshot.actorUid
     ||typeof op.id!=='string'||!UUID.test(op.id)||actual.has(op.id)
     ||!ALL.has(op.status))fail('invalid_scoped_operation');
   actual.add(op.id);
  }
  // The response must prove it checked exactly the records that are still
  // queued at commit time. A stale response cannot overwrite newer local work.
  if(actual.size!==checked.size||[...actual].some(id=>!checked.has(id)))
   fail('stale_checked_set');
  if([...seen].some(id=>!checked.has(id)))fail('unrequested_server_receipt');

  if(!Array.isArray(response.rows)||response.rows.length!==6)
   fail('partial_server_inventory');
  const qty={},revisions={};
  for(const row of response.rows){
   if(!row||!SIZES.includes(row.size)
     ||Object.prototype.hasOwnProperty.call(qty,row.size)||!number(row.quantity)||!safeRev(row.revision))
    fail('invalid_server_inventory');
   qty[row.size]=row.quantity;
   revisions[row.size]=row.revision;
  }
  if(SIZES.some(s=>!Object.prototype.hasOwnProperty.call(qty,s)))fail('partial_server_inventory');
  for(const size of SIZES){
   if(!safeRev(snapshot.serverRevisions?.[size])
      ||revisions[size]<snapshot.serverRevisions[size])
    fail('server_revision_regressed');
  }

  const acknowledge=[],unsubmitted=[];
  for(const op of scoped){
   if(seen.has(op.id)){acknowledge.push(op.id);continue;}
   // A server receipt once acknowledged is never allowed to disappear during
   // silent recovery. This could indicate a deleted/restored cloud database.
   if(op.status==='acked')fail('confirmed_operation_missing_server');
   if(!ACTIVE.has(op.status))fail('manual_conflict_or_permission_block');
   unsubmitted.push(op);
  }
  unsubmitted.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const provisional={...qty};
  for(const op of unsubmitted){
   const p=op.payload||{},size=p.size;
   if(!SIZES.includes(size))fail('invalid_pending_size');
   // Stocktake and reverse require extra server ordering/history guarantees.
   // Do not infer safe reconciliation from local counter or a partial history.
   if(op.type!=='inventory.delta'||!['buy','use'].includes(p.kind)
      ||!Number.isSafeInteger(p.amount)||p.amount<1||p.amount>100000)
    fail('needs_manual_or_sequential_rebase');
   if(p.kind==='buy'){
    if(!p.purchase||!Number.isSafeInteger(p.purchase.totalFen)
      ||p.purchase.totalFen<1)fail('invalid_pending_purchase');
   }else if(p.purchase!=null)fail('invalid_pending_purchase');
   const after=provisional[size]+(p.kind==='buy'?p.amount:-p.amount);
   if(!number(after))fail('pending_stock_out_of_bounds');
   provisional[size]=after;
  }
  return {
   snapshot:{
    ...snapshot,inventory:provisional,serverRevisions:revisions,
    // This local-only history cannot be presented as the complete family
    // purchase ledger. A separate server event synchronization is required.
    transactions:snapshot.transactions,
    localRevision:snapshot.localRevision+1
   },
   acknowledgedIds:acknowledge,
   pendingCount:unsubmitted.length,
   status:unsubmitted.length?'local-pending':'verified-as-of-server-read'
  };
 }
 const api=Object.freeze({build});
 if(root)root.XBInventoryReconciler=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
