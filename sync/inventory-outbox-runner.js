/* XiaoBao P3: explicitly invoked, fail-closed inventory outbox replay.
 * NO automatic invocation, NO legacy localStorage access, NO CloudBase SDK
 * import. This is a standalone integration contract until P3/P4 approval.
 */
(function(root){
 'use strict';
 const TYPES=new Set(['inventory.delta','inventory.count','transaction.reverse']);
 function errorCode(e){
  const msg=String(e?.message||'');
  if(msg==='inventory_client:revision_conflict'
    ||msg==='inventory_client:operation_conflict'
    ||msg==='inventory_client:stock_out_of_bounds'
    ||msg.startsWith('inventory_client:invalid_'))
   return 'conflict';
  if(msg==='inventory_client:permission_denied')return 'forbidden';
  if(msg==='inventory_client:login_required'
    ||msg==='inventory_client:session_unavailable')return 'auth_expired';
  // Unknown errors and network failure must never become an ACK.
  return 'server_error';
 }
 function create({outbox,remote,verifyAccess}={}){
  if(!outbox||typeof outbox.ready!=='function'
    ||typeof outbox.recordResult!=='function')throw Error('replay:outbox_required');
  if(!remote||typeof remote.applyOperation!=='function')throw Error('replay:remote_required');
  if(typeof verifyAccess!=='function')throw Error('replay:verify_access_required');

  function toRemote(op){
   if(!op||!TYPES.has(op.type))throw Error('replay:unsupported_type');
   const p=op.payload||{},base={
    familyId:op.familyId,operationId:op.id,childId:p.childId,
    size:p.size,occurredAt:p.occurredAt||op.createdAt,
    expectedRevision:null,reversesOperationId:null,amount:null,purchase:null
   };
   if(op.type==='inventory.count'){
    return {...base,kind:'stocktake',amount:p.count,
     expectedRevision:op.expectedRevision};
   }
   if(op.type==='transaction.reverse'){
    return {...base,kind:'reverse',reversesOperationId:p.reversesOperationId};
   }
   if(p.kind!=='buy'&&p.kind!=='use')throw Error('replay:invalid_inventory_delta');
   return {...base,kind:p.kind,amount:p.amount,purchase:p.kind==='buy'?p.purchase:null};
  }
  async function flush(scope,{uploadEnabled=false,maxItems=20,purchaseOnly=false,allowConsume=false,
  allowReverse=false,allowStocktake=false,fastPurchaseId=null,fastConsumeId=null,fastReverseId=null,fastStocktakeId=null}={}){
   if(!scope||typeof scope.familyId!=='string'||typeof scope.actorUid!=='string'
     ||!scope.familyId||!scope.actorUid)throw Error('replay:scope_required');
   if(!Number.isInteger(maxItems)||maxItems<1||maxItems>50)
    throw Error('replay:invalid_batch_size');
   // This guard deliberately runs before even querying the pending queue.
   if(uploadEnabled!==true)
    return {status:'upload-disabled',attempted:0,accepted:0,remaining:null};

   const fastId=fastStocktakeId??fastReverseId??fastConsumeId??fastPurchaseId;
   const stocktake=fastStocktakeId!==null,reverse=!stocktake&&fastReverseId!==null,
    consume=!stocktake&&!reverse&&fastConsumeId!==null;
   if(fastId===null){
    let grant;
    try{grant=await verifyAccess({familyId:scope.familyId,actorUid:scope.actorUid});}
    catch(_){
     return {status:'verification-unavailable',attempted:0,accepted:0,remaining:null};
    }
    if(!grant||grant.familyId!==scope.familyId||grant.actorUid!==scope.actorUid
      ||grant.appCode!=='xb'||grant.member!==true)
     return {status:'permission-unverified',attempted:0,accepted:0,remaining:null};
    if(grant.initialized!==true)
     return {status:'family-not-initialized',attempted:0,accepted:0,remaining:null};
   }
   const queued=await outbox.ready(scope);
   // The trusted caller already checked the current login, displayed stock,
   // pending IDB count, and a newly persisted one-time operation UUID.
   if(fastId!==null){
    if(queued.length!==1||queued[0]?.id!==fastId
      ||queued[0].type!==(stocktake?'inventory.count':reverse?'transaction.reverse':'inventory.delta')
      ||(!reverse&&!stocktake&&queued[0].payload?.kind!==(consume?'use':'buy'))
      ||(stocktake&&(allowStocktake!==true||queued[0].payload?.kind==='stocktake_batch'
        ||!Number.isSafeInteger(queued[0].expectedRevision)))
      ||(reverse&&allowReverse!==true)
      ||(consume&&allowConsume!==true)
      ||queued[0].familyId!==scope.familyId
      ||queued[0].actorUid!==scope.actorUid)
     return {status:'fast-purchase-not-single-pending',attempted:0,accepted:0};
    const op=queued[0];
    try{
     const receipt=await remote.applyOperation(toRemote(op));
     if(receipt?.operationId!==op.id
       ||receipt.childId!==op.payload.childId
       ||receipt.size!==op.payload.size
       ||!Number.isSafeInteger(receipt.quantity)||receipt.quantity<0
       ||!Number.isSafeInteger(receipt.revision)||receipt.revision<1)
      return {status:'purchase-ack-unverified',attempted:1,accepted:0};
     if(op.type==='inventory.delta'){
      if(typeof outbox.recordDeltaAck!=='function')
       throw Error('outbox_store:delta_ack_not_supported');
      await outbox.recordDeltaAck(scope,op.id,receipt);
     }else if(stocktake&&receipt.duplicate!==true
       &&typeof outbox.recordStocktakeAck==='function')
      await outbox.recordStocktakeAck(scope,op.id,receipt);
     else if(reverse&&receipt.duplicate!==true
       &&typeof outbox.recordReverseAck==='function')
      await outbox.recordReverseAck(scope,op.id,receipt);
     else await outbox.recordResult(scope,op.id,{
      kind:receipt.duplicate?'duplicate':'accepted',receiptId:op.id
     });
     return {status:(stocktake?'stocktake':reverse?'reverse':consume?'consume':'purchase')
       +(receipt.duplicate?'-ack-recovered':'-ack-confirmed'),
       attempted:1,accepted:1,
       receipt,operation:op,remaining:0};
    }catch(e){
     if(String(e?.message||'').startsWith('outbox_store:'))
      return {status:'purchase-local-ack-unknown',attempted:1,accepted:0};
     const code=errorCode(e);
     if(stocktake&&String(e?.message||'')==='inventory_client:revision_conflict'
       &&typeof outbox.abandonSingleStocktakeConflict==='function'){
      try{await outbox.abandonSingleStocktakeConflict(scope,op.id);}
      catch(_){return {status:'purchase-local-ack-unknown',attempted:1,accepted:0};}
      return {status:'stocktake-rejected',attempted:1,accepted:0};
     }
     try{await outbox.recordResult(scope,op.id,{kind:code});}
     catch(_){return {status:'purchase-local-ack-unknown',attempted:1,accepted:0};}
     if(stocktake&&code==='conflict')return {
       status:'stocktake-rejected',attempted:1,accepted:0
      };
     if(reverse&&code==='conflict')return {
      status:'reverse-rejected',attempted:1,accepted:0
     };
     return {status:'purchase-ack-unknown',attempted:1,accepted:0};
    }
   }
   // A purchase-only release must not dispatch pre-existing non-buy operations.
   if(purchaseOnly===true&&queued.some(op=>
     !(op?.type==='inventory.delta'
       &&(op?.payload?.kind==='buy'
         ||(allowConsume===true&&op?.payload?.kind==='use')))
     &&!(allowReverse===true&&op?.type==='transaction.reverse')
     &&!(allowStocktake===true&&op?.type==='inventory.count')))
    return {status:'unsupported-pending-type',attempted:0,accepted:0,
     remaining:queued.length};
   let accepted=0,attempted=0,status='awaiting-reconciliation';
   for(const op of queued.slice(0,maxItems)){
    if(op.familyId!==scope.familyId||op.actorUid!==scope.actorUid)
      throw Error('replay:cross_identity_queue_violation');
    if(!TYPES.has(op.type)){status='unsupported-pending-type';break;}
    let request;
    try{request=toRemote(op);}
    catch(_){
     await outbox.recordResult(scope,op.id,{kind:'conflict'});
     status='manual-review-required';break;
    }
    attempted++;
    try{
     const receipt=await remote.applyOperation(request);
     if(!receipt||receipt.operationId!==op.id)
      throw Error('replay:receipt_id_mismatch');
     if(op.type==='inventory.delta'){
      if(typeof outbox.recordDeltaAck!=='function')
       throw Error('outbox_store:delta_ack_not_supported');
      if(receipt.childId!==op.payload?.childId
        ||receipt.size!==op.payload?.size
        ||!Number.isSafeInteger(receipt.quantity)||receipt.quantity<0
        ||!Number.isSafeInteger(receipt.revision)||receipt.revision<1)
       throw Error('replay:receipt_unverified');
      await outbox.recordDeltaAck(scope,op.id,receipt);
     }else await outbox.recordResult(scope,op.id,{
      kind:receipt.duplicate?'duplicate':'accepted',receiptId:op.id
     });
     accepted++;
    }catch(e){
     // If server committed but ACK/local storage failed, it is safer to
     // retry the exact same ID than to invent a replacement operation.
     const kind=errorCode(e);
     if(String(e?.message||'').startsWith('outbox_store:'))throw e;
     await outbox.recordResult(scope,op.id,{kind});
     status=kind==='conflict'?'manual-review-required'
      :kind==='forbidden'?'permission-denied'
      :kind==='auth_expired'?'auth-required':'network-or-server-failure';
     break;
    }
   }
   const remaining=(await outbox.ready(scope)).length;
   return {status,attempted,accepted,remaining};
  }
  return Object.freeze({flush,toRemote});
 }
 const api=Object.freeze({create,errorCode});
 if(root)root.XBInventoryOutboxRunner=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
