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
  cloudWritesEnabled=false,purchaseOnly=false,allowConsume=false,
  allowReverse=false,allowStocktake=false}={}){
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
  const freshPurchaseIds=new Set(),freshConsumeIds=new Set(),
   freshReverseIds=new Set(),freshStocktakeIds=new Set();
  const online=()=>host?.navigator?.onLine!==false;
  function knownRows(rows){
   if(!Array.isArray(rows)||rows.length!==6)
    throw Error('primary_operations:invalid_six_size_snapshot');
   const stock={},revisions={};
   for(const row of rows){
    if(!row||!SIZES.includes(row.size)||Object.prototype.hasOwnProperty.call(stock,row.size)
       ||!Number.isSafeInteger(row.quantity)||row.quantity<0
       ||!Number.isSafeInteger(row.revision)||row.revision<0)
     throw Error('primary_operations:invalid_six_size_snapshot');
    stock[row.size]=row.quantity;revisions[row.size]=row.revision;
   }
   if(SIZES.some(s=>!Object.prototype.hasOwnProperty.call(stock,s)))
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
  function verifiedReadScope(view){
   if(view?.status!=='PRIMARY_READ_ONLY_READY'
     ||view.source!=='cloudbase-primary-receipt-verified'
     ||view.canWrite!==false||view.legacyPurchasesAppliedToInventory!==false
     ||view.legacyHistory?.complete!==true)
    throw Error('primary_operations:untrusted_view');
   const ctx=controller.verifiedContext();
   if(!ctx?.app||!UUID.test(ctx.familyId)||!ctx.actorUid
     ||view.familyId!==ctx.familyId||view.actorUid!==ctx.actorUid
     ||!UUID.test(view.childId))
    throw Error('primary_operations:read_scope_mismatch');
   const rows=SIZES.map(size=>({size,quantity:view.inventory?.[size],
    revision:view.revisions?.[size]}));
   return {scope:{app:ctx.app,familyId:ctx.familyId,
    actorUid:ctx.actorUid,childId:view.childId},stock:knownRows(rows)};
  }
  function verifiedScope(view){
   // The startup shortcut remains limited to the read-only activation path.
   if(cloudWritesEnabled===true)
    throw Error('primary_operations:untrusted_view');
   return verifiedReadScope(view);
  }
  // P2-02A: read ONLY the pre-existing, actor/child-keyed IDB baseline.
  // The currently active primary is verified from CloudBase; no last-used
  // child pointer, token copy, localStorage or optimistic queue is trusted.
  async function lastConfirmedInventory(){
   if(!online())return null;
   try{
    const ctx=controller.verifiedContext();
    if(!ctx?.app||!UUID.test(String(ctx.familyId))
      ||typeof ctx.actorUid!=='string'||!ctx.actorUid)return null;
    const target=await childReader.create(ctx.app,scopeGuard)
     .inspectLegacyTarget({familyId:ctx.familyId});
    if(!target||target.familyId!==ctx.familyId
      ||!UUID.test(String(target.childId))
      ||target.readyForMigration!==false)return null;
    const current=controller.verifiedContext();
    if(current?.app!==ctx.app||current?.familyId!==ctx.familyId
      ||current?.actorUid!==ctx.actorUid)return null;
    const scope={familyId:ctx.familyId,actorUid:ctx.actorUid};
    const [snapshot,queue]=await Promise.all([
     outbox.readInventory(scope,target.childId),outbox.stats(scope)
    ]);
    // An ordinary 009 enqueue can mutate the verified-server IDB snapshot
    // speculatively. Never label that local projection a confirmed stock.
    if(queue?.outstanding!==0||!Number.isSafeInteger(queue.total)
      ||queue.total<0||snapshot?.source!=='verified-server'
      ||snapshot.familyId!==scope.familyId
      ||snapshot.actorUid!==scope.actorUid
      ||snapshot.childId!==target.childId
      ||!snapshot.inventory||!snapshot.serverRevisions
      ||!SIZES.every(size=>Number.isSafeInteger(snapshot.inventory[size])
        &&snapshot.inventory[size]>=0&&snapshot.inventory[size]<=100000
        &&Number.isSafeInteger(snapshot.serverRevisions[size])
        &&snapshot.serverRevisions[size]>=0))return null;
    const after=controller.verifiedContext();
    if(after?.app!==ctx.app||after?.familyId!==scope.familyId
      ||after?.actorUid!==scope.actorUid||!online())return null;
    return Object.freeze({status:'PRIMARY_LAST_CONFIRMED_INVENTORY',
     familyId:scope.familyId,actorUid:scope.actorUid,childId:target.childId,
     inventory:Object.freeze(Object.fromEntries(SIZES.map(size=>
      [size,snapshot.inventory[size]]))),
     revisions:Object.freeze(Object.fromEntries(SIZES.map(size=>
      [size,snapshot.serverRevisions[size]])))});
   }catch(_){return null;}
  }
  async function activate({verifiedReadModel=null}={}){
   if(busy)return result('BUSY');
   if(!online())return result('OFFLINE_READ_UNVERIFIED');
   busy=true;
   try{
    const trusted=verifiedReadModel===null?null:verifiedScope(verifiedReadModel);
    const scope=trusted?trusted.scope:await current();
    let local=await outbox.readInventory(scope,scope.childId);
    if(!local){
     let baseline=trusted?.stock||null;
     if(!baseline){
      const remote=inventoryClient.create(scope.app);
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
     baseline=knownRows(b.rows);
     }
     const {stock,revisions}=baseline;
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
   }catch(_){selected=null;freshPurchaseIds.clear();freshConsumeIds.clear();freshReverseIds.clear();freshStocktakeIds.clear();return result('PRIMARY_INITIALIZATION_UNVERIFIED');}
   finally{busy=false;}
  }
  // A successful formal primary read is also the source for the local
  // 009 baseline. This is IDB-only: no reconciliation RPC or second restore.
  async function syncVerifiedReadModel({verifiedReadModel=null,batchQueue=null}={}){
   if(!selected)return result('PRIMARY_NOT_SELECTED');
   if(busy)return result('BUSY');
   if(!online())return result('OFFLINE_READ_UNVERIFIED');
   busy=true;
   try{
    const trusted=verifiedReadScope(verifiedReadModel);
    const scope=trusted.scope,{stock}=trusted;
    if(selected.familyId!==scope.familyId||selected.actorUid!==scope.actorUid
      ||selected.childId!==scope.childId)
     return result('PRIMARY_LOCAL_BASELINE_SCOPE_MISMATCH');
    if(!batchQueue||batchQueue.status!=='BATCH_QUEUE_VERIFIED'
      ||!Number.isSafeInteger(batchQueue.outstanding)
      ||batchQueue.outstanding<0)
     return result('PRIMARY_LOCAL_BASELINE_BATCH_QUEUE_UNVERIFIED');
    if(batchQueue.outstanding>0)
     return result('PRIMARY_LOCAL_BASELINE_BATCH_PENDING',{
      outstanding:batchQueue.outstanding
     });
    const current=controller.verifiedContext();
    if(!current||current.familyId!==scope.familyId
      ||current.actorUid!==scope.actorUid||!current.app)
     return result('PRIMARY_LOCAL_BASELINE_SCOPE_MISMATCH');
    let local=await outbox.readInventory(scope,scope.childId);
    if(!local){
     try{
      local=await outbox.initializeInventory(scope,{
       childId:scope.childId,inventory:stock.stock,
       serverRevisions:stock.revisions,source:'verified-server'
      });
     }catch(e){
      if(String(e?.message)==='outbox_store:queue_exists_before_baseline')
       return result('PRIMARY_LOCAL_BASELINE_PENDING_OPERATIONS');
      if(String(e?.message)!=='outbox_store:snapshot_already_initialized')
       throw e;
      local=await outbox.readInventory(scope,scope.childId);
     }
     if(!local||local.source!=='verified-server'
       ||local.familyId!==scope.familyId||local.actorUid!==scope.actorUid
       ||local.childId!==scope.childId
       ||!equalRows(SIZES.map(size=>({size,quantity:local.inventory?.[size],
        revision:local.serverRevisions?.[size]})),
       SIZES.map(size=>({size,quantity:stock.stock[size],
        revision:stock.revisions[size]}))))
      return result('PRIMARY_LOCAL_BASELINE_UNVERIFIED');
    }else{
     if(typeof outbox.updateVerifiedInventory!=='function')
      return result('PRIMARY_LOCAL_BASELINE_UNVERIFIED');
     const applied=await outbox.updateVerifiedInventory(scope,{
      childId:scope.childId,inventory:stock.stock,
      serverRevisions:stock.revisions
     });
     if(applied?.status==='LOCAL_OPERATIONS_PENDING')
      return result('PRIMARY_LOCAL_BASELINE_PENDING_OPERATIONS',{
       outstanding:applied.outstanding||0
      });
     if(applied?.status==='SERVER_REVISION_ROLLBACK')
      return result('PRIMARY_LOCAL_BASELINE_SERVER_REVISION_ROLLBACK',{
       sizes:applied.sizes||[]
      });
     if(applied?.status==='SERVER_REVISION_QUANTITY_MISMATCH')
      return result('PRIMARY_LOCAL_BASELINE_REVISION_QUANTITY_MISMATCH',{
       sizes:applied.sizes||[]
      });
     if(!['UPDATED','UNCHANGED'].includes(applied?.status)
       ||!applied.snapshot||applied.snapshot.source!=='verified-server'
       ||applied.snapshot.familyId!==scope.familyId
       ||applied.snapshot.actorUid!==scope.actorUid
       ||applied.snapshot.childId!==scope.childId)
      return result('PRIMARY_LOCAL_BASELINE_UNVERIFIED');
     local=applied.snapshot;
    }
    const latest=controller.verifiedContext();
    if(!latest||latest.familyId!==scope.familyId
      ||latest.actorUid!==scope.actorUid
      ||selected.familyId!==scope.familyId
      ||selected.actorUid!==scope.actorUid
      ||selected.childId!==scope.childId)
     return result('PRIMARY_LOCAL_BASELINE_SCOPE_CHANGED');
    return result('PRIMARY_LOCAL_BASELINE_SYNCED',{
     childId:scope.childId,inventory:local.inventory,
     revisions:local.serverRevisions
    });
   }catch(_){return result('PRIMARY_LOCAL_BASELINE_UNVERIFIED');}
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
  async function queue(op,{operatorApproved=false,
    verifiedPurchaseBaseline=null,verifiedConsumeBaseline=null,
    verifiedReverseBaseline=null,verifiedStocktakeBaseline=null}={}){
   if(cloudWritesEnabled!==true||operatorApproved!==true)
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   if(!selected)return result('PRIMARY_NOT_SELECTED');
   if(busy)return result('BUSY');
   // This first cut is ONLINE ONLY. Offline formal operations need an
   // independently reviewed UX/cutover gate; never silently enqueue them.
   if(!online())return result('OFFLINE_FORMAL_QUEUE_NOT_APPROVED');
   busy=true;
   try{
    const ctx=controller.verifiedContext();
    const kind=op?.type==='transaction.reverse'?'reverse':
     op?.type==='inventory.count'?'stocktake':op?.payload?.kind;
    const baseline=kind==='stocktake'?verifiedStocktakeBaseline:
     kind==='reverse'?verifiedReverseBaseline:
     kind==='use'?verifiedConsumeBaseline:verifiedPurchaseBaseline;
    const fast=((op?.type==='inventory.delta'&&['buy','use'].includes(kind))
       ||(op?.type==='transaction.reverse'&&kind==='reverse')
       ||(op?.type==='inventory.count'&&kind==='stocktake'&&op.payload?.kind!=='stocktake_batch'))
      &&(kind==='buy'||(kind==='use'&&allowConsume===true)
       ||(kind==='reverse'&&allowReverse===true)
       ||(kind==='stocktake'&&allowStocktake===true))
      &&baseline?.status===(kind==='buy'
       ?'PRIMARY_PURCHASE_BASELINE_VERIFIED':kind==='use'
        ?'PRIMARY_CONSUME_BASELINE_VERIFIED':kind==='stocktake'
        ?'PRIMARY_STOCKTAKE_BASELINE_VERIFIED':'PRIMARY_REVERSE_BASELINE_VERIFIED')
      &&(kind!=='stocktake'||(op.expectedRevision===baseline.revisions?.[op.payload.size]
       &&Number.isSafeInteger(op.payload.count)&&op.payload.count>=0
       &&op.payload.count<=100000))
      &&(kind!=='reverse'||(baseline.originalId===op.payload.reversesOperationId
        &&baseline.originalSize===op.payload.size))
      &&selected&&ctx?.app
      &&selected.familyId===ctx.familyId&&selected.actorUid===ctx.actorUid
      &&selected.childId===baseline.childId
      &&baseline.familyId===selected.familyId
      &&baseline.actorUid===selected.actorUid;
    const scope=fast?{app:ctx.app,...selected}:await current();
    if(purchaseOnly===true
      &&!(op?.type==='inventory.delta'
       &&(op?.payload?.kind==='buy'
         ||(allowConsume===true&&op?.payload?.kind==='use')))
      &&!(allowReverse===true&&op?.type==='transaction.reverse')
      &&!(allowStocktake===true&&op?.type==='inventory.count'))
     return result('FORMAL_PURCHASE_ONLY');
    if(!op||!TYPES.has(op.type)||!UUID.test(op.id)
      ||op.familyId!==scope.familyId||op.actorUid!==scope.actorUid
      ||op.payload?.childId!==scope.childId)
     return result('PRIMARY_OPERATION_SCOPE_REJECTED');
    const remote=inventoryClient.create(scope.app);
    // The SAME existing replay-to-RPC translator and CloudBase validation
    // used by M1-02 verify the immutable operation prior to IDB commit.
    const runner=runnerFactory.create({outbox,remote,verifyAccess:authInitialized});
    remote.normalizeOperation(runner.toRemote(op));
    if(fast){
     const [pending,snapshot]=await Promise.all([
      outbox.stats(scope),outbox.readInventory(scope,scope.childId)
     ]);
     if(pending.outstanding!==0||!snapshot
       ||snapshot.source!=='verified-server'
       ||snapshot.familyId!==scope.familyId||snapshot.actorUid!==scope.actorUid
       ||snapshot.childId!==scope.childId
       ||!SIZES.every(size=>Number.isSafeInteger(
        baseline.inventory[size])
        &&snapshot.inventory?.[size]===baseline.inventory[size]))
      return result('PRIMARY_PENDING_OR_CONFLICT_REVIEW_BEFORE_NEW_OPERATION');
     // The cloud-visible original may come from another device and not be
     // present in this device's optimistic IDB transaction projection.
     // Reverse is therefore queued durably without mutating stock until ACK.
     if(kind==='reverse'||kind==='stocktake'){
      const written=await outbox.enqueue(op);
      const created=written?.id===op.id&&written.status==='pending';
      if(created)(kind==='reverse'?freshReverseIds:freshStocktakeIds).add(op.id);
      return result(created?'PRIMARY_OPERATION_DURABLY_QUEUED':
       'PRIMARY_OPERATION_ALREADY_QUEUED',{
        operationId:op.id,fastReverse:kind==='reverse'&&created,
        fastStocktake:kind==='stocktake'&&created
       });
     }
     const written=await outbox.commitInventory(scope,op);
     if(written.duplicate!==true)
      (kind==='buy'?freshPurchaseIds:freshConsumeIds).add(op.id);
     return result(written.duplicate?'PRIMARY_OPERATION_ALREADY_QUEUED':
       'PRIMARY_OPERATION_DURABLY_QUEUED',{
        operationId:op.id,fastPurchase:kind==='buy'&&!written.duplicate,
        fastConsume:kind==='use'&&!written.duplicate
       });
    }
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
  async function flush({operatorApproved=false,fastPurchaseId=null,fastConsumeId=null,fastReverseId=null,fastStocktakeId=null}={}){
   if(cloudWritesEnabled!==true||operatorApproved!==true)
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   if(!selected)return result('PRIMARY_NOT_SELECTED');
   if(!online())return result('OFFLINE_NO_UPLOAD');
   if(busy)return result('BUSY');
   busy=true;
   try{
    const ctx=controller.verifiedContext();
    const fastId=fastStocktakeId??fastReverseId??fastConsumeId??fastPurchaseId;
    const stocktake=fastStocktakeId!==null,reverse=!stocktake&&fastReverseId!==null,
     consume=!stocktake&&!reverse&&fastConsumeId!==null;
    const freshIds=stocktake?freshStocktakeIds:reverse?freshReverseIds:
     consume?freshConsumeIds:freshPurchaseIds;
    const fast=typeof fastId==='string'&&freshIds.has(fastId)
      &&selected&&ctx?.app&&selected.familyId===ctx.familyId
      &&selected.actorUid===ctx.actorUid
      &&(stocktake?allowStocktake===true:reverse?allowReverse===true:
       !consume||allowConsume===true);
    if(fastId!==null&&!fast)
     return result('PRIMARY_PENDING_OR_CONFLICT_REVIEW_BEFORE_NEW_OPERATION',
      {operationId:fastId});
    const scope=fast?{app:ctx.app,...selected}:await current();
    if(!fast)await authInitialized();
    const remote=inventoryClient.create(scope.app);
    const runner=runnerFactory.create({outbox,remote,verifyAccess:authInitialized});
    if(fast)freshIds.delete(fastId);
    const sent=await runner.flush(scope,{uploadEnabled:true,maxItems:20,
     purchaseOnly:purchaseOnly===true,allowConsume:allowConsume===true,
     allowReverse:allowReverse===true,allowStocktake:allowStocktake===true,
     fastPurchaseId:fast&&!consume&&!reverse&&!stocktake?fastId:null,
     fastConsumeId:fast&&consume?fastId:null,
     fastReverseId:fast&&reverse?fastId:null,
     fastStocktakeId:fast&&stocktake?fastId:null});
    if(fast){
     const prefix=stocktake?'PRIMARY_STOCKTAKE':reverse?'PRIMARY_REVERSE':
      consume?'PRIMARY_USE':'PRIMARY_PURCHASE';
     const receiptPrefix=stocktake?'stocktake':reverse?'reverse':consume?'consume':'purchase';
     if(sent?.status===receiptPrefix+'-ack-confirmed'
       &&sent.receipt?.duplicate!==true)
      return result(prefix+'_ACK_CONFIRMED',{
       operationId:fastId,operation:sent.operation,
       receipt:sent.receipt,cloudWriteCommitted:true,
       familyId:scope.familyId,actorUid:scope.actorUid,
       childId:scope.childId
      });
     if(stocktake&&sent?.status==='stocktake-rejected')
      return result('PRIMARY_STOCK_REVISION_CONFLICT',{
       operationId:fastId,cloudWriteCommitted:false,rejected:true
      });
     if(reverse&&sent?.status==='reverse-rejected')
      return result('PRIMARY_REVERSE_SERVER_REJECTED',{
       operationId:fastId,cloudWriteCommitted:false,rejected:true
      });
     return result(sent?.status===receiptPrefix+'-ack-recovered'
       ?prefix+'_ACK_RECOVERED_NEEDS_REFRESH':
       'PRIMARY_ACK_UNKNOWN_PRESERVE_ID_AND_QUEUE',
       {operationId:fastId});
    }
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
  // A verified 027 batch ACK updates only the 009 local stock baseline.
  async function applyBatchInventoryAck({batchId,changes}={}){
   if(!selected||busy||!Array.isArray(changes)
     ||typeof outbox.applyVerifiedBatchInventory!=='function')
    return result('BATCH_LOCAL_SNAPSHOT_UNVERIFIED');
   const ctx=controller.verifiedContext();
   if(!ctx||ctx.familyId!==selected.familyId
     ||ctx.actorUid!==selected.actorUid||!ctx.app)
    return result('BATCH_LOCAL_SNAPSHOT_UNVERIFIED');
   try{
    const snap=await outbox.applyVerifiedBatchInventory(selected,{
     childId:selected.childId,changes
    });
    return result('BATCH_LOCAL_SNAPSHOT_ACK_APPLIED',{
     batchId,childId:selected.childId,
     familyId:selected.familyId,actorUid:selected.actorUid,
     inventory:snap.inventory,revisions:snap.serverRevisions
    });
   }catch(_){return result('BATCH_LOCAL_SNAPSHOT_UNVERIFIED',{batchId});}
  }
  async function pending(){
   // Do not let a new 027 batch begin while the local baseline transaction
   // is active. The batch client checks this existing queue-status contract.
   if(busy)return result('PRIMARY_QUEUE_COUNTS_UNVERIFIED');
   // Explicit local IDB-only check. Do not erase or upload pending events
   // merely because a user requested logout or a different account signed in.
   if(!selected)return result('PRIMARY_QUEUE_SCOPE_NOT_VERIFIED');
   try{
    const scope={familyId:selected.familyId,actorUid:selected.actorUid};
    const count=await outbox.stats(scope);
    if(!count||!Number.isSafeInteger(count.outstanding)
      ||count.outstanding<0||!Number.isSafeInteger(count.total)
      ||count.total<count.outstanding)
     return result('PRIMARY_QUEUE_COUNTS_UNVERIFIED');
    return result('PRIMARY_QUEUE_COUNTS_VERIFIED',{
     outstanding:count.outstanding,pending:count.pending,
     retry:count.retry,conflict:count.conflict,blocked:count.blocked
    });
   }catch(_){return result('PRIMARY_QUEUE_COUNTS_UNVERIFIED');}
  }
  return Object.freeze({activate,read,lastConfirmedInventory,syncVerifiedReadModel,queue,flush,pending,applyBatchInventoryAck,
   selectedScope:()=>selected?Object.freeze({...selected}):null,
   get cloudWritesEnabled(){return cloudWritesEnabled===true;}});
 }
 const api=Object.freeze({create,PRIMARY_DB_NAME});
 if(root)root.XBPrimaryCloudOperations=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
