/* M3 original five-page inventory command adapter.
 * Maps existing compare/addBuy, consume, stock-editor and undo actions into
 * the SAME durable primary operation chain proven in M1-02 smoke.
 * Feature-only. Never imported in live V1.1.2 or M3 deployed read-only demo.
 * No CloudBase write can run without BOTH approved build and operator approval.
 * Financial legacy history is immutable. Only new cloud purchase operations
 * are reversible, and reversals are audit events (not deleting old rows).
 * No new ID is generated to retry ambiguous commits.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const SIZES=['NB','S','M','L','XL','XXL'];
 function ret(status,extras={}){return Object.freeze({status,...extras});}
 function create({primary,uuid,clock}={}){
  if(!primary?.selectedScope||!primary?.read||!primary?.queue
    ||typeof uuid!=='function'||typeof clock!=='function')
   throw Error('primary_commands:dependencies_required');
  let busy=false;
  function toFen(price){
   if(typeof price!=='number'||!Number.isFinite(price)||price<=0)
    throw Error('primary_commands:invalid_price');
   const fen=Math.round(price*100);
   if(!Number.isSafeInteger(fen)||fen<1||fen>10000000
      ||Math.abs(fen/100-price)>1e-7)
    throw Error('primary_commands:invalid_price_precision');
   return fen;
  }
  function input(action,value,scope,revisions){
   if(!value||typeof value!=='object'||!SIZES.includes(value.size))
    throw Error('primary_commands:invalid_size');
   let type,expectedRevision=null,payload;
   if(action==='purchase'){
    const brand=String(value.brand??'').trim();
    const series=String(value.series??'').trim();
    if(!brand||!series||brand.length>120||series.length>120
      ||/[\x00-\x1f\x7f]/.test(brand+series)
      ||!Number.isSafeInteger(value.pieces)||value.pieces<1
      ||value.pieces>30000)
     throw Error('primary_commands:invalid_purchase');
    type='inventory.delta';
    const timestamp=clock(),purchaseDate=timestamp.slice(0,10);
    payload={childId:scope.childId,size:value.size,kind:'buy',
      amount:value.pieces,occurredAt:timestamp,
      purchase:{brand,series,totalFen:toFen(value.price),purchaseDate}};
   }else if(action==='consume'){
    if(!Number.isSafeInteger(value.count)||value.count<1
      ||value.count>100000)
     throw Error('primary_commands:invalid_consumption');
    type='inventory.delta';
    payload={childId:scope.childId,size:value.size,kind:'use',
      amount:value.count,occurredAt:clock()};
   }else if(action==='stocktake'){
    if(!Number.isSafeInteger(value.count)||value.count<0
      ||value.count>100000)
     throw Error('primary_commands:invalid_stocktake');
    expectedRevision=revisions[value.size];
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
     throw Error('primary_commands:unverified_revision');
    type='inventory.count';
    payload={childId:scope.childId,size:value.size,count:value.count,
      occurredAt:clock()};
   }else if(action==='reverse'){
    if(value.origin!=='cloud_post_migration'
      ||!UUID.test(String(value.reversesOperationId||'')))
     throw Error('primary_commands:cannot_reverse_legacy_history');
    type='transaction.reverse';
    payload={childId:scope.childId,size:value.size,
      reversesOperationId:value.reversesOperationId,occurredAt:clock()};
   }else throw Error('primary_commands:unsupported_action');
   const id=uuid();
   if(!UUID.test(id)||id===payload.reversesOperationId)
    throw Error('primary_commands:invalid_new_operation_id');
   const createdAt=payload.occurredAt;
   return {id,type,familyId:scope.familyId,actorUid:scope.actorUid,
     expectedRevision,createdAt,payload};
  }
  async function submit(action,value,{operatorApproved=false}={}){
   if(busy)return ret('BUSY');
   // This is intentionally ahead of UUID generation and read/SDK calls.
   if(primary.cloudWritesEnabled!==true||operatorApproved!==true)
    return ret('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   busy=true;
   try{
    const scope=primary.selectedScope();
    if(!scope||!UUID.test(scope.familyId)||!UUID.test(scope.childId)
      ||typeof scope.actorUid!=='string'||!scope.actorUid)
     return ret('PRIMARY_NOT_SELECTED');
    const fresh=await primary.read();
    if(fresh?.status!=='PRIMARY_CLOUD_READ_VERIFIED'
      ||!fresh.inventory||!fresh.revisions)
     return ret('PRIMARY_FRESH_STOCK_UNVERIFIED');
    if(action==='consume'&&SIZES.includes(value?.size)
      &&Number.isSafeInteger(value?.count)&&value.count>=1
      &&(!Number.isSafeInteger(fresh.inventory[value.size])
       ||fresh.inventory[value.size]<value.count))
     return ret('PRIMARY_INSUFFICIENT_STOCK');
    // An old form revision must not silently adopt newer cloud stock.
    if(action==='stocktake'&&value
      &&Object.prototype.hasOwnProperty.call(value,'expectedRevision')
      &&value.expectedRevision!==fresh.revisions[value.size])
     return ret('PRIMARY_STOCK_REVISION_CONFLICT');
    if(action==='stocktake'&&fresh.inventory[value?.size]===value?.count)
     return ret('PRIMARY_STOCK_UNCHANGED');
    const operation=input(action,value,scope,fresh.revisions);
    // queue() persists stable immutable operation into the primary-only IDB.
    // Never auto flush from a click; the explicit send action is separate.
    const queued=await primary.queue(operation,{operatorApproved:true});
    if(!queued||!['PRIMARY_OPERATION_DURABLY_QUEUED',
      'PRIMARY_OPERATION_ALREADY_QUEUED'].includes(queued.status)){
     return ret('PRIMARY_QUEUE_UNVERIFIED_PRESERVE_ORIGINAL_ID',
      {operationId:operation.id});
    }
    return ret(queued.status,{operationId:operation.id,
      cloudWriteCommitted:false});
   }catch(_){return ret('PRIMARY_OPERATION_REVIEW_REQUIRED');}
   finally{busy=false;}
  }
  return Object.freeze({submit});
 }
 const api=Object.freeze({create});
 if(root)root.XBPrimaryBusinessCommands=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
