/* XiaoBao v1.2.0 — local-only byte-preserving backup vault for v1.1.x JSON exports.
 * Pure browser/Node library: NO filesystem, network, database or storage writes.
 * The digest detects accidental changes, NOT a cryptographic signature of origin.
 * This is a BACKUP/RESTORE-DRY-RUN mechanism, never migration authorization.
 */
(function(root){
 'use strict';
 const MAX_BYTES=10*1024*1024;
 const ARCHIVE_KIND='xiaobao-legacy-protected-backup';
 const VERSION=1;
 function fail(code){throw new Error('legacy_vault:'+code);}
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
 const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
 function bytes(raw){
  if(typeof raw!=='string'||raw.length===0)fail('source_text_required');
  const buffer=new TextEncoder().encode(raw);
  if(buffer.length>MAX_BYTES)fail('file_too_large');
  return buffer;
 }
 function provider(cryptoProvider){
  const p=cryptoProvider||(typeof globalThis!=='undefined'?globalThis.crypto:null);
  if(!p||!p.subtle||typeof p.subtle.digest!=='function')fail('webcrypto_required');
  return p;
 }
 async function digest(data,cryptoProvider){
  const hashed=await provider(cryptoProvider).subtle.digest('SHA-256',bytes(data));
  return Array.from(new Uint8Array(hashed),x=>x.toString(16).padStart(2,'0')).join('');
 }
 function parseExport(raw){
  let value;
  try{value=JSON.parse(raw);}catch(_){fail('export_invalid_json');}
  if(!object(value)||value.app!=='xiaobao-diapers'||value.version!==1
     ||typeof value.exportedAt!=='string'
     ||!Number.isFinite(Date.parse(value.exportedAt))
     ||!object(value.data)||!object(value.data.inventory)||!object(value.data.target))
   fail('not_a_supported_v1_export');
  return value;
 }
 function exactTime(timestamp){
  if(typeof timestamp!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp)
     ||Number.isNaN(Date.parse(timestamp))
     ||new Date(timestamp).toISOString()!==timestamp)
   fail('invalid_created_at');
  return timestamp;
 }
 // Archive includes the original exported text verbatim, including unknown
 // fields, array ordering, whitespace and numbers such as 1.235.
 async function createFromExport(rawExport,{createdAt,cryptoProvider}={}){
  const sourceBytes=bytes(rawExport);
  parseExport(rawExport);
  const created=exactTime(createdAt);
  return Object.freeze({
   kind:ARCHIVE_KIND,
   version:VERSION,
   createdAt:created,
   sourceFormat:'v1-json-export',
   sourceByteLength:sourceBytes.length,
   sourceSha256:await digest(rawExport,cryptoProvider),
   originalExportText:rawExport,
   verifiedByServer:false,
   migrationAuthorized:false
  });
 }
 function shape(archive){
  if(!object(archive)||archive.kind!==ARCHIVE_KIND||archive.version!==VERSION
     ||archive.sourceFormat!=='v1-json-export'
     ||archive.verifiedByServer!==false||archive.migrationAuthorized!==false
     ||typeof archive.originalExportText!=='string'
     ||!Number.isSafeInteger(archive.sourceByteLength)||archive.sourceByteLength<1
     ||archive.sourceByteLength>MAX_BYTES||!hex(archive.sourceSha256))
   fail('archive_format_invalid');
  exactTime(archive.createdAt);
 }
 async function verify(archive,{cryptoProvider,contract=null,manifest=null,purchaseAudit=null}={}){
  shape(archive);
  if(bytes(archive.originalExportText).length!==archive.sourceByteLength)
   fail('archive_length_mismatch');
  if(await digest(archive.originalExportText,cryptoProvider)!==archive.sourceSha256)
   fail('archive_checksum_mismatch');
  const exported=parseExport(archive.originalExportText);
  let reviewCode='LEGACY_MAPPING_NOT_CHECKED',summary=null;
  if(contract!==null){
   if(!contract||typeof contract.inspect!=='function')fail('contract_required');
   try{
    const inspected=await contract.inspect(exported.data,cryptoProvider);
    summary={
     inventoryTotal:inspected.summary.totalInventory,
     transactionCount:inspected.summary.transactionCount,
     quoteCount:inspected.summary.quoteCount,
     weightRecordCount:inspected.summary.weightRecordCount,
     referenceOverrideCount:inspected.summary.referenceOverrideCount,
     stateSha256:inspected.sha256
    };
    reviewCode='BACKUP_VERIFIED_MIGRATION_NOT_AUTHORIZED';
   }catch(_){reviewCode='BACKUP_VERIFIED_LEGACY_REVIEW_REQUIRED';}
  }
  if(manifest!==null&&purchaseAudit!==null&&contract!==null){
   try{
    const audited=await manifest.audit(exported.data,contract,purchaseAudit,cryptoProvider);
    reviewCode=audited.readOnlyPreflightPass?
     'LEGACY_MAPPING_REVIEWED_UPLOAD_STILL_DISABLED':
     'BACKUP_VERIFIED_LEGACY_REVIEW_REQUIRED';
    if(summary)summary={...summary,blockingIssues:audited.blockers.length};
   }catch(_){reviewCode='BACKUP_VERIFIED_LEGACY_REVIEW_REQUIRED';}
  }
  return Object.freeze({
   integrity:'PASS',
   recoveryPreview:'EXACT_ORIGINAL_EXPORT_AVAILABLE',
   reviewCode,
   byteLength:archive.sourceByteLength,
   sha256:archive.sourceSha256,
   summary:summary?Object.freeze(summary):null,
   canUpload:false,
   canReplaceLocalState:false,
   serverReceiptPresent:false
  });
 }
 // Explicit manual recovery of the bytes of an already-exported v1 file.
 // Caller decides whether to download. No automatic import/overwrite.
 async function extractVerifiedOriginal(archive,{cryptoProvider}={}){
  await verify(archive,{cryptoProvider});
  return archive.originalExportText;
 }
 const api=Object.freeze({createFromExport,verify,extractVerifiedOriginal,
  ARCHIVE_KIND,VERSION,MAX_BYTES});
 if(root)root.XBLegacyBackupVault=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
