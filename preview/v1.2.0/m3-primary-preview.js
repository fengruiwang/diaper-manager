/* M3 original five-tab browser preview. All modes are READ ONLY.
 * The synthetic demo never reads CloudBase nor old V1.1.2 localStorage.
 * Real primary read requires receipt-verified 024 and active primary; if
 * unavailable, it NEVER falls back to smoke or to local sandbox as cloud.
 */
(function(root){
 'use strict';
 function create({host,projection,view,modelFactory}={}){
  if(!host||!projection?.project||!projection?.demo
    ||!view?.show||!view?.clear||!view?.status
    ||typeof modelFactory!=='function')
   throw Error('m3_preview:dependencies_required');
  let mode='LOCAL_SANDBOX',busy=false;
  function publish(code){mode=code;view.status(code);return code;}
  function demo(){
   if(busy)return publish('BUSY');
   if(host.XBM102?.isActive())return publish('EXIT_SMOKE_MODE_FIRST');
   try{
    const mapped=projection.project(projection.demo(),view.defaults());
    view.show(mapped);
    return publish('SYNTHETIC_DEMO_READ_ONLY');
   }catch(_){return publish('SYNTHETIC_DEMO_UNVERIFIED');}
  }
  async function cloud(){
   if(busy)return publish('BUSY');
   if(host.XBM102?.isActive())return publish('EXIT_SMOKE_MODE_FIRST');
   // Do not keep a synthetic/previous snapshot visible while a real
   // primary receipt is being checked. Unavailable cloud always shows no view.
   view.clear();
   busy=true;publish('VERIFYING_PRIMARY_RECEIPT');
   try{
    const controller=host.XBM1Preview;
    if(!controller||typeof controller.connect!=='function'
      ||typeof controller.verifiedContext!=='function')
     return publish('LOGIN_REQUIRED');
    await controller.connect();
    const context=controller.verifiedContext();
    if(!context)return publish('LOGIN_REQUIRED');
    const reader=modelFactory(context.app);
    const data=await reader.read({familyId:context.familyId,actorUid:context.actorUid});
    if(data?.status==='PRIMARY_NOT_READY')
     return publish('PRIMARY_NOT_READY_NO_CLOUD_VIEW');
    if(data?.status==='MIGRATION_READ_NOT_READY')
     return publish('MIGRATION_RECEIPT_NOT_READY');
    if(data?.status!=='PRIMARY_READ_ONLY_READY'||data.canWrite!==false)
     return publish('PRIMARY_CLOUD_UNVERIFIED');
    const mapped=projection.project(data,view.defaults());
    view.show(mapped);
    return publish('PRIMARY_CLOUD_READ_ONLY');
   }catch(_){
    return publish('PRIMARY_CLOUD_UNVERIFIED');
   }finally{busy=false;}
  }
  function exit(){view.clear();return publish('LOCAL_SANDBOX');}
  return Object.freeze({demo,cloud,exit,get status(){return mode;}});
 }
 function browserStart(){
  const doc=root.document,$=id=>doc.getElementById(id);
  const ids=['m3Demo','m3Cloud','m3Exit','m3Status'];
  if(ids.some(id=>!$(id))||!root.XBM3UI||!root.XBPrimaryUIProjection)
   return;
  const view={
   defaults:()=>root.XBM3UI.defaults(),
   show:value=>root.XBM3UI.show(value),
   clear:()=>root.XBM3UI.clear(),
   status:code=>{
    const notes={
     LOCAL_SANDBOX:'本机演练，不代表云端正式数据。',
     SYNTHETIC_DEMO_READ_ONLY:'合成示例：五个页面均只读，库存/价格/成长均非真实家庭数据。',
     PRIMARY_CLOUD_READ_ONLY:'已验证 primary、已完成迁移收据和权威云端读取；本页只读。',
     PRIMARY_NOT_READY_NO_CLOUD_VIEW:'尚无正式 primary，原有测试宝宝 S140 不会混入。',
     MIGRATION_RECEIPT_NOT_READY:'M2 未完成：无正式完成收据，不显示云端正式数据。',
     EXIT_SMOKE_MODE_FIRST:'请先退出 M1-02 专用测试宝宝模式。',
     LOGIN_REQUIRED:'尚未验证家庭登录，请使用现有账号登录。',
     PRIMARY_CLOUD_UNVERIFIED:'云端正式读取未核实，未打开正式数据。',
     VERIFYING_PRIMARY_RECEIPT:'正在核验正式宝宝及迁移完成收据。'
    };
    $('m3Status').textContent='M3 · '+code+'：'+(notes[code]||'未确认，未执行任何写入。');
    $('m3Exit').disabled=!root.XBM3UI.isActive();
   }
  };
  const factory=app=>root.XBPrimaryCloudReadModel.create({
   app,childReader:root.XBCloudbaseChildReader,
   scopeGuard:root.XBChildScopeGuard,
   accessPreflight:root.XBCloudbaseAccessPreflight,
   inventoryClient:root.XBInventoryClient,
   legacyHistoryReader:root.XBLegacyHistoryReader
  });
  const bridge=create({host:root,projection:root.XBPrimaryUIProjection,
   view,modelFactory:factory});
  root.XBM3Preview=bridge;
  $('m3Demo').addEventListener('click',()=>bridge.demo());
  $('m3Cloud').addEventListener('click',()=>bridge.cloud());
  $('m3Exit').addEventListener('click',()=>bridge.exit());
  // Prevent any mutation through original UI when shadow state is displayed:
  // document CAPTURE precedes the existing bubbling click/action listeners.
  const readOnlyElements=new Set([
   'saveQuote','buyNow','clearQuotes','saveWeight','cancelWeight',
   'savePlans','saveProfile','saveSizePreferences','saveStocks',
   'importDataBtn','importFile','resetAll','saveReference',
   'm102Arm','m102Create','m102Mode','m102Retire','m102Retry',
   'm102Refresh','m102RetireConfirmation','m102ArmText'
  ]);
  const allowedReadFilters=new Set(['growthRange','refBrand','refSize','refSearch']);
  doc.addEventListener('click',event=>{
   if(!root.XBM3UI.isActive())return;
   const el=event.target.closest('button,[data-action],input,select,textarea');
   if(!el||['m3Demo','m3Cloud','m3Exit'].includes(el.id))return;
   if(el.classList.contains('tab')||el.dataset.action==='go')return;
   if(allowedReadFilters.has(el.id))return;
   if(el.dataset.action&&['pickref','series'].includes(el.dataset.action))return;
   // For M3 read-only mode, block EVERY other action (not just known IDs).
   if(el.tagName==='BUTTON'||el.dataset.action||readOnlyElements.has(el.id)){
    event.preventDefault();event.stopImmediatePropagation();
    view.status('PRIMARY_READ_ONLY_NO_WRITES');
   }
  },true);
  for(const type of ['submit','input','change']){
   doc.addEventListener(type,event=>{
    if(!root.XBM3UI.isActive())return;
    const el=event.target;
    if(type!=='submit'&&allowedReadFilters.has(el.id))return;
    if(type!=='submit'&&el.id==='m3Status')return;
    event.preventDefault();event.stopImmediatePropagation();
   },true);
  }
  view.status('LOCAL_SANDBOX');
 }
 const api=Object.freeze({create});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root?.document){
  root.XBM3PreviewModule=api;
  if(root.document.readyState==='loading')
   root.document.addEventListener('DOMContentLoaded',browserStart,{once:true});
  else browserStart();
 }
})(typeof window!=='undefined'?window:null);
