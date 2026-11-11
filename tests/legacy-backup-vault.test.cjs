const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const Vault=require('../sync/legacy-backup-vault.js');
const Contract=require('../sync/migration-contract.js');
const Manifest=require('../sync/legacy-migration-manifest.js');
const PurchaseAudit=require('../sync/legacy-purchase-audit.js');
const source=fs.readFileSync(path.join(__dirname,'../sync/legacy-backup-vault.js'),'utf8');
const stamp='2026-11-11T09:00:00.000Z';
const state=()=>({
 dueDate:'2027-01-08',birthDate:'',currentSize:'NB',babyWeight:'',
 babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''},
 weightRecords:[],
 sizeMode:'manual',autoSize:'NB',replenishPolicy:{mode:'days',days:7},
 goalPrice:1.5,plannedBudget:250,
 target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
 daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
 inventory:{NB:13,S:42,M:0,L:0,XL:0,XXL:0},
 quotes:[],
 transactions:[{id:'buy-1',type:'buy',date:'2026-11-10',
  brand:'帮宝适',series:'一级帮',size:'S',pieces:60,price:69.99}],
 referenceOverrides:{'帮宝适|一级帮|S':1.235},preset:'balanced'
});
const exported=(data=state())=>JSON.stringify({
 app:'xiaobao-diapers',version:1,exportedAt:'2026-11-11T08:00:00.000Z',data
},null,2);
const pack=raw=>Vault.createFromExport(raw,{createdAt:stamp,cryptoProvider:webcrypto});
const check=archive=>Vault.verify(archive,{cryptoProvider:webcrypto,
 contract:Contract,manifest:Manifest,purchaseAudit:PurchaseAudit});
test('existing v1.1.2 JSON export is sealed then recovered byte for byte without normalization',async()=>{
 const raw=exported(),before=raw;
 const archive=await pack(raw);
 const json=JSON.stringify(archive);
 const parsed=JSON.parse(json);
 const result=await check(parsed);
 assert.equal(result.integrity,'PASS');
 assert.equal(result.canUpload,false);
 assert.equal(result.canReplaceLocalState,false);
 assert.equal(result.serverReceiptPresent,false);
 assert.equal(result.summary.inventoryTotal,55);
 assert.equal(result.summary.transactionCount,1);
 assert.equal(result.summary.referenceOverrideCount,1);
 assert.equal(result.reviewCode,'LEGACY_MAPPING_REVIEWED_UPLOAD_STILL_DISABLED');
 assert.equal(await Vault.extractVerifiedOriginal(parsed,{cryptoProvider:webcrypto}),before);
 assert.equal(parsed.originalExportText,before);
 assert.match(result.sha256,/^[0-9a-f]{64}$/);
});
test('unknown future fields are preserved exactly in backup and block migration review, not recovery',async()=>{
 const data=state();data.futureFeeding={ounces:90};data.transactions[0].customVoucher='X';
 const original=exported(data);
 const bundle=await pack(original);
 const reviewed=await check(bundle);
 assert.equal(reviewed.integrity,'PASS');
 assert.equal(reviewed.reviewCode,'BACKUP_VERIFIED_LEGACY_REVIEW_REQUIRED');
 assert.ok(reviewed.summary.blockingIssues>=2);
 assert.equal(await Vault.extractVerifiedOriginal(bundle,{cryptoProvider:webcrypto}),original);
});
test('single character tampering is rejected before recovery even if JSON parse succeeds',async()=>{
 const archive=await pack(exported());
 const altered={...archive,originalExportText:archive.originalExportText.replace('"pieces": 60','"pieces": 66')};
 await assert.rejects(()=>check(altered),/legacy_vault:archive_checksum_mismatch/);
 await assert.rejects(
  ()=>Vault.extractVerifiedOriginal(altered,{cryptoProvider:webcrypto}),
  /archive_checksum_mismatch/);
});
test('forged byte length, source format, archive flags and checksum are blocked',async()=>{
 const archive=await pack(exported());
 for(const bad of [
  {...archive,sourceByteLength:archive.sourceByteLength+1},
  {...archive,sourceSha256:'a'.repeat(64)},
  {...archive,version:2},{...archive,kind:'different-kind'},
  {...archive,migrationAuthorized:true},{...archive,verifiedByServer:true},
  {...archive,sourceFormat:'cloudbase'},{...archive,createdAt:'not-a-time'}
 ]){
  await assert.rejects(()=>check(bad),/legacy_vault:/);
 }
});
test('wrong application/version, missing nested data, invalid JSON and oversize are refused',async()=>{
 for(const raw of [
  '{}','not JSON',
  JSON.stringify({app:'unknown',version:1,exportedAt:stamp,data:state()}),
  JSON.stringify({app:'xiaobao-diapers',version:2,exportedAt:stamp,data:state()}),
  JSON.stringify({app:'xiaobao-diapers',version:1,exportedAt:stamp,data:[]}),
  JSON.stringify({app:'xiaobao-diapers',version:1,exportedAt:stamp,data:{inventory:{}}})
 ]){
  await assert.rejects(()=>pack(raw),/legacy_vault:/);
 }
 await assert.rejects(()=>pack(exported()+' '.repeat(Vault.MAX_BYTES)),/file_too_large/);
});
test('Unicode, whitespace and triple-decimal reference prices remain unmodified',async()=>{
 const data=state();
 data.transactions[0].brand='好奇';
 data.referenceOverrides['好奇|小森林|NB']=1.235;
 const raw=' \n'+exported(data)+'\n ';
 const archive=await pack(raw);
 const restored=await Vault.extractVerifiedOriginal(archive,{cryptoProvider:webcrypto});
 assert.equal(restored,raw);
 assert.deepEqual(JSON.parse(restored).data,data);
});
test('metadata pass is explicitly not server attestation, migration permission, or automatic restore',async()=>{
 const archive=await pack(exported());
 const r=await Vault.verify(archive,{cryptoProvider:webcrypto});
 assert.equal(r.reviewCode,'LEGACY_MAPPING_NOT_CHECKED');
 assert.equal(r.canReplaceLocalState,false);
 assert.equal(r.canUpload,false);
 assert.equal(r.summary,null);
});
test('vault does not call localStorage, IDB, SDK, fetch, DML, or import buttons',()=>{
 assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|cloudbase)\s*(?:\(|\.|\[)/i);
 assert.doesNotMatch(source,/\.(?:insert|update|delete|upsert|setItem|clear|removeItem)\s*\(/);
 assert.match(source,/cryptographic signature of origin/);
});
