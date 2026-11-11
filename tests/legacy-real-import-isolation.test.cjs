const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Harness=require('./helpers/isolated-v1-import-harness.cjs');
const Projection=require('../sync/legacy-restore-projection.js');
const Growth=require('../growth.js');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const SIZES=['NB','S','M','L','XL','XXL'];
const plain=()=>({
 dueDate:'2027-01-08',birthDate:'',currentSize:'NB',babyWeight:'',
 babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''},
 weightRecords:[],sizeMode:'manual',autoSize:'NB',
 replenishPolicy:{mode:'days',days:7},goalPrice:1.5,plannedBudget:250,
 target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
 daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
 inventory:{NB:2,S:60,M:0,L:0,XL:0,XXL:0},
 quotes:[{id:'q1',date:'2026-11-11',brand:'好奇',series:'小森林',
  size:'S',per:20,packs:3,pieces:60,price:63.5,unit:63.5/60}],
 transactions:[{id:'b1',type:'buy',date:'2026-11-11',
  brand:'好奇',series:'小森林',size:'S',pieces:60,price:63.5}],
 referenceOverrides:{'好奇|小森林|S':1.235},preset:'balanced'
});
const wrap=data=>({
 app:'xiaobao-diapers',version:1,exportedAt:'2026-11-11T08:00:00.000Z',data
});
function run(data,opts){return Harness.executeImport(wrap(data),opts);}
function changedRoots(report){return report.sectionChanges.map(x=>x.section);}
test('P2-4C extracts exact current production importData function, not reimplementation',()=>{
 assert.equal(source.split(/\r?\n/).filter(x=>x.startsWith('function importData(file)')).length,1);
 assert.ok(source.includes(Harness.importSource));
 assert.match(Harness.importSource,/const reader=new FileReader\(\)/);
 assert.match(Harness.importSource,/save\(\);renderAll\(\);toast\('备份已恢复'\)/);
});
test('actual legacy importer serializes complete synthetic data and real load() restores it',()=>{
 const input=plain(),before=JSON.stringify(input);
 const result=run(input);
 assert.equal(result.productionFunctionUsed,true);
 assert.equal(result.realBrowserStorageTouched,false);
 assert.equal(result.didSave,true);
 assert.deepEqual(result.events,['confirm','isolated_storage_write','render','toast:备份已恢复']);
 assert.deepEqual(result.savedState,input);
 assert.deepEqual(result.reloadedState,input);
 assert.equal(JSON.stringify(input),before);
 assert.deepEqual(Projection.compare(input,result.savedState).differenceCount,0);
});
test('user cancel stops all writes and never leaks seed data into actual localStorage',()=>{
 const result=run(plain(),{approved:false});
 assert.equal(result.didSave,false);
 assert.deepEqual(result.events,['confirm']);
 assert.equal(result.savedState,null);
 assert.equal(result.realBrowserStorageTouched,false);
});
test('invalid JSON, different app or missing inventory/target are rejected before storage write',()=>{
 const payloads=[
  '{ definitely broken JSON',
  JSON.stringify({app:'wrong-app',data:plain()}),
  JSON.stringify({app:'xiaobao-diapers',data:{target:{}}}),
  JSON.stringify({app:'xiaobao-diapers',data:{inventory:{}}})
 ];
 for(const file of payloads){
  const result=Harness.executeImport(file);
  assert.equal(result.didSave,false);
  assert.ok(result.events.some(event=>event==='toast:备份文件格式不正确'));
  assert.equal(result.savedState,null);
 }
});
test('actual importer rounds inventory, clamps quantity/target/daily and reload preserves those changes',()=>{
 const data=plain();data.inventory.S=60.6;data.inventory.NB=-2;
 data.target.S=20000;data.daily.S=0;
 const before=JSON.stringify(data),result=run(data);
 assert.equal(result.savedState.inventory.S,61);
 assert.equal(result.savedState.inventory.NB,0);
 assert.equal(result.savedState.target.S,10000);
 assert.equal(result.savedState.daily.S,1);
 assert.deepEqual(result.reloadedState,result.savedState);
 assert.equal(JSON.stringify(data),before);
 assert.deepEqual(changedRoots(Projection.compare(data,result.savedState))
   .filter(x=>['inventory','target','daily'].includes(x)).sort(),
   ['daily','inventory','target']);
});
test('real importer does not alter complete purchase, quote or reference override arrays',()=>{
 const data=plain(),result=run(data);
 assert.deepEqual(result.savedState.transactions,data.transactions);
 assert.deepEqual(result.savedState.quotes,data.quotes);
 assert.deepEqual(result.savedState.referenceOverrides,data.referenceOverrides);
 assert.equal(result.savedState.referenceOverrides['好奇|小森林|S'],1.235);
 assert.deepEqual(result.reloadedState.transactions,data.transactions);
});
test('real growth.extras drops unrecognized nested fields, causing explicit audit blocker',()=>{
 const data=plain();data.babyProfile.customHealthNote='PRIVATE_SAMPLE';
 data.weightRecords=[{
  id:'w1',date:'2027-01-08',time:'09:20',
  weight:3.21,note:'synthetic',futureExtension:'PRIVATE_SAMPLE'
 }];
 const result=run(data);
 assert.equal(result.didSave,true);
 assert.equal(result.savedState.babyProfile.customHealthNote,undefined);
 assert.equal(result.savedState.weightRecords[0].futureExtension,undefined);
 const report=Projection.compare(data,result.savedState);
 assert.equal(report.status,'PROJECTION_DIFF_REVIEW_REQUIRED');
 assert.ok(changedRoots(report).includes('babyProfile'));
 assert.ok(changedRoots(report).includes('weightRecords'));
 assert.ok(!JSON.stringify(report).includes('PRIVATE_SAMPLE'));
 assert.ok(!JSON.stringify(report).includes('futureExtension'));
});
test('invalid growth record is excluded by actual importer and must never be called lossless',()=>{
 const data=plain();data.weightRecords=[{
  id:'bad',date:'2027-01-08',time:'12:00',weight:999,note:'synthetic'
 }];
 const result=run(data);
 assert.deepEqual(result.savedState.weightRecords,[]);
 assert.equal(Projection.compare(data,result.savedState).status,
   'PROJECTION_DIFF_REVIEW_REQUIRED');
});
test('missing defaults are actually added; unknown top-level fields survive the old object spread',()=>{
 const data=plain();
 delete data.sizeMode;delete data.replenishPolicy;delete data.preset;
 data.futureSection={hello:'synthetic'};
 const result=run(data);
 assert.equal(result.savedState.sizeMode,'manual');
 assert.equal(result.savedState.preset,'balanced');
 assert.deepEqual(result.savedState.futureSection,{hello:'synthetic'});
 const diff=Projection.compare(data,result.savedState);
 assert.equal(diff.status,'PROJECTION_DIFF_REVIEW_REQUIRED');
 assert.ok(changedRoots(diff).includes('sizeMode'));
});
test('actual importer currently lacks a version check; validator MUST reject unsupported versions first',()=>{
 const unsupported=wrap(plain());unsupported.version=2;
 const result=Harness.executeImport(unsupported);
 assert.equal(result.didSave,true); // DOCUMENTED EXISTING IMPORTER LIMITATION
 assert.equal(result.realBrowserStorageTouched,false);
 assert.equal(Projection.compare(unsupported.data,result.savedState).differenceCount,0);
});
test('actual importer and independent P2-4B simulation agree on canonical and risky fixture outputs',()=>{
 const cases=[plain(),(()=>{
  const data=plain();data.inventory.S=-6;data.daily.M=33;
  data.weightRecords=[{id:'bad',date:'2027-01-10',time:'',weight:80,note:''}];
  return data;
 })(),(()=>{
  const data=plain();delete data.replenishPolicy;
  data.babyProfile.unknownField='private';
  data.referenceOverrides['好奇|小森林|NB']=0.987;
  return data;
 })()];
 for(const input of cases){
  const actual=run(input),projected=Projection.simulateImporter(wrap(input),Growth);
  assert.deepEqual(actual.savedState,projected);
  const diff=Projection.compare(input,actual.savedState);
  assert.equal(diff.canReplaceLocalState,false);
  assert.equal(diff.canUpload,false);
 }
});
test('sandbox source contains no actual browser/network APIs and imports only synthetic fixtures',()=>{
 const helper=fs.readFileSync(path.join(__dirname,'helpers/isolated-v1-import-harness.cjs'),'utf8');
 assert.match(helper,/vm\.createContext/);
 assert.match(helper,/codeGeneration:\{strings:false,wasm:false\}/);
 assert.match(helper,/const virtualStorage=new Map\(\)/);
 assert.match(helper,/require\('\.\.\/\.\.\/growth\.js'\)/);
 assert.doesNotMatch(helper,/\b(?:fetch|XMLHttpRequest|WebSocket|cloudbase|indexedDB|sessionStorage)\s*\(/);
 assert.doesNotMatch(helper,/\b(?:eval|Function)\s*\(/);
});
