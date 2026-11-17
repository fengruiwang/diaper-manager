/* Feature-only V1.2.0 formal login + five-tab cloud shell.
 * Shared-document writes are enabled only for explicitly completed domains.
 * Inventory/purchase remain independently disabled.
 * Never loaded by V1.1.2, accepted M1-02 or M3 preview.
 */
(function(root){
'use strict';
const FORMAL_WRITE_ENABLED=true;
// Purchase release is prepared but OFF until separate operator authorization.
const FORMAL_PURCHASE_ENABLED=false;
const SIZES=['NB','S','M','L','XL','XXL'];
const OTP_COOLDOWN_MS=60000;
// Five parallel server-authorized document RPCs, with no full-body second pass.
const DOCUMENT_READ_TIMEOUT_MS=60000;
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
function quoteChangeVisible(document,expected){
 if(!expected||!Array.isArray(document?.body?.items)
   ||!Number.isSafeInteger(document.revision)
   ||document.revision<=expected.expectedRevision)return false;
 const list=document.body.items,action=expected.action,record=expected.record;
 if(action==='clear')return list.length===0;
 if(!record||typeof record.id!=='string')return false;
 const current=list.find(item=>item.id===record.id);
 if(action==='delete')return !current;
 return (action==='add'||action==='edit')&&current
   &&Object.entries(record).every(([key,value])=>current[key]===value);
}
// A reference write is visible only after the fully verified five-document
// overlay was rendered, never merely because the formal page is "ready".
function referenceChangeVisible(document,expected){
 if(!expected||document?.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
   ||document.kind!=='reference'
   ||document.familyId!==expected.familyId
   ||document.actorUid!==expected.actorUid
   ||!Number.isSafeInteger(document.revision)
   ||document.revision<=expected.expectedRevision
   ||!document.body?.referenceOverrides
   ||typeof expected.record?.key!=='string')return false;
 const overrides=document.body.referenceOverrides,key=expected.record.key;
 if(expected.action==='reset')
  return !Object.prototype.hasOwnProperty.call(overrides,key);
 return expected.action==='set'&&overrides[key]===expected.record.value;
}
function growthChangeVisible(document,expected){
 if(!expected||!Array.isArray(document?.body?.items)
   ||!Number.isSafeInteger(document.revision)
   ||document.revision<=expected.expectedRevision)return false;
 const row=document.body.items.find(x=>x.id===expected.record?.id);
 if(expected.action==='delete')return !row;
 return (expected.action==='add'||expected.action==='edit')&&row
   &&Object.entries(expected.record).every(([k,v])=>row[k]===v);
}
function profileChangeVisible(document,expected){
 if(!expected||!document?.body?.babyProfile
   ||!Number.isSafeInteger(document.revision)
   ||document.revision<=expected.expectedRevision)return false;
 const record=expected.record||{},body=document.body;
 return Object.entries(record).every(([key,value])=>{
  if(key==='babyProfile')
   return value&&typeof value==='object'
    &&Object.entries(value).every(([field,n])=>body.babyProfile[field]===n);
  return body[key]===value;
 });
}
function settingsChangeVisible(document,expected){
 if(!expected||!document?.body
   ||!Number.isSafeInteger(document.revision)
   ||document.revision<=expected.expectedRevision)return false;
 const record=expected.record;
 if(!record||typeof record!=='object')return false;
 return Object.entries(record).every(([key,value])=>{
  const latest=document.body[key];
  if(key==='target'||key==='daily')
   return value&&typeof value==='object'&&latest
    &&Object.entries(value).every(([size,n])=>latest[size]===n);
  if(key==='replenishPolicy')
   return value&&typeof value==='object'&&latest
    &&Object.entries(value).every(([field,n])=>latest[field]===n);
  return latest===value;
 });
}
function create({host,doc,loginController,readModelFactory,primaryFactory,
 commandsFactory,actionsFactory,projection,ui,scriptLoader,
 documentsFactory=null,documentsOverlay=null,
 documentOpsFactory=null,documentCommandsFactory=null,
 batchStocktakeFactory=null,
 purchaseReleaseEnabled=FORMAL_PURCHASE_ENABLED,
 purchaseOperatorApproved=()=>false,
 documentWritesEnabled=FORMAL_WRITE_ENABLED}={}){
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
 let documentSnapshot=null,documentScope='',documentPending='',renderedReference=null;
 let primaryViewBase=null;
 let documentEpoch=0,documentReadSerial=0;
 let documentReadTask=null,fullyReadAt=null,fullReadVerified=false;
 let documentClientCache=null;
 let refreshBusy=false,pendingReviewSerial=0;
 const now=()=>typeof host.Date?.now==='function'?host.Date.now():Date.now();
 const syncTime=()=>new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hour12:false
 }).format(fullyReadAt);
 function showSync(message,phase='checking'){
  const el=$('formalSyncState');
  if(el)el.textContent=message;
  const bar=$('formalNotice');
  if(bar?.dataset)bar.dataset.syncPhase=phase;
 }
 async function checkPending(){
  if(mode!=='ready'||!actor||!family)return;
  const key=actor+'\x00'+family,epoch=documentEpoch,serial=++pendingReviewSerial;
  const domains=[
   {enabled:purchaseReleaseEnabled===true&&purchaseOperatorApproved()===true,
    guard:pendingGuard,expected:'PRIMARY_QUEUE_COUNTS_VERIFIED'},
   {enabled:documentWritesEnabled===true,
    guard:documentsGuard,expected:'DOCUMENT_QUEUE_COUNTS_VERIFIED'},
   {enabled:purchaseReleaseEnabled===true&&purchaseOperatorApproved()===true,
    guard:batchGuard,expected:'BATCH_QUEUE_VERIFIED'}
  ].filter(x=>x.enabled);
  const results=await Promise.all(domains.map(async x=>{
   try{return x.guard?.pending?await x.guard.pending():null;}catch(_){return null;}
  }));
  if(mode!=='ready'||documentEpoch!==epoch||serial!==pendingReviewSerial
    ||key!==actor+'\x00'+family)return;
  const uncertain=results.some((x,i)=>x?.status!==domains[i].expected
    ||!Number.isSafeInteger(x.outstanding)||x.outstanding<0);
  const outstanding=results.some(x=>Number.isSafeInteger(x?.outstanding)
    &&x.outstanding>0);
  const needsReview=uncertain||outstanding;
  const btn=$('formalSyncNow');
  if(btn){btn.hidden=!needsReview;btn.disabled=!needsReview;}
  if(outstanding)showSync('有操作待确认，请点击“核验待处理”。','pending');
  else if(uncertain)showSync('同步状态暂未核实，请点击“核验待处理”。','partial');
  else if(fullReadVerified&&fullyReadAt)showSync('已同步 · '+syncTime(),'synced');
 }
 function confirmedFullRead(){
  fullyReadAt=new Date();fullReadVerified=true;
  showSync('正在核对待处理操作…','checking');
  void checkPending().catch(()=>showSync('同步状态暂未核实，请点击刷新。','partial'));
 }
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
  $('formalAccountState').textContent=next==='ready'?'已连接':next==='boot'?'检查中':next==='login'?'未登录':next==='offline'?'离线':'需检查';
 }
 function conflictButton(visible){
  const button=$('formalResolveDocumentConflict');
  if(!button)return;
  button.hidden=!visible;button.disabled=!visible;
 }
 async function refreshConflictButton(){
  if(documentWritesEnabled!==true||!documentsGuard?.conflicts
    ||mode!=='ready'||!actor||!family)return;
  const scopeKey=actor+'\x00'+family,epoch=documentEpoch;
  const found=await documentsGuard.conflicts();
  if(scopeKey!==actor+'\x00'+family||epoch!==documentEpoch
    ||mode!=='ready')return;
  conflictButton(found?.status==='DOCUMENT_CONFLICTS_VERIFIED'
    &&found.items.length>0);
 }
 function batchConflictButton(visible){
  const btn=$('formalResolveBatchConflict');
  if(!btn)return;
  btn.hidden=!visible;btn.disabled=!visible;
 }
 async function refreshBatchConflictButton(){
  if(purchaseReleaseEnabled!==true||purchaseOperatorApproved()!==true
    ||!batchGuard?.conflicts||mode!=='ready'||!actor||!family)return;
  const key=actor+'\x00'+family,epoch=documentEpoch;
  const found=await batchGuard.conflicts();
  if(epoch!==documentEpoch||key!==actor+'\x00'+family
    ||mode!=='ready')return;
  batchConflictButton(found?.status==='BATCH_CONFLICTS_VERIFIED'
   &&found.items.length>0);
 }
 function clear(){
  conflictButton(false);batchConflictButton(false);
  ui.clear();actor=null;family=null;primary=null;shownStock=null;
  pendingGuard=null;documentsGuard=null;batchGuard=null;
  documentSnapshot=null;documentScope='';documentPending='';renderedReference=null;
  primaryViewBase=null;
  documentEpoch++;documentReadSerial++;pendingReviewSerial++;
  documentReadTask=null;fullyReadAt=null;fullReadVerified=false;
  documentClientCache?.client?.invalidateReadScope?.();
  documentClientCache=null;
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
 function showCloudView(data,ctx){
  ui.show(data);
  // A verified RPC response alone is not proof that the UI rendered it.
  const scope=data?.cloudDocumentsActorScope;
  renderedReference=data?.sharedBusinessDocumentsVerified===true
   &&scope?.familyId===ctx.familyId
   &&scope?.childId===data.childId
   &&data.actorUid===ctx.actorUid
   &&Number.isSafeInteger(data.documentRevisions?.reference)
   &&data.state?.referenceOverrides
   ?Object.freeze({
     status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind:'reference',
     familyId:ctx.familyId,actorUid:ctx.actorUid,childId:scope.childId,
     revision:data.documentRevisions.reference,
     body:Object.freeze({referenceOverrides:Object.freeze({
      ...data.state.referenceOverrides
     })})
    }):null;
 }
 function optionalRead(client,ctx,scopeKey,base,epoch){
  if(!client||typeof client.readAll!=='function')return Promise.resolve(false);
  if(documentPending===scopeKey)
   return documentReadTask||Promise.resolve(false);
  documentPending=scopeKey;
  const serial=++documentReadSerial;
  const current=()=>serial===documentReadSerial
   &&epoch===documentEpoch&&mode==='ready'
   &&actor===ctx.actorUid&&family===ctx.familyId;
  // Only the complete, identity-scoped five-document overlay marks sync success.
  const task=bounded(()=>client.readAll({
   familyId:ctx.familyId,actorUid:ctx.actorUid
  }),DOCUMENT_READ_TIMEOUT_MS).then(snapshot=>{
   if(!current())return false;
   if(snapshot?.status!=='PRIMARY_DOCUMENTS_FULLY_READ')
    throw Error('formal_entry:five_documents_incomplete');
   const merged=documentsOverlay.apply(base,snapshot);
   if(merged?.canWrite!==false||merged.sharedBusinessDocumentsVerified!==true)
    throw Error('formal_entry:five_documents_unverified');
   showCloudView(merged,ctx);
   documentSnapshot=snapshot;documentScope=scopeKey;
   confirmedFullRead();
   return true;
  }).catch(()=>{
   if(current()){
    fullReadVerified=false;
    showSync('部分数据读取失败或超时，未完全同步；请点击刷新重试。','partial');
   }
   return false;
  }).finally(()=>{
   if(serial===documentReadSerial&&documentPending===scopeKey){
    documentPending='';documentReadTask=null;
   }
  });
  documentReadTask=task;
  return task;
 }
 async function restore({verifiedStatus=null,expectedPurchaseId=null,expectedUseId=null,
  expectedReverseId=null,expectedOriginalId=null,expectedStocktake=null,
  expectedBatch=null,expectedQuotes=null,expectedGrowth=null,
  expectedProfile=null,expectedSettings=null,expectedReference=null,
  requireComplete=false}={}){
  if(busy)return expectedBatch!==null?'BATCH_READBACK_PENDING':
   expectedQuotes!==null?'QUOTES_READBACK_PENDING':
   expectedGrowth!==null?'GROWTH_READBACK_PENDING':
   expectedProfile!==null?'PROFILE_READBACK_PENDING':
   expectedSettings!==null?'SETTINGS_READBACK_PENDING':
   expectedReference!==null?'REFERENCE_READBACK_PENDING':mode;
  busy=true;const token=++revision;
  fullReadVerified=false;
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
    const batchAppears=expectedBatch===null
     ||(Array.isArray(expectedBatch)&&expectedBatch.length>=2
       &&expectedBatch.every(item=>SIZES.includes(item.size)
        &&verified?.inventory?.[item.size]===item.count
        &&Number.isSafeInteger(verified?.revisions?.[item.size])
        &&verified.revisions[item.size]>item.expectedRevision));
    if(token!==revision)return mode;
   if(verified?.status!=='PRIMARY_READ_ONLY_READY'
     ||verified.canWrite!==false){
    clear();screen('unverified',notes[verified?.status]||
     '正式云端数据尚未核实；不显示演示数据。');
    return mode;
   }
   const scopeKey=ctx.actorUid+'\x00'+ctx.familyId;
   const identityEpoch=documentEpoch;
   let data=projection.project(verified,ui.defaults());
   if(data.canWrite!==false)throw Error('formal_entry:unsafe_projection');
   const baseView=data;
   // The primary read above has already verified the current actor, family,
   // active primary, completed migration receipt and server inventory scope.
   // Reuse this current-session read scope for document RPCs only.
   if(documentClientCache
      &&(documentClientCache.actorUid!==ctx.actorUid
       ||documentClientCache.familyId!==ctx.familyId
       ||(documentClientCache.childId!==verified.childId
         &&(documentClientCache.childId||verified.childId)))){
    // Never render a prior baby's view with a changed primary scope.
    clear();screen('unverified','账号或正式宝宝作用域已变化，请重新检查。');
    return mode;
   }
   let documentsClient=null;
   if(typeof documentsFactory==='function'&&documentsOverlay?.apply){
    try{
     // A renewed SDK app for the same verified household needs fresh DB handles.
     documentsClient=documentClientCache?.app===ctx.app
      ?documentClientCache.client:documentsFactory(ctx.app);
     if(documentsClient){
      documentsClient.acceptVerifiedPrimary?.(verified);
      documentClientCache={app:ctx.app,actorUid:ctx.actorUid,
       familyId:ctx.familyId,childId:verified.childId,
       client:documentsClient};
     }
    }catch(_){
     documentsClient=null;documentClientCache=null;
     // Document service remains optional for authenticated inventory.
    }
   }
   let documentsVerified=false;
   if(documentSnapshot&&documentScope===scopeKey&&documentsClient){
    // Refresh all five shared documents on each verified reload.
    // account must not be masked by an old cached full-document snapshot.
    const old=documentSnapshot.documents;
    const fresh=await Promise.all(['reference','quotes','growth','profile','settings'].map(kind=>
     bounded(()=>documentsClient.read({
      familyId:ctx.familyId,actorUid:ctx.actorUid,
      kind,readEnabled:true
     }),12000).catch(()=>null)
    ));
    const acceptable=fresh.every((doc,i)=>
     doc?.status==='PRIMARY_DOCUMENT_READ_VERIFIED'
     &&doc.kind===['reference','quotes','growth','profile','settings'][i]
     &&doc.familyId===ctx.familyId
     &&doc.childId===old?.[doc.kind]?.childId
     &&Number.isSafeInteger(doc.revision));
    if(acceptable){
     documentSnapshot=Object.freeze({...documentSnapshot,
      documents:Object.freeze({...old,reference:fresh[0],quotes:fresh[1],growth:fresh[2],profile:fresh[3],settings:fresh[4]})});
     data=documentsOverlay.apply(data,documentSnapshot);
     documentsVerified=data.sharedBusinessDocumentsVerified===true;
    }else{
     // Never render stale shared documents after failed refresh.
     documentSnapshot=null;documentScope='';
    }
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
      primary:p,commands,documentCommands,documentQueue:documentsGuard,
      allowReference:true,allowQuotes:true,allowGrowth:true,allowProfile:true,
      allowSettings:false,
      onDocumentProgress:(kind,phase,timing={})=>{
       if(mode!=='ready'||actor!==ctx.actorUid||family!==ctx.familyId)return;
       const what=kind==='profile'?'宝宝资料':'设置';
       const messages={
        checking:'正在检查'+what+'及云端版本，请勿重复点击…',
        queued:what+'已加入本地持久队列，正在准备提交…',
        submitting:'正在核验原请求回执并提交'+what+'，请勿重复保存…',
        readback:what+'云端提交及回执已确认，正在重新读取页面…',
        pending:what+'请求尚待核实，原 UUID 已保留；请使用“重新核验待确认操作”，不要重复保存。'
       };
       if(messages[phase])$('formalSyncState').textContent=messages[phase];
       if(phase==='success'&&typeof host.console?.info==='function')
        host.console.info('P4-03E '+what+'保存耗时(ms)，本次浏览器观测值',timing);
      },
      readSettingsBaseline:()=>mode==='ready'
       &&documentSnapshot&&documentScope===actor+'\x00'+family
       ?{...documentSnapshot.documents?.settings,actorUid:actor}:null,
      onSettingsReadback:async(expected)=>{
       const current=controller.verifiedContext();
       if(!current||!documentsClient||!documentsGuard
         ||current.actorUid!==actor||current.familyId!==family)
        return 'pending';
       const receipt=await documentsGuard.checkSavedRequest(expected.requestId);
       if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
       const fresh=await documentsClient.read({
        familyId:current.familyId,actorUid:current.actorUid,
        kind:'settings',readEnabled:true
       });
       if(fresh.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||!settingsChangeVisible(fresh,expected))return 'pending';
       if(documentSnapshot&&documentScope===actor+'\x00'+family){
        documentSnapshot=Object.freeze({...documentSnapshot,
         documents:Object.freeze({...documentSnapshot.documents,settings:fresh})});
       }
       return await restore({expectedSettings:expected})==='ready'?'ready':'pending';
      },
      readProfileBaseline:()=>mode==='ready'
       &&documentSnapshot&&documentScope===actor+'\x00'+family
       ?{...documentSnapshot.documents?.profile,actorUid:actor}:null,
      onProfileAck:async(ack)=>{
       const current=controller.verifiedContext();
       const key=ctx.actorUid+'\x00'+ctx.familyId;
       const previous=documentSnapshot?.documents?.profile;
       if(!current||mode!=='ready'||identityEpoch!==documentEpoch
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||!primaryViewBase||documentScope!==key
         ||documentSnapshot?.status!=='PRIMARY_DOCUMENTS_FULLY_READ'
         ||previous?.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||ack?.kind!=='profile'||ack.familyId!==ctx.familyId
         ||ack.actorUid!==ctx.actorUid||ack.childId!==previous.childId
         ||typeof ack.requestId!=='string'||!ack.requestId
         ||!Number.isSafeInteger(ack.expectedRevision)
         ||!Number.isSafeInteger(ack.revision)
         ||ack.expectedRevision!==previous.revision
         ||ack.revision!==previous.revision+1
         ||!ack.nextBody||typeof ack.nextBody!=='object'
         ||Array.isArray(ack.nextBody)||!ack.nextBody.babyProfile
         ||typeof ack.nextBody.babyProfile!=='object'
         ||Array.isArray(ack.nextBody.babyProfile))return 'pending';
       const revised=Object.freeze({...previous,revision:ack.revision,
        body:ack.nextBody});
       if(!profileChangeVisible(revised,{record:ack.record,
        expectedRevision:ack.expectedRevision}))return 'pending';
       const snapshot=Object.freeze({...documentSnapshot,
        documents:Object.freeze({...documentSnapshot.documents,profile:revised})});
       let updated;
       try{
        updated=documentsOverlay.apply(primaryViewBase,snapshot);
        if(updated?.sharedBusinessDocumentsVerified!==true
          ||updated.cloudDocumentsActorScope?.childId!==ack.childId)
         return 'pending';
        showCloudView(updated,current);
       }catch(_){return 'pending';}
       documentSnapshot=snapshot;
       return 'ready';
      },
      onProfileReadback:async(expected)=>{
       const current=controller.verifiedContext();
       if(!current||!documentsClient||!documentsGuard
         ||current.actorUid!==actor||current.familyId!==family)
        return 'pending';
       if(expected.receiptVerified!==true){
        const receipt=await documentsGuard.checkSavedRequest(expected.requestId);
        if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
       }
       const fresh=await documentsClient.read({
        familyId:current.familyId,actorUid:current.actorUid,
        kind:'profile',readEnabled:true
       });
       if(fresh.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||!profileChangeVisible(fresh,expected))return 'pending';
       if(documentSnapshot&&documentScope===actor+'\x00'+family){
        documentSnapshot=Object.freeze({...documentSnapshot,
         documents:Object.freeze({...documentSnapshot.documents,profile:fresh})});
       }
       return await restore({expectedProfile:expected})==='ready'?'ready':'pending';
      },
      readGrowthBaseline:()=>mode==='ready'
       &&documentSnapshot&&documentScope===actor+'\x00'+family
       ?{...documentSnapshot.documents?.growth,actorUid:actor}:null,
      confirmGrowthDelete:record=>host.confirm?.(
       '确定删除 '+record.date+' 的体重记录？无法撤销。')===true,
      onGrowthAck:async(ack)=>{
       const current=controller.verifiedContext();
       const key=ctx.actorUid+'\x00'+ctx.familyId;
       const previous=documentSnapshot?.documents?.growth;
       if(!current||mode!=='ready'||identityEpoch!==documentEpoch
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||!primaryViewBase||documentScope!==key
         ||documentSnapshot?.status!=='PRIMARY_DOCUMENTS_FULLY_READ'
         ||previous?.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||ack?.kind!=='growth'||ack.familyId!==ctx.familyId
         ||ack.actorUid!==ctx.actorUid||ack.childId!==previous.childId
         ||typeof ack.requestId!=='string'||!ack.requestId
         ||!Number.isSafeInteger(ack.expectedRevision)
         ||!Number.isSafeInteger(ack.revision)
         ||ack.expectedRevision!==previous.revision
         ||ack.revision!==previous.revision+1
         ||!ack.nextBody||typeof ack.nextBody!=='object'
         ||Array.isArray(ack.nextBody)||!Array.isArray(ack.nextBody.items))
        return 'pending';
       const revised=Object.freeze({...previous,revision:ack.revision,
        body:ack.nextBody});
       if(!growthChangeVisible(revised,{action:ack.action,
        record:ack.record,expectedRevision:ack.expectedRevision}))
        return 'pending';
       const snapshot=Object.freeze({...documentSnapshot,
        documents:Object.freeze({...documentSnapshot.documents,growth:revised})});
       let updated;
       try{
        updated=documentsOverlay.apply(primaryViewBase,snapshot);
        if(updated?.sharedBusinessDocumentsVerified!==true
          ||updated.cloudDocumentsActorScope?.childId!==ack.childId)
         return 'pending';
        showCloudView(updated,current);
       }catch(_){return 'pending';}
       documentSnapshot=snapshot;
       root.XBFormalUIData.finishGrowthEdit?.({
        action:ack.action,recordId:ack.record?.id
       });
       return 'ready';
      },
      onGrowthReadback:async(expected)=>{
       const current=controller.verifiedContext();
       if(!current||!documentsClient||!documentsGuard
         ||current.actorUid!==actor||current.familyId!==family)
        return 'pending';
       if(expected.receiptVerified!==true){
        const receipt=await documentsGuard.checkSavedRequest(expected.requestId);
        if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
       }
       const fresh=await documentsClient.read({
        familyId:current.familyId,actorUid:current.actorUid,
        kind:'growth',readEnabled:true
       });
       if(fresh.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||!growthChangeVisible(fresh,expected))return 'pending';
       if(documentSnapshot&&documentScope===actor+'\x00'+family){
        documentSnapshot=Object.freeze({...documentSnapshot,
         documents:Object.freeze({...documentSnapshot.documents,growth:fresh})});
       }
       const visible=await restore({expectedGrowth:expected});
       if(visible==='ready'){
        root.XBFormalUIData.finishGrowthEdit?.({
         action:expected.action,recordId:expected.record?.id
        });
        return 'ready';
       }
       return 'pending';
      },
      readQuotesBaseline:()=>mode==='ready'
       &&documentSnapshot&&documentScope===actor+'\x00'+family
       ?{...documentSnapshot.documents?.quotes,
         actorUid:actor}:null,
      confirmQuoteClear:()=>host.confirm?.(
       '确定清空全部候选价格？不会影响采购记录。')===true,
      confirmQuoteDelete:()=>host.confirm?.(
       '确定删除这条候选价格？不会影响已购买记录。')===true,
      onQuotesAck:async(ack)=>{
       const current=controller.verifiedContext();
       const key=ctx.actorUid+'\x00'+ctx.familyId;
       const previous=documentSnapshot?.documents?.quotes;
       if(!current||mode!=='ready'||identityEpoch!==documentEpoch
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||!primaryViewBase||documentScope!==key
         ||documentSnapshot?.status!=='PRIMARY_DOCUMENTS_FULLY_READ'
         ||previous?.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||ack?.kind!=='quotes'||ack.familyId!==ctx.familyId
         ||ack.actorUid!==ctx.actorUid||ack.childId!==previous.childId
         ||typeof ack.requestId!=='string'||!ack.requestId
         ||!Number.isSafeInteger(ack.expectedRevision)
         ||!Number.isSafeInteger(ack.revision)
         ||ack.expectedRevision!==previous.revision
         ||ack.revision!==previous.revision+1
         ||!ack.nextBody||typeof ack.nextBody!=='object'
         ||Array.isArray(ack.nextBody)||!Array.isArray(ack.nextBody.items))
        return 'pending';
       const revised=Object.freeze({...previous,revision:ack.revision,
        body:ack.nextBody});
       if(!quoteChangeVisible(revised,ack))return 'pending';
       const snapshot=Object.freeze({...documentSnapshot,
        documents:Object.freeze({...documentSnapshot.documents,quotes:revised})});
       let updated;
       try{
        updated=documentsOverlay.apply(primaryViewBase,snapshot);
        if(updated?.sharedBusinessDocumentsVerified!==true
          ||updated.cloudDocumentsActorScope?.childId!==ack.childId)
         return 'pending';
        showCloudView(updated,current);
       }catch(_){return 'pending';}
       documentSnapshot=snapshot;
       root?.XBFormalUIData?.finishQuoteEdit?.({
        action:ack.action,recordId:ack.record?.id
       });
       // A single successful write is not a full cloud pull.
       return 'ready';
      },
      onQuotesReadback:async(expected)=>{
       const current=controller.verifiedContext();
       if(!current||!documentsClient||!documentsGuard
         ||current.actorUid!==actor||current.familyId!==family)
        return 'pending';
       const receipt=await documentsGuard.checkSavedRequest(expected.requestId);
       if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
       const fresh=await documentsClient.read({
        familyId:current.familyId,actorUid:current.actorUid,
        kind:'quotes',readEnabled:true
       });
       if(fresh.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||!quoteChangeVisible(fresh,expected))return 'pending';
       if(documentSnapshot&&documentScope===actor+'\x00'+family){
        documentSnapshot=Object.freeze({...documentSnapshot,
         documents:Object.freeze({...documentSnapshot.documents,quotes:fresh})});
       }
       const visible=await restore({expectedQuotes:expected});
       if(visible==='ready'){
        root.XBFormalUIData.finishQuoteEdit?.({
         action:expected.action,recordId:expected.record?.id
        });
        return 'ready';
       }
       return 'pending';
      },
      onReferenceProgress:(phase,timing={})=>{
       if(mode!=='ready'||actor!==ctx.actorUid||family!==ctx.familyId)return;
       const messages={
        checking:'正在检查参考价和云端版本，请勿重复点击…',
        queued:'参考价已加入本地持久队列，正在准备云端提交…',
        submitting:'正在向云端保存参考价，请勿重复保存…',
        readback:'云端提交及回执已确认，正在重新读取参考价…',
        pending:'这笔参考价请求尚待核实，请使用“重新核验待确认操作”，不要重复保存。'
       };
       if(messages[phase])$('formalSyncState').textContent=messages[phase];
       if(phase==='success'&&typeof host.console?.info==='function')
        host.console.info('P4-03D 参考价保存耗时(ms)，本次浏览器观测值',timing);
      },
      readReferenceBaseline:()=>mode==='ready'
       &&documentSnapshot&&documentScope===actor+'\x00'+family
       ?{...documentSnapshot.documents?.reference,
         actorUid:actor}:null,
      onReferenceAck:async(ack)=>{
       const current=controller.verifiedContext();
       const key=ctx.actorUid+'\x00'+ctx.familyId;
       const previous=documentSnapshot?.documents?.reference;
       // The ACK was checked by the document client and outbox. Here verify
       // current identity, exact CAS revision, and the complete saved body
       // before updating only the local reference overlay.
       if(!current||mode!=='ready'||identityEpoch!==documentEpoch
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||!primaryViewBase||documentScope!==key
         ||documentSnapshot?.status!=='PRIMARY_DOCUMENTS_FULLY_READ'
         ||previous?.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||ack?.kind!=='reference'||ack.familyId!==ctx.familyId
         ||ack.actorUid!==ctx.actorUid||ack.childId!==previous.childId
         ||ack.requestId===undefined
         ||!Number.isSafeInteger(ack.expectedRevision)
         ||!Number.isSafeInteger(ack.revision)
         ||ack.expectedRevision!==previous.revision
         ||ack.revision!==previous.revision+1
         ||!ack.nextBody||typeof ack.nextBody!=='object'
         ||Array.isArray(ack.nextBody)
         ||!ack.nextBody.referenceOverrides
         ||typeof ack.nextBody.referenceOverrides!=='object'
         ||Array.isArray(ack.nextBody.referenceOverrides)
         ||typeof ack.record?.key!=='string')
        return 'pending';
       const overrides=ack.nextBody.referenceOverrides;
       const matches=ack.action==='reset'
        ?!Object.prototype.hasOwnProperty.call(overrides,ack.record.key)
        :ack.action==='set'&&overrides[ack.record.key]===ack.record.value;
       if(!matches)return 'pending';
       const revised=Object.freeze({...previous,revision:ack.revision,
        body:ack.nextBody});
       const snapshot=Object.freeze({...documentSnapshot,
        documents:Object.freeze({...documentSnapshot.documents,
         reference:revised})});
       let updated;
       try{
        updated=documentsOverlay.apply(primaryViewBase,snapshot);
        if(updated?.sharedBusinessDocumentsVerified!==true
          ||updated.cloudDocumentsActorScope?.childId!==ack.childId)
         return 'pending';
        showCloudView(updated,current);
       }catch(_){return 'pending';}
       documentSnapshot=snapshot;
       confirmedFullRead();
       return 'ready';
      },
      onReferenceReadback:async({requestId,record,action,expectedRevision})=>{
       const current=controller.verifiedContext();
       if(!current||!documentsClient||!documentsGuard
         ||current.actorUid!==actor||current.familyId!==family)
        return 'pending';
       const receipt=await documentsGuard.checkSavedRequest(requestId);
       if(receipt.status!=='REQUEST_ACK_RECOVERED')return 'pending';
       const fresh=await documentsClient.read({
        familyId:current.familyId,actorUid:current.actorUid,
        kind:'reference',readEnabled:true
       });
       if(fresh.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||fresh.revision<=expectedRevision)return 'pending';
       const values=fresh.body?.referenceOverrides;
       const matches=action==='reset'
        ?values&&!Object.prototype.hasOwnProperty.call(values,record.key)
        :values?.[record.key]===record.value;
       if(!matches)return 'pending';
       if(documentSnapshot&&documentScope===actor+'\x00'+family){
        documentSnapshot=Object.freeze({...documentSnapshot,
         documents:Object.freeze({...documentSnapshot.documents,
          reference:fresh})});
       }
       const expected={requestId,record,action,expectedRevision,
        actorUid:current.actorUid,familyId:current.familyId};
       return await restore({expectedReference:expected})==='ready'
        &&referenceChangeVisible(renderedReference,expected)?'ready':'pending';
      },
      batchStocktake:batchGuard,
      createBatchId:()=>host.crypto.randomUUID(),
      onBatchReadback:({items})=>restore({expectedBatch:items}),
      readDocumentInput:el=>root.XBFormalUIData.documentAction(el),
      prepareQuoteEdit:id=>root.XBFormalUIData.prepareQuoteEdit(id),
      buildAllowsWrites:purchaseReleaseEnabled===true,
      operatorApproved:()=>purchaseReleaseEnabled===true
       &&purchaseOperatorApproved()===true,
      buildAllowsDocumentWrites:documentWritesEnabled===true,
      documentOperatorApproved:()=>documentWritesEnabled===true,
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
        const resultCode=String(answer?.status||'');
        if(/UNKNOWN|PENDING|REVIEW|CONFLICT|UNVERIFIED|FAILED/.test(resultCode)
          &&(documentWritesEnabled===true||purchaseReleaseEnabled===true)){
         const button=$('formalSyncNow');
         if(button){button.hidden=false;button.disabled=false;}
         void checkPending().catch(()=>{});
        }
        if(answer?.status==='BATCH_REVISION_CONFLICT_MANUAL_REVIEW')
         batchConflictButton(true);
       if(documentWritesEnabled===true
         &&answer?.status==='DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW')
        conflictButton(true);
       $('formalSyncState').textContent=
        answer?.status==='PRIMARY_STOCKTAKE_CLOUD_READBACK_VERIFIED'
         ?'单尺码盘点已保存，六尺码云端库存已重新读取。'
          :answer?.status==='BATCH_CLOUD_READBACK_VERIFIED'
         ?'多尺码盘点已一次性保存，云端六尺码库存已重新读取。'
         :answer?.status==='BATCH_REVISION_CONFLICT_MANUAL_REVIEW'
          ?'其他设备已更新库存，本次批量盘点未保存；请点击“处理盘点冲突”放弃旧修改后重新盘点。'
          :answer?.status==='BATCH_PENDING_REVIEW_FIRST'
          ?'上次批量盘点待处理，请先核验原请求或处理确定冲突。'
          :answer?.status==='BATCH_COMMITTED_READBACK_REQUIRED'
         ?'批量操作回执已确认，库存页面仍需刷新核验；请勿重复创建批次。'
         :answer?.status==='MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED'
         ?'多尺码盘点暂不可用，未保存任何库存修改。'
         :answer?.status==='PRIMARY_STOCK_REVISION_CONFLICT'
         ?'库存版本已更新，请刷新后重新盘点；未覆盖另一设备的库存。'
         :answer?.status==='REFERENCE_CLOUD_ACK_APPLIED'
         ?'参考价保存成功：026 已确认，当前页面价格已更新，家庭账号刷新后可见。'
         :answer?.status==='REFERENCE_CLOUD_READBACK_VERIFIED'
         ?'参考价保存成功：云端回执及实际页面读回均已核验，家庭账号刷新后可看到新值。'
         :answer?.status==='SETTINGS_CLOUD_READBACK_VERIFIED'
         ?'设置已保存并从云端重新读取；首页及补货计划已更新。'
         :answer?.status==='SETTINGS_COMMITTED_READBACK_REQUIRED'
         ?'设置回执已确认，但页面尚未核实最新值；请刷新，不要重复提交。'
         :answer?.status==='SETTINGS_FORM_INVALID'
         ?'设置未保存：请检查尺码、单片目标、备货目标和每日用量。'
         :answer?.status==='SETTINGS_DISPLAYED_BASELINE_REQUIRED'
         ?'设置尚无云端已验证基线，请刷新后重试；输入不应被清除。'
         :answer?.status==='PROFILE_CLOUD_READBACK_VERIFIED'
         ?'宝宝基本资料已保存并从云端核验；成长统计和页面已更新。'
         :answer?.status==='PROFILE_COMMITTED_READBACK_REQUIRED'
         ?'资料回执已确认，但页面读回尚待核验；请刷新，不要重复保存。'
         :answer?.status==='PROFILE_FORM_INVALID'
         ?'宝宝资料未保存：请检查日期、出生时分秒、体重及身长。'
         :answer?.status==='PROFILE_DISPLAYED_BASELINE_REQUIRED'
         ?'宝宝资料尚无云端已验证基线，请刷新后重试；输入不应被清除。'
         :['PROFILE_ACK_UNKNOWN_KEEP_REQUEST_ID','SETTINGS_ACK_UNKNOWN_KEEP_REQUEST_ID',
           'DOCUMENT_LOCAL_QUEUE_UNVERIFIED_KEEP_REQUEST_ID'].includes(answer?.status)
         ?'原宝宝资料或设置请求尚未确认，已保留 UUID；请核验待确认操作，不要再次保存。'
         :answer?.status==='GROWTH_CLOUD_READBACK_VERIFIED'
         ?'体重记录已保存并从云端读回，成长曲线与统计已更新。'
         :answer?.status==='GROWTH_COMMITTED_READBACK_REQUIRED'
         ?'体重记录回执已确认，云端页面尚待核验；请刷新，不要重复保存。'
         :answer?.status==='GROWTH_DELETE_CANCELLED'
         ?'已取消删除，体重记录未改变。'
         :answer?.status==='GROWTH_FORM_INVALID'
         ?'体重表单信息不完整，请核查日期、时间和体重后重试。'
         :answer?.status==='QUOTES_CLOUD_ACK_APPLIED'
         ?'候选价操作已由云端确认，当前列表已更新；其他家庭账号刷新后可查看。'
         :answer?.status==='QUOTES_CLOUD_READBACK_VERIFIED'
         ?'候选价已同步到云端，列表已更新；其他家庭账号刷新后可查看。'
         :answer?.status==='QUOTES_COMMITTED_READBACK_REQUIRED'
         ?'候选价回执已确认，页面尚待重新读取；请刷新，不要重复保存。'
         :answer?.status==='QUOTES_CLEAR_CANCELLED'
         ?'已取消清空候选价，云端列表保持不变。'
         :answer?.status==='QUOTES_DELETE_CANCELLED'
         ?'已取消删除候选价，未提交云端请求。'
         :answer?.status==='DOCUMENT_QUOTES_PERMISSION_DENIED_KEEP_ID'
         ?'服务器拒绝候选价写入，请检查权限；原 UUID 已保留。'
         :answer?.status==='QUOTES_ALREADY_EMPTY'
         ?'候选价列表已为空，无需清空。'
         :answer?.status==='QUOTE_FIELDS_READY_TO_EDIT'
         ?'已载入候选价，请修改后点击“保存本次修改”。'
         :answer?.status==='REFERENCE_COMMITTED_READBACK_REQUIRED'
         ?'参考价已经提交且回执确认，页面读回尚待核验；请勿再次保存，请刷新核实。'
         :answer?.status==='REFERENCE_FORM_INVALID'
         ?'参考价未保存：请检查价格输入与当前品牌、系列和尺码。'
         :answer?.status==='REFERENCE_DISPLAYED_BASELINE_REQUIRED'
         ?'参考价尚无已验证云端显示基线，请刷新页面，待共享文档读取完成后重试。'
         :['REFERENCE_OPERATION_REVIEW_REQUIRED','DOCUMENT_COMMAND_REJECTED'].includes(answer?.status)
         ?'参考价保存结果未核实，输入已保留；请检查网络和待确认操作，暂勿重复保存。'
         :answer?.status==='DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW'
         ?'数据已被其他设备更新，本次修改未保存；请点击“放弃本次修改并刷新”确认后再编辑。'
         :['DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID',
           'DOCUMENT_SYNC_UNKNOWN_QUEUE_PRESERVED',
           'DOCUMENT_RECEIPT_READBACK_REQUIRED_KEEP_ID',
           'DOCUMENT_ACK_NOT_VERIFIED',
           'REFERENCE_ACK_UNKNOWN_KEEP_REQUEST_ID',
           'DOCUMENT_LOCAL_QUEUE_UNVERIFIED_KEEP_REQUEST_ID',
           'DOCUMENT_RECEIPT_CONFLICT_KEEP_ID'].includes(answer?.status)
         ?'参考价请求回执尚待确认，原 UUID 已保留，请使用待确认操作核验，不要重复保存。'
         :answer?.status==='DOCUMENT_REFERENCE_PERMISSION_DENIED_KEEP_ID'
         ?'服务器明确拒绝参考价保存：请检查账号家庭权限；原请求已保留，切勿重复提交。'
         :answer?.status==='DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED'
         ?'共享文档已有其他设备更新，请刷新后重新编辑；未覆盖新数据。'
         :answer?.status==='DOCUMENT_PENDING_REVIEW_REQUIRED'
         ?'上次共享文档请求尚未核实，请使用待同步重试，不要重复保存。'
         :['PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED',
          'PRIMARY_USE_CLOUD_READBACK_VERIFIED',
          'PRIMARY_REVERSE_CLOUD_READBACK_VERIFIED'].includes(answer?.status)
         ?'云端采购、消耗或撤销已确认，正式库存及记录已重新读取。'
         :'云端操作状态：'+String(answer?.status||'UNVERIFIED')
          +(documentWritesEnabled===true
           ?'；请核验原参考价请求状态，未确认前不要重复保存。'
           :purchaseReleaseEnabled===true
            ?'；请核查原操作 ID。':'；正式写入尚未授权。');
      }
     }).attach(doc);
    }
   }
   // Save the current primary projection for local reference-only updates.
   // This does not request inventory/history again after a 026 ACK.
   primaryViewBase=baseView;
   // Do not wait for an additional getSession() call after showing UI.
   showCloudView(data,ctx);
   shownStock=Object.freeze({
    inventory:Object.freeze({...verified.inventory}),
    revisions:Object.freeze({...verified.revisions})
   });
   actor=ctx.actorUid;family=ctx.familyId;
   $('formalCurrentAccount').textContent=ctx.actorUid;
   $('formalCurrentFamily').textContent=ctx.familyId;
   screen('ready');
   if(documentsVerified)confirmedFullRead();
   else showSync(documentsClient?'库存已更新，正在核验共享数据…':
    '库存已更新，共享数据暂不可用；请点击刷新重试。','partial');
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
   if(!documentsVerified){
    const reading=optionalRead(documentsClient,ctx,scopeKey,data,identityEpoch);
    if(requireComplete===true&&await reading!==true)
     return 'SYNC_PARTIAL';
   }
   if(documentWritesEnabled===true)
    void refreshConflictButton().catch(()=>{});
    if(purchaseReleaseEnabled===true)
     void refreshBatchConflictButton().catch(()=>{});
   const settingsAppear=expectedSettings===null||
    (documentsVerified&&settingsChangeVisible(
     documentSnapshot?.documents?.settings,expectedSettings));
   const profileAppears=expectedProfile===null||
    (documentsVerified&&profileChangeVisible(
     documentSnapshot?.documents?.profile,expectedProfile));
   const growthAppears=expectedGrowth===null||
    (documentsVerified&&growthChangeVisible(
     documentSnapshot?.documents?.growth,expectedGrowth));
   const quotesAppear=expectedQuotes===null||
    (documentsVerified&&quoteChangeVisible(
     documentSnapshot?.documents?.quotes,expectedQuotes));
   const referenceAppears=expectedReference===null||
    (documentsVerified&&referenceChangeVisible(renderedReference,expectedReference));
   return !purchaseAppears?'PRIMARY_PURCHASE_READBACK_PENDING':
    !useAppears?'PRIMARY_USE_READBACK_PENDING':
    !reversedAppears?'PRIMARY_REVERSE_READBACK_PENDING':
    !stocktakeAppears?'PRIMARY_STOCKTAKE_READBACK_PENDING':
    !batchAppears?'BATCH_READBACK_PENDING':
    !quotesAppear?'QUOTES_READBACK_PENDING':
    !growthAppears?'GROWTH_READBACK_PENDING':
    !profileAppears?'PROFILE_READBACK_PENDING':
    !settingsAppear?'SETTINGS_READBACK_PENDING':
    !referenceAppears?'REFERENCE_READBACK_PENDING':mode;
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
  on('formalRefresh',async()=>{
   if(busy||refreshBusy)return;
   refreshBusy=true;fullReadVerified=false;
   const button=$('formalRefresh');
   if(button)button.disabled=true;
   showSync('正在刷新…','refreshing');
   try{
    const next=await restore({requireComplete:true});
    if(next!=='ready'&&next!=='SYNC_PARTIAL'&&mode==='ready')
     showSync('读取尚未完成，请稍后刷新。','partial');
   }finally{
    refreshBusy=false;if(button)button.disabled=false;
   }
  });
   // The 027 conflict must be proven uncommitted before user-confirmed archival.
   if($('formalResolveBatchConflict'))on('formalResolveBatchConflict',async()=>{
    if(mode!=='ready'||purchaseReleaseEnabled!==true
       ||purchaseOperatorApproved()!==true
       ||!batchGuard?.conflicts||!batchGuard?.abandonConflict){
     $('formalSyncState').textContent='批量盘点冲突处理目前不可用。';return;
    }
    const found=await batchGuard.conflicts();
    if(found?.status!=='BATCH_CONFLICTS_VERIFIED'
       ||found.items.length===0){
     $('formalSyncState').textContent='没有可处理的确定批量冲突。';
     batchConflictButton(false);return;
    }
    const item=found.items[0];
    const changes=item.items.map(row=>row.size+' → '+row.count+'片').join('、');
    if(host.confirm?.('旧批量盘点 '+changes+' 已因库存版本冲突而失败。'
       +'是否放弃这次未保存的修改并读取最新库存？'
       +'原批次编号和修改记录会保留。')!==true)return;
    const button=$('formalResolveBatchConflict');
    if(button)button.disabled=true;
    try{
     $('formalSyncState').textContent='正在核验原批次回执及最新库存…';
     const result=await batchGuard.abandonConflict({
      batchId:item.batchId,operatorApproved:true,userConfirmed:true
     });
     if(result?.status!=='BATCH_CONFLICT_ABANDONED'){
      $('formalSyncState').textContent='暂不能放弃原批次：'
       +String(result?.status||'UNVERIFIED')
       +'；原请求和库存未修改，请核验后重试。';
      return;
     }
     const next=await restore();
     $('formalSyncState').textContent=next==='ready'
      ?'原冲突批次已归档，最新库存已刷新；请重新盘点。'
      :'原冲突批次已归档，库存读取尚未完成，请刷新。';
    }finally{
     await refreshBatchConflictButton().catch(()=>{});
    }
   });
  // Explicit confirmation is required. No retry/ACK-unknown record may be discarded.
  on('formalResolveDocumentConflict',async()=>{
   if(documentWritesEnabled!==true||!documentsGuard?.conflicts
     ||!documentsGuard?.abandonConflict){
    $('formalSyncState').textContent='文档冲突处理尚未授权。';return;
   }
   const who=controller.verifiedContext();
   const found=await documentsGuard.conflicts();
   if(found?.status!=='DOCUMENT_CONFLICTS_VERIFIED'
     ||!found.items?.length){
    $('formalSyncState').textContent='没有已核实的确定冲突，请先核验原请求。';
    conflictButton(false);return;
   }
   const item=found.items[0];
   if(host.confirm?.('“'+item.kind+'”有一笔确定版本冲突，旧修改未保存。'
      +'是否放弃本次修改并刷新云端最新数据？'
      +'原 UUID 和冲突证据会保留，不会覆盖另一设备的数据。')!==true)
    return;
   const button=$('formalResolveDocumentConflict');
   if(button)button.disabled=true;
   try{
    if(busy){
     $('formalSyncState').textContent='页面正在刷新，请完成后再核验冲突。';return;
    }
    const next=await restore();
    const current=controller.verifiedContext();
    const scopeOk=next==='ready'&&current
     &&current.actorUid===who?.actorUid
     &&current.familyId===who?.familyId
     &&actor===who.actorUid&&family===who.familyId
     &&documentScope===actor+'\x00'+family
     &&documentSnapshot?.status==='PRIMARY_DOCUMENTS_FULLY_READ'
     &&renderedReference?.familyId===family
     &&renderedReference?.actorUid===actor;
    const latest=documentSnapshot?.documents?.[item.kind];
    if(!scopeOk||latest?.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
      ||!Number.isSafeInteger(latest.revision)
      ||latest.revision<=item.expectedRevision){
     $('formalSyncState').textContent=
      '冲突仍待核实：未读到完整最新云端数据，原 UUID 保留，请刷新重试。';
     return;
    }
    const changed=await documentsGuard.abandonConflict({
     requestId:item.requestId,operatorApproved:true,userConfirmed:true
    });
    if(changed?.status!=='DOCUMENT_CONFLICT_ABANDONED'
      ||changed.requestId!==item.requestId){
     $('formalSyncState').textContent=
      '未放弃原修改：'+String(changed?.status||'UNVERIFIED')
       +'；网络/回执不明时不可按确定冲突处理。';
     return;
    }
    attached?.releaseAbandonedDocumentConflict?.({
     kind:item.kind,requestId:item.requestId,
     actorUid:actor,familyId:family
    });
    $('formalSyncState').textContent='原 '+item.kind
     +' 修改已确认未提交，并由用户放弃。原 UUID 与冲突历史保留；'
     +'当前已显示云端最新版本，请重新编辑。';
   }finally{
    await refreshConflictButton();
   }
  });
  // Retry each domain's ORIGINAL UUIDs under its own authorization.
  const documentsApproved=()=>documentWritesEnabled===true;
  const purchasesApproved=()=>purchaseReleaseEnabled===true
    &&purchaseOperatorApproved()===true;
  $('formalSyncNow').hidden=true;
  if(documentsApproved()||purchasesApproved()){
   $('formalSyncNow').disabled=false;
   $('formalSyncNow').textContent='核验待处理';
  }
  on('formalSyncNow',async()=>{
   if(!documentsApproved()&&!purchasesApproved()){
    $('formalSyncState').textContent='正式业务写入尚未批准，未发送操作。';
    return;
   }
   // Document receipts may be retried while inventory writes remain OFF.
   // Never let this button invoke the other queue without its grant.
   if(documentsApproved()&&documentsGuard){
    const docPending=await documentsGuard.pending();
    if(docPending?.status==='DOCUMENT_QUEUE_COUNTS_VERIFIED'
      &&docPending.outstanding>0){
     const sent=await documentsGuard.send({operatorApproved:true});
     if(sent?.status==='DOCUMENT_SYNC_CONFIRMED'){
      const next=await restore();
      const verified=next==='ready'
       &&documentSnapshot?.status==='PRIMARY_DOCUMENTS_FULLY_READ'
       &&documentScope===actor+'\x00'+family;
      const releasedRef=verified
       &&await attached?.recoverReferenceButton?.({displayedReference:renderedReference});
      const releasedDocs=await attached?.recoverDocumentButtons?.({
       verified,displayedGrowth:documentSnapshot?.documents?.growth
        ?{...documentSnapshot.documents.growth,actorUid:actor}:null
      });
      const releasedQuote=verified
       &&await attached?.recoverMinimalButtons?.({domain:'quotes'});
      $('formalSyncState').textContent=next==='ready'
       ?releasedRef
        ?'原参考价 UUID 回执与实际页面价格均已确认，可以继续保存。'
        :releasedDocs
         ?'原资料或设置请求已确认，页面已重新读取，可以继续保存。'
         :releasedQuote
          ?'原候选价请求已核验并读回，可以继续保存。'
          :'原共享文档请求已确认，但尚有操作需要核验，请勿重复保存。'
       :'文档回执已确认，请刷新云端数据。';
     }else{
      if(['DOCUMENT_CONFLICT_REVIEW_REQUIRED',
        'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW'].includes(sent?.status))
       conflictButton(true);
      $('formalSyncState').textContent=
       '共享文档待确认：'+String(sent?.status||'UNVERIFIED')
        +'；确定冲突请使用单独放弃入口；其他结果保留原 UUID。';
     }
     return;
    }
    // A request may be already ACKed while its page readback was ambiguous.
    // Reverify cloud and the ORIGINAL UUID before enabling another save.
    if(docPending?.status==='DOCUMENT_QUEUE_COUNTS_VERIFIED'
      &&docPending.outstanding===0
      &&(attached?.hasPendingDocumentReview?.()
       ||attached?.hasPendingReferenceReview?.()
       ||attached?.hasPendingMinimalReview?.('quotes'))){
     const next=await restore();
     const verified=next==='ready'
      &&documentSnapshot?.status==='PRIMARY_DOCUMENTS_FULLY_READ'
      &&documentScope===actor+'\x00'+family;
     const releasedRef=verified
      &&await attached.recoverReferenceButton?.({displayedReference:renderedReference});
     const releasedDocs=await attached.recoverDocumentButtons({
      verified,displayedGrowth:documentSnapshot?.documents?.growth
       ?{...documentSnapshot.documents.growth,actorUid:actor}:null
     });
     const releasedQuote=verified
      &&await attached?.recoverMinimalButtons?.({domain:'quotes'});
     $('formalSyncState').textContent=releasedRef
      ?'原参考价 UUID 回执与实际显示价格均已核验，可以继续保存。'
      :releasedDocs
       ?'原宝宝资料或设置请求的回执已确认，页面已重新读取，可以继续保存。'
       :releasedQuote
        ?'原候选价请求已完成回执及读回核验，可以继续保存。'
        :'原操作还未完成回执及实际页面核验，保留 UUID，请勿重复保存。';
     return;
    }
   }
   if(!purchasesApproved()){
    $('formalSyncState').textContent='共享文档无待确认请求；库存与采购写入尚未批准。';
    return;
   }
   if(!primary)return;
   if(batchGuard){
    const pending=await batchGuard.pending();
    if(pending?.status==='BATCH_QUEUE_VERIFIED'&&pending.outstanding>0){
     const batchSent=await batchGuard.send({operatorApproved:true});
     if(['BATCH_ATOMIC_COMMIT_ACKED','BATCH_ACK_RECOVERED']
       .includes(batchSent?.status)){
      const next=await restore({expectedBatch:batchSent.items});
      $('formalSyncState').textContent=next==='ready'
       ?'原批次已确认，六尺码库存已从云端刷新。'
       :'批次回执已确认，云端库存仍需重新读取。';
     }else{
       if(batchSent?.status==='BATCH_NO_READY_OPERATION'){
        const found=await batchGuard.conflicts?.();
        await refreshBatchConflictButton().catch(()=>{});
        $('formalSyncState').textContent=found?.status==='BATCH_CONFLICTS_VERIFIED'
         &&found.items.length>0
         ?'原批次存在确定冲突；请点击“处理盘点冲突”。'
         :'批次目前无法继续发送，原编号已保留；请先核验原请求。';
       }else $('formalSyncState').textContent=
        '批次待核实：'+String(batchSent?.status||'UNVERIFIED')
         +'；已保留原批次 ID，请勿重复新建。';
      }
     return;
    }
   }
   const sent=await primary.flush({operatorApproved:true});
   if(sent.status==='PRIMARY_CLOUD_SYNCED_VERIFIED'){
    const next=await restore();
    const releasedPurchase=next==='ready'
     &&await attached?.recoverMinimalButtons?.({domain:'purchase'});
    $('formalSyncState').textContent=releasedPurchase
     ?'原采购请求已核验并显示在库存中，可以继续操作。'
     :next==='ready'
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
    cloudWritesEnabled:FORMAL_WRITE_ENABLED,
    fastReferenceEnabled:true,fastQuotesEnabled:true,
    fastGrowthEnabled:true,fastProfileEnabled:true,
    referenceAndQuotes:true,allowGrowth:true,allowProfile:true,allowSettings:false
   }),
  documentCommandsFactory:root.XBPrimaryDocumentsBusinessCommands,
  batchStocktakeFactory:({controller,host,primary})=>
   root.XBPrimaryStocktakeBatchClient.create({
    controller,host,primary,
    outboxFactory:root.XBDurableOutbox,
    contract:root.XBOutboxContract,
    cloudWritesEnabled:primary.cloudWritesEnabled===true
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
