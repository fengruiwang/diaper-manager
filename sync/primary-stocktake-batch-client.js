/* M3 multi-size stocktake: one PostgreSQL 027 RPC, durable batch ID,
 * separate IndexedDB outbox, no partial per-size 009 writes. NOT deployed.
 * Build write gate OFF unless separately reviewed and authorized.
 */
(function(root){
'use strict';
const DB_NAME='xiaobao-primary-stocktake-batches-v120';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIZES=['NB','S','M','L','XL','XXL'];
const answer=(status,rest={})=>Object.freeze({status,...rest});
function create({controller,host,primary,outboxFactory,contract,
 cloudWritesEnabled=false}={}){
 if(!controller?.verifiedContext||!primary?.selectedScope||!primary?.read
   ||!outboxFactory?.create||!contract?.createOperation||!host?.indexedDB)
  throw Error('batch_client:dependencies_required');
 const store=outboxFactory.create({
  indexedDB:host.indexedDB,contract,dbName:DB_NAME
 });
 if(!store?.enqueue||!store?.ready||!store?.stats
   ||!store?.recordResult||!store?.get)
  throw Error('batch_client:outbox_unavailable');
 let busy=false;
 const connected=()=>host.navigator?.onLine!==false;
 function scope(){
  const identity=primary.selectedScope();
  const verified=controller.verifiedContext();
  if(!identity||!verified||!UUID.test(identity.familyId)
    ||!UUID.test(identity.childId)||!identity.actorUid
    ||identity.familyId!==verified.familyId
    ||identity.actorUid!==verified.actorUid)
   throw Error('batch_client:verified_primary_required');
  return identity;
 }
 function validate(items,stock,revisions){
  if(!Array.isArray(items)||items.length<1||items.length>6)
   throw Error('batch_client:invalid_items');
  const seen=new Set(),result=[];
  for(const value of items){
   if(!value||!SIZES.includes(value.size)||seen.has(value.size)
     ||!Number.isSafeInteger(value.count)||value.count<0||value.count>100000
     ||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0
     ||!Number.isSafeInteger(stock[value.size])
     ||!Number.isSafeInteger(revisions[value.size])
     ||value.expectedRevision!==revisions[value.size]
     ||value.count===stock[value.size])
    throw Error('batch_client:invalid_or_stale_stock');
   seen.add(value.size);
   result.push({size:value.size,count:value.count,
    expectedRevision:value.expectedRevision});
  }
  result.sort((a,b)=>a.size.localeCompare(b.size));
  return result;
 }
 async function pending(){
  try{
   const id=scope(),t=await store.stats(id);
   if(!Number.isSafeInteger(t.outstanding)||t.outstanding<0)
    throw Error('batch_client:bad_counts');
   return answer('BATCH_QUEUE_VERIFIED',t);
  }catch(_){return answer('BATCH_QUEUE_UNVERIFIED');}
 }
 async function queue({items,batchId,operatorApproved=false}={}){
  if(cloudWritesEnabled!==true||operatorApproved!==true)
   return answer('BATCH_WRITES_NOT_AUTHORIZED');
  if(!connected())return answer('BATCH_OFFLINE_NOT_ACCEPTED');
  if(busy)return answer('BATCH_BUSY');
  if(!UUID.test(String(batchId)))return answer('BATCH_INVALID_ID');
  busy=true;
  try{
   const id=scope();
   const outstanding=await store.stats(id);
   if(outstanding.outstanding!==0)
    return answer('BATCH_PENDING_REVIEW_FIRST');
   const fresh=await primary.read();
   if(fresh?.status!=='PRIMARY_CLOUD_READ_VERIFIED')
    return answer('BATCH_STOCK_NOT_VERIFIED');
   const values=validate(items,fresh.inventory,fresh.revisions);
   // The existing generic contract verifies immutable IDs/types, but the
   // payload is NEVER forwarded to the single-size inventory 009 runner.
   const op=contract.createOperation({
    id:batchId,type:'inventory.count',familyId:id.familyId,
    actorUid:id.actorUid,expectedRevision:0,
    createdAt:new Date().toISOString(),
    payload:{childId:id.childId,kind:'stocktake_batch',
     items:values}
   });
   const stored=await store.enqueue(op);
   return answer('BATCH_DURABLY_QUEUED',{batchId:op.id,
    duplicate:stored?.duplicate===true,cloudWriteCommitted:false});
  }catch(_){return answer('BATCH_QUEUE_UNVERIFIED_KEEP_ID',{batchId});}
  finally{busy=false;}
 }
 function receiptMatches(result,items){
  const changes=result?.changes;
  return Number.isSafeInteger(result?.changed_sizes)
   &&result.changed_sizes===items.length
   &&Array.isArray(changes)&&changes.length===items.length
   &&items.every(item=>changes.some(change=>
    change.size===item.size&&change.new_quantity===item.count
    &&change.revision===item.expectedRevision+1));
 }
 async function receipt(id,batchId,items){
  const app=controller.verifiedContext()?.app;
  if(!app?.rdb)return null;
  try{
   const response=await app.rdb().rpc(
    'xb_read_primary_stocktake_batch_receipt_draft',{
     p_family_id:id.familyId,p_child_id:id.childId,
     p_batch_id:batchId
    });
   if(response?.error)return null;
   const d=Array.isArray(response?.data)?response.data[0]:response?.data;
   if(d?.status!=='COMMITTED'||d.family_id!==id.familyId
     ||d.child_id!==id.childId||d.batch_id!==batchId
     ||d.result?.status!=='APPLIED'
     ||!receiptMatches(d.result,items))return null;
   return d;
  }catch(_){return null;}
 }
 async function send({operatorApproved=false}={}){
  if(cloudWritesEnabled!==true||operatorApproved!==true)
   return answer('BATCH_WRITES_NOT_AUTHORIZED');
  if(!connected())return answer('BATCH_OFFLINE_QUEUE_PRESERVED');
  if(busy)return answer('BATCH_BUSY');
  busy=true;
  try{
   const id=scope(),list=await store.ready(id);
   if(list.length!==1)return answer(list.length?'BATCH_MULTIPLE_PENDING_BLOCKED':
    'BATCH_NO_READY_OPERATION');
   const op=list[0],items=op.payload?.items;
   if(!UUID.test(op.id)||op.familyId!==id.familyId
     ||op.actorUid!==id.actorUid||op.payload?.childId!==id.childId
     ||!Array.isArray(items))return answer('BATCH_IMMUTABLE_SCOPE_INVALID');
   // Before trying once, check whether an earlier ACK was lost.
   const already=await receipt(id,op.id,items);
   if(already){
    await store.recordResult(id,op.id,{kind:'accepted',receiptId:op.id});
    return answer('BATCH_ACK_RECOVERED',{batchId:op.id,items});
   }
   const app=controller.verifiedContext()?.app;
   let response;
   try{
    response=await app.rdb().rpc('xb_primary_stocktake_batch_draft',{
     p_family_id:id.familyId,p_child_id:id.childId,
     p_batch_id:op.id,p_items:items
    });
   }catch(_){
    // Do not replace batch ID or retry after an ambiguous network error.
    const found=await receipt(id,op.id,items);
    if(!found)return answer('BATCH_ACK_UNKNOWN_KEEP_ORIGINAL_ID',
     {batchId:op.id});
    await store.recordResult(id,op.id,{kind:'accepted',receiptId:op.id});
    return answer('BATCH_ACK_RECOVERED',{batchId:op.id,items});
   }
   if(response?.error){
    const code=String(response.error.code||response.error.errorCode||'');
    if(code==='40001'||code==='DATABASE_40001'){
     await store.recordResult(id,op.id,{kind:'conflict'});
     return answer('BATCH_REVISION_CONFLICT_MANUAL_REVIEW',
      {batchId:op.id});
    }
    return answer('BATCH_SERVER_UNVERIFIED_KEEP_ID',{batchId:op.id});
   }
   const d=Array.isArray(response?.data)?response.data[0]:response?.data;
   if(d?.saved!==true||d.batch_id!==op.id
      ||d.family_id!==id.familyId||d.child_id!==id.childId
      ||d.result?.status!=='APPLIED'
      ||!receiptMatches(d.result,items)){
    return answer('BATCH_ACK_UNVERIFIED_KEEP_ID',{batchId:op.id});
   }
   // A returned write ACK is not sufficient: verify the receipt
   // through the existing read-only batch receipt RPC before local ACK.
   if(!await receipt(id,op.id,items))
    return answer('BATCH_RECEIPT_READBACK_REQUIRED_KEEP_ID',{batchId:op.id});
   await store.recordResult(id,op.id,{kind:'accepted',receiptId:op.id});
   return answer('BATCH_ATOMIC_COMMIT_ACKED',{batchId:op.id,
    items,changedSizes:d.result.changed_sizes});
  }catch(_){return answer('BATCH_SYNC_UNVERIFIED_KEEP_QUEUE');}
  finally{busy=false;}
 }
 return Object.freeze({queue,send,pending,
  get cloudWritesEnabled(){return cloudWritesEnabled===true;}});
}
const api=Object.freeze({create,DB_NAME});
if(root)root.XBPrimaryStocktakeBatchClient=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
