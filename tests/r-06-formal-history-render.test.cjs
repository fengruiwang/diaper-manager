const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Project=require('../sync/primary-ui-projection.js');

const file=path.join(__dirname,'../preview/v1.2.0/formal/index.html');
const html=fs.readFileSync(file,'utf8');
function actualFunction(name,next){
 const start=html.indexOf('function '+name+'(){');
 const end=html.indexOf('function '+next+'(){',start);
 assert.ok(start!==-1&&end>start,'must execute actual formal HTML '+name);
 return html.slice(start,end);
}
const formalRender=actualFunction('renderHistory','updateSizeModePreview');
const smokeRender=actualFunction('renderM102History','renderHistory');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const num=n=>Number.isFinite(+n)?+n:0;
const money=n=>'¥'+num(n).toFixed(2);
const int=n=>Math.round(num(n)).toLocaleString('zh-CN');
const item=(id,{type='buy',reversed=false,origin='cloud_post_migration',
 date='2026-11-10',pieces=6,price=12}={})=>({
 id,type,reversed,origin,date,pieces,price,
 brand:'品牌'+id,series:'系列'+id,size:'S',
 operationId:origin==='cloud_post_migration'?'op-'+id:undefined,
 reversedByOperationId:reversed?'reverse-'+id:null
});
function render(transactions,{m102=false,stock}={}){
 const state=stock||{transactions,inventory:{S:40},currentSize:'S'};
 const nodes={historyList:{innerHTML:''},historyKpis:{innerHTML:''}};
 let edits=0;
 const $=id=>(nodes[id]??=({innerHTML:''}));
 const sandbox={
  state,m3ReadOnly:true,$,num,money,int,esc,currMonth:()=> '2026-11',
  spend:()=>state.transactions.filter(t=>t.type==='buy'&&t.reversed!==true)
   .reduce((sum,t)=>sum+num(t.price),0),
  renderStockEditor:()=>{edits++;},
  renderM102History:()=>{throw Error('M1 smoke renderer must not run');},
  window:{XBM102:{isActive:()=>false}},
  console
 };
 vm.runInNewContext(formalRender+'\nrenderHistory();',sandbox,{timeout:1500});
 return {list:nodes.historyList.innerHTML,kpis:nodes.historyKpis.innerHTML,
  state,edits};
}
function rowBody(htmlText){
 const match=htmlText.match(/<tbody>([\s\S]*?)<\/tbody>/);
 return match?match[1]:'';
}
function rows(htmlText){
 return (rowBody(htmlText).match(/<tr>/g)||[]).length;
}
test('R-06 actual formal DOM: only active buy/use rows; migration records stay read-only and source labels vanish',()=>{
 const transactions=[
  item('b-new',{date:'2026-11-16'}),
  item('u-new',{type:'use',date:'2026-11-15'}),
  item('b-reversed',{reversed:true,date:'2026-11-18'}),
  item('u-reversed',{type:'use',reversed:true,date:'2026-11-19'}),
  item('old-buy',{origin:'legacy_migration',date:'2026-10-10'}),
  item('old-use',{type:'use',origin:'legacy_migration',date:'2026-10-09'})
 ];
 const snapshot=JSON.stringify(transactions),out=render(transactions);
 assert.equal(rows(out.list),4);
 assert.match(out.list,/品牌b-new/);
 assert.match(out.list,/日常使用/);
 assert.match(out.list,/data-action="deletetx" data-id="b-new"/);
 assert.match(out.list,/data-action="deletetx" data-id="u-new"/);
 assert.doesNotMatch(out.list,/品牌b-reversed|品牌u-reversed/);
 assert.doesNotMatch(out.list,/data-id="b-reversed"|data-id="u-reversed"/);
 assert.match(out.list,/品牌old-buy/);
 assert.match(out.list,/品牌old-use/);
 assert.doesNotMatch(out.list,/data-id="old-buy"|data-id="old-use"/);
 assert.doesNotMatch(out.list,/旧版迁移历史|迁移后云端采购|迁移后云端消耗|迁移历史不可撤销|已撤销/);
 assert.equal((out.list.match(/data-action="deletetx"/g)||[]).length,2);
 assert.ok(out.list.indexOf('b-new')<out.list.indexOf('u-new'));
 assert.ok(out.list.indexOf('u-new')<out.list.indexOf('old-buy'));
 assert.match(out.kpis,/累计已花/);
 assert.match(out.kpis,/累计已记消耗 12 片/);
 assert.equal(out.edits,1);
 assert.equal(JSON.stringify(transactions),snapshot,'rendering must not edit underlying audit rows');
});
test('R-06 all reversed rows show ordinary empty history; effective spending and use totals zero',()=>{
 const transactions=[item('gone-buy',{reversed:true,price:99}),
  item('gone-use',{type:'use',reversed:true,pieces:40})];
 const out=render(transactions);
 assert.equal(rows(out.list),0);
 assert.match(out.list,/还没有采购或消耗记录/);
 assert.doesNotMatch(out.list,/品牌gone-buy|gone-use|已撤销|迁移历史不可撤销/);
 assert.match(out.kpis,/累计已花/);
 assert.match(out.kpis,/¥0/);
 assert.match(out.kpis,/累计已记消耗 0 片/);
 assert.equal(transactions[0].reversed,true);
 assert.equal(transactions[1].reversed,true);
});
test('R-06 sort and latest-250 cap apply AFTER filtering >250 newer reversed operations',()=>{
 // 320 reversed entries have newer dates than all 260 active entries.
 // Slicing first would hide all active history and fail this test.
 const date=i=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10);
 const active=Array.from({length:260},(_,i)=>item('live-'+i,{date:date(i)}));
 const reversed=Array.from({length:320},(_,i)=>item('gone-'+i,{
  reversed:true,date:date(i+300)
 }));
 const out=render([...active,...reversed]);
 assert.equal(rows(out.list),250);
 assert.ok(out.list.includes('data-id="live-259"'));
 assert.ok(out.list.includes('data-id="live-10"'));
 assert.ok(!out.list.includes('data-id="live-9"'));
 assert.doesNotMatch(out.list,/gone-/);
 assert.match(out.list,/这里只展示最新250条记录/);
 assert.ok(out.list.indexOf('live-259')<out.list.indexOf('live-10'));
 assert.equal(active.length,260);
 assert.equal(reversed.length,320);
});
test('R-06 ACK redraw: updated in-memory audit state hides original without network or another restore',()=>{
 const original=item('cloud-buy',{type:'buy',pieces:8,price:24});
 const use=item('cloud-use',{type:'use',pieces:3});
 const old=item('old',{origin:'legacy_migration'});
 const state={transactions:[original,use,old],inventory:{S:55}};
 const first=render(state.transactions,{stock:state});
 assert.equal(rows(first.list),3);
 assert.match(first.list,/data-id="cloud-buy"/);
 // Existing verified reverse ACK sets reversed + reversedByOperationId,
 // updates the authoritative stock, and invokes showCloudView -> renderHistory.
 // Only the display change belongs to this feature; network is not mocked.
 const accepted=state.transactions.map(t=>t.id==='cloud-buy'
  ?{...t,reversed:true,reversedByOperationId:'verified-original-reverse-uuid'}:t);
 const updated={...state,transactions:accepted,inventory:{S:47}};
 const after=render(updated.transactions,{stock:updated});
 assert.equal(rows(after.list),2);
 assert.doesNotMatch(after.list,/data-id="cloud-buy"/);
 assert.match(after.list,/data-id="cloud-use"/);
 assert.equal(updated.inventory.S,47);
 assert.equal(state.inventory.S,55);
 assert.equal(accepted[0].reversedByOperationId,'verified-original-reverse-uuid');
 const reopen=render(updated.transactions,{stock:updated});
 assert.equal(reopen.list,after.list);
});
test('R-06 actual cloud projection retains reversed records/origin/original UUID, while DOM hides both',()=>{
 const sizes=['NB','S','M','L','XL','XXL'];
 const source={
  status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  canWrite:false,familyId:'29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
  childId:'59918bcb-a7bc-4b2b-a9eb-f160475fd339',actorUid:'dad',
  inventory:Object.fromEntries(sizes.map(size=>[size,size==='S'?19:0])),
  revisions:Object.fromEntries(sizes.map(size=>[size,1])),
  settings:{target:{S:60},daily:{S:6}},
  profileData:{babyProfile:{name:'小宝'},dueDate:'2027-01-08',birthDate:''},
  legacyHistory:{complete:true,total:1,hasMore:false,rows:[{
   kind:'transaction',id:'legacy-buy',payload:{
    id:'legacy-buy',type:'buy',date:'2026-10-10',
    brand:'旧品牌',series:'旧系列',size:'S',pieces:40,price:40
   }
  }]},
  livePurchases:[{operationId:'397b1791-b8d0-4d63-82d6-c5b829240f42',
   brand:'已撤销云端采购',series:'一号',size:'S',pieces:10,
   totalFen:2400,purchaseDate:'2026-11-18',
   reversed:true,reversedByOperationId:'04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'}],
  liveUses:[{operationId:'79192488-bd70-4b88-8c66-3c5b5fb29ef5',
   size:'S',pieces:4,occurredAt:'2026-11-18T09:00:00Z',
   reversed:true,reversedByOperationId:'6b3d0e45-bf18-4c95-889c-6f19731a8ae5'}]
 };
 const projected=Project.project(source,{transactions:[],quotes:[],
  weightRecords:[],inventory:{},target:{},daily:{},referenceOverrides:{},
  babyProfile:{}});
 assert.equal(projected.state.transactions.length,3);
 assert.equal(projected.historyCount,3);
 assert.equal(projected.state.transactions.filter(x=>x.reversed===true).length,2);
 assert.equal(projected.state.transactions[0].origin,'legacy_migration');
 const purchased=projected.state.transactions.find(x=>x.operationId===source.livePurchases[0].operationId);
 const consumed=projected.state.transactions.find(x=>x.operationId===source.liveUses[0].operationId);
 assert.equal(purchased.origin,'cloud_post_migration');
 assert.equal(consumed.origin,'cloud_post_migration');
 assert.equal(purchased.reversedByOperationId,source.livePurchases[0].reversedByOperationId);
 assert.equal(consumed.reversedByOperationId,source.liveUses[0].reversedByOperationId);
 const before=JSON.stringify(projected.state.transactions);
 const page=render(projected.state.transactions,{stock:projected.state});
 assert.equal(rows(page.list),1);
 assert.match(page.list,/旧品牌/);
 assert.doesNotMatch(page.list,/已撤销云端采购|data-id="cloud:/);
 assert.equal(JSON.stringify(projected.state.transactions),before);
 assert.equal(projected.state.inventory.S,19);
 assert.match(page.kpis,/¥40/);
});
test('R-06 M1-02 standalone smoke history rendering is unchanged and still shows audit status',()=>{
 const nodes={historyList:{innerHTML:''},historyKpis:{innerHTML:''}};
 let stockEdits=0;
 const sandbox={
  $:key=>(nodes[key]??={innerHTML:''}),
  int,money,esc,
  renderStockEditor:()=>{stockEdits++;},
  window:{XBM102:{
   history:()=>[{purchaseDate:'2026-11-10',brand:'测试',
    series:'系列',size:'S',pieces:10,totalFen:2200,reversed:true}],
   status:'SYNTHETIC_TEST_READY'
  }}
 };
 vm.runInNewContext(smokeRender+'\nrenderM102History();',sandbox,{timeout:1500});
 assert.match(nodes.historyList.innerHTML,/专用测试宝宝/);
 assert.match(nodes.historyList.innerHTML,/已撤销/);
 assert.equal(stockEdits,1);
});
