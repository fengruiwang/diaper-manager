/* XiaoBao v1.2.0 P3 - deterministic, immutable local diaper projection.
 * Works on new IndexedDB snapshots; does not read or modify legacy localStorage.
 * A historical/cloud baseline must be explicitly verified before initialization.
 * No I/O. Server revisions are not guessed from local pending operations.
 */
(function(root){
 'use strict';
 const SIZES=Object.freeze(['NB','S','M','L','XL','XXL']);
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function fail(code){throw new Error('inventory_projection:'+code);}
 function uuid(x){return typeof x==='string'&&UUID.test(x);}
 function integer(n,minimum=0){return Number.isSafeInteger(n)&&n>=minimum&&n<=100000;}
 function dateOK(x){
  if(typeof x!=='string'||!/^\d{4}-\d\d-\d\d$/.test(x))return false;
  const dt=new Date(x+'T00:00:00.000Z');
  return Number.isFinite(dt.getTime())&&dt.toISOString().slice(0,10)===x;
 }
 function inventoryOf(source){
  if(!source||typeof source!=='object'||Array.isArray(source)
    ||Object.keys(source).length!==SIZES.length
    ||!SIZES.every(size=>integer(source[size])))fail('invalid_inventory_baseline');
  return Object.fromEntries(SIZES.map(size=>[size,source[size]]));
 }
 function serverRevisionsOf(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid_server_revisions');
  if(Object.keys(raw).some(x=>!SIZES.includes(x)))fail('invalid_server_revisions');
  return Object.fromEntries(SIZES.map(size=>{
   const n=raw[size]??0;
   if(!Number.isSafeInteger(n)||n<0)fail('invalid_server_revisions');
   return [size,n];
  }));
 }
 function createSnapshot({familyId,actorUid,childId,inventory,serverRevisions={},source}={}){
  if(!uuid(familyId)||!uuid(childId)||typeof actorUid!=='string'
     ||!actorUid||actorUid.length>128)fail('invalid_identity');
  if(source!=='test-fixture'&&source!=='verified-server')
   fail('unverified_initial_baseline');
  return {
   familyId,actorUid,childId,
   inventory:inventoryOf(inventory),
   serverRevisions:serverRevisionsOf(serverRevisions),
   transactions:[],localRevision:0,source
  };
 }
 function checkPurchase(p){
  if(!p||typeof p!=='object'||Array.isArray(p))fail('purchase_required');
  const keys=Object.keys(p).sort().join(',');
  if(keys!=='brand,purchaseDate,series,totalFen')fail('invalid_purchase');
  for(const k of ['brand','series']){
   if(typeof p[k]!=='string'||!p[k].trim()
    ||Array.from(p[k].trim()).length>120||/[\u0000-\u001f\u007f]/u.test(p[k]))
     fail('invalid_purchase');
  }
  if(!Number.isSafeInteger(p.totalFen)||p.totalFen<1||p.totalFen>10000000
    ||!dateOK(p.purchaseDate))fail('invalid_purchase');
  return {brand:p.brand.trim(),series:p.series.trim(),
   totalFen:p.totalFen,purchaseDate:p.purchaseDate};
 }
 function apply(snapshot,operation){
  if(!snapshot||!operation||!uuid(operation.id)
    ||snapshot.familyId!==operation.familyId
    ||snapshot.actorUid!==operation.actorUid
    ||snapshot.childId!==operation.payload?.childId)
   fail('identity_mismatch');
  if(!SIZES.includes(operation.payload.size))fail('invalid_size');
  if(!Number.isSafeInteger(snapshot.localRevision)||snapshot.localRevision<0
     ||!Array.isArray(snapshot.transactions))fail('invalid_snapshot');
  const size=operation.payload.size,p=operation.payload,kind=operation.type;
  if(snapshot.transactions.some(t=>t.id===operation.id))fail('operation_already_applied');
  const inventory=inventoryOf(snapshot.inventory),history=snapshot.transactions.map(x=>({...x}));
  const before=inventory[size];
  let after,entry;
  if(kind==='inventory.delta'){
   if(!['buy','use'].includes(p.kind)||!integer(p.amount,1))fail('invalid_delta');
   const purchase=p.kind==='buy'?checkPurchase(p.purchase):null;
   if(p.kind==='use'&&p.purchase!=null)fail('unexpected_purchase');
   after=before+(p.kind==='buy'?p.amount:-p.amount);
   entry={
    id:operation.id,kind:p.kind,size,pieces:p.amount,
    occurredAt:p.occurredAt||operation.createdAt,reversedBy:null,
    ...(purchase||{})
   };
  }else if(kind==='inventory.count'){
   if(!integer(p.count)||!Number.isSafeInteger(operation.expectedRevision)
      ||operation.expectedRevision<0)fail('invalid_stocktake');
   after=p.count;
   entry={id:operation.id,kind:'stocktake',size,count:p.count,
    expectedRevision:operation.expectedRevision,occurredAt:p.occurredAt||operation.createdAt};
  }else if(kind==='transaction.reverse'){
   if(!uuid(p.reversesOperationId)||p.reversesOperationId===operation.id)
    fail('invalid_reverse');
   const target=history.find(t=>t.id===p.reversesOperationId);
   if(!target||!['buy','use'].includes(target.kind)||target.size!==size)
    fail('reverse_target_missing');
   if(target.reversedBy)fail('already_reversed');
   after=before+(target.kind==='buy'?-target.pieces:target.pieces);
   target.reversedBy=operation.id;
   entry={id:operation.id,kind:'reverse',size,
    reversesOperationId:target.id,occurredAt:p.occurredAt||operation.createdAt};
  }else{
   fail('unsupported_operation_type');
  }
  if(!integer(after))fail('inventory_out_of_bounds');
  inventory[size]=after;
  history.push(entry);
  return {
   ...snapshot,inventory,transactions:history,
   localRevision:snapshot.localRevision+1
  };
 }
 const api=Object.freeze({SIZES,createSnapshot,apply});
 if(root)root.XBInventoryProjection=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
