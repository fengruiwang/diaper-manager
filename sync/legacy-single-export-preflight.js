/* A thin coordinator ONLY for the offline single-export UI.
 * Reuses the audited legacy vault, strict gate and SQL-022 gap checker.
 * Does not introduce a second business validator or any write capability.
 */
(function(root){
 'use strict';
 const GOOD='MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED';
 const SECTIONS=new Set([
  'source','envelope','inventory','transactions','quotes','weightRecords',
  'referenceOverrides','babyProfile','babyWeight','birthDate','dueDate',
  'replenishPolicy','preset','goalPrice','plannedBudget','target','daily',
  'currentSize','autoSize','sizeMode','unknown_extension'
 ]);
 const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const safeReason=x=>Object.freeze({
  section:SECTIONS.has(x?.section)?x.section:'unknown_extension',
  code:typeof x?.code==='string'&&/^[A-Z][A-Z0-9_]{1,90}$/.test(x.code)
   ?x.code:'UNCLASSIFIED_LOCAL_ISSUE',
  count:Number.isSafeInteger(x?.count)&&x.count>0?x.count:1
 });
 const sanitize=rows=>Object.freeze((Array.isArray(rows)?rows:[]).slice(0,60).map(safeReason));
 const blocked=code=>Object.freeze({status:code,canUpload:false,canCommit:false,
  serverVerified:false,backupIntegrity:'NOT_VERIFIED',strictStatus:'NOT_RUN',
  sql022Status:'NOT_RUN',issues:Object.freeze([]),counts:null});
 function create({vault,strictGate,contract,manifest,purchaseAudit,projection,growth,stage022,
  cryptoProvider}={}){
  if(!vault?.createFromExport||!vault?.verify||!strictGate?.review
    ||!contract?.inspect||!manifest?.audit||!purchaseAudit?.audit
    ||!projection?.simulateImporter||!growth?.extras||!stage022?.review
    ||!cryptoProvider?.subtle?.digest)
   throw Error('single_preflight:dependencies_required');
  async function run(raw,{createdAt}={}){
   let archive,back;
   try{
    archive=await vault.createFromExport(raw,{createdAt,cryptoProvider});
    back=await vault.verify(archive,{cryptoProvider,contract,manifest,purchaseAudit});
    if(back.integrity!=='PASS')return blocked('BACKUP_INTEGRITY_NOT_VERIFIED');
   }catch(_){return blocked('BACKUP_FORMAT_OR_SHA_FAILED');}
   let strict,sql;
   try{
    strict=await strictGate.review(raw,{contract,manifest,purchaseAudit,
     projection,growth,cryptoProvider});
   }catch(_){strict={status:'STRICT_REVIEW_UNVERIFIED'};}
   try{sql=stage022.review(raw);}catch(_){sql={status:'SQL022_COMPATIBILITY_UNVERIFIED',issues:[]};}
   const clean=strict.status===GOOD&&sql.status==='SQL022_LOCAL_SHAPE_PASS';
   const state=JSON.parse(raw).data;
   const tx=Array.isArray(state.transactions)?state.transactions:[];
   const cnt={
    purchases:tx.filter(x=>x?.type==='buy').length,
    consumption:tx.filter(x=>x?.type==='use').length,
    transactions:tx.length,
    quotes:Array.isArray(state.quotes)?state.quotes.length:0,
    growth:Array.isArray(state.weightRecords)?state.weightRecords.length:0,
    references:isObject(state.referenceOverrides)?Object.keys(state.referenceOverrides).length:0,
    stockSizes:isObject(state.inventory)?['NB','S','M','L','XL','XXL'].filter(k=>has(state.inventory,k)).length:0,
    stockTotal:isObject(state.inventory)?['NB','S','M','L','XL','XXL'].reduce((a,k)=>
      a+(Number.isSafeInteger(state.inventory[k])&&state.inventory[k]>=0?state.inventory[k]:0),0):0
   };
   const notices=sanitize([
    ...(Array.isArray(strict.reasons)?strict.reasons:[]),
    ...(Array.isArray(sql.issues)?sql.issues:[])
   ]);
   return Object.freeze({
    status:clean?'STRICT_LOCAL_PREFLIGHT_PASS_UPLOAD_DISABLED':'LOCAL_COMPATIBILITY_REVIEW_REQUIRED',
    backupIntegrity:'PASS',strictStatus:strict.status,sql022Status:sql.status,
    projectionDifferenceCount:Number.isSafeInteger(strict.differenceCount)?strict.differenceCount:null,
    issues:notices,counts:Object.freeze(cnt),
    canUpload:false,canCommit:false,serverVerified:false,
    getProtectedArchive:()=>archive
   });
  }
  async function verifyProtectedArchive(archive){
   let checked,raw;
   try{
    checked=await vault.verify(archive,{cryptoProvider,contract,manifest,purchaseAudit});
    raw=await vault.extractVerifiedOriginal(archive,{cryptoProvider});
   }catch(_){return blocked('PROTECTED_BACKUP_VERIFICATION_FAILED');}
   const again=await run(raw,{createdAt:new Date().toISOString()});
   return Object.freeze({
    status:again.status,backupIntegrity:checked.integrity,
    byteLength:checked.byteLength,
    strictStatus:again.strictStatus,sql022Status:again.sql022Status,
    issues:again.issues,counts:again.counts,
    canUpload:false,canCommit:false,serverVerified:false,
    getVerifiedOriginal:()=>raw
   });
  }
  function has(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
  return Object.freeze({run,verifyProtectedArchive});
 }
 const api=Object.freeze({create});
 if(root)root.XBLegacySingleExportPreflight=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
