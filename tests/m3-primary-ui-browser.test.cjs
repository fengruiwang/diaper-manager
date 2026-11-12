const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const UI=require('../sync/primary-ui-projection.js');
const Bridge=require('../preview/v1.2.0/m3-primary-preview.js');
const html=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/index.html'),'utf8');
const controller=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/m3-primary-preview.js'),'utf8');
const defaults=()=>({inventory:{},transactions:[],quotes:[],weightRecords:[],
 babyProfile:{name:'default'},dueDate:'',birthDate:'',target:{},daily:{},referenceOverrides:{},
 currentSize:'NB',plannedBudget:100,goalPrice:1.5});
test('M3 demo projects all five pages data, keeps S stock authoritative and shows historical vs new purchases',()=>{
 const view=UI.project(UI.demo(),defaults());
 assert.equal(view.synthetic,true);assert.equal(view.canWrite,false);
 assert.equal(view.state.inventory.S,230);assert.equal(view.revisions.S,2);
 assert.equal(view.state.transactions.length,3);
 assert.equal(view.state.transactions.filter(t=>t.origin==='legacy_migration').length,2);
 assert.equal(view.state.transactions.filter(t=>t.origin==='cloud_post_migration').length,1);
 assert.equal(view.state.quotes.length,1);
 assert.equal(view.state.weightRecords.length,2);
 assert.equal(view.state.referenceOverrides['好奇|小森林|S'],1.123);
 assert.equal(view.state.babyProfile.name,'演示宝宝');
 assert.equal(view.historicPurchasesAddedToStock,false);
});
test('project never mutates original view or local default snapshot',()=>{
 const d=defaults(),raw=UI.demo(),before=JSON.stringify(raw);
 const view=UI.project(raw,d);
 view.state.inventory.S=999;
 assert.equal(raw.inventory.S,230);
 assert.equal(d.inventory.S,undefined);
 assert.equal(JSON.stringify(raw),before);
});
test('unverified or paginated legacy data cannot pretend complete',()=>{
 const d=defaults(),v=UI.demo();
 assert.throws(()=>UI.project({...v,canWrite:true},d),/primary_ui:unverified_read_model/);
 assert.throws(()=>UI.project({...v,legacyHistory:{...v.legacyHistory,hasMore:true}},d),
  /primary_ui:incomplete_history_page/);
 assert.throws(()=>UI.project({...v,legacyHistory:{...v.legacyHistory,total:100}},d),
  /primary_ui:incomplete_history_page/);
});
test('missing source identity and an invalid live row fail closed',()=>{
 const d=defaults(),v=UI.demo();
 assert.throws(()=>UI.project({...v,inventory:{...v.inventory,S:-1}},d),
  /primary_ui:invalid_stock/);
 assert.throws(()=>UI.project({...v,livePurchases:[{...v.livePurchases[0],pieces:-10}]},d),
  /primary_ui:invalid_post_migration_purchase/);
});
test('browser bridge demo never instantiates cloud SDK and clears demo on failed primary lookup',async()=>{
 let on=false,cloudCalls=0;const statuses=[];
 const view={defaults,show:()=>{on=true},clear:()=>{on=false},
  status:s=>statuses.push(s)};
 const host={XBM102:{isActive:()=>false},XBM1Preview:{connect:async()=>{},
   verifiedContext:()=>({familyId:'F',actorUid:'A',app:{}})}};
 const bridge=Bridge.create({host,projection:UI,view,
  modelFactory:()=>{cloudCalls++;return {read:async()=>({status:'PRIMARY_NOT_READY'})}}});
 assert.equal(bridge.demo(),'SYNTHETIC_DEMO_READ_ONLY');assert.equal(on,true);
 assert.equal(await bridge.cloud(),'PRIMARY_NOT_READY_NO_CLOUD_VIEW');
 assert.equal(on,false);assert.equal(cloudCalls,1);
 assert.equal(bridge.exit(),'LOCAL_SANDBOX');
});
test('original five-tab browser preview contains M3 read-only controls and blocks mutations',()=>{
 for(const tab of ['overview','compare','history','growth','settings'])
  assert.match(html,new RegExp('data-tab="'+tab+'"'));
 for(const id of ['m3Panel','m3Status','m3Demo','m3Cloud','m3Exit'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/window\.XBM3UI=Object\.freeze/);
 assert.match(html,/if\(m3ReadOnly\).*return false;/);
 assert.match(html,/m3-primary-preview\.js/);
 assert.match(html,/旧版迁移历史/);
 assert.match(html,/迁移后新采购/);
 assert.match(controller,/addEventListener\('click',event=>/);
 assert.match(controller,/event\.stopImmediatePropagation\(\)/);
 assert.match(controller,/PRIMARY_NOT_READY_NO_CLOUD_VIEW/);
 assert.doesNotMatch(html,/xiaobao_diaper_planner_v1/);
});
