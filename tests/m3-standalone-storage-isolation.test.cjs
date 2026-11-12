const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/m3/index.html'),'utf8');
const controller=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/m1-controller.js'),'utf8');
const htmlScripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
 .map(x=>x[1]).filter(x=>x.trim());
const initStart=html.indexOf('// Standalone M3 memory-only data.');
const initEnd=html.indexOf('const $=id=>document.getElementById(id);',initStart);
const tabStart=html.indexOf('function tab(to,{scroll=true}={}){');
const tabEnd=html.indexOf('// Calendar-month age.',tabStart);
function shell(){
 const hits={read:0,write:0},tabViews=['overview','compare','history','growth','settings']
  .map(id=>({id,dataset:{tab:id},classList:{toggle(){}},}));
 const storage={getItem(){hits.read++;throw Error('FORBIDDEN_READ')},
   setItem(){hits.write++;throw Error('FORBIDDEN_WRITE')},
   removeItem(){hits.write++;throw Error('FORBIDDEN_WRITE')},
   clear(){hits.write++;throw Error('FORBIDDEN_WRITE')}};
 const context={SIZES:['NB','S','M','L','XL','XXL'],
   VALID_TABS:new Set(['overview','compare','history','growth','settings']),
   localStorage:storage,sessionStorage:storage,
   indexedDB:{open(){throw Error('FORBIDDEN_IDB')}},
   document:{querySelectorAll:()=>tabViews},
   window:{scrollTo(){}},renderHistory(){},renderSettings(){},renderGrowth(){},
   renderQuotes(){},renderReferenceTable(){}};
 const script='(function(){'+html.slice(initStart,initEnd)
  +html.slice(tabStart,tabEnd)
  +';return {load,save,tab,restoreActiveTab};})()';
 const methods=vm.runInNewContext(script,context,{timeout:1000});
 return {methods,hits};
}
test('standalone initial load and simulated refresh never touch M1 or production storage',()=>{
 assert.ok(initStart>0&&initEnd>initStart&&tabStart>initEnd&&tabEnd>tabStart);
 const first=shell(),second=shell();
 for(const s of [first,second]){
  assert.equal(s.methods.load().inventory.S,0);
  assert.equal(s.methods.save(),false);
  s.methods.restoreActiveTab();
  s.methods.tab('history',{scroll:false});
  s.methods.tab('growth',{scroll:false});
  s.methods.tab('compare',{scroll:false});
  s.methods.tab('settings',{scroll:false});
  assert.deepEqual(s.hits,{read:0,write:0});
 }
});
test('M3 standalone HTML contains no actual browser-storage read/write sites',()=>{
 assert.doesNotMatch(html,/xiaobao_v120_m1_local_sandbox/);
 assert.doesNotMatch(html,/xiaobao_v120_m1_active_tab/);
 assert.doesNotMatch(html,/xiaobao_diaper_planner_v1/);
 assert.doesNotMatch(html,/\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem|clear)\s*\(/);
 assert.match(html,/<body data-m3-standalone="true">/);
 assert.match(html,/src="\.\/m1-controller\.js"/);
 assert.doesNotMatch(html,/m102-cloud\.js/);
 assert.match(controller,/storage:standalone\?null:root\.localStorage/);
 assert.match(controller,/if\(standalone\)view\.status\('M3_ON_DEMAND_CLOUD_READ_ONLY'\)/);
});
test('all inline M3 scripts compile including read-only controls',()=>{
 for(const s of htmlScripts)assert.doesNotThrow(()=>new Function(s));
 assert.match(html,/id="m3Demo"/);
 assert.match(html,/id="m3Cloud"/);
 assert.match(html,/window\.XBM3UI=Object\.freeze/);
});
