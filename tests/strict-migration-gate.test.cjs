const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const Gate=require('../sync/strict-migration-gate.js');
const Contract=require('../sync/migration-contract.js');
const Manifest=require('../sync/legacy-migration-manifest.js');
const PurchaseAudit=require('../sync/legacy-purchase-audit.js');
const Projection=require('../sync/legacy-restore-projection.js');
const Growth=require('../growth.js');
const source=fs.readFileSync(path.join(__dirname,'../sync/strict-migration-gate.js'),'utf8');
const fixture=()=>({
 dueDate:'2027-01-08',birthDate:'',currentSize:'NB',babyWeight:'',
 babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''},
 weightRecords:[{id:'w1',date:'2027-01-08',time:'10:30',weight:3.267,note:'合成记录'}],
 sizeMode:'manual',autoSize:'NB',replenishPolicy:{mode:'days',days:7},
 goalPrice:1.5,plannedBudget:250,
 target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
 daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
 inventory:{NB:21,S:42,M:0,L:0,XL:0,XXL:0},
 quotes:[{id:'q1',date:'2026-11-10',brand:'好奇',series:'小森林',size:'S',
  per:20,packs:3,pieces:60,price:29.99,unit:29.99/60}],
 transactions:[
  {id:'buy1',type:'buy',date:'2026-11-10',brand:'好奇',series:'小森林',
   size:'S',pieces:60,price:29.99},
  {id:'use1',type:'use',date:'2026-11-11',size:'NB',pieces:5,price:0}
 ],
 referenceOverrides:{'好奇|小森林|S':1.235},
 preset:'balanced'
});
const wrap=data=>({
 app:'xiaobao-diapers',version:1,exportedAt:'2026-11-11T08:00:00.000Z',data
});
const review=(payload)=>Gate.review(typeof payload==='string'?payload:JSON.stringify(payload),{
 contract:Contract,manifest:Manifest,purchaseAudit:PurchaseAudit,
 projection:Projection,growth:Growth,cryptoProvider:webcrypto
});
const reasons=result=>result.reasons||[];
const has=(result,section,code)=>reasons(result).some(x=>x.section===section&&x.code===code);
const denied=result=>{
 assert.equal(result.canUpload,false);
 assert.equal(result.canReplaceLocalState,false);
 assert.equal(result.serverReceiptPresent,false);
 assert.equal(result.localStateUnchanged,true);
 assert.equal(result.requiresExplicitApproval,true);
};
test('complete canonical v1 legacy export passes mapping-only gate; upload always disabled',async()=>{
 const state=fixture(),before=JSON.stringify(state);
 const result=await review(wrap(state));
 assert.equal(result.status,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');
 assert.equal(result.differenceCount,0);
 assert.equal(result.inspectedCounts.transactions,2);
 assert.equal(result.inspectedCounts.quotes,1);
 assert.equal(result.inspectedCounts.weightRecords,1);
 assert.equal(result.inspectedCounts.referenceOverrides,1);
 assert.equal(result.inventoryBaselineSource,'LEGACY_EXPLICIT_STOCKTAKE');
 assert.equal(result.historicalPurchasesMustNotReplay,true);
 assert.equal(JSON.stringify(state),before);
 denied(result);
});
test('unsupported app or version is rejected before migration manifest runs',async()=>{
 for(const mod of [
  {app:'other-app'}, {version:2},{version:0},{version:null},
  {app:'xiaobao-diapers',version:'1'}
 ]){
  const r=await review({...wrap(fixture()),...mod});
  assert.equal(r.status,'SOURCE_REJECTED');
  assert.equal(r.code,'UNSUPPORTED_APP_OR_VERSION');
  denied(r);
 }
});
test('malformed JSON and oversized original export never enter migration',async()=>{
 for(const bad of ['{not-json','[]','',JSON.stringify({app:'xiaobao-diapers',version:1,data:null})]){
  const r=await review(bad);
  assert.equal(r.status,'SOURCE_REJECTED');
  denied(r);
 }
 const oversize=' '.repeat(Gate.MAX_BYTES+1);
 const r=await review(oversize);
 assert.equal(r.code,'SOURCE_FILE_TOO_LARGE');
});
test('timestamp must be exact valid UTC ISO and envelope additions are not silently discarded',async()=>{
 for(const exportedAt of ['yesterday','2026-02-31T08:00:00.000Z','2026-11-11']){
  const r=await review({...wrap(fixture()),exportedAt});
  assert.equal(r.code,'INVALID_EXPORT_TIMESTAMP');
 }
 const extra=await review({...wrap(fixture()),private_extension:'HIDDEN'});
 assert.equal(extra.code,'UNKNOWN_EXPORT_ENVELOPE_FIELD');
 assert.ok(!JSON.stringify(extra).includes('private_extension'));
});
test('missing preset is classified as UI-default review, not lossless or upload ready',async()=>{
 const state=fixture();delete state.preset;
 const r=await review(wrap(state));
 assert.equal(r.status,'DEFAULT_PRESET_REVIEW_REQUIRED');
 assert.equal(r.differenceCount,1);
 assert.ok(has(r,'preset','MISSING_UI_PRESET_DEFAULT'));
 denied(r);
});
test('all required business fields must exist, even if old importer would silently default them',async()=>{
 for(const name of ['transactions','quotes','referenceOverrides','weightRecords',
  'inventory','target','daily','babyProfile','replenishPolicy','goalPrice']){
  const s=fixture();delete s[name];
  const r=await review(wrap(s));
  assert.notEqual(r.status,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED',name);
  assert.equal(r.canUpload,false);
 }
});
test('unknown root and nested extension fields block mapping and never leak field values',async()=>{
 const state=fixture();
 state.futureCustom={secret:'PRIVATE_CUSTOM'};
 state.babyProfile.futureData='SECRET_PROFILE';
 state.transactions[0].voucherCode='SECRET_COUPON';
 state.quotes[0].unknownExtension='SECRET_QUOTE';
 state.weightRecords[0].doctorNote='SECRET_GROWTH';
 const r=await review(wrap(state));
 assert.equal(r.status,'SCHEMA_OR_RECORD_REVIEW_REQUIRED');
 assert.ok(has(r,'unknown_extension','UNKNOWN_TOP_LEVEL_FIELD'));
 assert.ok(has(r,'babyProfile','UNKNOWN_PROFILE_FIELD'));
 assert.ok(has(r,'transactions','UNKNOWN_NESTED_FIELD'));
 assert.ok(has(r,'quotes','UNKNOWN_NESTED_FIELD'));
 assert.ok(has(r,'weightRecords','UNKNOWN_NESTED_FIELD'));
 for(const word of ['futureCustom','futureData','voucherCode','doctorNote','PRIVATE','SECRET']){
  assert.ok(!JSON.stringify(r).includes(word),'must not disclose '+word);
 }
});
test('unknown inventory / target / daily sizes and policy fields are explicit blockers',async()=>{
 const state=fixture();
 state.inventory.XXX=100;state.target.XXX=42;state.daily.XXX=3;
 state.replenishPolicy.future='HIDDEN';
 const r=await review(wrap(state));
 assert.equal(r.status,'SCHEMA_OR_RECORD_REVIEW_REQUIRED');
 for(const section of ['inventory','target','daily'])
  assert.ok(has(r,section,'UNKNOWN_SIZE_FIELD'));
 assert.ok(has(r,'replenishPolicy','UNKNOWN_POLICY_FIELD'));
 assert.ok(!JSON.stringify(r).includes('XXX'));
});
test('malformed or out-of-catalog reference override keys require review without leaking brand data',async()=>{
 for(const invalidKey of ['missing-delimiters','好奇|小森林|XXL','|私密系列|S','私密品牌||NB','a|b|S|extra']){
  const state=fixture();
  state.referenceOverrides={};
  state.referenceOverrides[invalidKey]=1.235;
  const r=await review(wrap(state));
  assert.equal(r.status,'SCHEMA_OR_RECORD_REVIEW_REQUIRED');
  assert.ok(has(r,'referenceOverrides','UNMAPPED_REFERENCE_KEY'));
  assert.ok(!JSON.stringify(r).includes('私密系列'));
  assert.ok(!JSON.stringify(r).includes('私密品牌'));
  denied(r);
 }
});
test('invalid purchase total third decimal blocks, but three-decimal UNIT reference remains valid',async()=>{
 const good=await review(wrap(fixture()));
 assert.equal(good.status,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');
 const s=fixture();s.transactions[0].price=29.995;
 const bad=await review(wrap(s));
 assert.equal(bad.status,'SCHEMA_OR_RECORD_REVIEW_REQUIRED');
 assert.ok(has(bad,'transactions','LEGACY_RECORD_INVALID'));
 denied(bad);
});
test('duplicate purchase IDs and invalid date must be reviewed, never replayed as inventory',async()=>{
 const s=fixture();s.transactions.push({...s.transactions[0]});
 s.quotes[0].date='2026-02-30';
 const r=await review(wrap(s));
 assert.notEqual(r.status,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');
 denied(r);
});
test('negative, fractional, oversized or missing inventory is rejected without silent clamping',async()=>{
 for(const n of [-1,1.5,100001,null]){
  const s=fixture();s.inventory.NB=n;
  const r=await review(wrap(s));
  assert.equal(r.status,'SOURCE_STRUCTURE_REJECTED');
  denied(r);
 }
});
test('invalid growth measurement or discarded nested data is a blocking review item',async()=>{
 for(const issue of [
  s=>s.weightRecords[0].weight=999,
  s=>s.weightRecords[0].time='26:00',
  s=>s.weightRecords[0].unexpected='PRIVATE'
 ]){
  const s=fixture();issue(s);
  const r=await review(wrap(s));
  assert.equal(r.status,'SCHEMA_OR_RECORD_REVIEW_REQUIRED');
  denied(r);
 }
});
test('unknown modes and invalid planned amounts block instead of defaulting to manual',async()=>{
 for(const change of [
  s=>s.sizeMode='unsupported',
  s=>s.autoSize='XXXL',
  s=>s.preset='custom-unknown',
  s=>s.goalPrice=-1,
  s=>s.plannedBudget='250'
 ]){
  const s=fixture();change(s);
  const r=await review(wrap(s));
  assert.equal(r.status,'SCHEMA_OR_RECORD_REVIEW_REQUIRED');
  denied(r);
 }
});
test('valid original amounts and price values stay source of truth, not reconstructed purchase stock',async()=>{
 const s=fixture();s.inventory.S=0;s.transactions[0].pieces=900;
 const r=await review(wrap(s));
 assert.equal(r.status,'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED');
 assert.equal(r.inventoryBaselineSource,'LEGACY_EXPLICIT_STOCKTAKE');
 assert.equal(r.historicalPurchasesMustNotReplay,true);
 denied(r);
});
test('projection drift cannot be dismissed as safe and leaves original data untouched',async()=>{
 const s=fixture(),before=JSON.stringify(s);
 const injected={
  simulateImporter:()=>({...s,inventory:{...s.inventory,S:999}}),
  compare:Projection.compare
 };
 const r=await Gate.review(JSON.stringify(wrap(s)),{
  contract:Contract,manifest:Manifest,purchaseAudit:PurchaseAudit,
  projection:injected,growth:Growth,cryptoProvider:webcrypto
 });
 assert.equal(r.status,'SILENT_DATA_CHANGE_REVIEW_REQUIRED');
 assert.ok(has(r,'inventory','SILENT_NORMALIZATION_CHANGE'));
 assert.equal(JSON.stringify(s),before);
 denied(r);
});
test('missing or malfunctioning required dependencies fail closed without raw error leaks',async()=>{
 const raw=JSON.stringify(wrap(fixture()));
 const absent=await Gate.review(raw);
 assert.equal(absent.status,'DEPENDENCIES_UNAVAILABLE');
 const broken=await Gate.review(raw,{
  contract:Contract,manifest:{audit:async()=>{throw Error('private-input-secret');}},
  purchaseAudit:PurchaseAudit,projection:Projection,growth:Growth,cryptoProvider:webcrypto
 });
 assert.equal(broken.status,'SOURCE_STRUCTURE_REJECTED');
 assert.ok(!JSON.stringify(broken).includes('private-input-secret'));
 denied(broken);
});
test('source is read-only and has no network, IDB, storage or server-authority path',()=>{
 for(const token of [/\.rpc\s*\(/,/\.(?:insert|update|delete|upsert|applyOperation|initializeInventory|recordResult)\s*\(/,
  /\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage)\s*(?:\(|\.|\[)/,
  /\b(?:console\.log|console\.error)\s*\(/])
  assert.doesNotMatch(source,token);
 assert.match(source,/canUpload:false/);
 assert.match(source,/serverReceiptPresent:false/);
});
