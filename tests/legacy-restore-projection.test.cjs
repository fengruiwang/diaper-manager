const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Projection=require('../sync/legacy-restore-projection.js');
const Growth=require('../growth.js');
const source=fs.readFileSync(path.join(__dirname,'../sync/legacy-restore-projection.js'),'utf8');
const production=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const state=()=>({
 dueDate:'2027-01-08',birthDate:'',currentSize:'NB',babyWeight:'',
 babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''},
 weightRecords:[],sizeMode:'manual',autoSize:'NB',replenishPolicy:{mode:'days',days:7},
 goalPrice:1.5,plannedBudget:250,
 target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
 daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
 inventory:{NB:2,S:60,M:0,L:0,XL:0,XXL:0},quotes:[],transactions:[],
 referenceOverrides:{'好奇|小森林|S':1.235},preset:'balanced'
});
const exported=s=>({app:'xiaobao-diapers',version:1,exportedAt:'2026-11-11T08:00:00.000Z',data:s});
test('complete v1.1.2 snapshot projects without changing preserved data, no writes',()=>{
 const s=state(),serialized=JSON.stringify(s);
 const r=Projection.inspect(exported(s),Growth);
 assert.equal(r.status,'PROJECTION_IDENTICAL');
 assert.equal(r.differenceCount,0);
 assert.equal(JSON.stringify(s),serialized);
 assert.equal(r.productionImportExecuted,false);
 assert.equal(r.canReplaceLocalState,false);
 assert.equal(r.canUpload,false);
});
test('legacy missing defaults produce explicit difference instead of a fake lossless PASS',()=>{
 const s=state();delete s.sizeMode;delete s.preset;delete s.replenishPolicy;
 const r=Projection.inspect(exported(s),Growth);
 assert.equal(r.status,'PROJECTION_DIFF_REVIEW_REQUIRED');
 assert.ok(r.differenceCount>=3);
 assert.ok(r.sectionChanges.some(x=>x.section==='sizeMode'));
 assert.ok(r.sectionChanges.some(x=>x.section==='preset'));
});
test('inventory rounding and clamping are reported and never modify source',()=>{
 for(const inventoryValue of [1.4,-10,120000]){
  const s=state();s.inventory.S=inventoryValue;
  const before=JSON.stringify(s);
  const r=Projection.inspect(exported(s),Growth);
  assert.equal(r.status,'PROJECTION_DIFF_REVIEW_REQUIRED');
  assert.ok(r.sectionChanges.some(x=>x.section==='inventory'));
  assert.equal(JSON.stringify(s),before);
 }
});
test('nested unknown profile/weight fields are flagged while original history remains intact',()=>{
 const s=state();
 s.babyProfile.privateFutureField={nested:1};
 s.weightRecords=[{id:'w1',date:'2027-01-08',time:'11:20',weight:3.27,note:'',vendorField:'KEEP'}];
 const before=JSON.stringify(s);
 const r=Projection.inspect(exported(s),Growth);
 assert.equal(r.status,'PROJECTION_DIFF_REVIEW_REQUIRED');
 assert.ok(r.sectionChanges.some(x=>x.section==='babyProfile'));
 assert.ok(r.sectionChanges.some(x=>x.section==='weightRecords'));
 assert.ok(!JSON.stringify(r).includes('privateFutureField'));
 assert.ok(!JSON.stringify(r).includes('vendorField'));
 assert.equal(JSON.stringify(s),before);
});
test('invalid legacy measurement would be filtered by old importer and must trigger blocker',()=>{
 const s=state();
 s.weightRecords=[{id:'old',date:'2027-01-08',time:'18:00',weight:500,note:'untrusted'}];
 const r=Projection.inspect(exported(s),Growth);
 assert.equal(r.status,'PROJECTION_DIFF_REVIEW_REQUIRED');
 assert.ok(r.sectionChanges.some(x=>x.section==='weightRecords'));
});
test('referenceOverrides three-decimal prices and purchase rows are not normalized',()=>{
 const s=state();
 s.transactions=[{id:'b1',type:'buy',date:'2026-11-11',brand:'好奇',series:'小森林',size:'S',pieces:60,price:63.5}];
 s.quotes=[{id:'q1',date:'2026-11-11',brand:'好奇',series:'小森林',size:'S',per:20,packs:3,pieces:60,price:63.5,unit:63.5/60}];
 const r=Projection.inspect(exported(s),Growth);
 assert.equal(r.status,'PROJECTION_IDENTICAL');
});
test('invalid file envelope and missing growth functions are safely rejected',()=>{
 assert.throws(()=>Projection.inspect({app:'other',version:1,data:state()},Growth),/unsupported_export/);
 assert.throws(()=>Projection.inspect({app:'xiaobao-diapers',version:2,data:state()},Growth),/unsupported_export/);
 assert.throws(()=>Projection.inspect(exported(state()),{}),/growth_dependency_required/);
});
test('report avoids sharing field values, unknown keys, names, and record identifiers',()=>{
 const s=state();s.babyProfile.privatePasscode='secret-77';s.goalPrice=1.234;
 s.transactions=[{id:'private-order-number',type:'buy'}];
 const r=Projection.inspect(exported(s),Growth);
 const json=JSON.stringify(r);
 assert.ok(!json.includes('secret-77'));
 assert.ok(!json.includes('privatePasscode'));
 assert.ok(!json.includes('private-order-number'));
 assert.ok(!json.includes('1.234'));
});
test('simulation contract stays aligned with relevant existing production importer statements',()=>{
 for(const s of [
  "const d=defaults(),raw=obj.data",
  "target:{...d.target,...raw.target}",
  "daily:{...d.daily,...raw.daily}",
  "inventory:{...d.inventory,...raw.inventory}",
  "referenceOverrides:raw.referenceOverrides",
  "Object.assign(state,XBGrowth.extras",
  "XBGrowth.syncAutoSize(state)"
 ])assert.ok(production.includes(s),'Production import contract missing: '+s);
 assert.match(source,/Object\.assign\(state,growth\.extras/);
 assert.match(source,/growth\.syncAutoSize\(state\)/);
 assert.match(source,/Math\.round\(num\(state\.inventory\[size\]\)\)/);
});
test('pure read-only projection never invokes storage/SDK or mutation APIs',()=>{
 assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage)\s*(?:\(|\.|\[)/);
 assert.doesNotMatch(source,/\.(?:insert|update|delete|upsert|setItem|clear|removeItem)\s*\(/);
});
