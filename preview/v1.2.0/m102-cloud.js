/* M1-02: real CloudBase purchase/stock bridge, isolated smoke child only.
 * DEFAULT WRITES DISABLED pending explicit owner approval + 019/020 deployment.
 * The old v1.1.2 storage key is NEVER used. SDK session is never persisted here.
 * This is not a general-purpose baseline override or legacy migration path.
 */
(function(root){
 'use strict';
 const SMOKE='__xb_smoke_v1__';
 const DB_NAME='xiaobao-v120-m102-smoke-idb-v1';
 const SIZES=['NB','S','M','L','XL','XXL'];
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const DEFAULT_WRITE_APPROVAL=false;
 function fail(code){throw Error('m102:'+code);}
 function validRows(rows){
  if(!Array.isArray(rows)||rows.length!==6)fail('inventory_incomplete');
  const qty={},rev={};
  for(const r of rows){
   if(!r||!SIZES.includes(r.size)||Object.hasOwn(qty,r.size)
      ||!Number.isSafeInteger(r.quantity)||r.quantity<0||r.quantity>100000
      ||!Number.isSafeInteger(r.revision)||r.revision<0)fail('invalid_stock');
   qty[r.size]=r.quantity;rev[r.size]=r.revision;
  }
  if(SIZES.some(x=>!Object.hasOwn(qty,x)))fail('inventory_incomplete');
  return {qty,rev};
 }
 function sameRows(a,b){
  const x=validRows(a),y=validRows(b);
  return SIZES.every(s=>x.qty[s]===y.qty[s]&&x.rev[s]===y.rev[s]);
 }
 function verifyPurchaseOnlyBaseline(rows,purchases){
  const {qty,rev}=validRows(rows);
  if(!Array.isArray(purchases)||purchases.length>50)fail('baseline_history_not_bounded');
  const counts=Object.fromEntries(SIZES.map(s=>[s,0]));
  const totals=Object.fromEntries(SIZES.map(s=>[s,0]));
  const ids=new Set();
  for(const p of purchases){
   if(!p||!UUID.test(String(p.operationId))||ids.has(p.operationId)
     ||!SIZES.includes(p.size)||!Number.isSafeInteger(p.pieces)||p.pieces<1
     ||p.reversed===true)fail('baseline_not_purchases_only');
   ids.add(p.operationId);counts[p.size]++;totals[p.size]+=p.pieces;
  }
  if(SIZES.some(s=>qty[s]!==totals[s]||rev[s]!==counts[s]))
   fail('baseline_not_purchases_only');
  return {qty,rev};
 }
 function makeOperation(q,scope,childId,clock,idFactory){
  if(!q||!SIZES.includes(q.size)||!Number.isSafeInteger(q.pieces)
    ||q.pieces<1||q.pieces>30000)fail('invalid_pieces');
  const brand=String(q.brand||'').trim(),series=String(q.series||'').trim();
  if(!brand||!series||Array.from(brand).length>120||Array.from(series).length>120
    ||/[\u0000-\u001f\u007f]/.test(brand+series))fail('invalid_purchase');
  const totalFen=Math.round(Number(q.price)*100);
  if(!Number.isSafeInteger(totalFen)||totalFen<1||totalFen>10000000
     ||!Number.isFinite(Number(q.price))||Math.abs(totalFen/100-Number(q.price))>0.000001)
   fail('invalid_purchase_cents');
  const createdAt=clock(),operationId=idFactory();
  if(!UUID.test(operationId)||!UUID.test(scope.familyId)||!UUID.test(childId)
    ||typeof scope.actorUid!=='string'||!scope.actorUid)fail('invalid_identity');
  return {
   id:operationId,type:'inventory.delta',familyId:scope.familyId,
   actorUid:scope.actorUid,createdAt,
   payload:{childId,size:q.size,kind:'buy',amount:q.pieces,occurredAt:createdAt,
    purchase:{brand,series,totalFen,purchaseDate:createdAt.slice(0,10)}}
  };
 }
 function create({host,controller,view,approvedWrites=DEFAULT_WRITE_APPROVAL}={}){
  if(!host||!controller||typeof controller.verifiedContext!=='function'
    ||!view||typeof view.status!=='function'||!host.indexedDB
    ||!host.XBDurableOutbox||!host.XBInventoryClient||!host.XBOutboxContract
    ||!host.XBInventoryProjection||!host.XBInventoryReconciler
    ||!host.XBInventoryOutboxRunner||!host.XBInventorySyncReader
    ||!host.XBCloudbaseAccessPreflight)fail('dependencies_unavailable');
  const outbox=host.XBDurableOutbox.create({
   indexedDB:host.indexedDB,contract:host.XBOutboxContract,
   projection:host.XBInventoryProjection,reconciler:host.XBInventoryReconciler,
   dbName:DB_NAME
  });
  let active=false,busy=false,context=null,snapshot=null,purchases=[],status='LOCAL_SANDBOX';
  function publish(code){
   status=code;view.status(code,{
    active,busy,canWrite:approvedWrites===true,
    pending:0,inventory:snapshot?.inventory||null
   });
   if(typeof view.render==='function')view.render();
   return code;
  }
  function identity(){
   const live=controller.verifiedContext();
   if(!live||!live.app||!live.familyId||!live.actorUid)fail('login_required');
   if(context&&(context.familyId!==live.familyId||context.actorUid!==live.actorUid))
    fail('identity_changed');
   return live;
  }
  async function smokeScope(live){
   const pre=await host.XBCloudbaseAccessPreflight.create(live.app)
     .verifyAccess({familyId:live.familyId,actorUid:live.actorUid});
   if(pre.member!==true||pre.appCode!=='xb'||pre.familyId!==live.familyId
      ||pre.actorUid!==live.actorUid)fail('grant_unverified');
   const query=await live.app.rdb().from('xb_children')
     .select('id,family_id,legacy_slot,deleted_at,revision')
     .eq('family_id',live.familyId).eq('legacy_slot',SMOKE).limit(2);
   if(!query||query.error||!Array.isArray(query.data))fail('smoke_lookup_unavailable');
   if(query.data.length!==1)fail('smoke_child_not_ready');
   const child=query.data[0];
   if(!UUID.test(String(child.id))||child.family_id!==live.familyId
     ||child.legacy_slot!==SMOKE||child.deleted_at!==null
     ||!Number.isSafeInteger(child.revision))fail('smoke_scope_invalid');
   return {familyId:live.familyId,actorUid:live.actorUid,
    app:live.app,childId:child.id};
  }
  async function authorized(scope){
   const live=identity();
   if(host.navigator&&host.navigator.onLine===false)fail('offline');
   const smoke=await smokeScope(live);
   if(smoke.childId!==scope.childId||smoke.familyId!==scope.familyId
     ||smoke.actorUid!==scope.actorUid)fail('scope_changed');
   const local=await outbox.readInventory(scope,scope.childId);
   if(!local||local.source!=='verified-server')fail('baseline_unverified');
   return {familyId:scope.familyId,actorUid:scope.actorUid,
    member:true,appCode:'xb',initialized:true};
  }
  function remote(scope){return host.XBInventoryClient.create(scope.app);}
  async function initialSnapshot(scope,client){
   const local=await outbox.readInventory(scope,scope.childId);
   if(local){
    if(local.source!=='verified-server'||local.familyId!==scope.familyId
       ||local.actorUid!==scope.actorUid||local.childId!==scope.childId)
     fail('baseline_unverified');
    return local;
   }
   if(host.navigator&&host.navigator.onLine===false)fail('offline');
   const a=await client.readReconciliation({familyId:scope.familyId,
    childId:scope.childId,operationIds:[]});
   const h=await client.readPurchases({familyId:scope.familyId,childId:scope.childId});
   const b=await client.readReconciliation({familyId:scope.familyId,
    childId:scope.childId,operationIds:[]});
   if(a.actorUid!==scope.actorUid||b.actorUid!==scope.actorUid
     ||!sameRows(a.rows,b.rows))fail('baseline_changed_during_read');
   const {qty,rev}=verifyPurchaseOnlyBaseline(b.rows,h);
   try{
    return await outbox.initializeInventory(scope,{childId:scope.childId,
     inventory:qty,serverRevisions:rev,source:'verified-server'});
   }catch(e){
    if(String(e.message)==='outbox_store:snapshot_already_initialized')
     return outbox.readInventory(scope,scope.childId);
    throw e;
   }
  }
  async function reconcile(scope,client){
   const reader=host.XBInventorySyncReader.create({
    outbox,remote:client,verifyAccess:async()=>authorized(scope)
   });
   const result=await reader.reconcile({familyId:scope.familyId,
    actorUid:scope.actorUid,childId:scope.childId,readEnabled:true});
   if(!['verified-as-of-server-read','local-pending'].includes(result.status))
    fail('reconciliation_'+result.status.replace(/[^a-z-]/g,''));
   snapshot=await outbox.readInventory(scope,scope.childId);
   purchases=await client.readPurchases({familyId:scope.familyId,childId:scope.childId});
   return result;
  }
  async function flush(scope,client){
   if(approvedWrites!==true)return {status:'not-approved'};
   if(host.navigator&&host.navigator.onLine===false)return {status:'offline'};
   const runner=host.XBInventoryOutboxRunner.create({
    outbox,remote:client,verifyAccess:async()=>authorized(scope)
   });
   return runner.flush(scope,{uploadEnabled:true,maxItems:20});
  }
  async function activate(){
   if(busy)return 'BUSY';
   if(active){active=false;context=null;snapshot=null;purchases=[];return publish('LOCAL_SANDBOX');}
   busy=true;publish('VERIFYING_SMOKE_SCOPE');
   try{
    await controller.connect();
    const live=identity();
    const scope=await smokeScope(live);
    const client=remote(scope);
    const local=await initialSnapshot(scope,client);
    if(!local||local.source!=='verified-server')fail('baseline_unverified');
    context=scope;snapshot=local;active=true;
    const checked=await reconcile(scope,client);
    return publish(checked.status==='local-pending'?'CLOUD_LOCAL_PENDING':
      approvedWrites===true?'CLOUD_SMOKE_READY':'CLOUD_SMOKE_READ_ONLY_APPROVAL_REQUIRED');
   }catch(e){
    active=false;context=null;snapshot=null;purchases=[];
    return publish(errorCode(e));
   }finally{busy=false;view.status(status,{active,busy,canWrite:approvedWrites===true,
    pending:0,inventory:snapshot?.inventory||null});}
  }
  async function refresh({retry=false}={}){
   if(!active)return publish('LOCAL_SANDBOX');
   if(busy)return 'BUSY';
   busy=true;publish('REFRESHING');
   try{
    if(host.navigator&&host.navigator.onLine===false){
     snapshot=await outbox.readInventory(context,context.childId);
     return publish('OFFLINE_PENDING_LOCAL_ONLY');
    }
    const live=identity();
    const smoke=await smokeScope(live);
    if(smoke.childId!==context.childId)fail('scope_changed');
    const client=remote(context);
    const flushed=retry?await flush(context,client):{status:'read-only'};
    if(['manual-review-required','permission-denied'].includes(flushed.status))
     return publish('CLOUD_MANUAL_REVIEW_REQUIRED');
    const outcome=await reconcile(context,client);
    const stats=await outbox.stats(context);
    if(stats.conflict||stats.blocked)return publish('CLOUD_MANUAL_REVIEW_REQUIRED');
    if(stats.outstanding)return publish('CLOUD_LOCAL_PENDING');
    if(outcome.status==='verified-as-of-server-read')
     return publish(approvedWrites===true?'CLOUD_SYNCED':'CLOUD_SMOKE_READ_ONLY_APPROVAL_REQUIRED');
    return publish('CLOUD_LOCAL_PENDING');
   }catch(e){
    if(e.message==='m102:identity_changed'||e.message==='m102:scope_changed'){
     active=false;context=null;snapshot=null;purchases=[];
    }else if(context)snapshot=await outbox.readInventory(context,context.childId).catch(()=>snapshot);
    return publish(errorCode(e));
   }finally{busy=false;view.status(status,{active,busy,canWrite:approvedWrites===true,
    pending:0,inventory:snapshot?.inventory||null});}
  }
  async function submitPurchase(q){
   if(!active)return publish('CLOUD_MODE_NOT_ACTIVE');
   if(approvedWrites!==true)return publish('CLOUD_WRITE_NOT_AUTHORIZED');
   if(busy)return publish('BUSY');
   busy=true;publish('PURCHASE_QUEUING');
   try{
    if(!context||!snapshot)fail('baseline_unverified');
    // Even offline, only an already-authenticated same-tab, smoke-scoped
    // session may stage an immutable operation in isolated IndexedDB.
    const live=identity();
    if(context.familyId!==live.familyId||context.actorUid!==live.actorUid)
     fail('identity_changed');
    const op=makeOperation(q,context,context.childId,
     ()=>new Date().toISOString(),()=>host.crypto.randomUUID());
    const saved=await outbox.commitInventory(context,op);
    snapshot=saved.snapshot;
    if(host.navigator&&host.navigator.onLine===false)
     return publish('OFFLINE_PURCHASE_QUEUED_NOT_SYNCED');
    const client=remote(context);
    const flushed=await flush(context,client);
    if(['manual-review-required','permission-denied'].includes(flushed.status))
     return publish('CLOUD_MANUAL_REVIEW_REQUIRED');
    try{
     const outcome=await reconcile(context,client);
     const stats=await outbox.stats(context);
     return publish(outcome.status==='verified-as-of-server-read'&&stats.outstanding===0
       ?'CLOUD_SYNCED':'CLOUD_LOCAL_PENDING');
    }catch(_){
     snapshot=await outbox.readInventory(context,context.childId);
     return publish('CLOUD_ACK_UNVERIFIED_RETRY_SAME_ID');
    }
   }catch(e){
    if(context)snapshot=await outbox.readInventory(context,context.childId).catch(()=>snapshot);
    return publish(errorCode(e));
   }finally{busy=false;view.status(status,{active,busy,canWrite:approvedWrites===true,
    pending:0,inventory:snapshot?.inventory||null});}
  }
  function errorCode(e){
   const m=String(e?.message||'');
   if(/^m102:[a-z_]+$/.test(m))return m.slice(5).toUpperCase();
   if(m.startsWith('outbox_store:'))return 'LOCAL_IDB_REVIEW_REQUIRED';
   if(m.startsWith('inventory_client:'))return 'PURCHASE_OR_CLOUD_REJECTED';
   return 'NETWORK_OR_STORAGE_UNVERIFIED';
  }
  function reset(){
   active=false;context=null;snapshot=null;purchases=[];
   return publish('LOCAL_SANDBOX');
  }
  return Object.freeze({
   activate,refresh,submitPurchase,reset,isActive:()=>active,
   stock:size=>active&&snapshot?snapshot.inventory[size]:null,
   spend:()=>active?purchases.filter(x=>!x.reversed).reduce((n,x)=>n+x.totalFen,0)/100:null,
   history:()=>active?purchases.slice():[],
   get status(){return status;},
   get approvedWrites(){return approvedWrites===true;}
  });
 }
 function browserStart(){
  if(!root.document||!root.XBM1Preview)return;
  const doc=root.document,$=id=>doc.getElementById(id);
  const required=['m102Mode','m102Status','m102Refresh','m102Retry','buyNow'];
  if(required.some(x=>!$(x)))return;
  const view={
   status:(code,state)=>{
    const label=state.active?(state.canWrite?'隔离云端采购模式':'隔离云端只读模式'):'本机演练模式';
    $('m102Status').textContent=label+' · '+code+
     (state.active?'。库存取自独立 IndexedDB，在线刷新后以云端为准；待同步记录不代表已入库。':
      '。本机演练记录不会进入云端。')+
     (state.canWrite?'':' 当前云端写入未获授权，购买操作不可上传。');
    $('m102Mode').textContent=state.active?'退出云端模式':'进入隔离云端模式';
    $('m102Retry').disabled=!state.active||!state.canWrite||state.busy;
    $('m102Refresh').disabled=!state.active||state.busy;
   },
   render:()=>{if(typeof root.XBM1UI?.refresh==='function')root.XBM1UI.refresh();}
  };
  let bridge;
  try{bridge=create({host:root,controller:root.XBM1Preview,view,
    approvedWrites:DEFAULT_WRITE_APPROVAL});}
  catch(_){
   $('m102Status').textContent='M1-02 模块尚未就绪，请检查测试文件与浏览器 IndexedDB。';
   return;
  }
  root.XBM102=bridge;
  $('m102Mode').addEventListener('click',()=>bridge.activate());
  $('m102Refresh').addEventListener('click',()=>bridge.refresh());
  $('m102Retry').addEventListener('click',()=>bridge.refresh({retry:true}));
  root.addEventListener('online',()=>{if(bridge.isActive())bridge.refresh({retry:true});});
  view.status('LOCAL_SANDBOX',{active:false,busy:false,canWrite:false});
 }
 const api=Object.freeze({create,makeOperation,verifyPurchaseOnlyBaseline,
  validRows,sameRows,DB_NAME,SMOKE});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root&&root.document){
  root.XBM102Module=api;
  if(root.document.readyState==='loading')
   root.document.addEventListener('DOMContentLoaded',browserStart,{once:true});
  else browserStart();
 }
})(typeof window!=='undefined'?window:null);
