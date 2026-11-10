/* XiaoBao v1.2.0: read-only historical data migration inventory.
 * No writes to localStorage / IndexedDB / CloudBase.
 * Never treat old purchase events as the source of current stock: legacy
 * stocktake can overwrite quantities without an audit event.
 */
(function(root){
 'use strict';
 const LEGACY_FIELDS=Object.freeze({
  dueDate:'profile',birthDate:'profile',babyProfile:'profile',
  babyWeight:'profile',weightRecords:'growth',
  currentSize:'preferences',sizeMode:'preferences',autoSize:'preferences',
  replenishPolicy:'preferences',preset:'preferences',goalPrice:'preferences',
  plannedBudget:'preferences',target:'preferences',daily:'preferences',
  inventory:'diaper',transactions:'diaper',quotes:'price',
  referenceOverrides:'price'
 });
 const RECORD_FIELDS=Object.freeze({
  transactions:new Set(['id','type','date','brand','series','size','pieces','price']),
  quotes:new Set(['id','date','brand','series','size','per','packs','price','pieces','unit']),
  weightRecords:new Set(['id','date','time','weight','note']),
  babyProfile:new Set(['name','sex','birthTime','birthWeight','birthLength'])
 });
 const SIZES=new Set(['NB','S','M','L','XL','XXL']);
 const pureObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const dateOK=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)
  &&Number.isFinite(new Date(x+'T00:00:00.000Z').getTime())
  &&new Date(x+'T00:00:00.000Z').toISOString().slice(0,10)===x;
 const timeOK=x=>x===''||typeof x==='string'
  &&/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(x);
 function audit(state,contract,purchaseAudit,cryptoProvider){
  if(!contract||typeof contract.inspect!=='function')throw Error('migration_manifest:contract_required');
  if(!purchaseAudit||typeof purchaseAudit.audit!=='function')throw Error('migration_manifest:purchase_audit_required');
  // The result is always a Promise; the underlying contract validates original
  // state and computes SHA256 of the entire unmodified JSON.
  return inspect(state,contract,purchaseAudit,cryptoProvider);
 }
 async function inspect(state,contract,purchaseAudit,cryptoProvider){
  const original=await contract.inspect(state,cryptoProvider);
  const purchases=purchaseAudit.audit(state.transactions);
  const issues=[],warnings=[],unknown=[];
  function issue(path,code){issues.push({path,code});}
  function unknownFields(source,allowed,path){
   if(!pureObject(source))return;
   for(const field of Object.keys(source)){
    if(!allowed.has(field)){
     unknown.push({path:path+'.'+field,code:'unmapped_field'});
    }
   }
  }
  const keys=Object.keys(state);
  unknownFields(state,new Set(Object.keys(LEGACY_FIELDS)),'state');
  for(const [name,allowed] of Object.entries(RECORD_FIELDS)){
   if(name==='babyProfile'){unknownFields(state.babyProfile,allowed,'babyProfile');continue;}
   for(let i=0;i<(state[name]||[]).length;i++)
    unknownFields(state[name][i],allowed,name+'['+i+']');
  }
  if(!pureObject(state.babyProfile))issue('babyProfile','missing_or_invalid_profile');
  if(!dateOK(state.dueDate))issue('dueDate','invalid_due_date');
  if(state.birthDate!==''&&!dateOK(state.birthDate))issue('birthDate','invalid_birth_date');
  if(!SIZES.has(state.currentSize))issue('currentSize','invalid_current_size');
  if(state.sizeMode!=null&&!['auto','manual'].includes(state.sizeMode))
   issue('sizeMode','invalid_size_mode');
  if(state.replenishPolicy!=null&&
     (!pureObject(state.replenishPolicy)||!['custom','days'].includes(state.replenishPolicy.mode)
      ||![5,7,10].includes(Number(state.replenishPolicy.days))))
   issue('replenishPolicy','invalid_replenish_policy');

  for(const row of purchases.issues)issue('transactions['+row.index+']',row.code);
  const quotes=state.quotes||[];
  for(let i=0;i<quotes.length;i++){
   const q=quotes[i];
   if(!pureObject(q)){issue('quotes['+i+']','invalid_quote');continue;}
   if(!SIZES.has(q.size)||typeof q.brand!=='string'||!q.brand.trim()
    ||typeof q.series!=='string'||!q.series.trim())
    issue('quotes['+i+']','invalid_quote_identity');
   if(!dateOK(q.date))issue('quotes['+i+'].date','invalid_quote_date');
   if(!Number.isInteger(q.per)||q.per<1||q.per>1000
     ||!Number.isInteger(q.packs)||q.packs<1||q.packs>200
     ||q.pieces!==q.per*q.packs||q.pieces>30000)
    issue('quotes['+i+']','invalid_quote_pack_count');
   try{purchaseAudit.cents(q.price)}
   catch(e){issue('quotes['+i+'].price',e.message)}
   if(typeof q.unit!=='number'||!Number.isFinite(q.unit)
      ||!(q.unit>0)||Math.abs(q.unit-q.price/q.pieces)>1e-7)
    issue('quotes['+i+'].unit','quote_unit_mismatch');
  }

  const weights=state.weightRecords||[];
  for(let i=0;i<weights.length;i++){
   const w=weights[i];
   if(!dateOK(w.date)||!timeOK(w.time||'')||!Number.isFinite(w.weight)
      ||w.weight<0.3||w.weight>40
      ||Math.abs(w.weight*1000-Math.round(w.weight*1000))>1e-7)
    issue('weightRecords['+i+']','invalid_weight_measurement');
   if(w.note!=null&&(typeof w.note!=='string'||w.note.length>120))
    issue('weightRecords['+i+'].note','invalid_note');
  }
  // Unit reference prices may be three decimal places; they are NOT purchase
  // totals in cents. Preserve their exact 0.001 RMB precision.
  for(const [key,value] of Object.entries(state.referenceOverrides||{})){
   if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>100
      ||Math.abs(value*1000-Math.round(value*1000))>1e-7)
    issue('referenceOverrides.'+key,'invalid_reference_unit_price');
  }

  // Old inventory is the ONLY actual baseline. Purchasing/usage events are
  // retained separately as historical records but NEVER replayed for baseline.
  const baseline=Object.freeze({...original.summary.inventory});
  warnings.push('legacy_purchase_history_is_not_inventory_baseline');
  warnings.push('full_backup_and_explicit_user_approval_required');
  // Unknown fields are migration blockers until a schema mapping and a
  // retention mechanism for these exact records are reviewed.
  const blockers=[...issues,...unknown];
  return {
   source:{legacyKey:original.legacyKey,sha256:original.sha256,
    byteLength:original.byteLength,manifestVersion:original.manifestVersion},
   inventoryBaseline:baseline,
   summary:original.summary,
   historyTotals:{purchaseCount:purchases.purchaseCount,useCount:purchases.useCount,
    purchaseFen:purchases.spendFen,purchasePieces:purchases.pieceCount},
   knownMapping:{...LEGACY_FIELDS},
   unknownFields:unknown,
   issues,blockers,warnings,
   readOnlyPreflightPass:blockers.length===0,
   canUpload:false,
   requiresExplicitApproval:true
  };
 }
 const api=Object.freeze({audit,LEGACY_FIELDS});
 if(root)root.XBLegacyMigrationManifest=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
