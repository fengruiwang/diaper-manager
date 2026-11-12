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
  'importDataBtn','importFile','saveReference','saveQuoteEdit']);
 const guardedActions=new Set(['deletequote','editweight','deleteweight',
  'buyquote','consume','deletetx']);
 const result=(status)=>Object.freeze({status});
 function create({commands,primary,readPurchase,readQuote,readTransaction,
  notify,formalModeSelected,buildAllowsWrites=false,
  operatorApproved=()=>false}={}){
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
   try{return await commands.submit(action,value,{operatorApproved:true});}
   catch(_){return result('FORMAL_OPERATION_REVIEW_REQUIRED');}
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
   // A six-size local editor behaves atomically. Six separate 009 RPCs do
   // not. Never silently commit the first N changes and fail on the N+1th.
   if(changed.length!==1)return result('MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED');
   return invoke('stocktake',changed[0]);
  }
  async function handle(el,doc){
   if(buildAllowsWrites!==true||operatorApproved()!==true)
    return result('FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
   const action=el.dataset?.action;
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
    const el=event.target?.closest?.('button,[data-action],input');
    if(!el)return;
    if(!guardedIds.has(el.id)&&!guardedActions.has(el.dataset?.action)
      &&el.id!=='buyNow')return;
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve().then(()=>handle(el,doc)).then(notify,
      ()=>notify(result('FORMAL_OPERATION_REVIEW_REQUIRED')));
   };
   doc.addEventListener('click',handler,true);
   attached={doc,handler};
   return Object.freeze({detach(){
    if(!attached)return;
    attached.doc.removeEventListener('click',attached.handler,true);
    attached=null;
   }});
  }
  return Object.freeze({attach,handle});
 }
 const api=Object.freeze({create});
 if(root)root.XBPrimaryFormalUIActions=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
