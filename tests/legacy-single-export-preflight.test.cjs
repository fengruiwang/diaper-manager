const test=require('node:test'),assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const Vault=require('../sync/legacy-backup-vault.js');
const Strict=require('../sync/strict-migration-gate.js');
const Contract=require('../sync/migration-contract.js');
const Manifest=require('../sync/legacy-migration-manifest.js');
const Purchase=require('../sync/legacy-purchase-audit.js');
const Projection=require('../sync/legacy-restore-projection.js');
const Growth=require('../growth.js');
const Stage=require('../sync/legacy-stage-022-preflight.js');
const Coordinator=require('../sync/legacy-single-export-preflight.js');
const deps={vault:Vault,strictGate:Strict,contract:Contract,manifest:Manifest,
 purchaseAudit:Purchase,projection:Projection,growth:Growth,
 stage022:Stage,cryptoProvider:webcrypto};
const check=Coordinator.create(deps);
const fixture=()=>({
 dueDate:'2027-01-08',birthDate:'',currentSize:'NB',babyWeight:'',
 babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''},
 weightRecords:[],sizeMode:'manual',autoSize:'NB',
 replenishPolicy:{mode:'days',days:7},goalPrice:1.15,plannedBudget:250,
 target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
 daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
 inventory:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
 quotes:[],transactions:[{id:'synthetic-1',type:'buy',date:'2026-11-09',
 brand:'模拟品牌',series:'模拟系列',size:'S',pieces:5,price:5.35}],
 referenceOverrides:{'模拟品牌|模拟系列|NB':1.235},preset:'balanced'
});
const pack=(data=fixture())=>JSON.stringify({app:'xiaobao-diapers',
 version:1,exportedAt:'2026-11-12T10:00:00.000Z',data},null,2);
const review=raw=>check.run(raw,{createdAt:'2026-11-12T14:00:00.000Z'});
const safe=r=>{assert.equal(r.canUpload,false);assert.equal(r.canCommit,false);
 assert.equal(r.serverVerified,false);};
test('unborn default 小宝 profile: backup SHA, strict gate, SQL022 and lossless projection PASS',async()=>{
 const raw=pack(),result=await review(raw);
 assert.equal(result.backupIntegrity,'PASS');
 assert.equal(result.strictStatus,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');
 assert.equal(result.sql022Status,'SQL022_LOCAL_SHAPE_PASS');
 assert.equal(result.status,'STRICT_LOCAL_PREFLIGHT_PASS_UPLOAD_DISABLED');
 assert.equal(result.projectionDifferenceCount,0);
 assert.equal(result.getProtectedArchive().originalExportText,raw);
 assert.equal(result.counts.purchases,1);safe(result);
});
test('re-read real downloaded-style protected bundle verifies the same original bytes',async()=>{
 const raw=pack(),r=await review(raw);
 const protectedCopy=JSON.parse(JSON.stringify(r.getProtectedArchive()));
 const checked=await check.verifyProtectedArchive(protectedCopy);
 assert.equal(checked.backupIntegrity,'PASS');
 assert.equal(checked.status,r.status);
 assert.equal(checked.getVerifiedOriginal(),raw);safe(checked);
});
test('client strict PASS can still be rejected by SQL022 whitespace-only baby name',async()=>{
 const d=fixture();d.babyProfile.name='   ';const raw=pack(d);
 const strict=await Strict.review(raw,{contract:Contract,manifest:Manifest,
  purchaseAudit:Purchase,projection:Projection,growth:Growth,cryptoProvider:webcrypto});
 assert.equal(strict.status,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');
 const r=await review(raw);
 assert.equal(r.strictStatus,strict.status);
 assert.equal(r.sql022Status,'SQL022_COMPATIBILITY_BLOCKED');
 assert.ok(r.issues.some(x=>x.code==='SQL022_PROFILE_NAME_INVALID'));safe(r);
});
test('SQL022 blocks missing profile fields, empty name and non-string birth fields',async()=>{
 for(const mutate of [
  d=>delete d.babyProfile.birthTime,
  d=>d.babyProfile.name='',
  d=>d.babyProfile.birthWeight=3.25,
  d=>d.babyProfile.birthLength=50,
  d=>d.babyProfile.sex=1
 ]){
  const d=fixture();mutate(d);const r=await review(pack(d));
  assert.equal(r.sql022Status,'SQL022_COMPATIBILITY_BLOCKED');safe(r);
 }
});
test('SQL022 rejects numeric legacy babyWeight and string policy days',async()=>{
 for(const mutate of [
  d=>d.babyWeight=3.2,
  d=>d.replenishPolicy.days='7'
 ]){
  const d=fixture();mutate(d);const r=await review(pack(d));
  assert.equal(r.sql022Status,'SQL022_COMPATIBILITY_BLOCKED');safe(r);
 }
});
test('SQL022 duplicate-key scan blocks malformed original text that JSON.parse accepts',async()=>{
 const raw=pack().replace('"name": "小宝"','"name": "小宝", "name": "小宝"');
 const strict=await Strict.review(raw,{contract:Contract,manifest:Manifest,
 purchaseAudit:Purchase,projection:Projection,growth:Growth,cryptoProvider:webcrypto});
 assert.equal(strict.status,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');
 const r=await review(raw);
 assert.ok(r.issues.some(x=>x.code==='SQL022_DUPLICATE_JSON_KEY'));
 assert.equal(r.status,'LOCAL_COMPATIBILITY_REVIEW_REQUIRED');safe(r);
});
test('strict client PASS but SQL 022 rejects an overlong quote series',async()=>{
 const d=fixture();d.quotes=[{id:'synthetic-quote',date:'2026-11-10',
  brand:'合成品牌',series:'Q'.repeat(121),size:'NB',
  per:2,packs:1,pieces:2,price:3.56,unit:1.78}];
 const raw=pack(d);
 const strict=await Strict.review(raw,{contract:Contract,manifest:Manifest,
  purchaseAudit:Purchase,projection:Projection,growth:Growth,cryptoProvider:webcrypto});
 assert.equal(strict.status,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');
 const r=await review(raw);
 assert.equal(r.sql022Status,'SQL022_COMPATIBILITY_BLOCKED');
 assert.ok(r.issues.some(x=>x.code==='SQL022_QUOTE_TEXT_LENGTH_INVALID'));
 safe(r);
});
test('original records, ordering and thousandths are byte-identical through the vault',async()=>{
 const d=fixture();d.transactions.push({id:'synthetic-2',type:'use',date:'2026-11-09',
 size:'S',pieces:1,price:0});
 const raw=' \n'+pack(d)+'\n';const r=await review(raw);
 const restored=await check.verifyProtectedArchive(JSON.parse(JSON.stringify(r.getProtectedArchive())));
 assert.equal(restored.getVerifiedOriginal(),raw);
 assert.deepEqual(JSON.parse(restored.getVerifiedOriginal()).data.transactions,d.transactions);
 assert.equal(d.referenceOverrides['模拟品牌|模拟系列|NB'],1.235);
});
test('unknown fields are never silently dropped or exposed in report',async()=>{
 const d=fixture();d.babyProfile.unknown='PRIVATE_SECRET';
 const raw=pack(d);const r=await review(raw);
 assert.equal(r.sql022Status,'SQL022_COMPATIBILITY_BLOCKED');
 assert.equal(r.getProtectedArchive().originalExportText,raw);
 assert.ok(!JSON.stringify({status:r.status,issues:r.issues}).includes('PRIVATE_SECRET'));safe(r);
});
test('tampered protected copy is blocked and never restores unverified bytes',async()=>{
 const a=(await review(pack())).getProtectedArchive();
 const altered={...a,originalExportText:a.originalExportText.replace('"pieces": 5','"pieces": 9')};
 const r=await check.verifyProtectedArchive(altered);
 assert.equal(r.status,'PROTECTED_BACKUP_VERIFICATION_FAILED');
 assert.equal(r.getVerifiedOriginal,undefined);safe(r);
});
test('purchase precision rejects third decimals while 0.001 RMB reference is safe',async()=>{
 const a=await review(pack());assert.equal(a.status,'STRICT_LOCAL_PREFLIGHT_PASS_UPLOAD_DISABLED');
 const d=fixture();d.transactions[0].price=5.355;
 const b=await review(pack(d));
 assert.notEqual(b.strictStatus,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');safe(b);
});
