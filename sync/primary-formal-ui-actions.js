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
  operatorApproved=()=>false,documentCommands=null,
  readDocumentInput=null,prepareQuoteEdit=null,
  batchStocktake=null,createBatchId=null,
  purchaseOnly=false,onPurchaseReadback=null}={}){
  if(!commands?.submit||!primary?.read||typeof readPurchase!=='function'
    ||typeof readQuote!=='function'||typeof readTransaction!=='function'
    ||typeof notify!=='function'||typeof formalModeSelected!=='function'
    ||typeof operatorApproved!=='function')
   throw Error('formal_ui:dependencies_required');
  let busy=false, attached=null;
  async function invoke(action,value){
   if(buildAllowsWrites!==true||operatorApproved()!==true)
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   if(busy)return result('BUSY');
   busy=true;
   try{
    const queued=await commands.submit(action,value,{operatorApproved:true});
    if(action!=='purchase'||purchaseOnly!==true)return queued;
    if(!['PRIMARY_OPERATION_DURABLY_QUEUED',
      'PRIMARY_OPERATION_ALREADY_QUEUED'].includes(queued?.status))
     return queued;
    // RPC retries reuse the same durable UUID; never create a second buy.
    const synced=await primary.flush({operatorApproved:true});
    if(synced?.status!=='PRIMARY_CLOUD_SYNCED_VERIFIED')
     return Object.freeze({status:'PRIMARY_PURCHASE_PENDING_REVIEW',
      operationId:queued.operationId,cloudWriteCommitted:false});
    try{
     const visible=typeof onPurchaseReadback==='function'
      ?await onPurchaseReadback():null;
     if(visible==='ready')
      return Object.freeze({status:'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED',
       operationId:queued.operationId,cloudWriteCommitted:true});
    }catch(_){}
    return Object.freeze({status:'PRIMARY_PURCHASE_COMMITTED_READBACK_REQUIRED',
     operationId:queued.operationId,cloudWriteCommitted:true});
   }catch(_){return result('FORMAL_OPERATION_REVIEW_REQUIRED');}
   finally{busy=false;}
  }
  async function readStocktakeInputs(doc){
   const read=await primary.read();
   if(read?.status!=='PRIMARY_CLOUD_READ_VERIFIED'
     ||!read.inventory||!read.revisions)
    return result('PRIMARY_STOCK_UNVERIFIED');
   const changed=[];
   for(const size of SIZES){
    const field=doc.getElementById('inv_'+size);
    if(!field||typeof field.value!=='string'||field.value.trim()==='')
     return result('STOCK_FORM_INCOMPLETE');
    const n=Number(field.value);
    if(!Number.isSafeInteger(n)||n<0||n>100000)
     return result('STOCK_FORM_INVALID');
    if(!Number.isSafeInteger(read.inventory[size])
      ||!Number.isSafeInteger(read.revisions[size]))
     return result('PRIMARY_STOCK_UNVERIFIED');
    if(n!==read.inventory[size])changed.push({size,count:n});
   }
   if(changed.length===0)return result('PRIMARY_STOCK_UNCHANGED');
   // Entire original stock editor must be all-or-none. If multiple sizes
   // differ, use 027 one SQL transaction with one durable batch UUID. Never
   // submit six separate 009 stocktakes that might partially succeed.
   if(changed.length>1){
    if(!batchStocktake?.queue||typeof createBatchId!=='function')
     return result('MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED');
    const items=changed.map(x=>({...x,
     expectedRevision:read.revisions[x.size]}));
    return batchStocktake.queue({
     items,batchId:createBatchId(),operatorApproved:true
    });
   }
   return invoke('stocktake',changed[0]);
  }
  async function handle(el,doc){
   if(buildAllowsWrites!==true||operatorApproved()!==true)
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   const action=el.dataset?.action;
   if(purchaseOnly===true&&el.id!=='buyNow'&&action!=='buyquote')
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
   if(action==='editquote'&&typeof prepareQuoteEdit==='function'){
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
