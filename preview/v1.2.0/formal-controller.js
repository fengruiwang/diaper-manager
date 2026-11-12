/* Feature-only V1.2.0 formal login + five-tab cloud shell.
 * Login is separate from business UI; SDK owns tokens and refresh.
 * All business writes are DISABLED pending independent authorization.
 * Never loaded by V1.1.2, accepted M1-02 or M3 preview.
 */
(function(root){
'use strict';
const FORMAL_WRITE_ENABLED=false;
const validLogin=new Set(['CLOUD_READ_ONLY_CONNECTED','FAMILY_READY_NO_BUSINESS_CHILD','CHILD_SELECTION_REQUIRED']);
const notes={
 LOGIN_REQUIRED:'首次使用请邮箱验证码登录；后续使用 CloudBase 已保持的会话。',
 OFFLINE_LOCAL_ONLY:'当前离线，未清除登录会话。请联网后重试。',
 SESSION_UNVERIFIED:'暂时不能验证会话，请联网重试；不会自动退出。',
 PRIMARY_NOT_READY:'正式宝宝尚未创建或迁移，没有真实云端数据。',
 MIGRATION_READ_NOT_READY:'正式宝宝迁移未完成；不会显示合成数据或测试宝宝库存。',
 FAMILY_PERMISSION_DENIED:'家庭授权未通过，已隐藏业务内容。'
};
function create({host,doc,loginController,readModelFactory,primaryFactory,
 commandsFactory,actionsFactory,projection,ui,scriptLoader,
 documentsFactory=null,documentsOverlay=null,
 documentOpsFactory=null,documentCommandsFactory=null,
 batchStocktakeFactory=null}={}){
 if(!host||!doc||!loginController?.create||typeof readModelFactory!=='function'
   ||typeof primaryFactory!=='function'||!commandsFactory?.create
   ||!actionsFactory?.create||!projection?.project
   ||!ui?.show||!ui?.clear||!ui?.defaults||typeof scriptLoader!=='function')
  throw Error('formal_entry:dependencies_required');
 const $=id=>doc.getElementById(id);
 let controller=null,primary=null,attached=null,pendingGuard=null,
     documentsGuard=null,batchGuard=null;
 let actor=null,family=null,mode='boot',busy=false,revision=0;
 function screen(next,message=''){
  mode=next;doc.body.dataset.formalState=next;
  $('formalLoginCard').hidden=next!=='login';
  $('formalLoadingCard').hidden=next==='login'||next==='ready';
  $('formalGateMessage').textContent=message;
  $('formalAccountState').textContent=next;
 }
 function clear(){
  ui.clear();actor=null;family=null;primary=null;
  if(attached){attached.detach();attached=null;}
  $('formalCurrentAccount').textContent='—';
  $('formalCurrentFamily').textContent='—';
  // Per-account IndexedDB operation queues are NEVER deleted here.
 }
 function authView(){
  return {status(){},needsKey(){},identity(){},family(){},cloudStock(){}};
 }
 async function restore(){
  if(busy)return mode;
  busy=true;const token=++revision;
  screen('boot','正在恢复登录会话并重新验证家庭授权…');
  // SDK sessions are not invalidated by temporary network loss. In
  // particular, don't try to download the SDK just to classify offline.
  if(host.navigator?.onLine===false){
   clear();screen('offline',notes.OFFLINE_LOCAL_ONLY);
   busy=false;return mode;
  }
  try{
   const status=await controller.connect();
   if(token!==revision)return mode;
   if(status==='LOGIN_REQUIRED'){
    clear();screen('login',notes.LOGIN_REQUIRED);return mode;
   }
   if(status==='OFFLINE_LOCAL_ONLY'){
    clear();screen('offline',notes.OFFLINE_LOCAL_ONLY);return mode;
   }
   const ctx=controller.verifiedContext();
   if(!ctx){
    clear();screen('unverified',notes[status]||notes.SESSION_UNVERIFIED);
    return mode;
   }
   if(actor!==ctx.actorUid||family!==ctx.familyId)clear();
   const verified=await readModelFactory(ctx.app).read({
    familyId:ctx.familyId,actorUid:ctx.actorUid,limit:50
   });
   if(token!==revision)return mode;
   if(verified?.status!=='PRIMARY_READ_ONLY_READY'
     ||verified.canWrite!==false){
    clear();screen('unverified',notes[verified?.status]||
     '正式云端数据尚未核实；不显示演示数据。');
    return mode;
   }
   let data=projection.project(verified,ui.defaults());
   if(data.canWrite!==false)throw Error('formal_entry:unsafe_projection');
   // Once separately approved SQL 026 exists, A/B shared documents replace
   // the migrated read-only defaults. An unavailable RPC is NOT a local edit
   // fallback and cannot be called "sync successful".
   let documentsVerified=false,documentsClient=null;
   if(typeof documentsFactory==='function'&&documentsOverlay?.apply){
    documentsClient=documentsFactory(ctx.app);
    const snapshot=await documentsClient.readAll({
     familyId:ctx.familyId,actorUid:ctx.actorUid
    });
    if(snapshot.status==='PRIMARY_DOCUMENTS_FULLY_READ'){
     data=documentsOverlay.apply(data,snapshot);
     documentsVerified=data.sharedBusinessDocumentsVerified===true;
    }
   }
   // Primary outbox must be verified before business UI becomes visible.
   if(!primary){
    const p=primaryFactory({controller,host});
    const activation=await p.activate();
    if(activation.status!=='PRIMARY_OUTBOX_READ_ONLY_READY')
     throw Error('formal_entry:primary_outbox_unverified');
    primary=p;pendingGuard=p;
    const commands=commandsFactory.create({
     primary:p,uuid:()=>host.crypto.randomUUID(),
     clock:()=>new Date().toISOString()
    });
    if(!attached){
     let documentCommands=null;
     if(documentsClient&&typeof documentOpsFactory==='function'
       &&documentCommandsFactory?.create){
      const queue=documentOpsFactory({
       controller,host,documentsClient
      });
      documentsGuard=queue;
      documentCommands=documentCommandsFactory.create({
       client:documentsClient,queue,
       uuid:()=>host.crypto.randomUUID()
      });
     }
     if(typeof batchStocktakeFactory==='function'){
      batchGuard=batchStocktakeFactory({controller,host,primary:p});
     }
     attached=actionsFactory.create({
      primary:p,commands,documentCommands,
      batchStocktake:batchGuard,
      createBatchId:()=>host.crypto.randomUUID(),
      readDocumentInput:el=>root.XBFormalUIData.documentAction(el),
      prepareQuoteEdit:id=>root.XBFormalUIData.prepareQuoteEdit(id),
      buildAllowsWrites:FORMAL_WRITE_ENABLED,
      operatorApproved:()=>false,
      formalModeSelected:()=>mode==='ready',
      readPurchase:()=>root.XBFormalUIData.purchase(),
      readQuote:id=>root.XBFormalUIData.quote(id),
      readTransaction:id=>root.XBFormalUIData.transaction(id),
      notify:answer=>{
       $('formalSyncState').textContent='操作状态：'+
        String(answer?.status||'UNVERIFIED')+'；正式写入尚未授权。';
      }
     }).attach(doc);
    }
   }
   ui.show(data);
   actor=ctx.actorUid;family=ctx.familyId;
   const session=await ctx.app.auth.getSession();
   const email=session?.data?.user?.email||
     session?.data?.session?.user?.email;
   $('formalCurrentAccount').textContent=
    typeof email==='string'&&email?email:ctx.actorUid;
   $('formalCurrentFamily').textContent=ctx.familyId;
   screen('ready');
   $('formalSyncState').textContent=documentsVerified?
    '正式宝宝及五类共享文档已验证；本测试版本关闭云端写入。':
    '已验证正式宝宝与历史；非库存文档服务尚未部署，无法编辑或宣称双端同步。';
   return mode;
  }catch(_){
   clear();screen('unverified','家庭权限或正式宝宝数据尚未核实，未显示家庭信息。');
   return mode;
  }finally{busy=false;}
 }
 async function signOut(){
  if(busy)return 'BUSY';
  if(pendingGuard){
   const pending=await pendingGuard.pending();
   if(pending?.status!=='PRIMARY_QUEUE_COUNTS_VERIFIED'
      ||pending.outstanding>0){
    $('formalSyncState').textContent='库存待同步操作未清理；已阻止退出，保留原 ID。';
    return 'PENDING_OPERATIONS_BLOCK_SIGNOUT';
   }
  }
  if(documentsGuard){
   const docs=await documentsGuard.pending();
   if(docs?.status!=='DOCUMENT_QUEUE_COUNTS_VERIFIED'
      ||docs.outstanding>0){
    $('formalSyncState').textContent='候选价、成长或设置操作仍待同步；已阻止退出，保留原 ID。';
    return 'PENDING_DOCUMENTS_BLOCK_SIGNOUT';
   }
  }
  if(batchGuard){
   const batches=await batchGuard.pending();
   if(batches.status!=='BATCH_QUEUE_VERIFIED'||batches.outstanding>0){
    $('formalSyncState').textContent='多尺码盘点尚有待同步操作；已阻止退出，保留原批量 ID。';
    return 'PENDING_STOCKTAKE_BATCH_BLOCK_SIGNOUT';
   }
  }
  const result=await controller.signOut();
  if(result==='LOGIN_REQUIRED'){
   revision++;clear();pendingGuard=null;documentsGuard=null;batchGuard=null;
   screen('login',notes.LOGIN_REQUIRED);
  }
  return result;
 }
 async function confirmOtp(){
  const code=$('formalOtp').value.trim();$('formalOtp').value='';
  const result=await controller.confirmOtp(code);
  if(result==='OTP_INVALID_OR_EXPIRED'||result==='CONFIG_REQUIRED'){
   $('formalLoginMessage').textContent=result==='OTP_INVALID_OR_EXPIRED'?
    '验证码不正确或已过期。':'登录配置未就绪，请刷新后重试。';
   return;
  }
  // Successful OTP can lead to a verified session but a family/primary
  // that is not yet provisioned. Those are NOT invalid-login outcomes.
  // Re-check the actual SDK session and scopes rather than expecting a
  // single "CLOUD_READ_ONLY_CONNECTED" success code.
  await restore();
 }
 async function start(){
  screen('boot','正在安全恢复 CloudBase 会话…');
  controller=loginController.create({
   host,storage:null,view:authView(),scriptLoader
  });
  function on(id,fn){
   $(id).addEventListener('click',()=>{
    Promise.resolve().then(fn).catch(()=>{
     $('formalGateMessage').textContent='操作未核实，请检查网络。';
    });
   });
  }
  on('formalSendOtp',async()=>{
   const code=await controller.requestOtp($('formalEmail').value.trim());
   $('formalLoginMessage').textContent=code==='OTP_REQUESTED'?
    '验证码已发出，请查看邮箱。':'发送未确认：'+code;
  });
  on('formalConfirmOtp',confirmOtp);
  on('formalRetry',restore);
  on('formalRefresh',restore);
  on('formalSyncNow',async()=>{
   if(!FORMAL_WRITE_ENABLED){
    $('formalSyncState').textContent='正式业务写入尚未授权，未发送任何云端操作。';
    return;
   }
   if(!primary||!documentsGuard||!batchGuard)return;
   const a=await primary.flush({operatorApproved:true});
   const b=await documentsGuard.send({operatorApproved:true});
   const c=await batchGuard.send({operatorApproved:true});
   $('formalSyncState').textContent='库存：'+a.status+
    '；其他业务：'+b.status+'；盘点：'+c.status;
   if(a.status==='PRIMARY_CLOUD_SYNCED_VERIFIED'
     &&b.status==='DOCUMENT_SYNC_CONFIRMED'
     &&['BATCH_ATOMIC_COMMIT_ACKED','BATCH_ACK_RECOVERED',
      'BATCH_NO_READY_OPERATION'].includes(c.status))await restore();
  });
  on('formalSignOut',signOut);
  on('formalGateSignOut',signOut);
  host.addEventListener('online',restore);
  doc.addEventListener('visibilitychange',()=>{
   if(doc.visibilityState==='visible'&&host.navigator?.onLine!==false)
    restore();
  });
  await restore();
  return mode;
 }
 return Object.freeze({start,restore,signOut,
  get mode(){return mode;},get controller(){return controller;}});
}
function browserStart(){
 const doc=root.document,$=id=>doc.getElementById(id);
 if(!$('formalGate'))return;
 if(!root.XBM1PreviewModule||!root.XBPrimaryCloudReadModel
   ||!root.XBPrimaryCloudOperations||!root.XBPrimaryBusinessCommands
   ||!root.XBPrimaryFormalUIActions||!root.XBPrimaryUIProjection
   ||!root.XBM3UI){
   $('formalGateMessage').textContent=
    '正式入口组件未完整加载，请检查同目录脚本后刷新。未访问任何家庭数据。';
   return;
 }
 const loader=url=>new Promise((resolve,reject)=>{
  const script=doc.createElement('script');
  script.src=url;script.async=true;
  script.onload=resolve;script.onerror=()=>reject(Error('SDK_UNAVAILABLE'));
  doc.head.append(script);
 });
 const app=create({
  host:root,doc,scriptLoader:loader,
  loginController:root.XBM1PreviewModule,
  projection:root.XBPrimaryUIProjection,ui:root.XBM3UI,
  documentsFactory:app=>root.XBPrimaryDocumentsClient?.create({
   app,accessPreflight:root.XBCloudbaseAccessPreflight,
   childReader:root.XBCloudbaseChildReader,scopeGuard:root.XBChildScopeGuard,
   cloudWritesEnabled:FORMAL_WRITE_ENABLED
  }),
  documentsOverlay:root.XBPrimaryDocumentsOverlay,
  documentOpsFactory:({controller,host,documentsClient})=>
   root.XBPrimaryDocumentsOperations.create({
    controller,host,documentsClient,
    outboxFactory:root.XBDurableOutbox,
    contract:root.XBOutboxContract,
    cloudWritesEnabled:FORMAL_WRITE_ENABLED
   }),
  documentCommandsFactory:root.XBPrimaryDocumentsBusinessCommands,
  batchStocktakeFactory:({controller,host,primary})=>
   root.XBPrimaryStocktakeBatchClient.create({
    controller,host,primary,
    outboxFactory:root.XBDurableOutbox,
    contract:root.XBOutboxContract,
    cloudWritesEnabled:FORMAL_WRITE_ENABLED
   }),
  readModelFactory:cloud=>root.XBPrimaryCloudReadModel.create({
   app:cloud,childReader:root.XBCloudbaseChildReader,
   scopeGuard:root.XBChildScopeGuard,
   accessPreflight:root.XBCloudbaseAccessPreflight,
   inventoryClient:root.XBInventoryClient,
   legacyHistoryReader:root.XBLegacyHistoryReader
  }),
  primaryFactory:({controller,host})=>root.XBPrimaryCloudOperations.create({
   controller,host,
   accessPreflight:root.XBCloudbaseAccessPreflight,
   childReader:root.XBCloudbaseChildReader,
   scopeGuard:root.XBChildScopeGuard,
   legacyHistoryReader:root.XBLegacyHistoryReader,
   inventoryClient:root.XBInventoryClient,
   outboxFactory:root.XBDurableOutbox,
   outboxContract:root.XBOutboxContract,
   inventoryProjection:root.XBInventoryProjection,
   inventoryReconciler:root.XBInventoryReconciler,
   runnerFactory:root.XBInventoryOutboxRunner,
   syncFactory:root.XBInventorySyncReader,
   cloudWritesEnabled:FORMAL_WRITE_ENABLED
  }),
  commandsFactory:root.XBPrimaryBusinessCommands,
  actionsFactory:root.XBPrimaryFormalUIActions
 });
 root.XBFormalApp=app;app.start();
}
const api=Object.freeze({create,FORMAL_WRITE_ENABLED});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(root?.document){
 root.XBFormalAppModule=api;
 if(root.document.readyState==='loading')
  root.document.addEventListener('DOMContentLoaded',browserStart,{once:true});
 else browserStart();
}
})(typeof window!=='undefined'?window:null);
