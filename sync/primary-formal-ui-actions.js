/* M3 original V1.1.2 five-page DOM command capture for a future APPROVED
 * formal primary view (not loaded in existing M3 read-only browser preview).
 * Captures native page buttons before their legacy localStorage click handlers:
 * buyNow, buyquote, consume, saveStocks, deletetx.
 * Captures explicitly enabled shared-document writes before legacy local handlers.
 * No auto network actions; server permissions remain authoritative.
 * SERVER permissions remain authoritative; UI flags grant no SQL rights.
 */
(function(root){
 'use strict';
 const SIZES=['NB','S','M','L','XL','XXL'];
 const guardedIds=new Set(['saveQuote','clearQuotes','saveWeight',
  'saveProfile','savePlans','saveStocks','saveSizePreferences','resetAll',
  'importDataBtn','importFile','saveEditedReference','restoreDefaultReference']);
 const guardedActions=new Set(['deletequote','editquote','deleteweight',
  'buyquote','consume','deletetx','resetref']);
 const result=(status)=>Object.freeze({status});
 function create({commands,primary,readPurchase,readQuote,readTransaction,
  notify,formalModeSelected,onReferenceProgress=()=>{},onDocumentProgress=()=>{},buildAllowsWrites=false,
  operatorApproved=()=>false,
  buildAllowsDocumentWrites=buildAllowsWrites,
  documentOperatorApproved=operatorApproved,
  documentCommands=null,documentQueue=null,
  readDocumentInput=null,readReferenceBaseline=null,
  onReferenceReadback=null,onReferenceAck=null,allowReference=false,
  allowQuotes=false,readQuotesBaseline=null,onQuotesReadback=null,
  onQuotesAck=null,confirmQuoteClear=()=>false,confirmQuoteDelete=()=>true,
  prepareQuoteEdit=null,
  allowGrowth=false,readGrowthBaseline=null,onGrowthReadback=null,
  onGrowthAck=null,confirmGrowthDelete=()=>false,
  allowProfile=false,readProfileBaseline=null,onProfileReadback=null,
  onProfileAck=null,
  allowSettings=false,readSettingsBaseline=null,onSettingsReadback=null,
  onSettingsAck=null,
  batchStocktake=null,createBatchId=null,onBatchReadback=null,
  purchaseOnly=false,allowConsume=false,allowReverse=false,
  allowStocktake=false,readStocktakeBaseline=null,onPurchaseReadback=null}={}){
  if(!commands?.submit||!primary?.read||typeof readPurchase!=='function'
    ||typeof readQuote!=='function'||typeof readTransaction!=='function'
    ||typeof notify!=='function'||typeof formalModeSelected!=='function'
    ||typeof operatorApproved!=='function'
    ||typeof documentOperatorApproved!=='function')
   throw Error('formal_ui:dependencies_required');
  let busy=false,stocktakeBusy=false,referenceBusy=false,quoteBusy=false,growthBusy=false,profileBusy=false,settingsBusy=false,attached=null;
  // UI-only hold for a reference UUID pending authoritative readback.
  let referenceNeedsReview=null,referenceButtonLabel='';
  let activeReferenceAction=null,referenceResetLabel='';
  // UI-only holds; no UUID, queue, CAS or RPC behaviour is changed.
  const minimalBusy={purchase:false,quotes:false};
  const minimalReview={purchase:null,quotes:null};
  const minimalLabels={purchase:null,quotes:null};
  let minimalQuoteIntent=null,quoteButton=null,quoteButtonLabel='',quoteAction='add';
  function quoteFeedback(phase,answer=null){
   const doc=attached?.doc;
   const action=minimalQuoteIntent?.action||quoteAction;
   const list=action==='delete'||action==='clear';
   const node=doc?.getElementById(list
    ?'formalQuoteListFeedback':'formalCompareActionFeedback');
   const words={
    add:['正在保存候选价…','候选价保存成功'],
    edit:['正在保存修改…','候选价修改成功'],
    delete:['正在删除…','候选价已删除'],
    clear:['正在清空…','候选价已清空']
   }[action]||['正在保存候选价…','候选价已保存'];
   const status=String(answer?.status||'');
   if(node)node.textContent=phase==='working'?words[0]
    :phase==='success'?words[1]+'，云端 ACK 已确认，当前列表已更新。'
    :phase==='pending'
     ?(/CONFLICT|REVISION/.test(status)
       ?'云端数据版本已变化，请处理原请求冲突后刷新；请勿重复提交。'
       :'正在核验，请勿重复提交；原 UUID 已保留。')
    :phase==='recovered'?'原候选价操作已核验，可继续操作。'
    :phase==='cancelled'?'已取消操作，未提交云端请求。'
    :/FORM_INVALID|RECORD_NOT|ALREADY_EMPTY|BASELINE/.test(status)
     ?'未保存：请检查输入或刷新候选价后再试。'
    :/PERMISSION|NOT_AUTHORIZED/.test(status)
     ?'服务器拒绝保存：请检查账号和家庭权限，原请求保留。'
     :errorText(status,'quotes');
   const waiting=phase==='working'||phase==='pending';
   const save=doc?.getElementById('saveQuote');
   const clear=doc?.getElementById('clearQuotes');
   const controls=[save,clear,...(doc?.getElementById('quoteList')
    ?.querySelectorAll?.('[data-action="deletequote"],[data-action="editquote"]')||[])];
   for(const button of controls)if(button)button.disabled=waiting;
   if(quoteButton&&waiting)quoteButton.disabled=true;
   if(quoteButton&&waiting)quoteButton.textContent=
    phase==='pending'?'等待核验…':words[0];
   if(!waiting){
    if(quoteButton&&quoteButton!==save)
     quoteButton.textContent=quoteButtonLabel;
    if(save&&quoteButton===save)
     save.textContent=phase==='success'?'加入候选价':quoteButtonLabel;
    quoteButton=null;quoteButtonLabel='';
   }
  }
  function errorText(status,kind){
   const name=kind==='purchase'?'采购':kind==='quotes'?'候选价':'默认价';
   if(/NOT_AUTHORIZED|CONTRACT_NOT_READY|FORMAL_PURCHASE_ONLY/.test(status))
    return '当前云端操作未开放，请核对账号及家庭授权。';
   if(/FORM_INVALID|INVALID|NOT_VERIFIED|INPUT/.test(status))
    return name+'未保存：请检查商品、价格及数量填写是否正确。';
   if(/BASELINE|CONFLICT/.test(status))
    return name+'未确认：数据版本已变化，请刷新后核对。';
   return name+'保存未完成，请检查网络及同步状态后再操作。';
  }
  function minimalFeedback(kind,phase,answer=null){
   if(kind==='quotes')return quoteFeedback(phase,answer);
   const dom=attached?.doc;
   const button=dom?.getElementById(kind==='purchase'?'buyNow':'saveQuote');
   const text=dom?.getElementById('formalCompareActionFeedback');
   if(!button)return;
   if(!minimalLabels[kind])minimalLabels[kind]=button.textContent||
    (kind==='purchase'?'已购买 · 立即入库':'加入候选价');
   const name=kind==='purchase'?'采购':'候选价';
   if(text)text.textContent=phase==='working'?'正在保存'+name+'…':
    phase==='success'?name+'保存成功，云端回执与页面读回已确认。':
    phase==='pending'?'正在核验，请勿重复提交；原请求已保留，请使用“核验待处理”。':
    phase==='recovered'?'原'+name+'请求已核验，可继续操作。':
    errorText(String(answer?.status||''),kind);
   const waiting=phase==='working'||phase==='pending';
   button.disabled=waiting;
   button.textContent=waiting?(phase==='working'?'正在保存…':'等待核验…'):
    phase==='success'&&kind==='quotes'?'加入候选价':minimalLabels[kind];
   if(!waiting)minimalLabels[kind]=null;
  }
  function dispatchMinimal(el,doc,kind){
   if(minimalBusy[kind])return;
   if(minimalReview[kind]){
    minimalFeedback(kind,'pending');
    notify(result('DOCUMENT_PENDING_REVIEW_REQUIRED'));return;
   }
   minimalBusy[kind]=true;
   if(kind==='quotes'){
    minimalQuoteIntent=null;quoteButton=el;
    quoteButtonLabel=el.textContent||'加入候选价';
    quoteAction=el.id==='clearQuotes'?'clear':
     el.dataset?.action==='deletequote'?'delete':
     /修改/.test(quoteButtonLabel)?'edit':'add';
   }
   minimalFeedback(kind,'working');
   // Set the existing invoke busy guard synchronously before a second click.
   let promise;
   try{promise=handle(el,doc);}
   catch(_){promise=Promise.resolve(result('FORMAL_OPERATION_REVIEW_REQUIRED'));}
   void Promise.resolve(promise).then(answer=>{
    const success=answer?.status===(kind==='purchase'
     ?'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED':
      'QUOTES_CLOUD_READBACK_VERIFIED')
     ||kind==='quotes'&&answer?.status==='QUOTES_CLOUD_ACK_APPLIED';
    if(!success){
     const id=kind==='purchase'?answer?.operationId:answer?.requestId;
     if(typeof id==='string'&&id)
      minimalReview[kind]=Object.freeze(kind==='purchase'
       ?{operationId:id,kind:'buy'}:{requestId:id,
         action:minimalQuoteIntent?.action,record:minimalQuoteIntent?.record,
         expectedRevision:minimalQuoteIntent?.expectedRevision,
         actorUid:minimalQuoteIntent?.actorUid,
         familyId:minimalQuoteIntent?.familyId});
    }
    minimalFeedback(kind,success?'success':
     minimalReview[kind]?'pending':
     ['QUOTES_CLEAR_CANCELLED','QUOTES_DELETE_CANCELLED'].includes(answer?.status)
      ?'cancelled':'failed',answer);
    notify(answer);
   },()=>{
    minimalFeedback(kind,'failed',result('FORMAL_OPERATION_REVIEW_REQUIRED'));
    notify(result('FORMAL_OPERATION_REVIEW_REQUIRED'));
   }).finally(()=>{minimalBusy[kind]=false;});
  }
  async function recoverMinimalButtons({domain}={}){
   const pending=minimalReview[domain];
   if(!pending||minimalBusy[domain])return false;
   const callback=domain==='purchase'?onPurchaseReadback:
    domain==='quotes'?onQuotesReadback:null;
   if(typeof callback!=='function')return false;
   let verified=null;
   try{verified=await callback(pending);}catch(_){}
   if(verified!=='ready'||minimalReview[domain]!==pending)return false;
   minimalReview[domain]=null;
   minimalFeedback(domain,'recovered');
   return true;
  }
  const REFERENCE_STAGES=Object.freeze({
   checking:'正在检查价格与版本…',
   queued:'已加入本地队列，准备提交…',
   submitting:'正在核验原请求并提交云端…',
   readback:'云端回执已确认，正在刷新页面…',
   pending:'待确认，请勿重复保存'
  });
  function referenceProgress(phase,timing={}){
   const dom=attached?.doc;
   const button=dom?.getElementById('saveEditedReference');
   const restore=dom?.getElementById('restoreDefaultReference');
   const waiting=Object.prototype.hasOwnProperty.call(REFERENCE_STAGES,phase);
   if(button){
    if(!referenceButtonLabel)referenceButtonLabel=button.textContent||'保存新价格';
    button.disabled=waiting;
    button.textContent=waiting?REFERENCE_STAGES[phase]:referenceButtonLabel;
   }
   if(restore){
    if(!referenceResetLabel)referenceResetLabel=restore.textContent||'恢复默认价';
    restore.disabled=waiting;
    restore.textContent=waiting&&activeReferenceAction==='reset'
     ?phase==='pending'?'等待核验…':'正在恢复…':referenceResetLabel;
   }
   if(activeReferenceAction==='reset'){
    const feedback=dom?.getElementById('formalReferenceActionFeedback');
    if(feedback){
     feedback.textContent=waiting
      ?phase==='pending'
       ?'正在核验，请勿重复提交；原请求已保留，请使用“核验待处理”。'
       :'正在恢复默认价…'
      :phase==='success'
       ?'已恢复默认价，云端回执与页面价格读回已确认。'
      :phase==='idle'
       ?'原请求已核验，可继续操作。'
      :'恢复未完成，请刷新核对网络及云端数据。';
    }
   }
   if(!waiting)activeReferenceAction=null;
   if(typeof onReferenceProgress==='function')onReferenceProgress(phase,timing);
  }
  // P4-03E: profile/settings share P4-03D's feedback behavior, not a new queue.
  const activeDocumentButton={profile:null,settings:null};
  const pendingDocumentReview={profile:null,settings:null,growth:null};
  const originalLabels=new Map();
  const DOCUMENT_STAGES=Object.freeze({
   checking:'正在检查数据与版本…',
   queued:'已加入本地队列，准备提交…',
   submitting:'正在核验原请求并提交云端…',
   readback:'云端回执已确认，正在刷新页面…',
   pending:'待确认，请勿重复保存'
  });
  const PROFILE_STAGES=Object.freeze({
   checking:'正在保存宝宝资料…',
   queued:'正在保存宝宝资料…',
   submitting:'正在保存宝宝资料…',
   readback:'正在保存宝宝资料…',
   pending:'宝宝资料保存结果待核验，请勿重复提交'
  });
  const SETTINGS_STAGES=Object.freeze({
   checking:'正在保存设置…',queued:'正在保存设置…',
   submitting:'正在保存设置…',readback:'正在保存设置…',
   pending:'设置保存结果待核验，请勿重复提交'
  });
  function documentProgress(kind,phase,timing={},answer=null){
   const dom=attached?.doc;
   const controls=kind==='profile'?[dom?.getElementById('saveProfile')]:
    [dom?.getElementById('saveSizePreferences'),
     dom?.getElementById('savePlans'),
     ...(dom?.querySelectorAll?.('[data-preset]')||[])];
   if(activeDocumentButton[kind]&&!controls.includes(activeDocumentButton[kind]))
    controls.push(activeDocumentButton[kind]);
   const stages=kind==='profile'?PROFILE_STAGES:
    kind==='settings'?SETTINGS_STAGES:DOCUMENT_STAGES;
   const waiting=Object.prototype.hasOwnProperty.call(stages,phase);
   for(const el of controls){
    if(!el)continue;
    if(!originalLabels.has(el))originalLabels.set(el,el.textContent||'保存');
    el.disabled=waiting;
    el.textContent=el===activeDocumentButton[kind]&&waiting
     ?(phase==='pending'?'等待核验…':kind==='profile'?'正在保存…':
       kind==='settings'?'正在保存…':stages[phase])
     :originalLabels.get(el);
   }
   if(kind==='profile'){
    const feedback=dom?.getElementById('profileActionFeedback');
    if(feedback){
     const status=String(answer?.status||'');
     feedback.textContent=phase==='success'?'宝宝资料已保存'
      :phase==='working'||Object.prototype.hasOwnProperty.call(PROFILE_STAGES,phase)
       ?PROFILE_STAGES[phase]
      :phase==='idle'?'原宝宝资料请求已核验，可以继续操作。'
      :/UNCHANGED/.test(status)?'资料没有变化，无需保存。'
      :/FORM_INVALID|INPUT/.test(status)?'资料未保存：请检查日期、出生时间和测量数据。'
      :/PERMISSION|NOT_AUTHORIZED/.test(status)?'服务器拒绝保存宝宝资料，请检查账号及家庭权限。'
      :/CONFLICT|REVISION/.test(status)?'资料未保存：云端版本已变化，请刷新后重试。'
      :'宝宝资料保存未完成，请检查网络及同步状态。';
    }
   }
   if(kind==='settings'){
    const active=activeDocumentButton.settings;
    const preset=Boolean(active?.dataset?.preset);
    const size=active?.id==='saveSizePreferences';
    const feedback=dom?.getElementById(preset?'presetSettingsActionFeedback':
     size?'sizeSettingsActionFeedback':'planSettingsActionFeedback');
    if(feedback){
     const status=String(answer?.status||'');
     feedback.textContent=phase==='success'
      ?preset?'备货方案已保存':size?'尺码与采购偏好已保存':'备货计划已保存'
      :waiting&&phase!=='pending'
       ?preset?'正在应用并保存方案…':size?'正在保存设置…':'正在保存备货计划…'
      :phase==='pending'
       ?/CONFLICT|REVISION/.test(status)
        ?'云端版本已变化，请获取云端最新后重新编辑；原请求已保留。'
        :'设置保存结果待核验，原 UUID 已保留，请勿重复提交。'
      :phase==='idle'?'原设置请求已核验，可以继续操作。'
      :/UNCHANGED/.test(status)?'设置没有变化，无需保存'
      :/FORM_INVALID|INPUT/.test(status)?'设置未保存：请检查输入。'
      :/CONFLICT|REVISION/.test(status)
       ?'云端版本已变化，请获取云端最新后重新编辑。'
      :/PERMISSION|NOT_AUTHORIZED/.test(status)
       ?'服务器拒绝保存设置，请检查账号及家庭权限。'
      :'设置未保存，请检查网络和同步状态。';
    }
   }
   onDocumentProgress(kind,phase,timing);
   if(!waiting)activeDocumentButton[kind]=null;
  }
  let activeGrowthButton=null;
  function growthProgress(phase,action='add',answer=null){
   const dom=attached?.doc,save=dom?.getElementById('saveWeight');
   const cancel=dom?.getElementById('cancelWeight');
   const deletes=[...(dom?.querySelectorAll?.('[data-action="deleteweight"]')||[])];
   const controls=[save,cancel,...deletes].filter(Boolean);
   const waiting=phase==='working'||phase==='pending';
   for(const el of controls){
    if(!originalLabels.has(el))originalLabels.set(el,el.textContent||'保存');
    el.disabled=waiting;
    if(waiting&&el===activeGrowthButton)
     el.textContent=phase==='pending'?'等待核验…':
      action==='delete'?'正在删除…':
      action==='edit'?'正在保存修改…':'正在保存…';
    else if(!waiting&&(el===activeGrowthButton
      ||/^(正在保存|正在删除|等待核验)/.test(el.textContent||''))){
     if(phase==='success'&&el===save){
      if(/^(正在保存|等待核验)/.test(el.textContent||''))
       el.textContent='保存体重记录';
     }else el.textContent=originalLabels.get(el);
    }
   }
   const feedback=dom?.getElementById('growthActionFeedback');
   if(feedback){
    const status=String(answer?.status||'');
    feedback.textContent=phase==='working'
     ?action==='delete'?'正在删除记录…':
      action==='edit'?'正在保存修改…':'正在保存体重记录…'
     :phase==='success'
      ?action==='delete'?'体重记录已删除':
       action==='edit'?'体重记录已更新':'体重记录已保存'
     :phase==='pending'?'体重记录保存结果待核验，原请求已保留，请勿重复提交。'
     :phase==='recovered'?'原体重记录请求已核验，可以继续操作。'
     :phase==='cancelled'||status==='GROWTH_DELETE_CANCELLED'
      ?'已取消删除，体重记录未变化。'
     :/FORM_INVALID|INPUT/.test(status)
      ?'体重记录未保存：请检查测量日期、体重和时间。'
     :/PERMISSION|NOT_AUTHORIZED/.test(status)
      ?'服务器拒绝保存体重记录，请检查账号及家庭权限。'
     :/CONFLICT|REVISION/.test(status)
      ?'体重记录未保存：云端版本已变化，请刷新后重试。'
     :'体重记录保存未完成，请检查网络及同步状态。';
   }
   if(!waiting)activeGrowthButton=null;
  }
  const purchaseAuthorized=()=>buildAllowsWrites===true
   &&operatorApproved()===true;
  const documentsAuthorized=()=>buildAllowsDocumentWrites===true
   &&documentOperatorApproved()===true;
  async function invoke(action,value){
   if(!purchaseAuthorized())
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   if(busy)return result('BUSY');
   busy=true;
   try{
    const queued=await commands.submit(action,value,{operatorApproved:true});
    if(purchaseOnly!==true
      ||(action!=='purchase'
       &&!(allowConsume===true&&action==='consume')
       &&!(allowReverse===true&&action==='reverse')
       &&!(allowStocktake===true&&action==='stocktake')))
     return queued;
    const statusPrefix=action==='consume'?'PRIMARY_USE':
     action==='reverse'?'PRIMARY_REVERSE':
     action==='stocktake'?'PRIMARY_STOCKTAKE':'PRIMARY_PURCHASE';
    if(!['PRIMARY_OPERATION_DURABLY_QUEUED',
      'PRIMARY_OPERATION_ALREADY_QUEUED'].includes(queued?.status))
     return queued;
    // RPC retries reuse the same durable UUID; never create a second buy.
    let synced;
    try{synced=await primary.flush({operatorApproved:true});}
    catch(_){
     return Object.freeze({status:statusPrefix+'_PENDING_REVIEW',
      operationId:queued.operationId,cloudWriteCommitted:false});
    }
    if(synced?.status!=='PRIMARY_CLOUD_SYNCED_VERIFIED')
     return Object.freeze({status:statusPrefix+'_PENDING_REVIEW',
      operationId:queued.operationId,cloudWriteCommitted:false});
    try{
     const visible=typeof onPurchaseReadback==='function'
      ?await onPurchaseReadback({operationId:queued.operationId,
         kind:action==='consume'?'use':action==='purchase'?'buy':action,
         reversesOperationId:action==='reverse'?value?.reversesOperationId:null,
         size:action==='stocktake'?value?.size:null,
         count:action==='stocktake'?value?.count:null,
         expectedRevision:action==='stocktake'?value?.expectedRevision:null}):null;
     if(visible==='ready')
      return Object.freeze({status:statusPrefix+'_CLOUD_READBACK_VERIFIED',
       operationId:queued.operationId,cloudWriteCommitted:true});
    }catch(_){}
    return Object.freeze({status:statusPrefix+'_COMMITTED_READBACK_REQUIRED',
     operationId:queued.operationId,cloudWriteCommitted:true});
   }catch(_){return result('FORMAL_OPERATION_REVIEW_REQUIRED');}
   finally{busy=false;}
  }
  async function readStocktakeInputs(doc){
   if(stocktakeBusy)return result('BUSY');
   stocktakeBusy=true;
   try{
    // The baseline belongs to the rendered editor, not a newly fetched
    // revision: a stale editor must never overwrite another member's work.
    const displayed=typeof readStocktakeBaseline==='function'
     ?readStocktakeBaseline():null;
    if(allowStocktake===true&&(!displayed?.inventory||!displayed?.revisions))
     return result('PRIMARY_STOCK_BASELINE_UNVERIFIED');
    const read=await primary.read();
    if(read?.status!=='PRIMARY_CLOUD_READ_VERIFIED'
      ||!read.inventory||!read.revisions)
     return result('PRIMARY_STOCK_UNVERIFIED');
    const baseline=displayed||read,changed=[];
    for(const size of SIZES){
     const field=doc.getElementById('inv_'+size);
     if(!field||typeof field.value!=='string'||field.value.trim()==='')
      return result('STOCK_FORM_INCOMPLETE');
     const n=Number(field.value);
     if(!Number.isSafeInteger(n)||n<0||n>100000)
      return result('STOCK_FORM_INVALID');
     if(!Number.isSafeInteger(read.inventory[size])
       ||!Number.isSafeInteger(read.revisions[size])
       ||!Number.isSafeInteger(baseline.inventory[size])
       ||!Number.isSafeInteger(baseline.revisions[size]))
      return result('PRIMARY_STOCK_UNVERIFIED');
     if(n!==baseline.inventory[size])changed.push({size,count:n});
    }
    if(changed.length===0)return result('PRIMARY_STOCK_UNCHANGED');
    if(changed.some(x=>read.revisions[x.size]!==baseline.revisions[x.size]
      ||read.inventory[x.size]!==baseline.inventory[x.size]))
     return result('PRIMARY_STOCK_REVISION_CONFLICT');
    if(changed.length===1){
     const item=changed[0];
     return invoke('stocktake',displayed?
      {...item,expectedRevision:baseline.revisions[item.size]}:item);
    }
    // Never split one original six-size Save into multiple single-size RPCs.
    if(!batchStocktake?.queue||typeof createBatchId!=='function')
     return result('MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED');
    const items=changed.map(x=>({...x,
     expectedRevision:baseline.revisions[x.size]}));
    // Preserve the existing pre-release batch queue contract for isolated
    // callers; the formal P2-05 path explicitly opts into durable send/read.
    if(allowStocktake!==true)
     return batchStocktake.queue({
      items,batchId:createBatchId(),operatorApproved:true
     });
    if(typeof batchStocktake.send!=='function')
     return result('MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED');
    const batchId=createBatchId();
    const queued=await batchStocktake.queue({
     items,batchId,operatorApproved:true
    });
    if(!['BATCH_DURABLY_QUEUED','BATCH_ALREADY_QUEUED']
      .includes(queued?.status))return queued;
    // The batch ID is stored in IndexedDB before any network write.
    // A missing/ambiguous ACK never causes a fresh batch to be created.
    let sent;
    try{sent=await batchStocktake.send({operatorApproved:true});}
    catch(_){return Object.freeze({
     status:'BATCH_ACK_UNKNOWN_KEEP_ORIGINAL_ID',batchId
    });}
    if(!['BATCH_ATOMIC_COMMIT_ACKED','BATCH_ACK_RECOVERED']
      .includes(sent?.status))return sent||Object.freeze({
       status:'BATCH_ACK_UNKNOWN_KEEP_ORIGINAL_ID',batchId
      });
    try{
     const visible=typeof onBatchReadback==='function'
      ?await onBatchReadback({batchId,items}):null;
     if(visible==='ready')return Object.freeze({
      status:'BATCH_CLOUD_READBACK_VERIFIED',batchId,
      changedSizes:items.length,cloudWriteCommitted:true
     });
    }catch(_){}
    return Object.freeze({status:'BATCH_COMMITTED_READBACK_REQUIRED',
     batchId,cloudWriteCommitted:true});
   }catch(_){return result('PRIMARY_STOCKTAKE_REVIEW_REQUIRED');}
   finally{stocktakeBusy=false;}
  }
  async function invokeReference(el,doc){
   if(allowReference!==true||!documentCommands?.submit
     ||!documentQueue?.send||typeof readDocumentInput!=='function')
    return result('FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY');
   if(referenceBusy)return result('BUSY');
   referenceBusy=true;
   const t0=Date.now();let queuedAt=t0,committedAt=t0;
   try{
    // A change must be tied to the reference document actually rendered
    // on this account. Never silently use a newly advanced revision.
    const baseline=typeof readReferenceBaseline==='function'
     ?readReferenceBaseline():null;
    if(!baseline||typeof baseline.familyId!=='string'
      ||typeof baseline.actorUid!=='string'
      ||!Number.isSafeInteger(baseline.revision)
      ||baseline.revision<0||!baseline.body?.referenceOverrides)
     return result('REFERENCE_DISPLAYED_BASELINE_REQUIRED');
    const input=readDocumentInput(el,doc);
    if(input?.kind!=='reference'||!['set','reset'].includes(input.action)
      ||typeof input.record?.key!=='string'||!input.record.key)
     return result('REFERENCE_FORM_INVALID');
    const saved=await documentCommands.submit({
     ...input,familyId:baseline.familyId,actorUid:baseline.actorUid,
     expectedRevision:baseline.revision,operatorApproved:true,
     verifiedBaseline:baseline
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('REFERENCE_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    queuedAt=Date.now();
    referenceProgress('queued',{checkAndQueueMs:queuedAt-t0});
    referenceProgress('submitting');
    let sync;
    try{sync=await documentQueue.send({operatorApproved:true,
     fastReferenceId:requestId});}
    catch(_){return Object.freeze({
     status:'REFERENCE_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId
    });}
    if(sync?.status==='DOCUMENT_REFERENCE_ACK_CONFIRMED'){
     // ACK matches the queued full reference; targeted on-page update only.
     let applied='pending';
     try{applied=typeof onReferenceAck==='function'
      ?await onReferenceAck({...sync,record:input.record,
       action:input.action}):'pending';}catch(_){}
     return Object.freeze({
      status:applied==='ready'?'REFERENCE_CLOUD_ACK_APPLIED':
       'REFERENCE_COMMITTED_READBACK_REQUIRED',
      requestId,cloudWriteCommitted:true
     });
    }
    if(sync?.status!=='DOCUMENT_SYNC_CONFIRMED')
     return Object.freeze({status:sync?.status||
       'REFERENCE_ACK_UNKNOWN_KEEP_REQUEST_ID',
      requestId,cloudWriteCommitted:false});
    committedAt=Date.now();
    referenceProgress('readback',{
     checkAndQueueMs:queuedAt-t0,receiptAndCommitMs:committedAt-queuedAt
    });
    try{
     const visible=typeof onReferenceReadback==='function'
      ?await onReferenceReadback({requestId,
       record:input.record,action:input.action,
       expectedRevision:baseline.revision}):null;
     if(visible==='ready')return Object.freeze({
      status:'REFERENCE_CLOUD_READBACK_VERIFIED',
      requestId,cloudWriteCommitted:true,
      timings:Object.freeze({
       checkAndQueueMs:queuedAt-t0,
       receiptAndCommitMs:committedAt-queuedAt,
       readbackMs:Date.now()-committedAt
      })
     });
    }catch(_){}
    return Object.freeze({status:'REFERENCE_COMMITTED_READBACK_REQUIRED',
     requestId,cloudWriteCommitted:true});
   }catch(_){return result('REFERENCE_OPERATION_REVIEW_REQUIRED');}
   finally{referenceBusy=false;}
  }
  async function invokeQuotes(el,doc){
   if(allowQuotes!==true||!documentCommands?.submit
     ||!documentQueue?.send||typeof readDocumentInput!=='function')
    return result('FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY');
   if(quoteBusy)return result('BUSY');
   quoteBusy=true;
   try{
    const baseline=typeof readQuotesBaseline==='function'
     ?readQuotesBaseline():null;
    if(!baseline||typeof baseline.familyId!=='string'
      ||typeof baseline.actorUid!=='string'
      ||!Number.isSafeInteger(baseline.revision)||baseline.revision<0
      ||!Array.isArray(baseline.body?.items))
     return result('QUOTES_DISPLAYED_BASELINE_REQUIRED');
    const input=readDocumentInput(el,doc);
    if(input?.kind!=='quotes'
      ||!['add','edit','delete','clear'].includes(input.action))
     return result('QUOTES_FORM_INVALID');
    if(input.action==='clear'){
     if(!baseline.body.items.length)return result('QUOTES_ALREADY_EMPTY');
     if(typeof confirmQuoteClear!=='function'||confirmQuoteClear()!==true)
      return result('QUOTES_CLEAR_CANCELLED');
    }
    if(input.action==='edit'||input.action==='delete'){
     if(typeof input.record?.id!=='string'
       ||!baseline.body.items.some(row=>row.id===input.record.id))
      return result('QUOTES_RECORD_NOT_IN_DISPLAYED_LIST');
    }
    if(input.action==='delete'
      &&confirmQuoteDelete(input.record.id)!==true)
     return result('QUOTES_DELETE_CANCELLED');
    if(input.action==='add'&&(!input.record?.id
      ||baseline.body.items.some(row=>row.id===input.record.id)))
     return result('QUOTES_FORM_INVALID');
    minimalQuoteIntent=Object.freeze({action:input.action,
     expectedRevision:baseline.revision,actorUid:baseline.actorUid,
     familyId:baseline.familyId,
     record:input.record?Object.freeze({...input.record}):null});
    const saved=await documentCommands.submit({
     ...input,familyId:baseline.familyId,actorUid:baseline.actorUid,
     expectedRevision:baseline.revision,operatorApproved:true,
     verifiedBaseline:baseline
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('QUOTES_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    let sync;
    try{sync=await documentQueue.send({operatorApproved:true,
     fastDocumentId:requestId});}
    catch(_){return Object.freeze({
     status:'QUOTES_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId
    });}
    if(sync?.status==='DOCUMENT_QUOTES_ACK_CONFIRMED'){
     let applied='pending';
     try{applied=typeof onQuotesAck==='function'
      ?await onQuotesAck({...sync,action:input.action,
       record:input.record}):'pending';}catch(_){}
     return Object.freeze({
      status:applied==='ready'?'QUOTES_CLOUD_ACK_APPLIED':
       'QUOTES_COMMITTED_READBACK_REQUIRED',
      requestId,action:input.action,cloudWriteCommitted:true
     });
    }
    if(sync?.status!=='DOCUMENT_SYNC_CONFIRMED')
     return Object.freeze({
      status:sync?.status||'QUOTES_ACK_UNKNOWN_KEEP_REQUEST_ID',
      requestId,cloudWriteCommitted:false
     });
    try{
     const visible=typeof onQuotesReadback==='function'
      ?await onQuotesReadback({
       requestId,action:input.action,record:input.record,
       expectedRevision:baseline.revision
      }):null;
     if(visible==='ready')return Object.freeze({
      status:'QUOTES_CLOUD_READBACK_VERIFIED',
      requestId,action:input.action,cloudWriteCommitted:true
     });
    }catch(_){}
    return Object.freeze({status:'QUOTES_COMMITTED_READBACK_REQUIRED',
     requestId,cloudWriteCommitted:true});
   }catch(_){return result('QUOTES_OPERATION_REVIEW_REQUIRED');}
   finally{quoteBusy=false;}
  }
  async function invokeGrowth(el,doc,preparedInput=null){
   if(allowGrowth!==true||!documentCommands?.submit
     ||!documentQueue?.send||typeof readDocumentInput!=='function')
    return result('FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY');
   if(growthBusy)return result('BUSY');
   growthBusy=true;
   try{
    const baseline=typeof readGrowthBaseline==='function'
     ?readGrowthBaseline():null;
    if(!baseline||typeof baseline.familyId!=='string'
      ||typeof baseline.actorUid!=='string'
      ||!Number.isSafeInteger(baseline.revision)||baseline.revision<0
      ||!Array.isArray(baseline.body?.items))
     return result('GROWTH_DISPLAYED_BASELINE_REQUIRED');
    const input=preparedInput||readDocumentInput(el,doc);
    if(input?.kind!=='growth'||!['add','edit','delete'].includes(input.action))
     return result('GROWTH_FORM_INVALID');
    if(typeof input.record?.id!=='string'||!input.record.id)
     return result('GROWTH_FORM_INVALID');
    if(input.action==='edit'||input.action==='delete'){
     const existing=baseline.body.items.find(x=>x.id===input.record.id);
     if(!existing)return result('GROWTH_RECORD_NOT_IN_DISPLAYED_LIST');
     if(input.action==='delete'&&
       (typeof confirmGrowthDelete!=='function'
        ||confirmGrowthDelete(existing)!==true))
      return result('GROWTH_DELETE_CANCELLED');
    }else if(baseline.body.items.some(x=>x.id===input.record.id))
     return result('GROWTH_FORM_INVALID');
    const saved=await documentCommands.submit({
     ...input,familyId:baseline.familyId,actorUid:baseline.actorUid,
     expectedRevision:baseline.revision,operatorApproved:true,
     verifiedBaseline:baseline
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('GROWTH_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    let synced;
    try{synced=await documentQueue.send({operatorApproved:true,
     fastDocumentId:requestId,fastDocumentKind:'growth'});}
    catch(_){return Object.freeze({status:'GROWTH_ACK_UNKNOWN_KEEP_REQUEST_ID',
     requestId,action:input.action,record:input.record,
     expectedRevision:baseline.revision,familyId:baseline.familyId,
     actorUid:baseline.actorUid,cloudWriteCommitted:false});}
    const expected={requestId,action:input.action,record:input.record,
     expectedRevision:baseline.revision,
     receiptVerified:synced?.receiptVerified===true};
    if(synced?.status==='DOCUMENT_GROWTH_ACK_CONFIRMED'){
     let applied='pending';
     try{applied=typeof onGrowthAck==='function'
      ?await onGrowthAck({...synced,action:input.action,
       record:input.record}):'pending';}catch(_){}
     if(applied==='ready')return Object.freeze({
      status:'GROWTH_CLOUD_ACK_APPLIED',requestId,
      action:input.action,cloudWriteCommitted:true
     });
    }
    if(['DOCUMENT_GROWTH_ACK_RECOVERED_NEEDS_REFRESH',
      'DOCUMENT_GROWTH_ACK_CONFIRMED','DOCUMENT_SYNC_CONFIRMED']
      .includes(synced?.status)){
     let visible=null;
     try{visible=typeof onGrowthReadback==='function'
      ?await onGrowthReadback(expected):null;}catch(_){}
     if(visible==='ready')return Object.freeze({
      status:'GROWTH_CLOUD_READBACK_VERIFIED',requestId,
      action:input.action,cloudWriteCommitted:true
     });
     return Object.freeze({status:'GROWTH_COMMITTED_READBACK_REQUIRED',
      requestId,action:input.action,record:input.record,
      expectedRevision:baseline.revision,familyId:baseline.familyId,
      actorUid:baseline.actorUid,cloudWriteCommitted:true});
    }
    return Object.freeze({status:synced?.status||
      'GROWTH_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId,
     action:input.action,record:input.record,
     expectedRevision:baseline.revision,familyId:baseline.familyId,
     actorUid:baseline.actorUid,cloudWriteCommitted:false});
   }catch(_){return result('GROWTH_OPERATION_REVIEW_REQUIRED');}
   finally{growthBusy=false;}
  }
  async function invokeProfile(el,doc){
   if(allowProfile!==true||!documentCommands?.submit
     ||!documentQueue?.send||typeof readDocumentInput!=='function')
    return result('FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY');
   if(profileBusy)return result('BUSY');
   profileBusy=true;
   const startedAt=Date.now();let queuedAt=startedAt,committedAt=startedAt;
   try{
    const baseline=typeof readProfileBaseline==='function'
     ?readProfileBaseline():null;
    if(!baseline||typeof baseline.familyId!=='string'
      ||typeof baseline.actorUid!=='string'
      ||!Number.isSafeInteger(baseline.revision)||baseline.revision<0
      ||!baseline.body?.babyProfile
      ||typeof baseline.body.babyProfile!=='object'
      ||Array.isArray(baseline.body.babyProfile))
     return result('PROFILE_DISPLAYED_BASELINE_REQUIRED');
    const input=readDocumentInput(el,doc);
    if(input?.kind!=='profile'||input.action!=='patch'
       ||!input.record?.babyProfile)
     return result('PROFILE_FORM_INVALID');
    // Patch only fields whose displayed values actually changed. Unknown
    // top-level and nested migration fields remain in the full document body.
    const patch={},profilePatch={};
    const sameProfileValue=(key,next,current)=>{
     const empty=value=>value===null||value===undefined||value==='';
     if(['birthWeight','birthLength'].includes(key)){
      if(empty(next)||empty(current))return empty(next)&&empty(current);
      return Number(next)===Number(current);
     }
     return (next??'')===(current??'');
    };
    for(const key of ['dueDate','birthDate']){
     if(Object.prototype.hasOwnProperty.call(input.record,key)
       &&!sameProfileValue(key,input.record[key],baseline.body[key]))
      patch[key]=input.record[key];
    }
    for(const [key,value] of Object.entries(input.record.babyProfile)){
     if(!sameProfileValue(key,value,baseline.body.babyProfile[key]))
      profilePatch[key]=value;
    }
    if(Object.keys(profilePatch).length)patch.babyProfile=profilePatch;
    if(!Object.keys(patch).length)return result('PROFILE_UNCHANGED');
    const commandInput={...input,record:patch};
    const saved=await documentCommands.submit({
     ...commandInput,familyId:baseline.familyId,actorUid:baseline.actorUid,
     expectedRevision:baseline.revision,operatorApproved:true,
     verifiedBaseline:baseline
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('PROFILE_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    queuedAt=Date.now();
    documentProgress('profile','queued',{checkAndQueueMs:queuedAt-startedAt});
    documentProgress('profile','submitting');
    let synced;
    try{synced=await documentQueue.send({operatorApproved:true,
     fastDocumentId:requestId,fastDocumentKind:'profile'});}
    catch(_){return Object.freeze({status:'PROFILE_ACK_UNKNOWN_KEEP_REQUEST_ID',
     requestId,record:patch,expectedRevision:baseline.revision,
     familyId:baseline.familyId,actorUid:baseline.actorUid,
     cloudWriteCommitted:false});}
    const expected={requestId,record:patch,
     expectedRevision:baseline.revision,
     receiptVerified:synced?.receiptVerified===true};
    if(synced?.status==='DOCUMENT_PROFILE_ACK_CONFIRMED'){
     let applied='pending';
     try{applied=typeof onProfileAck==='function'
      ?await onProfileAck({...synced,action:'patch',record:patch}):'pending';
     }catch(_){}
     if(applied==='ready')return Object.freeze({
      status:'PROFILE_CLOUD_ACK_APPLIED',requestId,
      cloudWriteCommitted:true
     });
    }
    if(['DOCUMENT_PROFILE_ACK_RECOVERED_NEEDS_REFRESH',
      'DOCUMENT_PROFILE_ACK_CONFIRMED','DOCUMENT_SYNC_CONFIRMED']
      .includes(synced?.status)){
     committedAt=Date.now();
     documentProgress('profile','readback',{
      checkAndQueueMs:queuedAt-startedAt,receiptAndCommitMs:committedAt-queuedAt
     });
     let visible=null;
     try{visible=typeof onProfileReadback==='function'
      ?await onProfileReadback(expected):null;}catch(_){}
     if(visible==='ready')return Object.freeze({
      status:'PROFILE_CLOUD_READBACK_VERIFIED',requestId,
      cloudWriteCommitted:true,
      timings:Object.freeze({
       checkAndQueueMs:queuedAt-startedAt,
       receiptAndCommitMs:committedAt-queuedAt,
       readbackMs:Date.now()-committedAt
      })
     });
     return Object.freeze({status:'PROFILE_COMMITTED_READBACK_REQUIRED',
      requestId,record:patch,expectedRevision:baseline.revision,
      familyId:baseline.familyId,actorUid:baseline.actorUid,
      cloudWriteCommitted:true});
    }
    return Object.freeze({status:synced?.status||
      'PROFILE_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId,
     record:patch,expectedRevision:baseline.revision,
     familyId:baseline.familyId,actorUid:baseline.actorUid,
     cloudWriteCommitted:false});
   }catch(_){return result('PROFILE_OPERATION_REVIEW_REQUIRED');}
   finally{profileBusy=false;}
  }
  async function invokeSettings(el,doc){
   if(allowSettings!==true||!documentCommands?.submit
     ||!documentQueue?.send||typeof readDocumentInput!=='function')
    return result('FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY');
   if(settingsBusy)return result('BUSY');
   settingsBusy=true;
   const startedAt=Date.now();let queuedAt=startedAt,committedAt=startedAt;
   try{
    const baseline=typeof readSettingsBaseline==='function'
     ?readSettingsBaseline():null;
    if(!baseline||typeof baseline.familyId!=='string'
      ||typeof baseline.actorUid!=='string'
      ||!Number.isSafeInteger(baseline.revision)||baseline.revision<0
      ||!baseline.body?.target||!baseline.body?.daily)
     return result('SETTINGS_DISPLAYED_BASELINE_REQUIRED');
    const input=readDocumentInput(el,doc);
    if(input?.kind!=='settings'||input.action!=='patch'
      ||!input.record||typeof input.record!=='object'
      ||Array.isArray(input.record)||!Object.keys(input.record).length)
     return result('SETTINGS_FORM_INVALID');
    // Only changed values are expected by ACK/readback. The queued 026 body
    // is still merged from the COMPLETE B1 settings document.
    const patch={};
    for(const [key,value] of Object.entries(input.record)){
     if(['target','daily','replenishPolicy'].includes(key)
       &&value&&typeof value==='object'&&!Array.isArray(value)){
      const previous=baseline.body[key]||{},changed={};
      for(const [field,next] of Object.entries(value)){
       if(previous[field]!==next)changed[field]=next;
      }
      if(Object.keys(changed).length)patch[key]=changed;
     }else if(baseline.body[key]!==value)patch[key]=value;
    }
    if(!Object.keys(patch).length)return result('SETTINGS_UNCHANGED');
    const saved=await documentCommands.submit({
     ...input,record:patch,familyId:baseline.familyId,
     actorUid:baseline.actorUid,expectedRevision:baseline.revision,
     operatorApproved:true,verifiedBaseline:baseline
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('SETTINGS_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    queuedAt=Date.now();
    documentProgress('settings','queued',{checkAndQueueMs:queuedAt-startedAt});
    documentProgress('settings','submitting');
    let synced;
    try{synced=await documentQueue.send({operatorApproved:true,
     fastDocumentId:requestId,fastDocumentKind:'settings'});}
    catch(_){return Object.freeze({
     status:'SETTINGS_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId,
     record:patch,expectedRevision:baseline.revision,
     familyId:baseline.familyId,actorUid:baseline.actorUid,
     cloudWriteCommitted:false
    });}
    const expected={requestId,record:patch,
     expectedRevision:baseline.revision,
     receiptVerified:synced?.receiptVerified===true};
    if(synced?.status==='DOCUMENT_SETTINGS_ACK_CONFIRMED'){
     let applied='pending';
     try{applied=typeof onSettingsAck==='function'
      ?await onSettingsAck({...synced,action:'patch',record:patch}):'pending';
     }catch(_){}
     if(applied==='ready')return Object.freeze({
      status:'SETTINGS_CLOUD_ACK_APPLIED',requestId,cloudWriteCommitted:true
     });
    }
    if(['DOCUMENT_SETTINGS_ACK_RECOVERED_NEEDS_REFRESH',
      'DOCUMENT_SETTINGS_ACK_CONFIRMED','DOCUMENT_SYNC_CONFIRMED']
       .includes(synced?.status)){
     committedAt=Date.now();
     documentProgress('settings','readback',{
      checkAndQueueMs:queuedAt-startedAt,
      receiptAndCommitMs:committedAt-queuedAt
     });
     let visible=null;
     try{visible=typeof onSettingsReadback==='function'
      ?await onSettingsReadback(expected):null;}catch(_){}
     if(visible==='ready')return Object.freeze({
      status:'SETTINGS_CLOUD_READBACK_VERIFIED',requestId,
      cloudWriteCommitted:true,timings:Object.freeze({
       checkAndQueueMs:queuedAt-startedAt,
       receiptAndCommitMs:committedAt-queuedAt,
       readbackMs:Date.now()-committedAt
      })
     });
     return Object.freeze({status:'SETTINGS_COMMITTED_READBACK_REQUIRED',
      requestId,record:patch,expectedRevision:baseline.revision,
      familyId:baseline.familyId,actorUid:baseline.actorUid,
      cloudWriteCommitted:true});
    }
    return Object.freeze({status:synced?.status||
     'SETTINGS_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId,
     record:patch,expectedRevision:baseline.revision,
     familyId:baseline.familyId,actorUid:baseline.actorUid,
     cloudWriteCommitted:false});
   }catch(_){return result('SETTINGS_OPERATION_REVIEW_REQUIRED');}
   finally{settingsBusy=false;}
  }
  async function handle(el,doc,preparedDocumentInput=null){
   const action=el.dataset?.action;
   const referenceEvent=el.id==='saveEditedReference'
    ||el.id==='restoreDefaultReference'||action==='resetref';
   const quoteWriteEvent=el.id==='saveQuote'||el.id==='clearQuotes'
    ||action==='deletequote';
   const quoteEditEvent=action==='editquote';
   const growthWriteEvent=el.id==='saveWeight'||action==='deleteweight';
   const profileWriteEvent=el.id==='saveProfile';
   const settingsWriteEvent=el.id==='saveSizePreferences'
    ||el.id==='savePlans'||Boolean(el.dataset?.preset);
   const documentEvent=referenceEvent||quoteWriteEvent||quoteEditEvent
    ||growthWriteEvent||profileWriteEvent||settingsWriteEvent;
   // Each category has its own authorization; no cross-grant.
   if(documentEvent&&!documentsAuthorized())
    return result(purchaseAuthorized()
     ?'FORMAL_DOCUMENT_WRITES_NOT_AUTHORIZED'
     :'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   if(!documentEvent&&!purchaseAuthorized())
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   if(purchaseOnly===true&&el.id!=='buyNow'&&action!=='buyquote'
     &&!(allowConsume===true&&action==='consume')
     &&!(allowReverse===true&&action==='deletetx')
     &&!(allowStocktake===true&&el.id==='saveStocks')
     &&!(allowReference===true&&referenceEvent)
     &&!(allowQuotes===true&&(quoteWriteEvent||quoteEditEvent))
     &&!(allowGrowth===true&&growthWriteEvent)
     &&!(allowProfile===true&&profileWriteEvent)
     &&!(allowSettings===true&&settingsWriteEvent))
    return result('FORMAL_PURCHASE_ONLY');
   if(el.id==='buyNow')
    return invoke('purchase',readPurchase());
   if(action==='buyquote'){
    const quote=readQuote(el.dataset?.id);
    return quote?invoke('purchase',quote):result('QUOTE_NOT_VERIFIED');
   }
   if(action==='consume')
    return invoke('consume',{size:el.dataset?.size,count:Number(el.dataset?.count)});
   if(el.id==='saveStocks')
    return readStocktakeInputs(doc);
   if(referenceEvent)return invokeReference(el,doc);
   if(quoteWriteEvent)return invokeQuotes(el,doc);
   if(growthWriteEvent)return invokeGrowth(el,doc,preparedDocumentInput);
   if(profileWriteEvent)return invokeProfile(el,doc);
   if(settingsWriteEvent)return invokeSettings(el,doc);
   if(quoteEditEvent&&typeof prepareQuoteEdit==='function'){
    return prepareQuoteEdit(el.dataset?.id);
   }
   if(documentsAuthorized()&&documentCommands?.submit
     &&typeof readDocumentInput==='function'){
    const docAction=readDocumentInput(el,doc);
    if(docAction){
     return documentCommands.submit({...docAction,operatorApproved:true});
    }
   }
   if(action==='deletetx'){
    const record=readTransaction(el.dataset?.id);
    if(!record||record.origin!=='cloud_post_migration'
      ||!['buy','use'].includes(record.type)
      ||record.reversed===true||typeof record.operationId!=='string')
     return result('IMMUTABLE_LEGACY_HISTORY_NOT_REVERSIBLE');
    return invoke('reverse',{size:record.size,
     origin:record.origin,reversesOperationId:record.operationId});
   }
   return result('FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY');
  }
  function dispatchReference(el,doc){
    // Run synchronously from both capture handlers. invokeReference sets
    // referenceBusy before its first await: click + submit cannot race IDs.
    if(referenceBusy)return;
    if(referenceNeedsReview){
     notify(result('DOCUMENT_PENDING_REVIEW_REQUIRED'));return;
    }
    if(!documentsAuthorized()||allowReference!==true){
     void handle(el,doc).then(notify,
      ()=>notify(result('FORMAL_OPERATION_REVIEW_REQUIRED')));
     return;
    }
    // Capture the exact edit and displayed CAS baseline BEFORE any awaits.
    // It is metadata for restoring the ORIGINAL UUID, never a new command.
    let intent=null,baseline=null;
    try{
     intent=readDocumentInput?.(el,doc);
     baseline=readReferenceBaseline?.();
    }catch(_){}
    activeReferenceAction=intent?.action||null;
    referenceProgress('checking');
    void handle(el,doc).then(answer=>{
     // A committed/ambiguous request stays locked until its own receipt
     // and the same account's rendered reference are verified together.
     if(answer?.requestId&&!['REFERENCE_CLOUD_READBACK_VERIFIED',
      'REFERENCE_CLOUD_ACK_APPLIED'].includes(answer.status))
      referenceNeedsReview=Object.freeze({
       requestId:answer.requestId,action:intent?.action,
       record:intent?.record?Object.freeze({...intent.record}):null,
       expectedRevision:baseline?.revision,
       actorUid:baseline?.actorUid,familyId:baseline?.familyId
      });
     const phase=referenceNeedsReview?'pending':
      ['REFERENCE_CLOUD_READBACK_VERIFIED',
      'REFERENCE_CLOUD_ACK_APPLIED'].includes(answer?.status)?'success':'failed';
     referenceProgress(phase,answer?.timings||{});
     if(intent?.action==='reset'&&phase==='failed'){
      const msg=attached?.doc.getElementById('formalReferenceActionFeedback');
      if(msg)msg.textContent=errorText(String(answer?.status||''),'reference');
     }
     notify(answer);
    },()=>{
     referenceProgress('failed');
     notify(result('REFERENCE_OPERATION_REVIEW_REQUIRED'));
    });
  }
  async function recoverReferenceButton({displayedReference=null}={}){
   const pending=referenceNeedsReview;
   if(!pending||referenceBusy||!displayedReference
     ||displayedReference.status!=='PRIMARY_DOCUMENT_READ_VERIFIED'
     ||displayedReference.kind!=='reference'
     ||displayedReference.actorUid!==pending.actorUid
     ||displayedReference.familyId!==pending.familyId
     ||!Number.isSafeInteger(displayedReference.revision)
     ||!Number.isSafeInteger(pending.expectedRevision)
     ||displayedReference.revision<=pending.expectedRevision
     ||typeof pending.record?.key!=='string'
     ||!displayedReference.body?.referenceOverrides
     ||typeof documentQueue?.checkSavedRequest!=='function')return false;
   const values=displayedReference.body.referenceOverrides;
   const match=pending.action==='reset'
    ?!Object.prototype.hasOwnProperty.call(values,pending.record.key)
    :pending.action==='set'
     &&values[pending.record.key]===pending.record.value;
   if(!match)return false;
   let receipt=null;
   try{receipt=await documentQueue.checkSavedRequest(pending.requestId);}catch(_){}
   if(receipt?.status!=='REQUEST_ACK_RECOVERED'
     ||receipt.requestId!==undefined&&receipt.requestId!==pending.requestId
     ||referenceNeedsReview!==pending)return false;
   referenceNeedsReview=null;
   referenceProgress('idle');
   return true;
  }
  // Only an explicitly abandoned, receipt-absent CAS conflict may release a
  // local pending button after the current account's cloud view is verified.
  function releaseAbandonedDocumentConflict({kind,requestId,
   actorUid,familyId}={}){
   if(kind==='quotes'&&minimalReview.quotes?.requestId===requestId
     &&minimalReview.quotes.actorUid===actorUid
     &&minimalReview.quotes.familyId===familyId){
    minimalReview.quotes=null;
    minimalFeedback('quotes','recovered');
    return true;
   }
   if(kind==='reference'&&referenceNeedsReview?.requestId===requestId
     &&referenceNeedsReview.actorUid===actorUid
     &&referenceNeedsReview.familyId===familyId){
    referenceNeedsReview=null;
    referenceProgress('idle');
    return true;
   }
   if(kind==='growth'&&pendingDocumentReview.growth?.requestId===requestId
     &&pendingDocumentReview.growth.actorUid===actorUid
     &&pendingDocumentReview.growth.familyId===familyId){
    const action=pendingDocumentReview.growth.action;
    pendingDocumentReview.growth=null;
    growthProgress('recovered',action);
    return true;
   }
   if((kind==='profile'||kind==='settings')
     &&pendingDocumentReview[kind]===requestId){
    pendingDocumentReview[kind]=null;
    documentProgress(kind,'idle');
    return true;
   }
   return false;
  }
  function dispatchGrowthSave(el,doc){
   if(growthBusy)return;
   if(pendingDocumentReview.growth){
    growthProgress('pending',pendingDocumentReview.growth.action);
    notify(result('DOCUMENT_PENDING_REVIEW_REQUIRED'));return;
   }
   if(!documentsAuthorized()||allowGrowth!==true){
    let pending;try{pending=handle(el,doc);}catch(_){pending=Promise.resolve(
     result('FORMAL_OPERATION_REVIEW_REQUIRED'));}
    void Promise.resolve(pending).then(notify,
     ()=>notify(result('FORMAL_OPERATION_REVIEW_REQUIRED')));
    return;
   }
   let input=null;
   try{input=readDocumentInput?.(el,doc);}catch(_){}
   if(!input){
    growthProgress('failed','add',result('GROWTH_FORM_INVALID'));
    notify(result('GROWTH_FORM_INVALID'));return;
   }
   activeGrowthButton=el;
   growthProgress('working',input.action);
   let promise;
   try{promise=handle(el,doc,input);}
   catch(_){promise=Promise.resolve(result('GROWTH_OPERATION_REVIEW_REQUIRED'));}
   void Promise.resolve(promise).then(answer=>{
    const ok=['GROWTH_CLOUD_ACK_APPLIED','GROWTH_CLOUD_READBACK_VERIFIED']
     .includes(answer?.status);
    if(answer?.requestId&&!ok){
     pendingDocumentReview.growth=Object.freeze({
      requestId:answer.requestId,action:answer.action||input.action,
      record:answer.record||input.record,
      expectedRevision:answer.expectedRevision,
      actorUid:answer.actorUid,familyId:answer.familyId
     });
    }
    growthProgress(pendingDocumentReview.growth?'pending':
     ok?'success':answer?.status==='GROWTH_DELETE_CANCELLED'
      ?'cancelled':'failed',input.action,answer);
    notify(answer);
   },()=>{
    growthProgress('failed',input.action,
     result('GROWTH_OPERATION_REVIEW_REQUIRED'));
    notify(result('GROWTH_OPERATION_REVIEW_REQUIRED'));
   });
  }
  function dispatchDocumentSave(el,doc,kind){
   if(kind!=='profile'&&kind!=='settings')return;
   if(kind==='profile'?profileBusy:settingsBusy)return;
   if(pendingDocumentReview[kind]){
    notify(result('DOCUMENT_PENDING_REVIEW_REQUIRED'));return;
   }
   if(!documentsAuthorized()||!(kind==='profile'?allowProfile:allowSettings)){
    void handle(el,doc).then(notify,
     ()=>notify(result('FORMAL_OPERATION_REVIEW_REQUIRED')));
    return;
   }
   activeDocumentButton[kind]=el;
   documentProgress(kind,'checking');
   let promise;
   try{promise=handle(el,doc);}
   catch(_){promise=Promise.resolve(result('FORMAL_OPERATION_REVIEW_REQUIRED'));}
   void Promise.resolve(promise).then(answer=>{
    const ok=kind==='profile'
     ?['PROFILE_CLOUD_ACK_APPLIED','PROFILE_CLOUD_READBACK_VERIFIED']
       .includes(answer?.status)
     :['SETTINGS_CLOUD_ACK_APPLIED','SETTINGS_CLOUD_READBACK_VERIFIED']
      .includes(answer?.status);
    if(answer?.requestId&&!ok)pendingDocumentReview[kind]=answer.requestId;
    documentProgress(kind,pendingDocumentReview[kind]?'pending':
     ok?'success':'failed',answer?.timings||{},answer);
    notify(answer);
   },()=>{
    documentProgress(kind,'failed',{},result('FORMAL_OPERATION_REVIEW_REQUIRED'));
    notify(result('FORMAL_OPERATION_REVIEW_REQUIRED'));
   });
  }
  // Manual "重新核验待确认操作" is the only recovery path for
  // ambiguous UUIDs. Require both a verified cloud read and original receipt.
  async function recoverDocumentButtons({verified=false,displayedGrowth=null}={}){
   if(verified!==true||typeof documentQueue?.checkSavedRequest!=='function')
    return false;
   let recovered=false;
   const growth=pendingDocumentReview.growth;
   if(growth&&displayedGrowth?.status==='PRIMARY_DOCUMENT_READ_VERIFIED'
     &&displayedGrowth.kind==='growth'
     &&displayedGrowth.familyId===growth.familyId
     &&displayedGrowth.actorUid===growth.actorUid
     &&Number.isSafeInteger(displayedGrowth.revision)
     &&displayedGrowth.revision>growth.expectedRevision
     &&Array.isArray(displayedGrowth.body?.items)){
    const row=displayedGrowth.body.items.find(x=>x.id===growth.record?.id);
    const matches=growth.action==='delete'?!row:
     (growth.action==='add'||growth.action==='edit')&&row
      &&Object.entries(growth.record||{}).every(([key,value])=>row[key]===value);
    if(matches){
     let receipt=null;
     try{receipt=await documentQueue.checkSavedRequest(growth.requestId);}catch(_){}
     if(receipt?.status==='REQUEST_ACK_RECOVERED'){
      pendingDocumentReview.growth=null;
      growthProgress('recovered',growth.action);
      recovered=true;
     }
    }
   }
   for(const kind of ['profile','settings']){
    const requestId=pendingDocumentReview[kind];
    if(!requestId)continue;
    let receipt=null;
    try{receipt=await documentQueue.checkSavedRequest(requestId);}catch(_){}
    if(receipt?.status!=='REQUEST_ACK_RECOVERED')continue;
    pendingDocumentReview[kind]=null;
    documentProgress(kind,'idle');
    recovered=true;
   }
   return recovered;
  }
  function attach(doc){
   if(!doc?.addEventListener||!doc?.removeEventListener
     ||typeof doc.getElementById!=='function')
    throw Error('formal_ui:document_required');
   if(attached)throw Error('formal_ui:already_attached');
   const handler=event=>{
    if(!formalModeSelected())return;
    const el=event.target?.closest?.('button,[data-action],[data-preset]');
    if(!el)return;
    const action=el.dataset?.action||'';
    const allowedIds=new Set(['formalRefresh','formalSignOut',
      'formalGateSignOut','formalRetry','formalSendOtp',
      'formalConfirmOtp','formalSyncNow','formalResolveDocumentConflict','formalResolveBatchConflict','closeRefEditor','cancelEditedReference',
      'cancelWeight','installPwa','pwaUpdateNow']);
    const allowedActions=new Set(['go','editstock','series','pickref','editref','editweight']);
    if(el.classList?.contains('tab')||allowedIds.has(el.id)
      ||allowedActions.has(action))return;
    // Any unrecognized business button is also blocked: it must not fall
    // through to the old localStorage-only V1.1.2 handler by accident.
    event.preventDefault();event.stopImmediatePropagation();
    if(el.id==='saveEditedReference'||el.id==='restoreDefaultReference'
      ||action==='resetref'){
     dispatchReference(el,doc);return;
    }
    if(el.id==='saveWeight'||action==='deleteweight'){
     dispatchGrowthSave(el,doc);return;
    }
    if(el.id==='saveProfile'){
     dispatchDocumentSave(el,doc,'profile');return;
    }
    if(el.id==='saveSizePreferences'||el.id==='savePlans'||el.dataset?.preset){
     dispatchDocumentSave(el,doc,'settings');return;
    }
    if(el.id==='buyNow'){
     dispatchMinimal(el,doc,'purchase');return;
    }
    if(el.id==='saveQuote'||el.id==='clearQuotes'
      ||action==='deletequote'){
     dispatchMinimal(el,doc,'quotes');return;
    }
    Promise.resolve().then(()=>handle(el,doc)).then(notify,
      ()=>notify(result('FORMAL_OPERATION_REVIEW_REQUIRED')));
   };
   const formHandler=event=>{
    if(!formalModeSelected())return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.target?.id!=='priceEditForm')return;
    const el={id:'saveEditedReference',dataset:{}};
    dispatchReference(el,doc);
   };
   doc.addEventListener('click',handler,true);
   doc.addEventListener('submit',formHandler,true);
   attached={doc,handler,formHandler};
   return Object.freeze({
    hasPendingReferenceReview:()=>Boolean(referenceNeedsReview),
    recoverReferenceButton,releaseAbandonedDocumentConflict,
    hasPendingDocumentReview:()=>Boolean(pendingDocumentReview.growth
     ||pendingDocumentReview.profile||pendingDocumentReview.settings),
    hasPendingMinimalReview:domain=>Boolean(minimalReview[domain]),
    recoverMinimalButtons,recoverDocumentButtons,detach(){
    if(!attached)return;
    attached.doc.removeEventListener('click',attached.handler,true);
    attached.doc.removeEventListener('submit',attached.formHandler,true);
    attached=null;
   }});
  }
  return Object.freeze({attach,handle});
 }
 const api=Object.freeze({create});
 if(root)root.XBPrimaryFormalUIActions=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
