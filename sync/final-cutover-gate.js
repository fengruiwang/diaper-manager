/* V1.2.0 M2 final full-snapshot cutover gate. Offline read-only code:
 * NEVER reads localStorage, uploads/merges data, or creates server receipts.
 * Final migration must use a new export AFTER all old-device writes stop.
 * Different device data are not assumed identical and are never auto-merged.
 */
(function(root){
 'use strict';
 const SECTIONS=['inventory','transactions','quotes','weightRecords','referenceOverrides',
  'babyProfile','babyWeight','dueDate','birthDate','target','daily','preset',
  'replenishPolicy','currentSize','sizeMode','autoSize','goalPrice','plannedBudget'];
 const MAX_SOURCES=12,MAX_BYTES=10485760;
 function fail(code){throw Error('cutover:'+code);}
 function stable(value){
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value!==null&&typeof value==='object'){
   return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  }
  const s=JSON.stringify(value);
  if(s===undefined)fail('unsupported_json_value');
  return s;
 }
 function safeExport(source){
  if(typeof source!=='string'||!source.length
    ||new TextEncoder().encode(source).length>MAX_BYTES)fail('invalid_source_size');
  let envelope;
  try{envelope=JSON.parse(source);}catch(_){fail('invalid_json');}
  if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)
    ||envelope.app!=='xiaobao-diapers'||envelope.version!==1
    ||!envelope.data||typeof envelope.data!=='object'||Array.isArray(envelope.data)
    ||typeof envelope.exportedAt!=='string'||!Number.isFinite(Date.parse(envelope.exportedAt)))
   fail('invalid_export_envelope');
  return envelope;
 }
 function diff(a,b){
  const keys=new Set([...Object.keys(a),...Object.keys(b)]);
  return [...keys].sort().filter(key=>
   !Object.hasOwn(a,key)||!Object.hasOwn(b,key)||stable(a[key])!==stable(b[key]));
 }
 async function prepare({sources,selectedSlot,allDevicesEnumerated=false,
   oldWritesStopped=false,freezeAt=null,strictReview,digest}={}){
  if(!Array.isArray(sources)||!sources.length||sources.length>MAX_SOURCES)
   fail('source_count_invalid');
  if(!Number.isInteger(selectedSlot)||selectedSlot<0||selectedSlot>=sources.length)
   fail('invalid_selected_slot');
  if(typeof strictReview!=='function'||typeof digest!=='function')
   fail('review_dependencies_required');
  const reviewed=[];
  for(const item of sources){
   if(!item||typeof item.raw!=='string')fail('invalid_source');
   const envelope=safeExport(item.raw);
   const review=await strictReview(item.raw);
   const sourceHash=await digest(item.raw);
   const stateHash=await digest(stable(envelope.data));
   if(typeof sourceHash!=='string'||!/^[0-9a-f]{64}$/.test(sourceHash)
     ||typeof stateHash!=='string'||!/^[0-9a-f]{64}$/.test(stateHash))
    fail('invalid_digest');
   reviewed.push({envelope,review,sourceHash,stateHash});
  }
  const winner=reviewed[selectedSlot],issues=[];
  if(!allDevicesEnumerated)issues.push('DEVICE_INVENTORY_UNCONFIRMED');
  if(!oldWritesStopped)issues.push('OLD_VERSION_WRITES_NOT_STOPPED');
  // An export predating the declared write-stop point is necessarily stale.
  const frozenAt=typeof freezeAt==='string'&&Number.isFinite(Date.parse(freezeAt))
    ?Date.parse(freezeAt):null;
  if(frozenAt===null)issues.push('FREEZE_TIMESTAMP_MISSING');
  else if(reviewed.some(x=>Date.parse(x.envelope.exportedAt)<frozenAt))
   issues.push('SOURCE_EXPORTED_BEFORE_FREEZE');
  if(!reviewed.every(x=>x.review?.status==='MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED'))
   issues.push('STRICT_PREFLIGHT_NOT_PASSED');
  const differences=[];
  for(let i=0;i<reviewed.length;i++){
   if(i===selectedSlot)continue;
   if(reviewed[i].stateHash!==winner.stateHash){
    // Only field names and source-slot indices escape the local comparison.
    differences.push(Object.freeze({
     slot:i,sections:Object.freeze(diff(winner.envelope.data,reviewed[i].envelope.data))
    }));
   }
  }
  if(differences.length)issues.push('MULTIPLE_DEVICE_STATES_DIFFER');
  return Object.freeze({
   status:issues.length?'BLOCKED':'CUTOVER_LOCAL_REVIEW_READY',
   // This is planning proof only; never a server permission or migration token.
   canUpload:false,canCommit:false,serverReceiptPresent:false,
   selectedSlot,sourceSha256:winner.sourceHash,
   stateSha256:winner.stateHash,sourceCount:reviewed.length,
   differences:Object.freeze(differences),
   issues:Object.freeze(issues),
   inventoryBaselineSource:'LEGACY_EXPLICIT_STOCKTAKE'
  });
 }
 async function verifyBeforeUpload(plan,raw,strictReview,digest){
  if(!plan||plan.status!=='CUTOVER_LOCAL_REVIEW_READY'
    ||plan.differences?.length||plan.issues?.length
    ||typeof strictReview!=='function'||typeof digest!=='function')
   return Object.freeze({status:'CUTOVER_BLOCKED',canUpload:false});
  const sourceHash=await digest(raw);
  if(sourceHash!==plan.sourceSha256)
   return Object.freeze({status:'FINAL_EXPORT_CHANGED',canUpload:false});
  const recheck=await strictReview(raw);
  if(!(recheck?.status==='MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED'))
   return Object.freeze({status:'STRICT_PREFLIGHT_NOT_PASSED',canUpload:false});
  // The authorized uploader must do a fresh client+server check; this module
  // intentionally cannot grant write permission, even on success.
  return Object.freeze({status:'SOURCE_UNCHANGED_LOCAL_CHECK',canUpload:false,
   requiresSeparateCloudApproval:true});
 }
 const api=Object.freeze({prepare,verifyBeforeUpload,stable,diff,SECTIONS});
 if(root)root.XBFinalCutoverGate=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
