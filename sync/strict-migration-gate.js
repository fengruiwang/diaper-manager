/* XiaoBao P2-4D strict migration decision review.
 * Pure read-only local inspection of an EXPORTED v1 JSON string; no SDK,
 * IndexedDB, localStorage, RPC, migration token or database writes.
 * Even a clean result is planning evidence only, NEVER upload authorization.
 */
(function(root){
 'use strict';
 const MAX_BYTES=10*1024*1024;
 const EXPECTED='xiaobao-diapers';
 const KNOWN=new Set([
  'dueDate','birthDate','babyProfile','babyWeight','weightRecords',
  'currentSize','sizeMode','autoSize','replenishPolicy','preset',
  'goalPrice','plannedBudget','target','daily','inventory',
  'transactions','quotes','referenceOverrides'
 ]);
 const SIZES=new Set(['NB','S','M','L','XL','XXL']);
 const PROFILE=new Set(['name','sex','birthTime','birthWeight','birthLength']);
 const POLICY=new Set(['mode','days']);
 const ENVELOPE=new Set(['app','version','exportedAt','data']);
 const REQUIRED=[...KNOWN].filter(x=>x!=='preset');
 const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
 function status(state,extra={}){
  return Object.freeze({
   status:state,canUpload:false,canReplaceLocalState:false,
   serverReceiptPresent:false,localStateUnchanged:true,
   requiresExplicitApproval:true,...extra
  });
 }
 function issue(section,code){
  return Object.freeze({section,code});
 }
 function category(path){
  if(typeof path!=='string')return 'unknown_extension';
  const start=path.startsWith('state.')?path.slice(6):path;
  const head=start.split(/[.\[]/)[0];
  return KNOWN.has(head)?head:'unknown_extension';
 }
 function countCodes(items){
  const counts=new Map();
  for(const x of items){
   const key=x.section+'|'+x.code;
   counts.set(key,(counts.get(key)||0)+1);
  }
  return Object.freeze([...counts].map(([key,count])=>{
   const [section,code]=key.split('|');
   return Object.freeze({section,code,count});
  }).sort((a,b)=>(a.section+a.code).localeCompare(b.section+b.code)));
 }
 function validateEnvelope(raw){
  if(typeof raw!=='string'||raw.length<2)return {problem:'SOURCE_TEXT_REQUIRED'};
  const size=new TextEncoder().encode(raw).length;
  if(size>MAX_BYTES)return {problem:'SOURCE_FILE_TOO_LARGE'};
  let envelope;
  try{envelope=JSON.parse(raw);}catch(_){return {problem:'INVALID_JSON'};}
  if(!isObject(envelope)||envelope.app!==EXPECTED||
     envelope.version!==1||!isObject(envelope.data))
   return {problem:'UNSUPPORTED_APP_OR_VERSION'};
  const date=envelope.exportedAt;
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date)
     ||Number.isNaN(Date.parse(date))||new Date(date).toISOString()!==date)
   return {problem:'INVALID_EXPORT_TIMESTAMP'};
  if(Object.keys(envelope).some(key=>!ENVELOPE.has(key)))
   return {problem:'UNKNOWN_EXPORT_ENVELOPE_FIELD'};
  return {envelope,size};
 }
 function additionalStructureIssues(data){
  const issues=[];
  for(const key of REQUIRED){
   if(!own(data,key))issues.push(issue(key,'REQUIRED_FIELD_MISSING'));
  }
  for(const key of Object.keys(data)){
   if(!KNOWN.has(key))issues.push(issue('unknown_extension','UNKNOWN_TOP_LEVEL_FIELD'));
  }
  for(const sizeKey of ['inventory','target','daily']){
   const rows=data[sizeKey];
   if(!isObject(rows))continue;
   for(const key of Object.keys(rows)){
    if(!SIZES.has(key))issues.push(issue(sizeKey,'UNKNOWN_SIZE_FIELD'));
   }
  }
  if(isObject(data.babyProfile)){
   for(const key of Object.keys(data.babyProfile)){
    if(!PROFILE.has(key))issues.push(issue('babyProfile','UNKNOWN_PROFILE_FIELD'));
   }
  }
  if(isObject(data.replenishPolicy)){
   for(const key of Object.keys(data.replenishPolicy)){
    if(!POLICY.has(key))issues.push(issue('replenishPolicy','UNKNOWN_POLICY_FIELD'));
   }
  }
  // v1.1.2 produces referenceKey(brand,series,size) with five supported
  // reference sizes (XXL has no reference price in the original catalog).
  // Keep every original key untouched; reject ambiguous/unmapped keys rather
  // than silently dropping a custom comparison threshold.
  if(isObject(data.referenceOverrides)){
   for(const key of Object.keys(data.referenceOverrides)){
    const parts=key.split('|');
    if(parts.length!==3||!parts[0].trim()||!parts[1].trim()
       ||!new Set(['NB','S','M','L','XL']).has(parts[2]))
     issues.push(issue('referenceOverrides','UNMAPPED_REFERENCE_KEY'));
   }
  }
  if(own(data,'preset')&&!['balanced','cautious','relaxed','custom'].includes(data.preset))
   issues.push(issue('preset','UNKNOWN_PRESET'));
  if(own(data,'sizeMode')&&!['auto','manual'].includes(data.sizeMode))
   issues.push(issue('sizeMode','INVALID_SIZE_MODE'));
  if(own(data,'autoSize')&&!SIZES.has(data.autoSize))
   issues.push(issue('autoSize','INVALID_AUTO_SIZE'));
  if(typeof data.goalPrice!=='number'||!Number.isFinite(data.goalPrice)||data.goalPrice<=0)
   issues.push(issue('goalPrice','INVALID_GOAL_PRICE'));
  if(typeof data.plannedBudget!=='number'||!Number.isFinite(data.plannedBudget)||data.plannedBudget<0)
   issues.push(issue('plannedBudget','INVALID_PLANNED_BUDGET'));
  return issues;
 }
 function onlyPresetDefault(raw,normalized,contract){
  if(own(raw,'preset')||normalized.preset!=='balanced')return false;
  const rest={...normalized};
  delete rest.preset;
  return contract.stableStringify(raw)===contract.stableStringify(rest);
 }
 async function review(rawExport,{
  contract,manifest,purchaseAudit,projection,growth,cryptoProvider
 }={}){
  const checked=validateEnvelope(rawExport);
  if(checked.problem)return status('SOURCE_REJECTED',{code:checked.problem});
  if(!contract||typeof contract.stableStringify!=='function'
     ||!manifest||typeof manifest.audit!=='function'
     ||!purchaseAudit||typeof purchaseAudit.audit!=='function'
     ||!projection||typeof projection.simulateImporter!=='function'
     ||typeof projection.compare!=='function'
     ||!growth||typeof growth.extras!=='function')
   return status('DEPENDENCIES_UNAVAILABLE');
  const raw=checked.envelope.data,errors=additionalStructureIssues(raw);
  let manifestResult;
  try{
   manifestResult=await manifest.audit(raw,contract,purchaseAudit,cryptoProvider);
  }catch(_){
   return status('SOURCE_STRUCTURE_REJECTED',{
    reasons:countCodes([...errors,issue('source','MIGRATION_CONTRACT_REJECTED')])
   });
  }
  for(const item of manifestResult.issues||[]){
   errors.push(issue(category(item.path),'LEGACY_RECORD_INVALID'));
  }
  for(const item of manifestResult.unknownFields||[]){
   errors.push(issue(category(item.path),'UNKNOWN_NESTED_FIELD'));
  }
  if(!manifestResult.readOnlyPreflightPass&&errors.length===0)
   errors.push(issue('source','MANIFEST_REVIEW_REQUIRED'));
  if(errors.length){
   return status('SCHEMA_OR_RECORD_REVIEW_REQUIRED',{
    reasons:countCodes(errors),
    inspectedCounts:Object.freeze({
     transactions:manifestResult.summary?.transactionCount??0,
     quotes:manifestResult.summary?.quoteCount??0,
     weightRecords:manifestResult.summary?.weightRecordCount??0,
     referenceOverrides:manifestResult.summary?.referenceOverrideCount??0
    })
   });
  }
  let projected,diff;
  try{
   projected=projection.simulateImporter(checked.envelope,growth);
   diff=projection.compare(raw,projected);
  }catch(_){return status('PROJECTION_UNVERIFIED');}
  if(!diff||!Number.isSafeInteger(diff.differenceCount)||diff.differenceCount<0)
   return status('PROJECTION_UNVERIFIED');
  const common=Object.freeze({
   inspectedCounts:Object.freeze({
    transactions:manifestResult.summary.transactionCount,
    quotes:manifestResult.summary.quoteCount,
    weightRecords:manifestResult.summary.weightRecordCount,
    referenceOverrides:manifestResult.summary.referenceOverrideCount
   }),
   expectedBackupBeforeMigration:true,
   inventoryBaselineSource:'LEGACY_EXPLICIT_STOCKTAKE',
   historicalPurchasesMustNotReplay:true
  });
  if(diff.differenceCount===0){
   return status('MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED',{
    ...common,differenceCount:0,reasons:Object.freeze([])
   });
  }
  if(onlyPresetDefault(raw,projected,contract)&&diff.differenceCount===1){
   return status('DEFAULT_PRESET_REVIEW_REQUIRED',{
    ...common,differenceCount:1,
    reasons:countCodes([issue('preset','MISSING_UI_PRESET_DEFAULT')])
   });
  }
  const reasons=(diff.sectionChanges||[]).map(item=>
   issue(KNOWN.has(item.section)?item.section:'unknown_extension','SILENT_NORMALIZATION_CHANGE'));
  return status('SILENT_DATA_CHANGE_REVIEW_REQUIRED',{
   ...common,differenceCount:diff.differenceCount,
   reasons:countCodes(reasons)
  });
 }
 const api=Object.freeze({review,MAX_BYTES});
 if(root)root.XBStrictMigrationGate=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
