const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const G=require('../growth.js');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const match=source.match(/<script>\s*([\s\S]*?)<\/script>/);
assert.ok(match,'inline application script must exist');
const script=match[1];
test('inline HTML JavaScript parses',()=>assert.doesNotThrow(()=>new vm.Script(script)));
test('PWA and original storage identity preserved',()=>{
 assert.match(source,/const KEY='xiaobao_diaper_planner_v1'/);
 assert.match(source,/src="\.\/growth\.js"/);
 assert.match(source,/id="legacyStock"/);
 assert.match(source,/data-tab="growth"/);
 assert.match(source,/name="viewport"/);
});
function boot(legacy,chosenTab){
 const map=new Map(),store=new Map();
 store.set('xiaobao_diaper_planner_v1',JSON.stringify(legacy));
 if(chosenTab)store.set('xiaobao_active_tab_v1',chosenTab);
 const elements=id=>{
  if(!map.has(id))map.set(id,elem(id));
  return map.get(id);
 };
 function elem(id){
  const classes=new Set(id==='overview'||id==='tab-overview'?['active']:[]);
  return {id,hidden:false,value:'',innerHTML:'',textContent:'',style:{},dataset:{},files:null,disabled:false,
   classList:{contains:x=>classes.has(x),toggle:(x,on)=>{if(on)classes.add(x);else classes.delete(x)},add:x=>classes.add(x),remove:x=>classes.delete(x)},
   handlers:{},addEventListener(type,cb){this.handlers[type]=cb},focus(){},select(){},scrollIntoView(){},setAttribute(){},getAttribute(){return null},closest(){return null}};
 }
 const tabs=['overview','compare','history','growth','settings'].map(id=>{const e=elements('tab-'+id);e.dataset.tab=id;return e});
 const panels=['overview','compare','history','growth','settings'].map(elements);
 const document={
  getElementById:elements,
  querySelectorAll(sel){return sel==='.tab'?tabs:sel==='.panel'?panels:[]},
  querySelector(sel){return elements(sel)},
  addEventListener(){},
  createElement:()=>elem('created'),
  body:{append(){}}
 };
 elements('qBrand').value='好奇';
 elements('qSeries').value='';
 elements('qSize').value='NB';
 elements('qPerPack').value='60';elements('qPacks').value='1';elements('qPrice').value='';
 elements('refSize').value='NB';
 elements('growthRange').value='all';
 elements('weightKg').value='';
 const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v))};
 const context={document,localStorage,XBGrowth:G,
  window:{scrollTo(){},location:{},addEventListener(){}},
  console,Date,JSON,Math,Number,String,Object,Array,Set,Map,Intl,
  setTimeout(){return 1},clearTimeout(){},confirm(){return true},
  FileReader:function(){this.readAsText=file=>{this.result=file.json;this.onload()}},Blob:function(){},URL:{createObjectURL(){},revokeObjectURL(){}},
 };
 vm.runInNewContext(script,context,{timeout:5000,filename:'index-app.js'});
 return {elements,store,tabs,panels};
}
const fixture=()=>({
 dueDate:'2027-01-08',birthDate:'2025-01-08',currentSize:'S',babyWeight:'5.5',
 inventory:{NB:18,S:36,M:20,L:0,XL:0,XXL:0},
 target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
 transactions:[{id:'old-buy',type:'buy',date:'2025-03-10',brand:'好奇',series:'小森林',size:'NB',pieces:80,price:99}],
 quotes:[{id:'quote1',brand:'好奇',series:'小森林',size:'S',price:60,pieces:60,unit:1}],
 referenceOverrides:{'好奇|小森林|NB':1.19},goalPrice:1.5,plannedBudget:250,preset:'balanced'
});
test('v1.0.2 user data automatically migrates without losing records',()=>{
 const before=fixture(),{store}=boot(before);
 const after=JSON.parse(store.get('xiaobao_diaper_planner_v1'));
 for(const k of ['inventory','target','daily','transactions','quotes','referenceOverrides','babyWeight','currentSize'])
  assert.deepEqual(JSON.parse(JSON.stringify(after[k])),before[k],'changed '+k);
 assert.equal(after.sizeMode,'manual');assert.ok(after.babyProfile);assert.deepEqual(after.weightRecords,[]);
});
test('after switching to S, leftover NB stock is at the very bottom',()=>{
 const {elements}=boot(fixture());
 assert.match(elements('legacyStock').innerHTML,/NB/);
 assert.doesNotMatch(elements('sizeCards').innerHTML,/NB · 正在用/);
 assert.match(elements('sizeCards').innerHTML,/S · 正在用/);
 assert.match(elements('kpiGrid').innerHTML,/当前使用尺码/);
});
test('installed app restores growth page after refresh',()=>{
 const {panels,elements}=boot(fixture(),'growth');
 assert.equal(panels[3].classList.contains('active'),true);
 assert.match(elements('growthSummary').innerHTML,/最新体重/);
});
test('old NB inventory empty means no historical area',()=>{
 const data=fixture();data.inventory.NB=0;
 const {elements}=boot(data);
 assert.equal(elements('legacySection').hidden,true);
});
test('post-birth automatic weight chooses current size, not hardcoded NB/S',()=>{
 const data=fixture();data.sizeMode='auto';data.autoSize='NB';data.currentSize='NB';
 data.weightRecords=[{id:'m',date:'2025-05-10',time:'',weight:9.5,note:''}];
 const {elements}=boot(data);
 assert.match(elements('sizeCards').innerHTML,/M · 正在用/);
 assert.match(elements('shoppingPlan').innerHTML,/M/);
 assert.doesNotMatch(elements('shoppingPlan').innerHTML,/新生儿首批试用/);
});

test('new-format JSON backups restore growth records, profile and reference price',()=>{
 const {elements,store}=boot(fixture());
 const data={...fixture(),babyProfile:{name:'宝宝',sex:'女',birthTime:'07:02:09',birthWeight:3.25,birthLength:50},weightRecords:[{id:'w1',date:'2025-02-01',time:'09:30',weight:4.2,note:'儿保'}],sizeMode:'auto',autoSize:'S'};
 const box=elements('importFile');box.files=[{json:JSON.stringify({app:'xiaobao-diapers',version:1,data})}];
 box.handlers.change({target:box});
 const restored=JSON.parse(store.get('xiaobao_diaper_planner_v1'));
 assert.equal(restored.babyProfile.birthTime,'07:02:09');
 assert.equal(restored.weightRecords.length,1);
 assert.equal(restored.weightRecords[0].weight,4.2);
 assert.deepEqual(restored.referenceOverrides,data.referenceOverrides);
 assert.deepEqual(restored.inventory,data.inventory);
 assert.deepEqual(restored.transactions,data.transactions);
});
test('v1.1.1 app shell precaches new growth module without changing user storage',()=>{
 const sw=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
 const version=JSON.parse(fs.readFileSync(path.join(__dirname,'../version.json'),'utf8'));
 assert.match(sw,/xiaobao-shell-v1\.1\.1/);
 assert.match(sw,/\.\/growth\.js/);
 assert.equal(version.version,'1.1.1');
 assert.match(source,/const KEY='xiaobao_diaper_planner_v1'/);
});

test('budget field stays in legacy JSON but budget setting is absent',()=>{
 assert.doesNotMatch(source,/id="plannedBudget"/);
 assert.match(source,/plannedBudget:250/);
 assert.doesNotMatch(source,/首批备货预算<\/span>/);
 assert.match(source,/const KEY='xiaobao_diaper_planner_v1'/);
});
test('birth-stage settings keep NB/S presets without postnatal policy',()=>{
 const s=fixture();s.birthDate='';
 const {elements}=boot(s,'settings');
 assert.equal(elements('prenatalPresets').hidden,false);
 assert.equal(elements('postnatalPolicy').hidden,true);
 assert.match(elements('settingsSizes').innerHTML,/出生前重点备货/);
 assert.match(elements('settingsSizes').innerHTML,/NB · 首批试用/);
 assert.match(elements('settingsSizes').innerHTML,/S · 下一码/);
});
test('when L is active, current and next are first and NB/S/M are collapsed as history',()=>{
 const s=fixture();s.currentSize='L';s.inventory.M=11;
 const {elements}=boot(s,'settings'),markup=elements('settingsSizes').innerHTML;
 assert.equal(elements('prenatalPresets').hidden,true);
 assert.equal(elements('postnatalPolicy').hidden,false);
 assert.match(markup,/L · 正在使用/);
 assert.match(markup,/XL · 下一尺码/);
 assert.match(markup,/<details class="plan-more"><summary>历史尺码设置/);
 assert.ok(markup.indexOf('L · 正在使用')<markup.indexOf('NB'));
 assert.match(markup,/NB 18片 \/ S 36片 \/ M 11片/);
});
test('saving a 5-day policy preserves every historical target and price record',()=>{
 const before=fixture();before.currentSize='L';
 before.target.L=72;before.target.NB=80;before.target.S=60;
 const {elements,store}=boot(before,'settings');
 for(const x of G.SIZES){elements('target_'+x).value=String(before.target[x]);elements('daily_'+x).value=String(before.daily[x]);}
 elements('replenishMode').value='days';elements('replenishDays').value='5';
 elements('daily_L').value='7';
 elements('savePlans').handlers.click();
 const after=JSON.parse(store.get('xiaobao_diaper_planner_v1'));
 assert.deepEqual(after.target,before.target);
 assert.equal(after.daily.L,7);
 assert.deepEqual(after.replenishPolicy,{mode:'days',days:5});
 assert.equal(after.plannedBudget,250);
 for(const key of ['inventory','transactions','quotes','referenceOverrides','weightRecords'])
  if(before[key]!==undefined) assert.deepEqual(after[key],before[key]);
 assert.equal(G.stockPlan(after).target,35);
});
test('custom target can be set for current L without changing unused NB/S',()=>{
 const before=fixture();before.currentSize='L';before.target.L=0;
 const {elements,store}=boot(before,'settings');
 for(const x of G.SIZES){elements('target_'+x).value=String(before.target[x]);elements('daily_'+x).value=String(before.daily[x]);}
 elements('replenishMode').value='custom';elements('replenishDays').value='7';
 elements('target_L').value='54';
 elements('savePlans').handlers.click();
 const after=JSON.parse(store.get('xiaobao_diaper_planner_v1'));
 assert.equal(after.target.L,54);
 assert.equal(after.target.NB,before.target.NB);
 assert.equal(after.target.S,before.target.S);
 assert.equal(G.stockPlan(after).target,54);
});
test('old backups without policy import with seven-day default and unchanged budget',()=>{
 const {elements,store}=boot(fixture());
 const original=fixture();
 const box=elements('importFile');box.files=[{json:JSON.stringify({app:'xiaobao-diapers',version:1,data:original})}];
 box.handlers.change({target:box});
 const after=JSON.parse(store.get('xiaobao_diaper_planner_v1'));
 assert.deepEqual(after.replenishPolicy,{mode:'days',days:7});
 assert.equal(after.plannedBudget,original.plannedBudget);
 assert.deepEqual(after.inventory,original.inventory);
 assert.deepEqual(after.target,original.target);
 assert.deepEqual(after.referenceOverrides,original.referenceOverrides);
});
