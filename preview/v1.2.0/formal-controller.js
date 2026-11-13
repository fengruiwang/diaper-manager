/* Feature-only V1.2.0 formal login + five-tab cloud shell.
 * Login is separate from business UI; SDK owns tokens and refresh.
 * All business writes are DISABLED pending independent authorization.
 * Never loaded by V1.1.2, accepted M1-02 or M3 preview.
 */
(function(root){
'use strict';
const FORMAL_WRITE_ENABLED=false;
// Purchase release is prepared but OFF until separate operator authorization.
const FORMAL_PURCHASE_ENABLED=false;
const SIZES=['NB','S','M','L','XL','XXL'];
const OTP_COOLDOWN_MS=60000;
const OTP_STORAGE_KEY='xiaobao_v120_formal_otp_resend_until';
const validLogin=new Set(['CLOUD_READ_ONLY_CONNECTED','FAMILY_READY_NO_BUSINESS_CHILD','CHILD_SELECTION_REQUIRED','FORMAL_FAMILY_VERIFIED']);
const notes={
 LOGIN_REQUIRED:'首次使用请邮箱验证码登录；后续使用 CloudBase 已保持的会话。',
 OFFLINE_LOCAL_ONLY:'当前离线，未清除登录会话。请联网后重试。',
 SESSION_UNVERIFIED:'暂时不能验证会话，请联网重试；不会自动退出。',
 CONNECT_FAILED:'云端连接暂时失败，请检查网络后重新检查。不会自动退出登录。',
 CLOUD_READ_UNVERIFIED:'暂时无法核验家庭权限或云端数据，请稍后重新检查。',
 NO_VISIBLE_FAMILY:'当前账号尚未关联可访问的家庭，请核实家庭授权。',
 FAMILY_REVIEW_REQUIRED:'发现多个家庭或家庭信息未核实，需要重新检查权限。',
 CHILD_SELECTION_REQUIRED:'家庭已登录，但正式宝宝作用域尚未准备好。',
 FAMILY_READY_NO_BUSINESS_CHILD:'家庭已登录，但正式宝宝尚未创建或迁移。',
 PRIMARY_NOT_READY:'正式宝宝数据尚未准备好。登录状态已确认，但正式宝宝尚未创建或完成历史迁移。',
 MIGRATION_READ_NOT_READY:'正式宝宝迁移未完成；不会显示合成数据或测试宝宝库存。',
 FAMILY_PERMISSION_DENIED:'家庭授权未通过，已隐藏业务内容。'
};
function create({host,doc,loginController,readModelFactory,primaryFactory,
 commandsFactory,actionsFactory,projection,ui,scriptLoader,
 documentsFactory=null,documentsOverlay=null,
 documentOpsFactory=null,documentCommandsFactory=null,
 batchStocktakeFactory=null,
 purchaseReleaseEnabled=FORMAL_PURCHASE_ENABLED,
 purchaseOperatorApproved=()=>false}={}){
 if(!host||!doc||!loginController?.create||typeof readModelFactory!=='function'
   ||typeof primaryFactory!=='function'||!commandsFactory?.create
   ||!actionsFactory?.create||!projection?.project
   ||!ui?.show||!ui?.clear||!ui?.defaults||typeof scriptLoader!=='function')
  throw Error('formal_entry:dependencies_required');
 const $=id=>doc.getElementById(id);
 let controller=null,primary=null,attached=null,pendingGuard=null,
     documentsGuard=null,batchGuard=null;
 let actor=null,family=null,mode='boot',busy=false,revision=0;
 let shownStock=null;
 let otpSending=false,otpConfirming=false,otpExpiresAt=0,otpTimer=null,otpSentBefore=false,
     otpFailure='';
 // Optional documents never gate primary readiness; scope is account-specific.
 let documentSnapshot=null,documentScope='',documentAttempt='',documentPending='';
 let documentEpoch=0;
 const now=()=>typeof host.Date?.now==='function'?host.Date.now():Date.now();
 function restoreOtpCooldown(){
  try{
   const raw=host.localStorage?.getItem(OTP_STORAGE_KEY);
   const n=Number(raw);
   if(raw&&Number.isSafeInteger(n)&&n>now()
     &&n<=now()+OTP_COOLDOWN_MS+2000){
    otpExpiresAt=n;otpSentBefore=true;
   }
  }catch(_){/* only saves resend expiry, never tokens or email */}
 }
 function redrawOtpButton(){
  const button=$('formalSendOtp'),left=Math.ceil((otpExpiresAt-now())/1000);
  if(left>0){
   button.disabled=true;button.textContent=left+' 秒后重新发送';
   return;
  }
  if(otpExpiresAt){
   otpExpiresAt=0;otpSentBefore=true;
   try{host.localStorage?.removeItem(OTP_STORAGE_KEY);}catch(_){}
  }
  button.disabled=otpSending;
  button.textContent=otpSending?'发送中…':
   otpSentBefore?'重新发送验证码':'发送验证码';
  if(otpTimer!==null&&typeof host.clearInterval==='function'){
   host.clearInterval(otpTimer);otpTimer=null;
  }
 }
 function redrawConfirmButton(){
  const b=$('formalConfirmOtp');
  b.disabled=otpConfirming;
  b.textContent=otpConfirming?'正在验证，请稍候…':'登录并进入小宝管家';
 }
 function startOtpTicker(){
  redrawOtpButton();
  if(otpTimer===null&&otpExpiresAt>now()
    &&typeof host.setInterval==='function'){
   otpTimer=host.setInterval(redrawOtpButton,1000);
  }
 }
 async function sendOtp(){
  // Busy/cooldown checks happen before calling the CloudBase SDK.
  if(otpSending||otpExpiresAt>now())return 'OTP_REQUEST_BLOCKED';
  otpSending=true;otpFailure='';
  $('formalLoginMessage').textContent='正在向邮箱发送验证码…';
  redrawOtpButton();
  let code='OTP_REQUEST_FAILED';
  try{
   code=await controller.requestOtp($('formalEmail').value.trim());
   if(code==='OTP_REQUESTED'){
    otpSentBefore=true;otpExpiresAt=now()+OTP_COOLDOWN_MS;
    try{host.localStorage?.setItem(OTP_STORAGE_KEY,
     String(otpExpiresAt));}catch(_){}
    $('formalLoginMessage').textContent=
     '验证码发送成功，请检查邮箱（包括垃圾邮件）。60 秒后可重新发送。';
   }else{
    // Server rate-limit verdict always takes precedence over local timer.
    $('formalLoginMessage').textContent=
     otpFailure==='family_client: rate_limited'?
      '发送过于频繁，服务器已限制请求，请稍后重试。':
     code==='EMAIL_REQUIRED'?'请输入有效的邮箱地址。':
     code==='CONFIG_REQUIRED'?'登录配置暂不可用，请刷新后重试。':
     code==='OTP_REQUEST_FAILED'?
      '验证码发送失败，请检查网络和邮箱地址后再试。':
      '验证码未发送成功：'+code;
   }
  }catch(_){
   $('formalLoginMessage').textContent=
    '验证码发送请求未完成，请检查网络后再试。';
  }finally{
   otpSending=false;startOtpTicker();
  }
  return code;
 }
 function screen(next,message=''){
  mode=next;doc.body.dataset.formalState=next;
  $('formalLoginCard').hidden=next!=='login';
  $('formalLoadingCard').hidden=next!=='boot';
  $('formalGateActions').hidden=next==='boot'||next==='login'||next==='ready';
  $('formalGateMessage').textContent=message;
  $('formalAccountState').textContent=next;
 }
 function clear(){
  ui.clear();actor=null;family=null;primary=null;shownStock=null;
  pendingGuard=null;documentsGuard=null;batchGuard=null;
  documentSnapshot=null;documentScope='';documentAttempt='';documentPending='';
  documentEpoch++;
  if(attached){attached.detach();attached=null;}
  $('formalCurrentAccount').textContent='—';
  $('formalCurrentFamily').textContent='—';
  // Per-account IndexedDB operation queues are NEVER deleted here.
 }
 function authView(){
  return {status(code,detail){if(code==='OTP_REQUEST_FAILED')otpFailure=detail||'';},needsKey(){},identity(){},family(){},cloudStock(){}};
 }
 // Bound each critical await. Late responses cannot re-enter the UI after timeout.
 async function bounded(task,millis){
  let timer;
  const expire=new Promise((_,reject)=>{
   timer=(host.setTimeout||setTimeout)(()=>{
    reject(Error('formal_entry:read_timeout'));
   },millis);
  });
  try{return await Promise.race([Promise.resolve().then(task),expire]);}
  finally{(host.clearTimeout||clearTimeout)(timer);}
 }
 function optionalRead(client,ctx,scopeKey,base,epoch){
  if(!client||typeof client.readAll!=='function'
    ||documentPending===scopeKey||documentAttempt===scopeKey)return;
  documentPending=scopeKey;documentAttempt=scopeKey;
  // Do not await: documents are not a prerequisite for the receipt-backed
  // primary inventory and historical read-only UI.
  void bounded(()=>client.readAll({
   familyId:ctx.familyId,actorUid:ctx.actorUid
  }),12000).then(snapshot=>{
   if(epoch!==documentEpoch||mode!=='ready'||actor!==ctx.actorUid
     ||family!==ctx.familyId||snapshot?.status!=='PRIMARY_DOCUMENTS_FULLY_READ')
    return;
   const merged=documentsOverlay.apply(base,snapshot);
   if(merged?.canWrite!==false||merged.sharedBusinessDocumentsVerified!==true)
    return;
   documentSnapshot=snapshot;documentScope=scopeKey;
   ui.show(merged);
   $('formalSyncState').textContent=
    '正式宝宝及五类共享文档已验证；本测试版本关闭云端写入。';
  }).catch(()=>{
   // A failed optional read must not hide or sign out a verified primary.
  }).finally(()=>{
   if(documentPending===scopeKey)documentPending='';
  });
 }
 async function restore({verifiedStatus=null,expectedPurchaseId=null,expectedUseId=null,
  expectedReverseId=null,expectedOriginalId=null,expectedStocktake=null}={}){
  if(busy)return mode;
  busy=true;const token=++revision;
  // Retain the verified same-account view during visibility/online rechecks.
  // A real identity, permission or primary failure still clears it below.
  if(mode!=='ready'&&mode!=='boot')screen('boot','正在打开小宝管家…');
  if(host.navigator?.onLine===false){
   clear();screen('offline',notes.OFFLINE_LOCAL_ONLY);
   busy=false;return mode;
  }
  try{
   // Reuse the just-confirmed session/family only for OTP; every new reload
   // still verifies afresh. Formal primary, receipt and RLS remain checked.
   const status=validLogin.has(verifiedStatus)&&controller.verifiedContext()
    ?verifiedStatus:await bounded(()=>controller.connect(),18000);
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
   const verified=await bounded(()=>readModelFactory(ctx.app).read({
    familyId:ctx.familyId,actorUid:ctx.actorUid,limit:50
   }),20000);
   // An RPC ACK alone is not proof that the purchase appears in the
   // authoritative RLS-scoped history read by the other family member.
   const purchaseAppears=expectedPurchaseId===null
    ||(Array.isArray(verified?.livePurchases)
      &&verified.livePurchases.some(row=>row.operationId===expectedPurchaseId
       &&row.reversed!==true));
   const useAppears=expectedUseId===null
    ||(Array.isArray(verified?.liveUses)
      &&verified.liveUses.some(row=>row.operationId===expectedUseId));
   // Reverse ACK only counts after fresh RLS-scoped primary read shows the
   // exact original UUID with this specific reversal UUID.
   const reversedAppears=expectedReverseId===null
    ||(typeof expectedOriginalId==='string'&&
      [...(verified?.livePurchases||[]),...(verified?.liveUses||[])]
       .some(row=>row.operationId===expectedOriginalId
        &&row.reversed===true
        &&row.reversedByOperationId===expectedReverseId));
   const stocktakeAppears=expectedStocktake===null
     ||(expectedStocktake&&SIZES.includes(expectedStocktake.size)
       &&verified?.inventory?.[expectedStocktake.size]===expectedStocktake.count
       &&Number.isSafeInteger(verified?.revisions?.[expectedStocktake.size])
       &&verified.revisions[expectedStocktake.size]>expectedStocktake.expectedRevision);
    if(token!==revision)return mode;
   if(verified?.status!=='PRIMARY_READ_ONLY_READY'
     ||verified.canWrite!==false){
    clear();screen('unverified',notes[verified?.status]||
     '正式云端数据尚未核实；不显示演示数据。');
    return mode;
   }
   const scopeKey=ctx.actorUid+'\\x00'+ctx.familyId;
   const identityEpoch=documentEpoch;
   let data=projection.project(verified,ui.defaults());
   if(data.canWrite!==false)throw Error('formal_entry:unsafe_projection');
   let documentsClient=null;
   if(typeof documentsFactory==='function'&&documentsOverlay?.apply){
    try{documentsClient=documentsFactory(ctx.app);}catch(_){
     // Optional document service must not prevent a valid primary read.
    }
   }
   let documentsVerified=false;
   if(documentSnapshot&&documentScope===scopeKey){
    data=documentsOverlay.apply(data,documentSnapshot);
    documentsVerified=data.sharedBusinessDocumentsVerified===true;
   }
   // An authenticated, receipt-backed primary is required for outbox setup.
   if(!primary){
    const p=primaryFactory({controller,host,
     cloudWritesEnabled:purchaseReleaseEnabled===true});
    // Write-capable activation retains independent server scope validation.
    const activation=await bounded(()=>p.activate({
     verifiedReadModel:purchaseReleaseEnabled===true?null:verified
    }),16000);
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
      // Draft batch RPC is not enabled for P2-04.
      batchStocktake:null,
      readDocumentInput:el=>root.XBFormalUIData.documentAction(el),
      prepareQuoteEdit:id=>root.XBFormalUIData.prepareQuoteEdit(id),
      buildAllowsWrites:purchaseReleaseEnabled===true,
      operatorApproved:()=>purchaseReleaseEnabled===true
       &&purchaseOperatorApproved()===true,
      purchaseOnly:true,allowConsume:true,allowReverse:true,
      allowStocktake:true,readStocktakeBaseline:()=>mode==='ready'?shownStock:null,
      onPurchaseReadback:({operationId,kind,reversesOperationId,
       size,count,expectedRevision})=>restore({
       expectedPurchaseId:kind==='buy'?operationId:null,
       expectedUseId:kind==='use'?operationId:null,
       expectedReverseId:kind==='reverse'?operationId:null,
       expectedOriginalId:kind==='reverse'?reversesOperationId:null,
       expectedStocktake:kind==='stocktake'?{size,count,expectedRevision}:null
      }),
      formalModeSelected:()=>mode==='ready',
      readPurchase:()=>root.XBFormalUIData.purchase(),
      readQuote:id=>root.XBFormalUIData.quote(id),
      readTransaction:id=>root.XBFormalUIData.transaction(id),
      notify:answer=>{
       $('formalSyncState').textContent=
        answer?.status==='PRIMARY_STOCKTAKE_CLOUD_READBACK_VERIFIED'
         ?'单尺码盘点已保存，六尺码云端库存已重新读取。'
         :answer?.status==='MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED'
         ?'本阶段一次只能保存一个尺码，请只修改一个尺码后重试；未保存任何修改。'
         :answer?.status==='PRIMARY_STOCK_REVISION_CONFLICT'
         ?'库存版本已更新，请刷新后重新盘点；未覆盖另一设备的库存。'
         :['PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED',
          'PRIMARY_USE_CLOUD_READBACK_VERIFIED',
          'PRIMARY_REVERSE_CLOUD_READBACK_VERIFIED'].includes(answer?.status)
         ?'云端采购、消耗或撤销已确认，正式库存及记录已重新读取。'
         :'云端操作状态：'+String(answer?.status||'UNVERIFIED')
          +(purchaseReleaseEnabled===true?'；请核查原操作 ID。':
           '；正式写入尚未授权。');
      }
     }).attach(doc);
    }
   }
   // Do not wait for an additional getSession() call after showing UI.
   ui.show(data);
   shownStock=Object.freeze({
    inventory:Object.freeze({...verified.inventory}),
    revisions:Object.freeze({...verified.revisions})
   });
   actor=ctx.actorUid;family=ctx.familyId;
   $('formalCurrentAccount').textContent=ctx.actorUid;
   $('formalCurrentFamily').textContent=ctx.familyId;
   screen('ready');
   $('formalSyncState').textContent=documentsVerified?
    '正式宝宝及五类共享文档已验证；本测试版本关闭云端写入。':
    '已验证正式宝宝、历史记录和六尺码库存。候选价、参考价、成长、资料及设置来自历史迁移快照（参考价目录为软件内置）；五类共享文档尚未全部核验，不能视为实时双端同步；正式写入关闭。';
   // Enrich the account label only; cannot gate UI readiness or leak across
   // actor switches. SDK continues to own all session and refresh tokens.
   void bounded(()=>ctx.app.auth.getSession(),6000).then(session=>{
    if(identityEpoch!==documentEpoch||mode!=='ready'||actor!==ctx.actorUid
       ||family!==ctx.familyId)return;
    const email=session?.data?.user?.email||
     session?.data?.session?.user?.email;
    if(typeof email==='string'&&email)
     $('formalCurrentAccount').textContent=email;
   }).catch(()=>{});
   if(!documentsVerified)
    optionalRead(documentsClient,ctx,scopeKey,data,identityEpoch);
   return !purchaseAppears?'PRIMARY_PURCHASE_READBACK_PENDING':
    !useAppears?'PRIMARY_USE_READBACK_PENDING':
    !reversedAppears?'PRIMARY_REVERSE_READBACK_PENDING':
    !stocktakeAppears?'PRIMARY_STOCKTAKE_READBACK_PENDING':mode;
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
  if(otpConfirming)return 'OTP_VERIFY_BUSY';
  const input=$('formalOtp'),code=input.value.trim();
  if(!code){
   $('formalLoginMessage').textContent='请输入邮件中的验证码。';
   return 'OTP_CODE_REQUIRED';
  }
  otpConfirming=true;redrawConfirmButton();
  $('formalLoginMessage').textContent='正在验证，请稍候…';
  try{
   const result=await bounded(()=>controller.confirmOtp(code),30000);
   if(result==='OTP_INVALID_OR_EXPIRED'){
    $('formalLoginMessage').textContent='验证码不正确或已过期，请检查后重新输入。';
    return result;
   }
   if(result==='OTP_VERIFY_FAILED'){
    $('formalLoginMessage').textContent='验证请求失败，请检查网络后重试；已保留验证码。';
    return result;
   }
   if(result==='CONFIG_REQUIRED'){
    $('formalLoginMessage').textContent='登录配置暂不可用，请刷新页面重试。';
    return result;
   }
   if(validLogin.has(result)&&controller.verifiedContext()){
    const next=await restore({verifiedStatus:result});
    if(next==='ready'){
     input.value='';$('formalLoginMessage').textContent='';
    }else if(next==='unverified'){
     $('formalLoginMessage').textContent=''; // The visible gate explains unverified primary.
    }
    return next;
   }
   $('formalLoginMessage').textContent='会话尚未确认，请检查网络后重新检查。';
   return result;
  }catch(_){
   $('formalLoginMessage').textContent='验证超时或网络异常，已保留验证码，请重试。';
   return 'OTP_VERIFY_UNAVAILABLE';
  }finally{otpConfirming=false;redrawConfirmButton();}
 }
 async function start(){
  screen('boot','正在打开小宝管家…');
  controller=loginController.create({
   host,storage:null,view:authView(),scriptLoader,
   deferChildReadToFormal:true
  });
  restoreOtpCooldown();startOtpTicker();redrawConfirmButton();
  function on(id,fn){
   $(id).addEventListener('click',()=>{
    Promise.resolve().then(fn).catch(()=>{
     $('formalGateMessage').textContent='操作未核实，请检查网络。';
    });
   });
  }
  on('formalSendOtp',sendOtp);
  on('formalConfirmOtp',confirmOtp);
  on('formalRetry',restore);
  on('formalRefresh',restore);
  // Inventory-ledger retry only (buy/use/reverse/one-size stocktake).
  if(purchaseReleaseEnabled===true&&purchaseOperatorApproved()===true){
   $('formalSyncNow').disabled=false;
   $('formalSyncNow').textContent='重新提交待确认库存操作';
  }
  on('formalSyncNow',async()=>{
   if(purchaseReleaseEnabled!==true||purchaseOperatorApproved()!==true){
    $('formalSyncState').textContent='正式采购写入尚未批准，未发送操作。';
    return;
   }
   if(!primary)return;
   const sent=await primary.flush({operatorApproved:true});
   if(sent.status==='PRIMARY_CLOUD_SYNCED_VERIFIED'){
    const next=await restore();
    $('formalSyncState').textContent=next==='ready'
     ?'云端已核验，采购与库存已刷新。'
     :'云端操作已确认，页面读取仍需重试。';
   }else $('formalSyncState').textContent=
    '待确认操作：'+String(sent.status)+'；保留原操作 ID，不要重复提交。';
  });
  on('formalSignOut',signOut);
  on('formalGateSignOut',signOut);
  host.addEventListener('online',restore);
  host.addEventListener('storage',event=>{
   if(event?.key!==OTP_STORAGE_KEY)return;
   restoreOtpCooldown();startOtpTicker();
  });
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
  primaryFactory:({controller,host,cloudWritesEnabled=false})=>root.XBPrimaryCloudOperations.create({
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
   cloudWritesEnabled:cloudWritesEnabled===true,
   purchaseOnly:true,allowConsume:true,allowReverse:true,
    allowStocktake:true
  }),
  commandsFactory:root.XBPrimaryBusinessCommands,
  actionsFactory:root.XBPrimaryFormalUIActions
 });
 root.XBFormalApp=app;app.start();
}
const api=Object.freeze({create,FORMAL_WRITE_ENABLED,FORMAL_PURCHASE_ENABLED});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(root?.document){
 root.XBFormalAppModule=api;
 if(root.document.readyState==='loading')
  root.document.addEventListener('DOMContentLoaded',browserStart,{once:true});
 else browserStart();
}
})(typeof window!=='undefined'?window:null);
