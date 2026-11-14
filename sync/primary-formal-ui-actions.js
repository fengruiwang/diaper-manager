/* M3 original V1.1.2 five-page DOM command capture for a future APPROVED
 * formal primary view (not loaded in existing M3 read-only browser preview).
 * Captures native page buttons before their legacy localStorage click handlers:
 * buyNow, buyquote, consume, saveStocks, deletetx.
 * Keeps unsupported quote/profile/growth/settings writes blocked, never
 * falling through to an independent local history. No auto network actions.
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
  notify,formalModeSelected,buildAllowsWrites=false,
  operatorApproved=()=>false,documentCommands=null,documentQueue=null,
  readDocumentInput=null,readReferenceBaseline=null,
  onReferenceReadback=null,allowReference=false,
  allowQuotes=false,readQuotesBaseline=null,onQuotesReadback=null,
  confirmQuoteClear=()=>false,prepareQuoteEdit=null,
  allowGrowth=false,readGrowthBaseline=null,onGrowthReadback=null,
  confirmGrowthDelete=()=>false,
  allowProfile=false,readProfileBaseline=null,onProfileReadback=null,
  allowSettings=false,readSettingsBaseline=null,onSettingsReadback=null,
  batchStocktake=null,createBatchId=null,onBatchReadback=null,
  purchaseOnly=false,allowConsume=false,allowReverse=false,
  allowStocktake=false,readStocktakeBaseline=null,onPurchaseReadback=null}={}){
  if(!commands?.submit||!primary?.read||typeof readPurchase!=='function'
    ||typeof readQuote!=='function'||typeof readTransaction!=='function'
    ||typeof notify!=='function'||typeof formalModeSelected!=='function'
    ||typeof operatorApproved!=='function')
   throw Error('formal_ui:dependencies_required');
  let busy=false,stocktakeBusy=false,referenceBusy=false,quoteBusy=false,growthBusy=false,profileBusy=false,settingsBusy=false,attached=null;
  async function invoke(action,value){
   if(buildAllowsWrites!==true||operatorApproved()!==true)
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
     expectedRevision:baseline.revision,operatorApproved:true
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('REFERENCE_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    let sync;
    try{sync=await documentQueue.send({operatorApproved:true});}
    catch(_){return Object.freeze({
     status:'REFERENCE_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId
    });}
    if(sync?.status!=='DOCUMENT_SYNC_CONFIRMED')
     return Object.freeze({status:sync?.status||
       'REFERENCE_ACK_UNKNOWN_KEEP_REQUEST_ID',
      requestId,cloudWriteCommitted:false});
    try{
     const visible=typeof onReferenceReadback==='function'
      ?await onReferenceReadback({requestId,
       record:input.record,action:input.action,
       expectedRevision:baseline.revision}):null;
     if(visible==='ready')return Object.freeze({
      status:'REFERENCE_CLOUD_READBACK_VERIFIED',
      requestId,cloudWriteCommitted:true
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
    if(input.action==='add'&&(!input.record?.id
      ||baseline.body.items.some(row=>row.id===input.record.id)))
     return result('QUOTES_FORM_INVALID');
    const saved=await documentCommands.submit({
     ...input,familyId:baseline.familyId,actorUid:baseline.actorUid,
     expectedRevision:baseline.revision,operatorApproved:true
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('QUOTES_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    let sync;
    try{sync=await documentQueue.send({operatorApproved:true});}
    catch(_){return Object.freeze({
     status:'QUOTES_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId
    });}
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
  async function invokeGrowth(el,doc){
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
    const input=readDocumentInput(el,doc);
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
     expectedRevision:baseline.revision,operatorApproved:true
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('GROWTH_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    let synced;
    try{synced=await documentQueue.send({operatorApproved:true});}
    catch(_){return Object.freeze({
     status:'GROWTH_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId
    });}
    if(synced?.status!=='DOCUMENT_SYNC_CONFIRMED')
     return Object.freeze({status:synced?.status
       ||'GROWTH_ACK_UNKNOWN_KEEP_REQUEST_ID',
      requestId,cloudWriteCommitted:false});
    try{
     const visible=typeof onGrowthReadback==='function'
      ?await onGrowthReadback({
       requestId,action:input.action,record:input.record,
       expectedRevision:baseline.revision
      }):null;
     if(visible==='ready')return Object.freeze({
      status:'GROWTH_CLOUD_READBACK_VERIFIED',requestId,
      action:input.action,cloudWriteCommitted:true
     });
    }catch(_){}
    return Object.freeze({status:'GROWTH_COMMITTED_READBACK_REQUIRED',
     requestId,cloudWriteCommitted:true});
   }catch(_){return result('GROWTH_OPERATION_REVIEW_REQUIRED');}
   finally{growthBusy=false;}
  }
  async function invokeProfile(el,doc){
   if(allowProfile!==true||!documentCommands?.submit
     ||!documentQueue?.send||typeof readDocumentInput!=='function')
    return result('FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY');
   if(profileBusy)return result('BUSY');
   profileBusy=true;
   try{
    // Match the exact document revision visible in the settings editor.
    const baseline=typeof readProfileBaseline==='function'
     ?readProfileBaseline():null;
    if(!baseline||typeof baseline.familyId!=='string'
      ||typeof baseline.actorUid!=='string'
      ||!Number.isSafeInteger(baseline.revision)||baseline.revision<0
      ||!baseline.body?.babyProfile
      ||typeof baseline.body.babyProfile!=='object')
     return result('PROFILE_DISPLAYED_BASELINE_REQUIRED');
    const input=readDocumentInput(el,doc);
    if(input?.kind!=='profile'||input.action!=='patch'
       ||!input.record?.babyProfile)
     return result('PROFILE_FORM_INVALID');
    const saved=await documentCommands.submit({
     ...input,familyId:baseline.familyId,actorUid:baseline.actorUid,
     expectedRevision:baseline.revision,operatorApproved:true
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('PROFILE_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    let synced;
    try{synced=await documentQueue.send({operatorApproved:true});}
    catch(_){return Object.freeze({
     status:'PROFILE_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId,
     cloudWriteCommitted:false
    });}
    if(synced?.status!=='DOCUMENT_SYNC_CONFIRMED')
     return Object.freeze({
      status:synced?.status||'PROFILE_ACK_UNKNOWN_KEEP_REQUEST_ID',
      requestId,cloudWriteCommitted:false
     });
    try{
     const visible=typeof onProfileReadback==='function'
      ?await onProfileReadback({
       requestId,record:input.record,expectedRevision:baseline.revision
      }):null;
     if(visible==='ready')return Object.freeze({
      status:'PROFILE_CLOUD_READBACK_VERIFIED',
      requestId,cloudWriteCommitted:true
     });
    }catch(_){}
    return Object.freeze({status:'PROFILE_COMMITTED_READBACK_REQUIRED',
     requestId,cloudWriteCommitted:true});
   }catch(_){return result('PROFILE_OPERATION_REVIEW_REQUIRED');}
   finally{profileBusy=false;}
  }
  async function invokeSettings(el,doc){
   if(allowSettings!==true||!documentCommands?.submit
     ||!documentQueue?.send||typeof readDocumentInput!=='function')
    return result('FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY');
   if(settingsBusy)return result('BUSY');
   settingsBusy=true;
   try{
    // Bind all settings edits to the revision actually displayed in UI.
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
      ||Object.keys(input.record).length===0)
     return result('SETTINGS_FORM_INVALID');
    const saved=await documentCommands.submit({
     ...input,familyId:baseline.familyId,actorUid:baseline.actorUid,
     expectedRevision:baseline.revision,operatorApproved:true
    });
    if(saved?.status!=='DOCUMENT_OPERATION_DURABLY_QUEUED')
     return saved||result('SETTINGS_COMMAND_UNVERIFIED');
    const requestId=saved.requestId;
    let synced;
    try{synced=await documentQueue.send({operatorApproved:true});}
    catch(_){return Object.freeze({
     status:'SETTINGS_ACK_UNKNOWN_KEEP_REQUEST_ID',requestId,
     cloudWriteCommitted:false
    });}
    if(synced?.status!=='DOCUMENT_SYNC_CONFIRMED')
     return Object.freeze({
      status:synced?.status||'SETTINGS_ACK_UNKNOWN_KEEP_REQUEST_ID',
      requestId,cloudWriteCommitted:false
     });
    try{
     const visible=typeof onSettingsReadback==='function'
      ?await onSettingsReadback({
       requestId,record:input.record,expectedRevision:baseline.revision
      }):null;
     if(visible==='ready')return Object.freeze({
      status:'SETTINGS_CLOUD_READBACK_VERIFIED',
      requestId,cloudWriteCommitted:true
     });
    }catch(_){}
    return Object.freeze({status:'SETTINGS_COMMITTED_READBACK_REQUIRED',
     requestId,cloudWriteCommitted:true});
   }catch(_){return result('SETTINGS_OPERATION_REVIEW_REQUIRED');}
   finally{settingsBusy=false;}
  }
  async function handle(el,doc){
   if(buildAllowsWrites!==true||operatorApproved()!==true)
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
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
   if(growthWriteEvent)return invokeGrowth(el,doc);
   if(profileWriteEvent)return invokeProfile(el,doc);
   if(settingsWriteEvent)return invokeSettings(el,doc);
   if(quoteEditEvent&&typeof prepareQuoteEdit==='function'){
    return prepareQuoteEdit(el.dataset?.id);
   }
   if(documentCommands?.submit&&typeof readDocumentInput==='function'){
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
      'formalConfirmOtp','formalSyncNow','closeRefEditor','cancelEditedReference',
      'cancelWeight']);
    const allowedActions=new Set(['go','editstock','series','pickref','editref','editweight']);
    if(el.classList?.contains('tab')||allowedIds.has(el.id)
      ||allowedActions.has(action))return;
    // Any unrecognized business button is also blocked: it must not fall
    // through to the old localStorage-only V1.1.2 handler by accident.
    event.preventDefault();event.stopImmediatePropagation();
    Promise.resolve().then(()=>handle(el,doc)).then(notify,
      ()=>notify(result('FORMAL_OPERATION_REVIEW_REQUIRED')));
   };
   const formHandler=event=>{
    if(!formalModeSelected())return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.target?.id!=='priceEditForm')return;
    const el={id:'saveEditedReference',dataset:{}};
    Promise.resolve().then(()=>handle(el,doc)).then(notify,
      ()=>notify(result('FORMAL_OPERATION_REVIEW_REQUIRED')));
   };
   doc.addEventListener('click',handler,true);
   doc.addEventListener('submit',formHandler,true);
   attached={doc,handler,formHandler};
   return Object.freeze({detach(){
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
