/* M3 formal PRIMARY inventory/transaction bridge, using P2/P3 modules.
 * NOT imported by M1-02, M3 synthetic preview, V1.1.2 or live PWA.
 * No auto network calls on import/create. This is NOT an authorization.
 * Existing 009 RPC handles buy/use/stocktake/reverse; same durable outbox,
 * replay and reconciliation modules as the real M1-02 purchase path.
 * Other cloud write types (price/quote/weight/profile/settings) are NOT
 * enabled until separately reviewed server write contracts exist.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const SIZES=['NB','S','M','L','XL','XXL'];
 const TYPES=new Set(['inventory.delta','inventory.count','transaction.reverse']);
 // Deliberately separate from M1-02 smoke and any existing family localStorage.
 const PRIMARY_DB_NAME='xiaobao-primary-sync-v120';
 const result=(status,extra={})=>Object.freeze({status,cloudWriteCommitted:false,...extra});
 function create({controller,host,accessPreflight,childReader,scopeGuard,
  legacyHistoryReader,inventoryClient,outboxFactory,outboxContract,
  inventoryProjection,inventoryReconciler,runnerFactory,syncFactory,
  cloudWritesEnabled=false}={}){
  if(!controller?.verifiedContext||!accessPreflight?.create
    ||!childReader?.create||!scopeGuard?.requireLegacyMigrationTarget
    ||!legacyHistoryReader?.create||!inventoryClient?.create
    ||!outboxFactory?.create||!outboxContract?.createOperation
    ||!inventoryProjection?.createSnapshot||!inventoryReconciler?.build
    ||!host?.indexedDB||!runnerFactory?.create||!syncFactory?.create)
   throw Error('primary_operations:dependencies_required');
  const outbox=outboxFactory.create({indexedDB:host.indexedDB,
   contract:outboxContract,projection:inventoryProjection,
   reconciler:inventoryReconciler,dbName:PRIMARY_DB_NAME});
  if(!outbox?.readInventory||!outbox?.initializeInventory
    ||!outbox?.commitInventory||!outbox?.stats)
   throw Error('primary_operations:primary_outbox_unverified');
  let selected=null,busy=false;
  const online=()=>host?.navigator?.onLine!==false;
  function knownRows(rows){
   if(!Array.isArray(rows)||rows.length!==6)
    throw Error('primary_operations:invalid_six_size_snapshot');
   const stock={},revisions={};
   for(const row of rows){
    if(!row||!SIZES.includes(row.size)||Object.hasOwn(stock,row.size)
       ||!Number.isSafeInteger(row.quantity)||row.quantity<0
       ||!Number.isSafeInteger(row.revision)||row.revision<0)
     throw Error('primary_operations:invalid_six_size_snapshot');
    stock[row.size]=row.quantity;revisions[row.size]=row.revision;
   }
   if(SIZES.some(s=>!Object.hasOwn(stock,s)))
    throw Error('primary_operations:invalid_six_size_snapshot');
   return {stock,revisions};
  }
  function equalRows(a,b){
   const x=knownRows(a),y=knownRows(b);
   return SIZES.every(k=>x.stock[k]===y.stock[k]
    &&x.revisions[k]===y.revisions[k]);
  }
  async function verifyPrimary(){
   if(!online())throw Error('primary_operations:offline_unverified');
   const context=controller.verifiedContext();
   if(!context||!context.app||!UUID.test(context.familyId)
     ||typeof context.actorUid!=='string'||!context.actorUid)
    throw Error('primary_operations:login_required');
   const {app,familyId,actorUid}=context;
   const grant=await accessPreflight.create(app).verifyAccess({familyId,actorUid});
   if(!grant||grant.member!==true||grant.appCode!=='xb'
      ||grant.familyId!==familyId||grant.actorUid!==actorUid)
    throw Error('primary_operations:family_grant_unverified');
   const primary=await childReader.create(app,scopeGuard)
    .inspectLegacyTarget({familyId});
   if(!primary||primary.familyId!==familyId
     ||!UUID.test(primary.childId)||primary.readyForMigration!==false)
    throw Error('primary_operations:primary_scope_unverified');
   const {childId}=primary;
   const receipt=await legacyHistoryReader.create(app)
    .readSettings({familyId,childId});
   if(!receipt||receipt.complete!==true||receipt.canEdit!==false
      ||receipt.canUpload!==false)
    throw Error('primary_operations:migration_receipt_unverified');
   return {app,familyId,actorUid,childId};
  }
  async function current(){
   const validated=await verifyPrimary();
   if(selected&&(selected.familyId!==validated.familyId
      ||selected.childId!==validated.childId
      ||selected.actorUid!==validated.actorUid))
    throw Error('primary_operations:identity_or_child_changed');
   return validated;
  }
  async function authInitialized(){
   const scope=await current();
   const snap=await outbox.readInventory(scope,scope.childId);
   if(!snap||snap.source!=='verified-server'
      ||snap.familyId!==scope.familyId||snap.childId!==scope.childId
      ||snap.actorUid!==scope.actorUid)
    throw Error('primary_operations:verified_baseline_required');
   return Object.freeze({familyId:scope.familyId,actorUid:scope.actorUid,
    appCode:'xb',member:true,initialized:true});
  }
  async function activate(){
   if(busy)return result('BUSY');
   if(!online())return result('OFFLINE_READ_UNVERIFIED');
   busy=true;
   try{
    const scope=await current();
    const remote=inventoryClient.create(scope.app);
    let local=await outbox.readInventory(scope,scope.childId);
    if(!local){
     const a=await remote.readReconciliation({familyId:scope.familyId,
      childId:scope.childId,operationIds:[]});
     const b=await remote.readReconciliation({familyId:scope.familyId,
      childId:scope.childId,operationIds:[]});
     if(a.complete!==true||b.complete!==true
       ||a.actorUid!==scope.actorUid||b.actorUid!==scope.actorUid
       ||a.familyId!==scope.familyId||b.familyId!==scope.familyId
       ||a.childId!==scope.childId||b.childId!==scope.childId
       ||!equalRows(a.rows,b.rows))
      throw Error('primary_operations:server_baseline_unverified');
     const {stock,revisions}=knownRows(b.rows);
     try{
      local=await outbox.initializeInventory(scope,{
       childId:scope.childId,inventory:stock,serverRevisions:revisions,
       source:'verified-server'
      });
     }catch(e){
      if(String(e?.message)!=='outbox_store:snapshot_already_initialized')throw e;
      local=await outbox.readInventory(scope,scope.childId);
     }
    }
    if(!local||local.source!=='verified-server'
      ||local.familyId!==scope.familyId||local.actorUid!==scope.actorUid
      ||local.childId!==scope.childId)
     throw Error('primary_operations:local_baseline_unverified');
    selected={familyId:scope.familyId,actorUid:scope.actorUid,
     childId:scope.childId};
    return result('PRIMARY_OUTBOX_READ_ONLY_READY',{childId:scope.childId});
   }catch(_){selected=null;return result('PRIMARY_INITIALIZATION_UNVERIFIED');}
   finally{busy=false;}
  }
  async function read(){
   if(!selected)return result('PRIMARY_NOT_SELECTED');
   if(busy)return result('BUSY');
   busy=true;
   try{
    const scope=await current();
    const remote=inventoryClient.create(scope.app);
    const sync=syncFactory.create({
     outbox,remote,verifyAccess:authInitialized
    });
    const reconcile=await sync.reconcile({
     familyId:scope.familyId,childId:scope.childId,
     actorUid:scope.actorUid,readEnabled:true
    });
    if(!['verified-as-of-server-read','local-pending'].includes(reconcile.status))
     return result('PRIMARY_RECONCILIATION_REVIEW_REQUIRED');
    const snapshot=await outbox.readInventory(scope,scope.childId);
    if(!snapshot||snapshot.source!=='verified-server')
     return result('PRIMARY_SNAPSHOT_UNVERIFIED');
    return result(reconcile.status==='local-pending'?
     'PRIMARY_LOCAL_PENDING_NOT_CLOUD_STOCK':'PRIMARY_CLOUD_READ_VERIFIED',
     {inventory:snapshot.inventory,revisions:snapshot.serverRevisions});
   }catch(_){return result('PRIMARY_CLOUD_READ_UNVERIFIED');}
   finally{busy=false;}
  }
  async function queue(op,{operatorApproved=false}={}){
   if(cloudWritesEnabled!==true||operatorApproved!==true)
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   if(!selected)return result('PRIMARY_NOT_SELECTED');
   if(busy)return result('BUSY');
   // This first cut is ONLINE ONLY. Offline formal operations need an
   // independently reviewed UX/cutover gate; never silently enqueue them.
   if(!online())return result('OFFLINE_FORMAL_QUEUE_NOT_APPROVED');
   busy=true;
   try{
    const scope=await current();
    if(!op||!TYPES.has(op.type)||!UUID.test(op.id)
      ||op.familyId!==scope.familyId||op.actorUid!==scope.actorUid
      ||op.payload?.childId!==scope.childId)
     return result('PRIMARY_OPERATION_SCOPE_REJECTED');
    const remote=inventoryClient.create(scope.app);
    // The SAME existing replay-to-RPC translator and CloudBase validation
    // used by M1-02 verify the immutable operation prior to IDB commit.
    const runner=runnerFactory.create({outbox,remote,verifyAccess:authInitialized});
    remote.normalizeOperation(runner.toRemote(op));
    await authInitialized();
    // Prevent one device from basing a new use/stocktake on yesterday's
    // snapshot. Reuse the existing ACK-aware reconciliation just as M1-02
    // does. Pending, ambiguous, or conflicting operations block a NEW ID.
    const synchronizer=syncFactory.create({
     outbox,remote,verifyAccess:authInitialized
    });
    const refresh=await synchronizer.reconcile({familyId:scope.familyId,
     childId:scope.childId,actorUid:scope.actorUid,readEnabled:true});
    const pending=await outbox.stats(scope);
    if(refresh.status!=='verified-as-of-server-read'
       ||pending.outstanding!==0)
     return result('PRIMARY_PENDING_OR_CONFLICT_REVIEW_BEFORE_NEW_OPERATION');
    const written=await outbox.commitInventory(scope,op);
    return result(written.duplicate?
     'PRIMARY_OPERATION_ALREADY_QUEUED':'PRIMARY_OPERATION_DURABLY_QUEUED',
     {operationId:op.id,cloudWriteCommitted:false});
   }catch(_){return result('PRIMARY_LOCAL_QUEUE_UNVERIFIED');}
   finally{busy=false;}
  }
  async function flush({operatorApproved=false}={}){
   if(cloudWritesEnabled!==true||operatorApproved!==true)
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   if(!selected)return result('PRIMARY_NOT_SELECTED');
   if(!online())return result('OFFLINE_NO_UPLOAD');
   if(busy)return result('BUSY');
   busy=true;
   try{
    const scope=await current();
    await authInitialized();
    const remote=inventoryClient.create(scope.app);
    const runner=runnerFactory.create({outbox,remote,verifyAccess:authInitialized});
    const sent=await runner.flush(scope,{uploadEnabled:true,maxItems:20});
    if(!sent||['manual-review-required','permission-denied','auth-required',
      'network-or-server-failure','unsupported-pending-type']
      .includes(sent.status))
     return result('PRIMARY_UPLOAD_STOP_MANUAL_REVIEW_REQUIRED');
    // Re-read authoritative CloudBase and stored ACKs; no speculative PASS.
    const synchronizer=syncFactory.create({outbox,remote,
      verifyAccess:authInitialized});
    const matched=await synchronizer.reconcile({familyId:scope.familyId,
     childId:scope.childId,actorUid:scope.actorUid,readEnabled:true});
    const stats=await outbox.stats(scope);
    if(matched.status!=='verified-as-of-server-read'
      ||stats.outstanding!==0)
     return result('PRIMARY_ACK_OR_REVISIONS_NOT_VERIFIED');
    return result('PRIMARY_CLOUD_SYNCED_VERIFIED',{
     operationCount:sent.accepted,cloudWriteCommitted:sent.accepted>0});
   }catch(_){return result('PRIMARY_ACK_UNKNOWN_PRESERVE_ID_AND_QUEUE');}
   finally{busy=false;}
  }
  return Object.freeze({activate,read,queue,flush,
   selectedScope:()=>selected?Object.freeze({...selected}):null,
   get cloudWritesEnabled(){return cloudWritesEnabled===true;}});
 }
 const api=Object.freeze({create,PRIMARY_DB_NAME});
 if(root)root.XBPrimaryCloudOperations=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
