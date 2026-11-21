/* Standalone V1.2.0 stable full-write release.
 * All implemented authenticated inventory and shared-document write domains
 * are enabled. CloudBase session, family scope, child scope, server RPC/RLS,
 * revision checks and ACK/readback verification remain authoritative.
 * Never loaded by V1.1.2, accepted M1-02 or the synthetic M3 preview.
 */
(function(root){
'use strict';
const FORMAL_WRITE_ENABLED=true;
const FORMAL_DOCUMENT_WRITE_ENABLED=true;
// Purchase release is prepared but OFF until separate operator authorization.
const FORMAL_PURCHASE_ENABLED=true;
const SIZES=['NB','S','M','L','XL','XXL'];
const OTP_COOLDOWN_MS=60000;
// Five parallel server-authorized document RPCs, with no full-body second pass.
const DOCUMENT_READ_TIMEOUT_MS=60000;
// A short App switch is not a reload. The next eligible foreground return
// after 45 seconds may reuse the normal authenticated full-cloud refresh.
const FOREGROUND_REFRESH_MS=45000;
// Only the six-size read RPC runs on this timer; unchanged stock is a no-op.
const FOREGROUND_INVENTORY_POLL_MS=30000;
const OTP_STORAGE_KEY='xiaobao_v120_formal_otp_resend_until';
const validLogin=new Set(['CLOUD_READ_ONLY_CONNECTED','FAMILY_READY_NO_BUSINESS_CHILD','CHILD_SELECTION_REQUIRED','FORMAL_FAMILY_VERIFIED']);
const notes={
 LOGIN_REQUIRED:'欢迎使用小宝管家，请使用邮箱验证码登录。',
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
 historyCache=null,maternalWeightFactory=null,
 batchStocktakeFactory=null,
 purchaseReleaseEnabled=FORMAL_PURCHASE_ENABLED,
 purchaseOperatorApproved=()=>false,
 documentWritesEnabled=FORMAL_DOCUMENT_WRITE_ENABLED}={}){
 if(!host||!doc||!loginController?.create||typeof readModelFactory!=='function'
   ||typeof primaryFactory!=='function'||!commandsFactory?.create
   ||!actionsFactory?.create||!projection?.project
   ||!ui?.show||!ui?.clear||!ui?.defaults||typeof scriptLoader!=='function')
  throw Error('formal_entry:dependencies_required');
 const $=id=>doc.getElementById(id);
 let controller=null,primary=null,warmPrimary=null,attached=null,pendingGuard=null,
     documentsGuard=null,batchGuard=null;
 let actor=null,family=null,mode='boot',busy=false,revision=0;
 let familyContext=null,maternalWeight=null;
 let shownStock=null,localInventoryBaselineReady=false,cachedPreview=null;
 const BOOT_MESSAGE='正在进入小宝管家…';
 let otpSending=false,otpConfirming=false,otpExpiresAt=0,otpTimer=null,otpSentBefore=false,
     otpFailure='';
 // Optional documents never gate primary readiness; scope is account-specific.
 let documentSnapshot=null,documentScope='',documentPending='',renderedReference=null;
 let primaryViewBase=null;
 let documentEpoch=0,documentReadSerial=0;
 let documentReadTask=null,fullyReadAt=null,fullReadVerified=false,fullReadScope='';
 let documentClientCache=null;
 let refreshBusy=false,pendingReviewSerial=0,syncActionBusy=false;
 let lastBackgroundAt=null,lastAutoAttemptAt=0,onlineRecoveryNeeded=false;
 let inventoryPollTimer=null,inventoryPollBusy=false,inventoryPollSerial=0;
 let inventoryPollTick=null;
 let mobileDraft=null;
 let pendingCount=0,pendingCountsVerified=false;
 const now=()=>typeof host.Date?.now==='function'?host.Date.now():Date.now();
 const syncTime=()=>new Intl.DateTimeFormat('zh-CN',{
  timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hour12:false
 }).format(fullyReadAt);
 const syncScope=()=>mode==='ready'&&actor&&family&&primaryViewBase?.childId
  ?actor+'\x00'+family+'\x00'+primaryViewBase.childId:'';
 const currentFullRead=()=>Boolean(fullReadVerified&&fullyReadAt
  &&fullReadScope&&fullReadScope===syncScope());
 // Stop the timer (and invalidate late reads) when the view is hidden,
 // offline or no longer verified. The existing startup and full-sync paths
 // remain the only places that apply stock and revision changes.
 function stopInventoryPolling(){
  if(inventoryPollTimer!==null){
   host.clearInterval?.(inventoryPollTimer);inventoryPollTimer=null;
  }
  inventoryPollSerial++;
  // The old in-flight RPC is now stale and its finally handler must not
  // hold the next foreground cycle hostage.
  inventoryPollBusy=false;
 }
 function updateInventoryPolling(){
  const eligible=mode==='ready'&&doc.visibilityState==='visible'
   &&host.navigator?.onLine!==false;
  if(!eligible){stopInventoryPolling();return;}
  if(inventoryPollTimer!==null||typeof host.setInterval!=='function')return;
  inventoryPollTimer=host.setInterval(()=>{void inventoryPollTick?.();},
   FOREGROUND_INVENTORY_POLL_MS);
  // Node fixtures do not need a permanent background task.
  inventoryPollTimer?.unref?.();
 }
 function showSync(message,phase='checking'){
  const el=$('formalSyncState');
  if(el)el.textContent=message;
  const bar=$('formalNotice');
  if(bar?.dataset)bar.dataset.syncPhase=phase;
 }
 function hasPendingPageReview(){
  return Boolean(attached?.hasPendingReferenceReview?.()
   ||attached?.hasPendingDocumentReview?.()
   ||['purchase','consume','reverse','stocktake','quotes']
    .some(x=>attached?.hasPendingMinimalReview?.(x)));
 }
 function syncButtonState(){
  const connected=host.navigator?.onLine!==false;
  const current=controller?.verifiedContext?.();
  const selected=primary?.selectedScope?.();
  const scoped=mode==='ready'&&Boolean(actor&&family&&primary
   &&current?.actorUid===actor&&current.familyId===family
   &&(!selected||(selected.actorUid===actor&&selected.familyId===family
    &&selected.childId===primaryViewBase?.childId)));
  const blocked=syncActionBusy||refreshBusy||busy;
  const headerRecovery=hasPendingPageReview();
  const get=$('formalGetCloudLatest'),send=$('formalSubmitPending');
  const refresh=$('formalRefresh');
  if(refresh)refresh.disabled=!scoped||!connected||blocked;
  const top=$('formalSyncNow'),count=$('formalPendingCount');
  if(get)get.disabled=!scoped||!connected||blocked;
  if(send)send.disabled=!scoped||!connected||blocked
   ||!pendingCountsVerified||pendingCount===0;
  if(top){
   top.hidden=!scoped||!connected
    ||(pendingCountsVerified&&pendingCount===0&&!headerRecovery);
   top.disabled=!scoped||!connected||blocked
    ||!pendingCountsVerified||(pendingCount===0&&!headerRecovery);
  }
  if(count)count.textContent=pendingCountsVerified
   ?'待同步：'+pendingCount+' 项':'待同步：状态待核验';
 }
 async function checkPending(){
  if(mode!=='ready'||!actor||!family||host.navigator?.onLine===false
    ||controller?.verifiedContext?.()?.actorUid!==actor
    ||controller?.verifiedContext?.()?.familyId!==family){
   pendingCountsVerified=false;pendingCount=0;syncButtonState();return null;
  }
  const key=actor+'\x00'+family,epoch=documentEpoch,serial=++pendingReviewSerial;
  const pendingChild=primary?.selectedScope?.()?.childId;
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
    ||key!==actor+'\x00'+family
    ||pendingChild!==primary?.selectedScope?.()?.childId)return null;
  const verified=results.every((x,i)=>x?.status===domains[i].expected
   &&Number.isSafeInteger(x.outstanding)&&x.outstanding>=0);
  pendingCountsVerified=verified;
  pendingCount=verified?results.reduce((n,x)=>n+x.outstanding,0):0;
  syncButtonState();
  const status=$('formalSyncState')?.textContent||'';
  const generic=/^(正在核对待处理|已同步 ·|上次完整获取：|有 \d+ 项待处理|待同步队列状态尚未核实|本机待同步：)/.test(status);
  if(generic){
   if(!verified)showSync('待同步队列状态尚未核实，请先核验。','partial');
   else if(pendingCount>0)showSync('有 '+pendingCount+' 项待处理操作。','pending');
   else if(currentFullRead())showSync('上次完整获取：'+syncTime(),'synced');
   else showSync('本机待同步：0 项；云端完整获取尚未核实。','partial');
  }
  return verified?{status:'verified',outstanding:pendingCount}:null;
 }
 // A verified primary read plus all five documents is the only source of
 // the "last complete cloud read" timestamp. Single-document/stock ACKs
 // and empty local queues never enter this function.
 function confirmedFullRead(ctx,childId){
  const current=controller?.verifiedContext?.(),selected=primary?.selectedScope?.();
  if(mode!=='ready'||!ctx||!childId||actor!==ctx.actorUid
    ||family!==ctx.familyId||current?.actorUid!==ctx.actorUid
    ||current?.familyId!==ctx.familyId
    ||primaryViewBase?.childId!==childId||!localInventoryBaselineReady
    ||(selected&&(selected.actorUid!==actor
     ||selected.familyId!==family||selected.childId!==childId)))return false;
  const scope=syncScope();
  if(!scope)return false;
  fullyReadAt=new Date();fullReadScope=scope;fullReadVerified=true;
  const status=$('formalSyncState')?.textContent||'';
  // Do not replace a business-specific success / conflict message from B5-02.
  if(!status||/^(正在刷新|正在核对待处理|已同步 ·|上次完整获取：|云端数据已更新 ·|库存已更新，|部分数据读取失败|部分云端数据尚未获取成功|待同步队列状态尚未核实|本机待同步：|有 \d+ 项待处理)/.test(status))
   showSync('云端数据已更新 · '+syncTime(),'synced');
  void checkPending().catch(()=>{});
  return true;
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
 function sameFamilyContext(ctx){
  return Boolean(ctx&&familyContext&&ctx.actorUid===familyContext.actorUid
   &&ctx.familyId===familyContext.familyId);
 }
 function setFamilyContext(ctx){
  if(familyContext&&!sameFamilyContext(ctx))ui.resetNavigation?.();
  familyContext=ctx;
  if(ctx)doc.body.dataset.formalFamilyReady='true';
  else{
   delete doc.body.dataset.formalFamilyReady;
   delete doc.body.dataset.formalMaternalOnly;
  }
  maternalWeight?.setContext(ctx);
 }
 function screen(next,message=''){
  mode=next;doc.body.dataset.formalState=next;
  if(next==='ready')delete doc.body.dataset.formalMaternalOnly;
  const healthEntry=$('formalOpenMaternalHealth');
  if(healthEntry)healthEntry.hidden=next!=='unverified'||!familyContext;
  // Keep one stable loading gate on successful cold starts; a validated
  // read-only cache is visible only after a cloud read fails.
  const viewingCache=Boolean(cachedPreview)&&next==='cached';
  $('formalLoginCard').hidden=next!=='login';
  $('formalLoadingCard').hidden=next!=='boot';
  if($('formalCachedInventory'))$('formalCachedInventory').hidden=!viewingCache;
  $('formalGateActions').hidden=next==='boot'||next==='login'||next==='ready';
  $('formalGateMessage').textContent=viewingCache
   ?'上次已确认库存 · 云端暂未同步 · 暂不可修改'
   :next==='boot'?BOOT_MESSAGE:message;
  $('formalAccountState').textContent=next==='ready'?'已连接'
   :next==='boot'?'检查中':next==='cached'?'未同步'
   :next==='login'?'未登录':next==='offline'?'离线':'需检查';
  updateInventoryPolling();
 }
 function sameCachedScope(){
  const ctx=controller?.verifiedContext?.();
  return Boolean(cachedPreview&&ctx?.app===cachedPreview.app
   &&ctx?.actorUid===cachedPreview.actorUid
   &&ctx?.familyId===cachedPreview.familyId);
 }
 function showCachedInventory(snapshot,ctx){
  if(snapshot?.status!=='PRIMARY_LAST_CONFIRMED_INVENTORY'
    ||snapshot.actorUid!==ctx.actorUid||snapshot.familyId!==ctx.familyId
    ||!snapshot.childId||!SIZES.every(size=>
     Number.isSafeInteger(snapshot.inventory?.[size])
      &&snapshot.inventory[size]>=0&&snapshot.inventory[size]<=100000
      &&Number.isSafeInteger(snapshot.revisions?.[size])
      &&snapshot.revisions[size]>=0))return false;
  const grid=$('formalCachedStockGrid');
  if(!grid)return false;
  // Only fixed size labels and validated integer counts enter this HTML.
  grid.innerHTML=SIZES.map(size=>
   '<div class="sizecard"><div class="size-top"><span class="size-pill">'
    +size+'</span></div><div class="stock-number"><b>'
    +snapshot.inventory[size]+'</b><small>片</small></div></div>').join('');
  cachedPreview={app:ctx.app,actorUid:ctx.actorUid,
   familyId:ctx.familyId,childId:snapshot.childId};
  // Retain verified tiles for a later read failure, never flash them mid-boot.
  return true;
 }
 // The cold-start label remains stable across session, cloud and IDB reads.
 // Errors still replace the gate with an actionable state.
 function bootStage(token,message){
  if(token!==revision||mode!=='boot')return;
  if($('formalGateMessage')?.textContent!==BOOT_MESSAGE)
   $('formalGateMessage').textContent=BOOT_MESSAGE;
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
 function clear({keepFamily=false}={}){
  if(!keepFamily)setFamilyContext(null);
  stopInventoryPolling();
  historyCache?.invalidate?.();
  conflictButton(false);batchConflictButton(false);
  ui.clear();mobileDraft?.reset();actor=null;family=null;primary=null;
  warmPrimary=null;cachedPreview=null;shownStock=null;
  if($('formalCachedInventory'))$('formalCachedInventory').hidden=true;
  if($('formalCachedStockGrid'))$('formalCachedStockGrid').innerHTML='';
  localInventoryBaselineReady=false;
  pendingGuard=null;documentsGuard=null;batchGuard=null;
  documentSnapshot=null;documentScope='';documentPending='';renderedReference=null;
  primaryViewBase=null;
  documentEpoch++;documentReadSerial++;pendingReviewSerial++;
  documentReadTask=null;fullyReadAt=null;fullReadVerified=false;fullReadScope='';
  const sync=$('formalSyncState'),feedback=$('formalCloudSyncFeedback');
  if(sync)sync.textContent='';
  if(feedback)feedback.textContent='';
  const bar=$('formalNotice');
  if(bar?.dataset)bar.dataset.syncPhase='checking';
  documentClientCache?.client?.invalidateReadScope?.();
  documentClientCache=null;
  pendingCount=0;pendingCountsVerified=false;syncButtonState();
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
 // Only called when a real, same-scope 009/027 ACK changed the primary
 // view during a pending read. Preserve that ACK's evidence per size, but
 // accept independently newer server revisions from other sizes. Both
 // histories remain available: a late read cannot erase a confirmed UUID.
 function protectAcknowledgedBusiness(incoming,acknowledged){
  const inventory={...incoming.state.inventory};
  const revisions={...incoming.revisions};
  for(const size of SIZES){
   const confirmed=acknowledged.revisions?.[size];
   const remote=incoming.revisions?.[size];
   if(Number.isSafeInteger(confirmed)&&confirmed>=0
     &&Number.isSafeInteger(remote)&&confirmed>=remote){
    inventory[size]=acknowledged.state.inventory[size];
    revisions[size]=confirmed;
   }
  }
  const transactions=incoming.state.transactions.slice();
  const keys=new Map(transactions.map((t,i)=>[t.operationId||t.id,i]));
  for(const confirmed of acknowledged.state.transactions){
   const key=confirmed.operationId||confirmed.id;
   const index=keys.get(key);
   if(index===undefined){
    keys.set(key,transactions.length);
    transactions.push(confirmed);
   }else if(confirmed.reversed===true&&transactions[index].reversed!==true){
    // A verified local reverse ACK must not be undone by an older server read.
    transactions[index]={...transactions[index],reversed:true,
     reversedByOperationId:confirmed.reversedByOperationId};
   }
  }
  return Object.freeze({...incoming,
   state:Object.freeze({...incoming.state,
    inventory:Object.freeze(inventory),transactions:Object.freeze(transactions)}),
   revisions:Object.freeze(revisions),historyCount:transactions.length});
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
   // The business ACK callbacks update primaryViewBase while this read is
   // pending. Overlay only on the latest verified same-child baseline.
   const latest=primaryViewBase||base;
   const selected=primary?.selectedScope?.();
   const verifiedContext=controller?.verifiedContext?.();
   if(!latest||latest.status!=='PRIMARY_READ_ONLY_READY'
     ||latest.canWrite!==false||latest.actorUid!==ctx.actorUid
     ||latest.familyId!==ctx.familyId||!latest.childId
     ||verifiedContext?.actorUid!==ctx.actorUid
     ||verifiedContext?.familyId!==ctx.familyId
     ||(selected&&(selected.actorUid!==ctx.actorUid
       ||selected.familyId!==ctx.familyId
       ||selected.childId!==latest.childId)))
    return false;
   // A document ACK may also have completed while a previous read was slow.
   // Keep the newer local confirmed revision, per document, without an RPC.
   let safeSnapshot=snapshot;
   if(documentSnapshot?.status==='PRIMARY_DOCUMENTS_FULLY_READ'
     &&documentScope===scopeKey){
    const currentDocs=documentSnapshot.documents;
    const incoming=snapshot.documents;
    const replacements={...incoming};
    let changed=false;
    for(const kind of ['reference','quotes','growth','profile','settings']){
     const newer=currentDocs?.[kind],older=incoming?.[kind];
     if(newer?.status==='PRIMARY_DOCUMENT_READ_VERIFIED'
       &&newer.familyId===ctx.familyId&&newer.childId===latest.childId
       &&older?.familyId===ctx.familyId&&older.childId===latest.childId
       &&Number.isSafeInteger(newer.revision)
       &&Number.isSafeInteger(older.revision)
       &&newer.revision>=older.revision){
      replacements[kind]=newer;changed=true;
     }
    }
    if(changed)safeSnapshot={...snapshot,documents:replacements};
   }
   if(!current())return false;
   const merged=documentsOverlay.apply(latest,safeSnapshot);
   if(merged?.canWrite!==false||merged.sharedBusinessDocumentsVerified!==true
     ||(merged.cloudDocumentsActorScope
       &&(merged.cloudDocumentsActorScope.familyId!==ctx.familyId
         ||merged.cloudDocumentsActorScope.childId!==latest.childId))
     ||merged.state?.inventory!==undefined
       &&JSON.stringify(merged.state.inventory)!==JSON.stringify(latest.state.inventory)
     ||JSON.stringify(merged.state.transactions)!==JSON.stringify(latest.state.transactions))
    throw Error('formal_entry:five_documents_unverified');
   showCloudView(merged,ctx);
   documentSnapshot=safeSnapshot;documentScope=scopeKey;
   confirmedFullRead(ctx,latest.childId);
   return true;
  }).catch(()=>{
   if(current()){
    fullReadVerified=false;
    const status=$('formalSyncState')?.textContent||'';
    if(/^(正在刷新|正在核对待处理|库存已更新，|部分数据读取失败|部分云端数据尚未获取成功|云端数据已更新 ·|上次完整获取：|待同步队列状态尚未核实)/.test(status))
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
  requireComplete=false,automatic=false}={}){
  if(busy)return expectedBatch!==null?'BATCH_READBACK_PENDING':
   expectedQuotes!==null?'QUOTES_READBACK_PENDING':
   expectedGrowth!==null?'GROWTH_READBACK_PENDING':
   expectedProfile!==null?'PROFILE_READBACK_PENDING':
   expectedSettings!==null?'SETTINGS_READBACK_PENDING':
   expectedReference!==null?'REFERENCE_READBACK_PENDING':mode;
  const retainedActor=actor,retainedFamily=family,retainedContext=controller?.verifiedContext?.();
  // Close local inventory-operation baselines for the entire refresh. This
  // prevents a new 027 batch from entering its separate queue after that
  // queue was checked but before the 009 snapshot update commits.
  busy=true;localInventoryBaselineReady=false;syncButtonState();
  const token=++revision;
  fullReadVerified=false;
  // Keep the already visible home during same-scope refreshes.
  // OTP just verified a session, so skip the login-checking label in that path.
  const loginAlreadyVerified=validLogin.has(verifiedStatus)
   &&controller.verifiedContext();
  if(mode!=='ready'){
   const stage=loginAlreadyVerified
    ?'正在获取家庭与库存数据…':'正在检查登录状态…';
   if(mode==='boot')bootStage(token,stage);
   else screen('boot',stage);
  }
  if(host.navigator?.onLine===false){
   if(sameCachedScope()){
    screen('cached');busy=false;syncButtonState();return mode;
   }
   clear();screen('offline',notes.OFFLINE_LOCAL_ONLY);
   busy=false;return mode;
  }
  try{
   // Reuse the just-confirmed session/family only for OTP; every new reload
   // still verifies afresh. Formal primary, receipt and RLS remain checked.
   const status=loginAlreadyVerified
    ?verifiedStatus:await bounded(()=>controller.connect(),18000);
   if(token!==revision)return mode;
   if(status==='LOGIN_REQUIRED'){
    clear();screen('login',notes.LOGIN_REQUIRED);return mode;
   }
   if(status==='OFFLINE_LOCAL_ONLY'){
    clear();screen('offline',notes.OFFLINE_LOCAL_ONLY);return mode;
   }
   // A stale SDK context from an earlier check cannot authorize a new
   // startup preview when the current login/family check was not successful.
   if(!validLogin.has(status))setFamilyContext(null);
   if(!validLogin.has(status)&&mode!=='ready'){
    clear();screen('unverified',notes[status]||notes.SESSION_UNVERIFIED);
    return mode;
   }
   const ctx=controller.verifiedContext();
   if(!ctx){
    clear();screen('unverified',notes[status]||notes.SESSION_UNVERIFIED);
    return mode;
   }
   if(actor!==ctx.actorUid||family!==ctx.familyId){
    const wasReady=mode==='ready';
    clear({keepFamily:sameFamilyContext(ctx)});
    // A changed account must not show the previous account's home or
    // the old boot message while the new family's stock is being read.
    if(wasReady)screen('boot','正在获取家庭与库存数据…');
   }
   if(validLogin.has(status))setFamilyContext(ctx);
   bootStage(token,'正在获取家庭与库存数据…');
   // A separate read-only IDB preview races the normal complete cloud read.
   // The existing primary bridge is reused for activation after verification.
   const cacheEpoch=documentEpoch;
   if(mode==='boot'&&!primary){
    try{
     warmPrimary=primaryFactory({controller,host,
      cloudWritesEnabled:purchaseReleaseEnabled===true});
     const candidate=warmPrimary;
     if(typeof candidate?.lastConfirmedInventory==='function')
      void Promise.resolve().then(()=>candidate.lastConfirmedInventory())
       .then(snapshot=>{
        const current=controller?.verifiedContext?.();
        if(token!==revision||cacheEpoch!==documentEpoch
          ||mode!=='boot'||!snapshot
          ||current?.app!==ctx.app||current?.familyId!==ctx.familyId
          ||current?.actorUid!==ctx.actorUid)return;
        showCachedInventory(snapshot,ctx);
       }).catch(()=>{});
    }catch(_){warmPrimary=null;}
   }
   // Capture BEFORE the asynchronous primary read, not after it returns.
   // The existing ACK callbacks replace primaryViewBase only after a server
   // receipt was validated. A changed reference is therefore fresh evidence.
   const businessBaselineAtRead=primaryViewBase;
   const readStartEpoch=documentEpoch;
   const verified=await bounded(()=>readModelFactory(ctx.app,historyCache).read({
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
    const readContext=controller?.verifiedContext?.();
    const selectedAfterRead=primary?.selectedScope?.();
    if(token!==revision||readStartEpoch!==documentEpoch)return mode;
    const stocktakeReadbackRequested=expectedStocktake!==null
      ||expectedBatch!==null;
    const contextChanged=readContext?.actorUid!==ctx.actorUid
      ||readContext?.familyId!==ctx.familyId;
    const familyOnly=sameFamilyContext(readContext)
     &&(verified?.status==='PRIMARY_NOT_READY'||verified?.status==='MIGRATION_READ_NOT_READY');
    const selectedChanged=Boolean(selectedAfterRead
      &&(selectedAfterRead.actorUid!==ctx.actorUid
        ||selectedAfterRead.familyId!==ctx.familyId
        ||selectedAfterRead.childId!==verified?.childId));
    const readModelIdentityChanged=verified?.status==='PRIMARY_READ_ONLY_READY'
      &&(verified.familyId!==ctx.familyId
        ||verified.actorUid!==ctx.actorUid
        ||typeof verified.childId!=='string'||!verified.childId);
    if(stocktakeReadbackRequested
      &&(contextChanged||selectedChanged||readModelIdentityChanged
        ||!selectedAfterRead)){
     clear({keepFamily:familyOnly});
     screen('unverified','账号、家庭或正式宝宝作用域已变化，盘点结果未完成核验。');
     return mode;
    }
    if(familyOnly){
     clear({keepFamily:true});screen('unverified',notes[verified.status]);
     return mode;
    }
    // Preserve the existing superseded-read behavior for ordinary refreshes.
    // Strict identity failure above is scoped to the 009/027 recovery handoff.
    if(contextChanged||selectedChanged){
     // The old UI must not survive a verified actor or primary-child switch,
     // including a background refresh with no startup cache on screen.
     if(contextChanged||mode==='ready'||cachedPreview){
      clear();screen('unverified',
       '账号、家庭或宝宝作用域已变化，已隐藏旧库存。');
     }
     return mode;
    }
   if(verified?.status!=='PRIMARY_READ_ONLY_READY'
     ||verified.canWrite!==false){
    clear();screen('unverified',notes[verified?.status]||
     '正式云端数据尚未核实；不显示演示数据。');
    return mode;
   }
   if(cachedPreview&&cachedPreview.childId!==verified.childId){
    // The active primary baby changed after the early IDB lookup.
    // Hide the old child's tile immediately, before slower activation.
    cachedPreview=null;
    if($('formalCachedInventory'))$('formalCachedInventory').hidden=true;
    if($('formalCachedStockGrid'))$('formalCachedStockGrid').innerHTML='';
    if(mode==='boot')screen('boot','正在核对本机库存…');
   }
   // Fresh, correctly scoped primary read was verified; do not overwrite
   // a form changed after the automatic network request began.
   if(automatic&&mobileDraft?.hasUnsaved?.()){
    showSync('刷新期间发现未保存内容，已暂缓自动同步；保存后可刷新。','partial');
    return 'AUTO_SYNC_DRAFT_DEFERRED';
   }
   const scopeKey=ctx.actorUid+'\x00'+ctx.familyId;
   const identityEpoch=documentEpoch;
   let data=projection.project(verified,ui.defaults());
   if(data.canWrite!==false)throw Error('formal_entry:unsafe_projection');
   const baseView=data;
   // A confirmed original receipt plus a newer per-size revision is the
   // recovery proof. Quantity may legitimately have changed again on another
   // device; render this complete current server snapshot, never the old count.
   const stocktakeAppears=expectedStocktake===null
     ||(expectedStocktake&&SIZES.includes(expectedStocktake.size)
       &&Number.isSafeInteger(expectedStocktake.count)
       &&expectedStocktake.count>=0&&expectedStocktake.count<=100000
       &&Number.isSafeInteger(expectedStocktake.expectedRevision)
       &&expectedStocktake.expectedRevision>=0
       &&Number.isSafeInteger(verified?.revisions?.[expectedStocktake.size])
       &&verified.revisions[expectedStocktake.size]>expectedStocktake.expectedRevision);
   const batchSizes=Array.isArray(expectedBatch)
     ?expectedBatch.map(item=>item?.size):[];
   const batchAppears=expectedBatch===null
     ||(Array.isArray(expectedBatch)&&expectedBatch.length>=2
       &&expectedBatch.length<=SIZES.length
       &&new Set(batchSizes).size===expectedBatch.length
       &&expectedBatch.every(item=>item&&SIZES.includes(item.size)
        &&Number.isSafeInteger(item.count)&&item.count>=0&&item.count<=100000
        &&Number.isSafeInteger(item.expectedRevision)&&item.expectedRevision>=0
        &&Number.isSafeInteger(verified?.revisions?.[item.size])
        &&verified.revisions[item.size]>item.expectedRevision));
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
     // A 026 ACK can advance one document while these five reads are pending.
     // A lower/equal read revision never replaces that confirmed snapshot.
     const currentDocs=documentScope===scopeKey
       ?documentSnapshot?.documents:null;
     const names=['reference','quotes','growth','profile','settings'];
     const nextDocs={...old};
     for(let i=0;i<names.length;i++){
      const kind=names[i],latest=currentDocs?.[kind],incoming=fresh[i];
      nextDocs[kind]=latest?.status==='PRIMARY_DOCUMENT_READ_VERIFIED'
       &&latest.familyId===ctx.familyId&&latest.childId===baseView.childId
       &&Number.isSafeInteger(latest.revision)
       &&latest.revision>=incoming.revision?latest:incoming;
     }
     documentSnapshot=Object.freeze({...documentSnapshot,
      documents:Object.freeze(nextDocs)});
     data=documentsOverlay.apply(data,documentSnapshot);
     documentsVerified=data.sharedBusinessDocumentsVerified===true;
    }else{
     // Never render stale shared documents after failed refresh.
     documentSnapshot=null;documentScope='';
    }
   }
   // The next real step is validating the local inventory bridge.
   // Do not show this stage before the primary cloud read succeeds.
   bootStage(token,'正在核对本机库存…');
   // An authenticated, receipt-backed primary is required for outbox setup.
   if(!primary){
    const p=warmPrimary||primaryFactory({controller,host,
     cloudWritesEnabled:purchaseReleaseEnabled===true});
    warmPrimary=null;
    // Write-capable activation retains independent server scope validation.
    const activation=await bounded(()=>p.activate({
     verifiedReadModel:purchaseReleaseEnabled===true?null:verified
    }),16000);
    if(activation.status!=='PRIMARY_OUTBOX_READ_ONLY_READY')
     throw Error('formal_entry:primary_outbox_unverified');
    primary=p;pendingGuard=p;
    const commands=commandsFactory.create({
     primary:p,uuid:()=>host.crypto.randomUUID(),
     clock:()=>new Date().toISOString(),
     isOnline:()=>host.navigator?.onLine!==false
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
       uuid:()=>host.crypto.randomUUID(),
       isOnline:()=>host.navigator?.onLine!==false
      });
     }
     if(typeof batchStocktakeFactory==='function'){
      batchGuard=batchStocktakeFactory({controller,host,primary:p});
     }
     attached=actionsFactory.create({
      primary:p,commands,documentCommands,documentQueue:documentsGuard,
      allowReference:true,allowQuotes:true,allowGrowth:true,allowProfile:true,
      allowSettings:true,
      onDocumentProgress:(kind,phase,timing={})=>{
       if(mode!=='ready'||actor!==ctx.actorUid||family!==ctx.familyId)return;
       if(phase==='idle')mobileDraft?.recover(kind);
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
      onSettingsAck:async(ack)=>{
       const current=controller.verifiedContext();
       const key=ctx.actorUid+'\x00'+ctx.familyId;
       const previous=documentSnapshot?.documents?.settings;
       if(!current||mode!=='ready'||identityEpoch!==documentEpoch
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||!primaryViewBase||documentScope!==key
         ||documentSnapshot?.status!=='PRIMARY_DOCUMENTS_FULLY_READ'
         ||previous?.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
         ||ack?.kind!=='settings'||ack.familyId!==ctx.familyId
         ||ack.actorUid!==ctx.actorUid||ack.childId!==previous.childId
         ||typeof ack.requestId!=='string'||!ack.requestId
         ||!Number.isSafeInteger(ack.expectedRevision)
         ||!Number.isSafeInteger(ack.revision)
         ||ack.expectedRevision!==previous.revision
         ||ack.revision!==previous.revision+1
         ||!ack.nextBody||typeof ack.nextBody!=='object'
         ||Array.isArray(ack.nextBody)||!ack.nextBody.target
         ||typeof ack.nextBody.target!=='object'
         ||Array.isArray(ack.nextBody.target)||!ack.nextBody.daily
         ||typeof ack.nextBody.daily!=='object'
         ||Array.isArray(ack.nextBody.daily))return 'pending';
       const revised=Object.freeze({...previous,revision:ack.revision,
        body:ack.nextBody});
       if(!settingsChangeVisible(revised,{record:ack.record,
        expectedRevision:ack.expectedRevision}))return 'pending';
       const snapshot=Object.freeze({...documentSnapshot,
        documents:Object.freeze({...documentSnapshot.documents,settings:revised})});
       try{
        const updated=documentsOverlay.apply(primaryViewBase,snapshot);
        if(updated?.sharedBusinessDocumentsVerified!==true
          ||updated.cloudDocumentsActorScope?.childId!==ack.childId)
         return 'pending';
        showCloudView(updated,current);
       }catch(_){return 'pending';}
       documentSnapshot=snapshot;
       return 'ready';
      },
      onSettingsReadback:async(expected)=>{
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
       if(phase==='idle')mobileDraft?.recover('reference');
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
       // An 026 ACK proves only this document write, not a full cloud read.
       void checkPending().catch(()=>{});
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
      onBatchReadback:async({items})=>{
       const visible=await restore({expectedBatch:items});
       // A committed 027 receipt is not a completed local handoff until the
       // normal verified restore has also synchronized the 009 snapshot.
       return visible==='ready'&&localInventoryBaselineReady?'ready':'pending';
      },
      onBatchAck:async ack=>{
       const current=controller.verifiedContext(),selected=primary?.selectedScope?.();
       const base=primaryViewBase,changes=ack?.changes,items=ack?.items;
       if(mode!=='ready'||!current||!selected||!base||!shownStock
         ||identityEpoch!==documentEpoch||actor!==ctx.actorUid
         ||family!==ctx.familyId||current.actorUid!==ctx.actorUid
         ||current.familyId!==ctx.familyId||selected.childId!==base.childId
         ||selected.familyId!==ctx.familyId||selected.actorUid!==ctx.actorUid
         ||base.familyId!==ctx.familyId||base.actorUid!==ctx.actorUid
         ||base.status!=='PRIMARY_READ_ONLY_READY'
         ||!Array.isArray(items)||items.length<2||items.length>6
         ||!Array.isArray(changes)||changes.length!==items.length)
        return 'pending';
       const inv={...base.state.inventory},rev={...base.revisions};
       const seen=new Set();
       for(const item of items){
        const change=changes.find(x=>x.size===item.size);
        if(!change||seen.has(item.size)||!SIZES.includes(item.size)
          ||!Number.isSafeInteger(item.count)||item.count<0||item.count>100000
          ||!Number.isSafeInteger(item.expectedRevision)
          ||item.expectedRevision!==shownStock.revisions?.[item.size]
          ||change.new_quantity!==item.count
          ||!Number.isSafeInteger(change.revision)
          ||change.revision<=item.expectedRevision)return 'pending';
        seen.add(item.size);
        inv[item.size]=change.new_quantity;
        rev[item.size]=change.revision;
       }
       const nextBase=Object.freeze({...base,
        state:Object.freeze({...base.state,inventory:inv}),
        revisions:Object.freeze(rev)});
       try{
        const view=documentSnapshot?.status==='PRIMARY_DOCUMENTS_FULLY_READ'
          &&documentScope===ctx.actorUid+'\x00'+ctx.familyId
         ?documentsOverlay.apply(nextBase,documentSnapshot):nextBase;
        if(items.some(x=>view.state.inventory[x.size]!==x.count))
         return 'pending';
        showCloudView(view,current);
       }catch(_){return 'pending';}
       primaryViewBase=nextBase;
       shownStock=Object.freeze({
        inventory:Object.freeze({...inv}),revisions:Object.freeze({...rev})
       });
       return 'ready';
      },
      readDocumentInput:el=>root.XBFormalUIData.documentAction(el),
      prepareQuoteEdit:id=>root.XBFormalUIData.prepareQuoteEdit(id),
      buildAllowsWrites:purchaseReleaseEnabled===true,
      operatorApproved:()=>purchaseReleaseEnabled===true
       &&purchaseOperatorApproved()===true,
      buildAllowsDocumentWrites:documentWritesEnabled===true,
      documentOperatorApproved:()=>documentWritesEnabled===true,
      purchaseOnly:true,allowConsume:true,allowReverse:true,
      allowStocktake:true,allowBatchStocktake:true,fastBatchStocktake:true,
      readStocktakeBaseline:()=>{
       const current=controller.verifiedContext(),selected=primary?.selectedScope?.();
       const base=primaryViewBase;
       if(!localInventoryBaselineReady)
        return {status:'PRIMARY_LOCAL_BASELINE_PENDING'};
       if(mode!=='ready'||!current||!selected||!base||!shownStock
         ||identityEpoch!==documentEpoch||actor!==ctx.actorUid
         ||family!==ctx.familyId||current.actorUid!==ctx.actorUid
         ||current.familyId!==ctx.familyId||selected.childId!==base.childId
         ||selected.familyId!==ctx.familyId||selected.actorUid!==ctx.actorUid
         ||base.familyId!==ctx.familyId||base.actorUid!==ctx.actorUid
         ||base.status!=='PRIMARY_READ_ONLY_READY')return null;
       return {familyId:ctx.familyId,actorUid:ctx.actorUid,
        childId:base.childId,inventory:{...shownStock.inventory},
        revisions:{...shownStock.revisions}};
      },
      readPurchaseBaseline:()=>{
       if(!localInventoryBaselineReady)
        return {status:'PRIMARY_LOCAL_BASELINE_PENDING'};
       const current=controller.verifiedContext();
       const base=primaryViewBase;
       const selected=primary?.selectedScope?.();
       if(mode!=='ready'||!current||!selected||!base||!shownStock
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||identityEpoch!==documentEpoch
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||selected.familyId!==ctx.familyId
         ||selected.actorUid!==ctx.actorUid
         ||selected.childId!==base.childId
         ||base.familyId!==ctx.familyId||base.actorUid!==ctx.actorUid
         ||base.status!=='PRIMARY_READ_ONLY_READY'
         ||!base.state?.inventory||!shownStock.revisions)return null;
       return Object.freeze({
        status:'PRIMARY_PURCHASE_BASELINE_VERIFIED',
        familyId:ctx.familyId,actorUid:ctx.actorUid,
        childId:base.childId,inventory:{...base.state.inventory},
        revisions:{...shownStock.revisions}
       });
      },
      readConsumeBaseline:()=>{
       if(!localInventoryBaselineReady)
        return {status:'PRIMARY_LOCAL_BASELINE_PENDING'};
       const current=controller.verifiedContext();
       const base=primaryViewBase,selected=primary?.selectedScope?.();
       if(mode!=='ready'||!current||!selected||!base||!shownStock
         ||identityEpoch!==documentEpoch
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||selected.familyId!==ctx.familyId
         ||selected.actorUid!==ctx.actorUid||selected.childId!==base.childId
         ||base.familyId!==ctx.familyId||base.actorUid!==ctx.actorUid
         ||base.status!=='PRIMARY_READ_ONLY_READY'
         ||!base.state?.inventory||!shownStock.revisions)return null;
       const settingsScope=ctx.actorUid+'\x00'+ctx.familyId;
       const settingsDoc=documentSnapshot?.status==='PRIMARY_DOCUMENTS_FULLY_READ'
         &&documentScope===settingsScope
         ?documentSnapshot.documents?.settings:null;
       // The migrated settings inside base.state are display data only.
       // A one-day use must use this actor's current verified cloud document.
       const verifiedDaily=settingsDoc?.status==='PRIMARY_DOCUMENT_READ_VERIFIED'
         &&settingsDoc.kind==='settings'
         &&settingsDoc.familyId===ctx.familyId
         &&settingsDoc.childId===base.childId
         &&Number.isSafeInteger(settingsDoc.revision)
         &&settingsDoc.revision>=0
         &&settingsDoc.body?.daily
         &&typeof settingsDoc.body.daily==='object'
         &&!Array.isArray(settingsDoc.body.daily)
         ?settingsDoc.body.daily:null;
       return Object.freeze({
        status:'PRIMARY_CONSUME_BASELINE_VERIFIED',
        familyId:ctx.familyId,actorUid:ctx.actorUid,
        childId:base.childId,inventory:{...base.state.inventory},
        revisions:{...shownStock.revisions},
        daily:verifiedDaily?{...verifiedDaily}:null,
        dailySettingsStatus:verifiedDaily?'verified':
          documentPending===settingsScope?'loading':'unverified'
       });
      },
      readReverseBaseline:record=>{
       if(!localInventoryBaselineReady)
        return {status:'PRIMARY_LOCAL_BASELINE_PENDING'};
       const current=controller.verifiedContext(),selected=primary?.selectedScope?.();
       const base=primaryViewBase;
       const original=base?.state?.transactions?.find(t=>
        t.operationId===record?.operationId);
       if(mode!=='ready'||!current||!selected||!base||!shownStock
         ||identityEpoch!==documentEpoch
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||selected.familyId!==ctx.familyId
         ||selected.actorUid!==ctx.actorUid||selected.childId!==base.childId
         ||base.familyId!==ctx.familyId||base.actorUid!==ctx.actorUid
         ||base.status!=='PRIMARY_READ_ONLY_READY'
         ||!base.state?.inventory||!shownStock.revisions
         ||!original||original.origin!=='cloud_post_migration'
         ||!['buy','use'].includes(original.type)||original.reversed===true
         ||original.reversedByOperationId||original.size!==record.size
         ||original.type!==record.type||original.id!==record.id)
        return null;
       return Object.freeze({
        status:'PRIMARY_REVERSE_BASELINE_VERIFIED',
        familyId:ctx.familyId,actorUid:ctx.actorUid,
        childId:base.childId,inventory:{...base.state.inventory},
        revisions:{...shownStock.revisions},
        originalId:original.operationId,originalSize:original.size,
        originalType:original.type
       });
      },
      confirmReverse:record=>host.confirm?.(
       record.type==='buy'
        ?'确认撤销这条采购记录吗？库存将相应调整。'
        :'确认撤销这条消耗记录吗？库存将相应调整。')===true,
      onPurchaseAck:async(ack)=>{
       const current=controller.verifiedContext();
       const selected=primary?.selectedScope?.();
       const op=ack?.operation,payload=op?.payload,
        receipt=ack?.receipt,base=primaryViewBase;
       if(!current||mode!=='ready'||identityEpoch!==documentEpoch
         ||actor!==ctx.actorUid||family!==ctx.familyId
         ||current.actorUid!==ctx.actorUid||current.familyId!==ctx.familyId
         ||!selected||selected.childId!==base?.childId
         ||!base||base.status!=='PRIMARY_READ_ONLY_READY'
         ||base.familyId!==ctx.familyId||base.actorUid!==ctx.actorUid
         ||ack.familyId!==ctx.familyId||ack.actorUid!==ctx.actorUid
         ||ack.childId!==base.childId||op?.familyId!==ctx.familyId
         ||op.actorUid!==ctx.actorUid
         ||(op.type!=='inventory.delta'&&op.type!=='transaction.reverse'
           &&op.type!=='inventory.count')
         ||(op.type==='inventory.delta'
           &&!['buy','use'].includes(payload?.kind))
         ||payload?.childId!==base.childId
         ||receipt?.operationId!==op.id||ack.operationId!==op.id
         ||receipt.childId!==base.childId
         ||receipt.size!==payload.size||!SIZES.includes(receipt.size)
         ||receipt.duplicate===true
         ||(op.type==='inventory.delta'
           &&(!Number.isSafeInteger(payload.amount)||payload.amount<1))
         ||!Number.isSafeInteger(receipt.quantity)||receipt.quantity<0
         ||!Number.isSafeInteger(receipt.revision)||receipt.revision<1
         ||!Number.isSafeInteger(shownStock?.revisions?.[payload.size])
         ||receipt.revision<=shownStock.revisions[payload.size]
         ||(op.type==='inventory.count'
           &&(payload.kind==='stocktake_batch'||!Number.isSafeInteger(payload.count)
             ||payload.count!==receipt.quantity||payload.count<0
             ||payload.count>100000
             ||op.expectedRevision!==shownStock.revisions[payload.size]))
         ||(payload.kind==='buy'
          &&(!payload.purchase
            ||!Number.isSafeInteger(payload.purchase.totalFen)
            ||!payload.purchase.purchaseDate))
         ||(payload.kind==='use'&&payload.purchase!=null)
         ||(payload.kind==='use'
          &&(!Number.isSafeInteger(payload.amount)||payload.amount<1
           ||!root.XBPrimaryBusinessDate?.fromTimestamp))
         ||(op.type==='transaction.reverse'
          &&(typeof payload.reversesOperationId!=='string'
           ||!base.state?.transactions?.some(t=>
            t.operationId===payload.reversesOperationId
            &&t.origin==='cloud_post_migration'
            &&['buy','use'].includes(t.type)&&t.size===payload.size
            &&t.reversed!==true&&!t.reversedByOperationId)))
         ||base.state?.transactions?.some(x=>x.operationId===op.id))
        return 'pending';
       const reversing=op.type==='transaction.reverse',
        stocktaking=op.type==='inventory.count',p=payload.purchase;
       const row=payload.kind==='buy'?{
        id:'cloud:'+op.id,type:'buy',
        date:p.purchaseDate,brand:p.brand,series:p.series,
        size:payload.size,pieces:payload.amount,
        price:p.totalFen/100,operationId:op.id,
        reversed:false,reversedByOperationId:null,
        origin:'cloud_post_migration'
       }:reversing||stocktaking?null:{
        id:'cloud:'+op.id,type:'use',
        date:root.XBPrimaryBusinessDate.fromTimestamp(payload.occurredAt),
        size:payload.size,pieces:payload.amount,price:0,
        occurredAt:payload.occurredAt,operationId:op.id,
        reversed:false,reversedByOperationId:null,
        origin:'cloud_post_migration'
       };
       const inventory={...base.state.inventory,[payload.size]:receipt.quantity};
       const revisions={...base.revisions,[payload.size]:receipt.revision};
       const transactions=stocktaking?base.state.transactions:reversing
        ?base.state.transactions.map(t=>
         t.operationId===payload.reversesOperationId
          ?{...t,reversed:true,reversedByOperationId:op.id}:t)
        :[row,...base.state.transactions];
       const nextBase=Object.freeze({...base,
        state:Object.freeze({...base.state,inventory,transactions}),
        revisions:Object.freeze(revisions),
        historyCount:(base.historyCount??base.state.transactions.length)
         +(reversing||stocktaking?0:1)});
       let view;
       try{
        view=documentSnapshot?.status==='PRIMARY_DOCUMENTS_FULLY_READ'
          &&documentScope===ctx.actorUid+'\x00'+ctx.familyId
         ?documentsOverlay.apply(nextBase,documentSnapshot):nextBase;
        if(view.state.inventory[payload.size]!==receipt.quantity
          ||!(stocktaking?true:reversing
            ?view.state.transactions.some(t=>
              t.operationId===payload.reversesOperationId
              &&t.reversed===true&&t.reversedByOperationId===op.id)
            :view.state.transactions.some(x=>x.operationId===op.id)))
         return 'pending';
        showCloudView(view,current);
       }catch(_){return 'pending';}
       primaryViewBase=nextBase;
       shownStock=Object.freeze({
        inventory:Object.freeze({...inventory}),
        revisions:Object.freeze({...revisions})
       });
       return 'ready';
      },
      onPurchaseReadback:({operationId,kind,reversesOperationId,
       size,count,expectedRevision})=>restore({
       expectedPurchaseId:kind==='buy'?operationId:null,
       expectedUseId:kind==='use'?operationId:null,
       expectedReverseId:kind==='reverse'?operationId:null,
       expectedOriginalId:kind==='reverse'?reversesOperationId:null,
       expectedStocktake:kind==='stocktake'?{size,count,expectedRevision}:null
      }),
      formalModeSelected:()=>mode==='ready',
      readSyncBusy:()=>busy||refreshBusy||syncActionBusy,
      readPurchase:()=>root.XBFormalUIData.purchase(),
      readQuote:id=>root.XBFormalUIData.quote(id),
      readTransaction:id=>root.XBFormalUIData.transaction(id),
      notify:answer=>{
        mobileDraft?.settle(answer);
        const resultCode=String(answer?.status||'');
        if(resultCode==='FORMAL_REFRESH_IN_PROGRESS'){
         $('formalSyncState').textContent='正在核验云端数据，暂不可修改；未创建新请求。';
         return;
        }
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
       void checkPending().catch(()=>{});
       $('formalSyncState').textContent=
        ['OFFLINE_FORMAL_QUEUE_NOT_APPROVED',
          'DOCUMENT_OFFLINE_REQUIRES_VERIFIED_BASELINE'].includes(answer?.status)
         ?'当前网络不可用，本次操作未保存，请联网后重新操作。'
        :answer?.status==='PRIMARY_STOCKTAKE_CLOUD_ACK_APPLIED'
         ?'库存盘点成功，库存已更新'
        :answer?.status==='PRIMARY_STOCKTAKE_CLOUD_READBACK_VERIFIED'
         ?'单尺码盘点已保存，六尺码云端库存已重新读取。'
          :answer?.status==='BATCH_CLOUD_ACK_APPLIED'
         ?'批量盘点成功，库存已更新'
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
         :answer?.status==='SETTINGS_CLOUD_ACK_APPLIED'
         ?'设置已由云端确认，首页及补货计划已立即更新。'
         :answer?.status==='SETTINGS_CLOUD_READBACK_VERIFIED'
         ?'设置已保存并从云端重新读取；首页及补货计划已更新。'
         :answer?.status==='SETTINGS_UNCHANGED'
         ?'设置没有变化，无需保存。'
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
         :['PRIMARY_PURCHASE_CLOUD_ACK_APPLIED',
          'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED',
          'PRIMARY_USE_CLOUD_ACK_APPLIED',
          'PRIMARY_USE_CLOUD_READBACK_VERIFIED',
          'PRIMARY_REVERSE_CLOUD_ACK_APPLIED',
          'PRIMARY_REVERSE_CLOUD_READBACK_VERIFIED'].includes(answer?.status)
         ?'云端操作已确认，库存及记录已更新。'
         :'云端操作状态：'+String(answer?.status||'UNVERIFIED')
          +(documentWritesEnabled===true
           ?'；请核验原参考价请求状态，未确认前不要重复保存。'
           :purchaseReleaseEnabled===true
            ?'；请核查原操作 ID。':'；正式写入尚未授权。');
      }
     }).attach(doc);
    }
   }
   // An ACK may have advanced business state while this restore awaited
   // five documents. Do not replace that verified ACK with the older read.
   const live=primaryViewBase!==businessBaselineAtRead
     &&primaryViewBase?.status==='PRIMARY_READ_ONLY_READY'
     &&primaryViewBase.actorUid===ctx.actorUid
     &&primaryViewBase.familyId===ctx.familyId
     &&primaryViewBase.childId===baseView.childId
     ?primaryViewBase:null;
   const displayBase=live?protectAcknowledgedBusiness(baseView,live):baseView;
   if(live){
    data=documentsVerified
     ?documentsOverlay.apply(displayBase,documentSnapshot):displayBase;
   }
   const latestContext=controller?.verifiedContext?.();
   const selectedNow=primary?.selectedScope?.();
   if(token!==revision||readStartEpoch!==documentEpoch
      ||identityEpoch!==documentEpoch
      ||latestContext?.actorUid!==ctx.actorUid
      ||latestContext?.familyId!==ctx.familyId
      ||(selectedNow&&(selectedNow.actorUid!==ctx.actorUid
        ||selectedNow.familyId!==ctx.familyId
        ||selectedNow.childId!==displayBase.childId)))return mode;
   // Still the same local-inventory stage when an existing primary bridge
   // skips activate() but must perform a fresh IDB baseline sync.
   bootStage(token,'正在核对本机库存…');
   // Keep the local 009 baseline aligned with this already verified read.
   // Check the separate 027 queue first; the 009 queue and snapshot are then
   // checked atomically by the IndexedDB outbox transaction.
   let localBaselineResult=null;
   if(typeof primary?.syncVerifiedReadModel==='function'){
    let batchQueue={status:'BATCH_QUEUE_VERIFIED',outstanding:0};
    if(batchGuard?.pending){
     try{batchQueue=await batchGuard.pending();}
     catch(_){batchQueue={status:'BATCH_QUEUE_UNVERIFIED'};}
    }
    const baselineReadModel={...verified,
     inventory:{...(displayBase.state?.inventory||verified.inventory)},
     revisions:{...(displayBase.revisions||verified.revisions)}};
    localBaselineResult=await primary.syncVerifiedReadModel({
     verifiedReadModel:baselineReadModel,batchQueue
    });
    localInventoryBaselineReady=
     localBaselineResult?.status==='PRIMARY_LOCAL_BASELINE_SYNCED';
   }else{
    // Minimal legacy test doubles have no IndexedDB bridge; production
    // primary-cloud-operations always exposes syncVerifiedReadModel.
    localInventoryBaselineReady=true;
   }
   const postSyncContext=controller?.verifiedContext?.();
   const postSyncSelected=primary?.selectedScope?.();
   if(token!==revision||readStartEpoch!==documentEpoch
     ||postSyncContext?.actorUid!==ctx.actorUid
     ||postSyncContext?.familyId!==ctx.familyId
     ||(postSyncSelected&&(postSyncSelected.actorUid!==ctx.actorUid
       ||postSyncSelected.familyId!==ctx.familyId
       ||postSyncSelected.childId!==displayBase.childId))){
    localInventoryBaselineReady=false;return mode;
   }
   if(automatic&&mobileDraft?.hasUnsaved?.()){
    // If the user edited during the document/IDB awaits, preserve their
    // input and keep old stock write-disabled until another verified read.
    localInventoryBaselineReady=false;
    showSync('刷新期间发现未保存内容，已暂缓自动同步；保存后可刷新。','partial');
    return 'AUTO_SYNC_DRAFT_DEFERRED';
   }
   primaryViewBase=displayBase;
   // Do not wait for an additional getSession() call after showing UI.
   showCloudView(data,ctx);
   shownStock=Object.freeze({
    // Real projected views carry state + revisions; keep the earlier
    // minimal read-model fallback for login-only integration harnesses.
    inventory:Object.freeze({...((displayBase.state?.inventory)||verified.inventory)}),
    revisions:Object.freeze({...((displayBase.revisions)||verified.revisions)})
   });
   actor=ctx.actorUid;family=ctx.familyId;
   $('formalCurrentAccount').textContent=ctx.actorUid;
   $('formalCurrentFamily').textContent=ctx.familyId;
   screen('ready');syncButtonState();
   void checkPending().catch(()=>{});
   if(!localInventoryBaselineReady){
    const code=localBaselineResult?.status||'PRIMARY_LOCAL_BASELINE_UNVERIFIED';
    showSync(/PENDING/.test(code)
     ?'云端库存已刷新，但本机存在待确认操作；原 UUID 和库存快照已保留，请先核验原操作。'
     :'云端库存已刷新，但本机库存基线尚未通过核验，暂不可继续库存操作；请刷新重试。',
     'partial');
   }else if(documentsVerified)confirmedFullRead(ctx,verified.childId);
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
  }catch(error){
   // A denied family/child scope must not fall back to an old IDB stock tile.
   // Only a transient read/network error may expose the still-nonwritable
   // same-scope cached gate. The server remains authoritative.
   const failure=String(error?.code||'')+' '+String(error?.message||'');
   if(/permission[_ -]?denied|access[_ -]?denied|unauthori[sz]ed|forbidden|42501|403/i.test(failure)){
    clear();screen('unverified',notes.FAMILY_PERMISSION_DENIED);
    return mode;
   }
   const current=controller?.verifiedContext?.();
   if((mode==='boot'||mode==='cached')&&sameCachedScope()){
    // Network/read errors must not erase a verified read-only cache.
    // A cached gate never changes mode to ready or unlocks any command.
    screen('cached');return mode;
   }
   if(mode==='ready'&&retainedActor&&retainedFamily
     &&current?.actorUid===retainedActor&&current.familyId===retainedFamily
     &&retainedContext?.actorUid===retainedActor
     &&retainedContext.familyId===retainedFamily){
    showSync('部分云端数据尚未获取成功，请稍后重试','partial');
    return 'SYNC_PARTIAL';
   }
   clear();screen('unverified','家庭权限或正式宝宝数据尚未核实，未显示家庭信息。');
   return mode;
  }finally{busy=false;syncButtonState();}
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
  screen('boot',BOOT_MESSAGE);
  controller=loginController.create({
   host,storage:null,view:authView(),scriptLoader,
   deferChildReadToFormal:true
  });
  maternalWeight=maternalWeightFactory?.(controller);
  restoreOtpCooldown();startOtpTicker();redrawConfirmButton();
  function on(id,fn){
   $(id)?.addEventListener('click',()=>{
    Promise.resolve().then(fn).catch(()=>{
     $('formalGateMessage').textContent='操作未核实，请检查网络。';
    });
   });
  }
  on('formalSendOtp',sendOtp);
  on('formalConfirmOtp',confirmOtp);
  on('formalRetry',restore);
  on('formalOpenMaternalHealth',()=>{
   if(mode!=='unverified'||!familyContext)return;
   if(!sameFamilyContext(controller.verifiedContext())){
    clear();screen('unverified','账号或家庭已变化，请重新检查。');
    return;
   }
   ui.openMaternalHealth?.();
  });
  async function fetchCloudLatest({automatic=false}={}){
   if(mode!=='ready'||!actor||!family||busy||refreshBusy||syncActionBusy)return;
   if(host.navigator?.onLine===false){
    const node=$('formalCloudSyncFeedback');
    if(node)node.textContent='获取云端数据失败，请检查网络后重试';
    showSync('获取云端数据失败，请检查网络后重试','partial');
    syncButtonState();return;
   }
   refreshBusy=true;fullReadVerified=false;syncButtonState();
   const node=$('formalCloudSyncFeedback');
   if(node)node.textContent='正在获取云端最新数据…';
   showSync('正在刷新…','refreshing');
   const epoch=documentEpoch,account=actor,household=family;
   const child=primaryViewBase?.childId;
   try{
    const next=await restore({requireComplete:true,automatic});
    if(next==='AUTO_SYNC_DRAFT_DEFERRED'){
     if(node)node.textContent='自动同步已暂缓：编辑内容未保存，请保存后手动刷新。';
     return;
    }
    // An ordinary restore can return the still-visible view if its verified
    // actor/child changed during an in-flight read. For an explicit refresh,
    // never leave that old household visible as if it were still authorized.
    if(epoch===documentEpoch&&actor===account&&family===household){
     const current=controller?.verifiedContext?.();
     const selected=primary?.selectedScope?.();
     if(current?.actorUid!==account||current?.familyId!==household
       ||(selected&&(selected.actorUid!==account
        ||selected.familyId!==household||selected.childId!==child))){
      clear();
      screen('unverified','账号、家庭或宝宝作用域已变化，请重新检查。');
      return;
     }
    }
    if(epoch!==documentEpoch||actor!==account||family!==household)return;
    if(node)node.textContent=next==='ready'&&currentFullRead()
      &&host.navigator?.onLine!==false
     ?'云端数据已更新'
     :'获取云端数据失败，请检查网络后重试';
    if((next!=='ready'||!currentFullRead())
      &&/正在刷新/.test($('formalSyncState')?.textContent||''))
     showSync('获取云端数据失败，请检查网络后重试','partial');
   }catch(_){
    if(epoch===documentEpoch&&actor===account&&family===household&&node)
     node.textContent='获取云端数据失败，请检查网络后重试';
   }finally{
    refreshBusy=false;syncButtonState();
    await checkPending().catch(()=>{});
   }
  }
  on('formalRefresh',fetchCloudLatest);
  on('formalGetCloudLatest',fetchCloudLatest);
  // T05-P2-01: an Android touch entrypoint only; both existing refresh
  // buttons and this gesture call fetchCloudLatest(), never a second sync.
  const touchInput=Number(host.navigator?.maxTouchPoints||0)>0
   ||host.matchMedia?.('(any-pointer: coarse)')?.matches===true
   ||host.matchMedia?.('(pointer: coarse)')?.matches===true;
  // Ensure native overscroll is contained even when the Android PWA media
  // query disagrees with navigator.maxTouchPoints.
  if(touchInput)doc.documentElement?.classList?.add('xiaobao-pull-touch');
  // Draft tracking is shared with foreground sync on desktop and mobile.
  // Only touch gestures remain conditional on the Android pointer capability.
  {
   const threshold=64;
   let pull=null,pullFeedbackTimer=null;
   const pullFeedback=(phase)=>{
    const bar=$('formalNotice');
    if(!bar?.dataset)return;
    if(pullFeedbackTimer!==null){
     (host.clearTimeout||clearTimeout)(pullFeedbackTimer);pullFeedbackTimer=null;
    }
    if(phase)bar.dataset.pullPhase=phase;
    else delete bar.dataset.pullPhase;
    if(phase==='success'||phase==='failure'){
     pullFeedbackTimer=(host.setTimeout||setTimeout)(()=>{
      if(bar.dataset.pullPhase===phase)delete bar.dataset.pullPhase;
      pullFeedbackTimer=null;
     },1400);
    }
   };
   // Static inputs survive renderAll(): connectivity alone cannot release
   // unsaved drafts. Ignore filter-only controls, but protect unknown edits.
   const editedFields=new Map(),saving=new Map();
   let focusValues=new WeakMap(),editSerial=0;
   const fieldValue=field=>field?.type==='checkbox'
    ?String(Boolean(field.checked)):String(field?.value??'');
   const groupOf=field=>{
    const id=String(field?.id||'');
    if(['growthRange','refBrand','refSize','refSearch','formalEmail',
       'formalOtp','maternalWeightDate','maternalWeightTime','maternalWeightJin','maternalWeightNote',
       'maternalProfileJin','maternalProfileDue','maternalProfileDelivery'].includes(id))return null;
    if(['sizeMode','currentSize','goalPrice'].includes(id))return 'size';
    if(['replenishMode','replenishDays'].includes(id)
      ||/^(target_|daily_)/.test(id))return 'plans';
    if(['babyName','babySex','dueDate','birthDate','birthHour',
       'birthMinute','birthSecond','birthWeight','birthLength'].includes(id))
     return 'profile';
    if(['qBrand','qSeriesChoice','qSeries','qSize','qPerPack',
       'qPacks','qPrice'].includes(id))return 'quotes';
    if(['weightDate','weightTime','weightKg','weightNote'].includes(id))
     return 'growth';
    if(id==='editedReferencePrice')return 'reference';
    if(/^inv_/.test(id))return 'stocktake';
    return 'other'; // unknown inputs stay guarded until replaced
   };
   const validField=field=>/^(INPUT|TEXTAREA|SELECT)$/i.test(field?.tagName||'');
   doc.addEventListener('focusin',event=>{
    const field=event?.target;
    if(mode==='ready'&&validField(field)&&groupOf(field)
      &&!editedFields.has(field))focusValues.set(field,fieldValue(field));
   },true);
   const rememberEdit=event=>{
    const field=event?.target;
    if(mode!=='ready'||!validField(field)||!groupOf(field))return;
    if(focusValues.has(field)&&fieldValue(field)===focusValues.get(field)){
     editedFields.delete(field);return;
    }
    editedFields.set(field,++editSerial);
   };
   doc.addEventListener('input',rememberEdit,true);
   doc.addEventListener('change',rememberEdit,true);
   // Capture exactly the submitted form and input versions. A confirmed
   // settings write must not discard a second unsaved settings form.
   const stage=(domain,group,filter=()=>true)=>{
    if(saving.has(domain))return;
    saving.set(domain,{epoch:documentEpoch,scope:syncScope(),
     fields:new Map([...editedFields].filter(([field])=>
      groupOf(field)===group&&filter(field)))});
   };
   const release=domain=>{
    const snapshot=saving.get(domain);
    if(!snapshot)return;
    saving.delete(domain);
    if(snapshot.epoch!==documentEpoch||snapshot.scope!==syncScope())return;
    for(const [field,version] of snapshot.fields){
     if(editedFields.get(field)!==version)continue;
     editedFields.delete(field);
     focusValues.set(field,fieldValue(field));
    }
   };
   const forget=group=>{
    for(const field of editedFields.keys())
     if(groupOf(field)===group){
      editedFields.delete(field);focusValues.set(field,fieldValue(field));
     }
   };
   const saveTarget=event=>{
    // A blocked click must not stage a fictitious document save.
    if(busy||refreshBusy||syncActionBusy)return;
    const button=event?.target?.closest?.('button,[data-action],[data-preset]');
    if(!button)return;
    const id=button.id,action=button.dataset?.action;
    if(id==='saveSizePreferences')stage('settings','size');
    else if(id==='savePlans')stage('settings','plans');
    else if(button.dataset?.preset)stage('settings','plans',field=>
     field.id==='target_NB'||field.id==='target_S');
    else if(id==='saveProfile')stage('profile','profile');
    else if(id==='saveQuote')stage('quotes','quotes');
    else if(id==='buyNow')stage('purchase','quotes');
    else if(id==='saveWeight')stage('growth','growth');
    else if(id==='saveStocks')stage('stocktake','stocktake');
    else if(id==='saveEditedReference'||id==='restoreDefaultReference'
      ||action==='resetref')stage('reference','reference');
   };
   doc.addEventListener('click',saveTarget,true);
   doc.addEventListener('submit',event=>{
    if(!busy&&!refreshBusy&&!syncActionBusy
      &&event?.target?.id==='priceEditForm')stage('reference','reference');
   },true);
   // Legacy cancel button handlers have reset their inputs before bubbling.
   doc.addEventListener('click',event=>{
    const id=event?.target?.closest?.('button')?.id;
    if(id==='cancelWeight')forget('growth');
    if(id==='closeRefEditor'||id==='cancelEditedReference')forget('reference');
   });
   mobileDraft={
    settle(answer){
     const status=String(answer?.status||'');
     const kind=status.startsWith('SETTINGS_')?'settings'
      :status.startsWith('PROFILE_')?'profile'
      :status.startsWith('QUOTES_')?'quotes'
      :status.startsWith('GROWTH_')?'growth'
      :status.startsWith('REFERENCE_')?'reference'
      :status.startsWith('PRIMARY_STOCKTAKE_')||status.startsWith('BATCH_')
       ?'stocktake'
      :status.startsWith('PRIMARY_PURCHASE_')?'purchase':null;
     if(!kind)return;
     const confirmed=[
      'SETTINGS_CLOUD_ACK_APPLIED','SETTINGS_CLOUD_READBACK_VERIFIED',
      'SETTINGS_UNCHANGED',
      'PROFILE_CLOUD_ACK_APPLIED','PROFILE_CLOUD_READBACK_VERIFIED',
      'QUOTES_CLOUD_ACK_APPLIED','QUOTES_CLOUD_READBACK_VERIFIED',
      'GROWTH_CLOUD_ACK_APPLIED','GROWTH_CLOUD_READBACK_VERIFIED',
      'REFERENCE_CLOUD_ACK_APPLIED','REFERENCE_CLOUD_READBACK_VERIFIED',
      'PRIMARY_STOCKTAKE_CLOUD_ACK_APPLIED',
      'PRIMARY_STOCKTAKE_CLOUD_READBACK_VERIFIED',
      'BATCH_CLOUD_ACK_APPLIED','BATCH_CLOUD_READBACK_VERIFIED',
      'PRIMARY_PURCHASE_CLOUD_ACK_APPLIED',
      'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED'
     ].includes(status);
     if(confirmed)release(kind);
     else if(!answer?.requestId)saving.delete(kind);
     // Unknown ACK and original UUID review must never unlock a draft.
    },
    recover:release,
    hasUnsaved:()=>editing(),
    reset(){editedFields.clear();saving.clear();focusValues=new WeakMap();}
   };
   // Use the real document scrolling element when available (Android PWA
   // commonly scrolls the root, not body). Preserve legacy fallback in tests.
   const atTop=()=>{
    const scroller=doc.scrollingElement;
    return scroller?Math.max(0,Number(scroller.scrollTop)||0)<=1
     :Math.max(0,Number(host.scrollY)||0,
       Number(doc.documentElement?.scrollTop)||0,
       Number(doc.body?.scrollTop)||0)<=1;
   };
   const editing=()=>{
    for(const field of editedFields.keys())
     if(field?.isConnected===false)editedFields.delete(field);
    if(editedFields.size)return true;
    const active=doc.activeElement;
    if(active?.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/i.test(active?.tagName||''))
     return true;
    if($('priceEditor')?.hidden===false)return true;
    // querySelector() matches descendants of hidden parents. The reference
    // dialog itself has no [hidden], but its #priceEditor backdrop does:
    // treating it as open blocked EVERY top pull in the real five-page DOM.
    const dialogs=doc.querySelectorAll?.('[role="dialog"],[aria-modal="true"]');
    return Boolean(dialogs&&Array.from(dialogs).some(dialog=>
     !dialog.closest?.('[hidden]')
     &&(typeof dialog.getClientRects!=='function'
       ||dialog.getClientRects().length>0)));
   };
   // Check the scroll position at touchstart only. Android may briefly
   // report a root scroll offset during a finger drag; don't abort that
   // already-qualified gesture. Every other safety gate is rechecked.
   const safe=(checkTop=true)=>{
    if(mode!=='ready'||busy||refreshBusy||syncActionBusy
      ||(checkTop&&!atTop())
      ||hasPendingPageReview()||attached?.hasActiveBusinessAction?.()
      ||$('formalResolveDocumentConflict')?.hidden===false
      ||$('formalResolveBatchConflict')?.hidden===false
      ||editing())return false;
    const current=controller?.verifiedContext?.();
    const selected=primary?.selectedScope?.();
    return Boolean(actor&&family&&primaryViewBase?.childId
     &&current?.actorUid===actor&&current?.familyId===family
     &&(!selected||(selected.actorUid===actor&&selected.familyId===family
       &&selected.childId===primaryViewBase.childId)));
   };
   const exempt=target=>Boolean(target?.closest?.(
    'input,textarea,select,button,a,[contenteditable],'
    +'.price-editor-backdrop,.price-editor-card,.table-wrap,.ref-list'));
   const innerScroller=target=>{
    const root=doc.scrollingElement||doc.documentElement||doc.body;
    for(let node=target;node&&node!==root&&node!==doc.body;
        node=node.parentElement){
     const overflow=host.getComputedStyle?.(node)?.overflowY
      ||node.style?.overflowY||'';
     if(/auto|scroll/i.test(overflow)
       &&Number(node.scrollHeight)>Number(node.clientHeight)+2)return true;
    }
    return false;
   };
   if(touchInput)doc.addEventListener('touchstart',event=>{
    pull=null;
    if(event.touches?.length!==1||!safe()
      ||exempt(event.target)||innerScroller(event.target))return;
    pullFeedback('');
    const t=event.touches[0];
    pull={x:t.clientX,y:t.clientY,armed:false};
   },{passive:true,capture:true});
   if(touchInput)doc.addEventListener('touchmove',event=>{
    if(!pull)return;
    if(event.touches?.length!==1||!safe(false)){
     pull=null;pullFeedback('');return;
    }
    const t=event.touches[0],dy=t.clientY-pull.y;
    const dx=Math.abs(t.clientX-pull.x);
    // Never intercept ordinary upward scrolling or horizontal gestures.
    if(dy<=0||dx>Math.max(12,dy*.75)){
     pull=null;pullFeedback('');return;
    }
    if(dy<8)return;
    // Avoid a second navigation if the browser has already claimed the
    // gesture. On normal Android touch events passive:false allows cancel.
    if(!event.cancelable){pull=null;pullFeedback('');return;}
    event.preventDefault();
    pull.armed=dy>=threshold;
    pullFeedback(pull.armed?'armed':'pulling');
   },{passive:false,capture:true});
   if(touchInput)doc.addEventListener('touchend',event=>{
    const gesture=pull;pull=null;
    if(!gesture||!gesture.armed||event.changedTouches?.length!==1
      ||!safe(false)){pullFeedback('');return;}
    const t=event.changedTouches[0],dy=t.clientY-gesture.y;
    if(dy<threshold||Math.abs(t.clientX-gesture.x)>dy*.75){
     pullFeedback('');return;
    }
    pullFeedback('refreshing');
    // The toolbar and the gesture share this one authenticated cloud path.
    void fetchCloudLatest().then(()=>{
     if(mode!=='ready'){pullFeedback('');return;}
     pullFeedback($('formalCloudSyncFeedback')?.textContent==='云端数据已更新'
      ?'success':'failure');
    }).catch(()=>pullFeedback('failure'));
   },{passive:true,capture:true});
   if(touchInput)doc.addEventListener('touchcancel',()=>{
    pull=null;pullFeedback('');
   },{passive:true,capture:true});
  }

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
  async function processPendingOnce(){
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
      if(releasedQuote)mobileDraft?.recover('quotes');
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
     if(releasedQuote)mobileDraft?.recover('quotes');
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
      if(next==='ready')await attached?.recoverMinimalButtons?.({
       domain:'stocktake',verifiedBatch:true});
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
    const releasedConsume=next==='ready'
     &&await attached?.recoverMinimalButtons?.({domain:'consume'});
    const releasedReverse=next==='ready'
     &&await attached?.recoverMinimalButtons?.({domain:'reverse'});
    const releasedStocktake=next==='ready'
     &&await attached?.recoverMinimalButtons?.({domain:'stocktake'});
    $('formalSyncState').textContent=releasedPurchase
     ?'原采购请求已核验并显示在库存中，可以继续操作。'
     :releasedConsume
      ?'原消耗请求已核验，库存和消耗记录已更新，可以继续操作。'
     :releasedReverse
      ?'原撤销请求已核验，库存和历史状态已更新，可以继续操作。'
     :releasedStocktake
      ?'原库存盘点请求已核验，页面库存已更新，可以继续保存。'
     :next==='ready'
      ?'云端已核验，采购与消耗库存已刷新。'
      :'云端操作已确认，页面读取仍需重试。';
   }else $('formalSyncState').textContent=
    '待确认操作：'+String(sent.status)+'；保留原操作 ID，不要重复提交。';
  }
  async function submitPending(){
   if(syncActionBusy||refreshBusy||busy)return;
   if(mode!=='ready'||!actor||!family||host.navigator?.onLine===false
     ||controller?.verifiedContext?.()?.actorUid!==actor
     ||controller?.verifiedContext?.()?.familyId!==family){
    const node=$('formalCloudSyncFeedback');
    if(node)node.textContent=host.navigator?.onLine===false
     ?'网络中断，未完成操作已保留':'请先登录并确认当前家庭和宝宝';
    syncButtonState();return;
   }
   syncActionBusy=true;syncButtonState();
   const node=$('formalCloudSyncFeedback');
   if(node)node.textContent='正在处理待同步操作…';
   const account=actor,household=family,epoch=documentEpoch;
   let remaining=null,conflict=false;
   try{
    // Three bounded passes at most: 026, 027, then 009. Each pass invokes
    // precisely the existing top-button recovery implementation.
    for(let pass=0;pass<3;pass++){
     const before=await checkPending();
     if(epoch!==documentEpoch||actor!==account||family!==household)break;
     if(!before){if(node)node.textContent='队列状态待核验，请先检查网络及原请求';break;}
     remaining=before.outstanding;
     if(remaining===0&&!hasPendingPageReview())break;
     await processPendingOnce();
     if(epoch!==documentEpoch||actor!==account||family!==household)break;
     const after=await checkPending();
     if(!after){if(node)node.textContent='已处理部分操作，仍有待核验记录';break;}
     remaining=after.outstanding;
     const message=$('formalSyncState')?.textContent||'';
     if(/DOCUMENT_CONFLICT|BATCH_REVISION_CONFLICT|PRIMARY_STOCK_REVISION_CONFLICT|SERVER_REJECTED|原批次存在确定冲突/.test(message)){
      conflict=true;break;
     }
     // No progress means ambiguous ACK, conflict or a pending readback.
     if(after.outstanding>=before.outstanding)break;
    }
    if(epoch===documentEpoch&&actor===account&&family===household){
     const final=await checkPending();
     if(node)node.textContent=conflict
      ?'部分操作存在数据冲突，请先处理冲突'
      :host.navigator?.onLine===false
       ?'网络中断，未完成操作已保留'
      :final?.outstanding===0&&!hasPendingPageReview()
       ?'待同步操作已处理完成'
      :'已处理部分操作，仍有待核验记录';
    }
   }catch(_){
    if(node&&epoch===documentEpoch&&actor===account&&family===household)
     node.textContent='已处理部分操作，仍有待核验记录';
   }finally{
    syncActionBusy=false;syncButtonState();
    await checkPending().catch(()=>{});
   }
  }
  on('formalSyncNow',submitPending);
  on('formalSubmitPending',submitPending);
  on('formalSignOut',signOut);
  on('formalGateSignOut',signOut);
  // P3-02: a single 010 read RPC, not a second full restore protocol.
  // Unknown queue state is not assumed empty; no locally pending UUID may
  // be bypassed by the background stock observer.
  function canPollInventory(){
   if(doc.visibilityState!=='visible'||mode!=='ready'
     ||host.navigator?.onLine===false
     ||busy||refreshBusy||syncActionBusy
     ||!localInventoryBaselineReady||!pendingCountsVerified||pendingCount!==0
     ||hasPendingPageReview()||attached?.hasActiveBusinessAction?.()
     ||$('formalResolveDocumentConflict')?.hidden===false
     ||$('formalResolveBatchConflict')?.hidden===false
     ||mobileDraft?.hasUnsaved?.())return false;
   const current=controller?.verifiedContext?.();
   const selected=primary?.selectedScope?.();
   return Boolean(current?.app&&actor&&family&&primaryViewBase?.childId
    &&shownStock?.inventory&&shownStock?.revisions
    &&current.actorUid===actor&&current.familyId===family
    &&selected?.actorUid===actor&&selected?.familyId===family
    &&selected?.childId===primaryViewBase.childId
    &&typeof primary?.checkInventory==='function');
  }
  async function pollInventory(){
   if(inventoryPollBusy||mode!=='ready'||doc.visibilityState!=='visible')return;
   const identity=controller?.verifiedContext?.();
   const selectedNow=primary?.selectedScope?.();
   if(!identity?.app||identity.actorUid!==actor||identity.familyId!==family
     ||!selectedNow||selectedNow.actorUid!==actor
     ||selectedNow.familyId!==family
     ||selectedNow.childId!==primaryViewBase?.childId){
    revision++;clear();
    screen('unverified','账号、家庭或宝宝作用域已变化，已隐藏旧库存。');
    return;
   }
   if(!canPollInventory())return;
   const current=identity,selected=selectedNow;
   const child=primaryViewBase.childId,epoch=documentEpoch;
   const serial=++inventoryPollSerial;
   inventoryPollBusy=true;
   try{
    const checked=await primary.checkInventory();
    if(serial!==inventoryPollSerial||mode!=='ready'
      ||doc.visibilityState!=='visible')return;
    const after=controller?.verifiedContext?.();
    const chosen=primary?.selectedScope?.();
    if(after?.app!==current.app||after?.actorUid!==actor
      ||after?.familyId!==family
      ||chosen?.actorUid!==actor||chosen?.familyId!==family
      ||chosen?.childId!==child
      ||primaryViewBase?.childId!==child
      ||checked?.status==='PRIMARY_INVENTORY_CHECK_SCOPE_CHANGED'){
     revision++;clear();
     screen('unverified','账号、家庭或宝宝作用域已变化，已隐藏旧库存。');
     return;
    }
    // A manual refresh, 009/026/027 command or fresh draft can begin while
    // the lightweight RPC is pending. Never promote that stale observation.
    if(epoch!==documentEpoch||!canPollInventory()
      ||checked?.status!=='PRIMARY_INVENTORY_CHECK_VERIFIED')return;
    if(checked.familyId!==family||checked.actorUid!==actor
      ||checked.childId!==child)return;
    const differs=SIZES.some(size=>
     checked.inventory?.[size]!==shownStock.inventory?.[size]
     ||checked.revisions?.[size]!==shownStock.revisions?.[size]);
    if(!differs)return;
    // Only the existing complete read + IDB baseline synchronization can
    // replace the rendered stock. Never trust this small read as an ACK.
    void fetchCloudLatest({automatic:true});
   }catch(_){/* leave current verified view, no false sync success */}
   finally{
    if(serial===inventoryPollSerial)inventoryPollBusy=false;
   }
  }
  inventoryPollTick=pollInventory;
  // The only automatic refresh entrypoint. Manual clicks and touch pull
  // continue to use fetchCloudLatest(); automatic reads never flush UUIDs.
  function foregroundRefresh(reason){
   if(host.navigator?.onLine===false)return;
   if(mode!=='ready'){
    // A visible offline/cached gate may retry the original login + primary
    // validation; the full-page gate is never bypassed.
    if((mode==='offline'||mode==='cached'||mode==='unverified')
      &&!busy)void restore();
    return;
   }
   const current=controller?.verifiedContext?.();
   const selected=primary?.selectedScope?.();
   if(!actor||!family||!primaryViewBase?.childId
     ||current?.actorUid!==actor||current?.familyId!==family
     ||(selected&&(selected.actorUid!==actor
      ||selected.familyId!==family||selected.childId!==primaryViewBase.childId))){
    revision++;clear();
    screen('unverified','账号、家庭或宝宝作用域已变化，请重新检查。');
    return;
   }
   // Do not overwrite a dirty form, a reference modal or an ongoing command.
   // This guard runs BEFORE fetchCloudLatest clears the full-read marker.
   if(busy||refreshBusy||syncActionBusy||hasPendingPageReview()
     ||attached?.hasActiveBusinessAction?.()
     ||$('formalResolveDocumentConflict')?.hidden===false
     ||$('formalResolveBatchConflict')?.hidden===false
     ||pendingCount>0)return;
   if(mobileDraft?.hasUnsaved?.()){
    showSync('有未保存内容，已暂缓自动同步；保存或取消后可手动刷新。','partial');
    return;
   }
   const timestamp=now();
   if(timestamp-lastAutoAttemptAt<FOREGROUND_REFRESH_MS)return;
   // Treat online+visible as a single opportunity, not two full reads.
   lastAutoAttemptAt=timestamp;
   onlineRecoveryNeeded=false;
   void fetchCloudLatest({automatic:true});
  }
  host.addEventListener('offline',()=>{
   updateInventoryPolling();
   onlineRecoveryNeeded=true;
   if(mode==='ready')showSync('当前网络已断开，页面保留上次数据；未同步。','partial');
  });
  host.addEventListener('online',()=>{
   updateInventoryPolling();
   onlineRecoveryNeeded=true;
   if(doc.visibilityState==='visible')foregroundRefresh('online');
  });
  host.addEventListener('storage',event=>{
   if(event?.key!==OTP_STORAGE_KEY)return;
   restoreOtpCooldown();startOtpTicker();
  });
  doc.addEventListener('visibilitychange',()=>{
   if(doc.visibilityState==='hidden'){
    updateInventoryPolling();lastBackgroundAt=now();return;
   }
   if(doc.visibilityState!=='visible')return;
   updateInventoryPolling();
   const away=lastBackgroundAt===null?0:now()-lastBackgroundAt;
   lastBackgroundAt=null;
   if(away>=FOREGROUND_REFRESH_MS||onlineRecoveryNeeded)
    foregroundRefresh('visible');
  });
  await restore();
  return mode;
 }
 return Object.freeze({start,restore,signOut,
  get mode(){return mode;},get controller(){return controller;}});
}
function maternalBrowserHost(host){
 if(typeof host.crypto?.randomUUID==='function')return host;
 // Chrome 86 has Web Crypto but does not expose randomUUID().
 const randomUUID=()=>{
  const bytes=host.crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
 };
 return {navigator:host.navigator,get indexedDB(){return host.indexedDB;},crypto:{randomUUID}};
}
function browserStart(){
 const doc=root.document,$=id=>doc.getElementById(id);
 if(!$('formalGate'))return;
 if(!root.XBM1PreviewModule||!root.XBPrimaryCloudReadModel
   ||!root.XBPrimaryCloudOperations||!root.XBPrimaryBusinessCommands
   ||!root.XBPrimaryFormalUIActions||!root.XBPrimaryUIProjection
   ||!root.XBM3UI||!root.XBMaternalWeight||!root.XBMaternalHealthClient
   ||!root.XBMaternalHealthOperations){
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
  purchaseOperatorApproved:()=>FORMAL_PURCHASE_ENABLED,
  loginController:root.XBM1PreviewModule,
  maternalWeightFactory:controller=>root.XBMaternalWeight.mount({
   doc,host:maternalBrowserHost(root),controller,
   clientFactory:root.XBMaternalHealthClient,operationsFactory:root.XBMaternalHealthOperations,
   cloudWritesEnabled:true
  }),
  projection:root.XBPrimaryUIProjection,ui:root.XBM3UI,
  historyCache:root.XBPrimaryCloudReadModel.createHistoryCache(),
  documentsFactory:app=>root.XBPrimaryDocumentsClient?.create({
   app,accessPreflight:root.XBCloudbaseAccessPreflight,
   childReader:root.XBCloudbaseChildReader,scopeGuard:root.XBChildScopeGuard,
   cloudWritesEnabled:FORMAL_DOCUMENT_WRITE_ENABLED
  }),
  documentsOverlay:root.XBPrimaryDocumentsOverlay,
  documentOpsFactory:({controller,host,documentsClient})=>
   root.XBPrimaryDocumentsOperations.create({
    controller,host,documentsClient,
    outboxFactory:root.XBDurableOutbox,
    contract:root.XBOutboxContract,
    cloudWritesEnabled:FORMAL_DOCUMENT_WRITE_ENABLED,
    fastReferenceEnabled:true,fastQuotesEnabled:true,
    fastGrowthEnabled:true,fastProfileEnabled:true,fastSettingsEnabled:true,
    referenceAndQuotes:true,allowGrowth:true,allowProfile:true,allowSettings:true
   }),
  documentCommandsFactory:root.XBPrimaryDocumentsBusinessCommands,
  batchStocktakeFactory:({controller,host,primary})=>
   root.XBPrimaryStocktakeBatchClient.create({
    controller,host,primary,
    outboxFactory:root.XBDurableOutbox,
    contract:root.XBOutboxContract,
    cloudWritesEnabled:primary.cloudWritesEnabled===true
   }),
  readModelFactory:(cloud,historyCache)=>root.XBPrimaryCloudReadModel.create({
   app:cloud,childReader:root.XBCloudbaseChildReader,
   scopeGuard:root.XBChildScopeGuard,
   accessPreflight:root.XBCloudbaseAccessPreflight,
   inventoryClient:root.XBInventoryClient,
   legacyHistoryReader:root.XBLegacyHistoryReader,
   historyCache
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
const api=Object.freeze({create,FORMAL_WRITE_ENABLED,
 FORMAL_DOCUMENT_WRITE_ENABLED,FORMAL_PURCHASE_ENABLED});
if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(root?.document){
 root.XBFormalAppModule=api;
 if(root.document.readyState==='loading')
  root.document.addEventListener('DOMContentLoaded',browserStart,{once:true});
 else browserStart();
}
})(typeof window!=='undefined'?window:null);
