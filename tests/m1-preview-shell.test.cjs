const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const M=require('../preview/v1.2.0/m1-controller.js');
const html=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/index.html'),'utf8');
const controller=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/m1-controller.js'),'utf8');
function mock({session=true,stock=false}={}){
 const events=[], calls=[],storage=new Map(),view={
  status:(a,b)=>events.push(['status',a,b]),needsKey:x=>events.push(['key',x]),
  identity:x=>events.push(['identity',x]),
  family:(a,b)=>events.push(['family',a,b]),
  cloudStock:x=>events.push(['stock',x])
 };
 const family='c19a4aa8-7c24-4e0d-b8e4-c66d26ff0001';
 const child='d19a4aa8-7c24-4e0d-b8e4-c66d26ff0002';
 const host={navigator:{onLine:true},XBM1PublicConfig:{publishableKey:'public-only-example'},
  cloudbase:{init:()=>({
   auth:{getSession:async()=>({data:{session:session?{user:{id:'u1'}}:null,user:{id:'u1'}}})},
   rdb:()=>({from:()=>({select:()=>({limit:async()=>({data:[{id:family}]})})})})
  })},
  XBCloudbaseFamilyClient:{create:()=>({requestCode:async()=>{},confirmCode:async()=>{},logout:async()=>{}})},
  XBSessionRecovery:{create:()=>({restore:async()=>({status:session?'authenticated':'auth-required'})})},
  XBCloudbaseAccessPreflight:{create:()=>({verifyAccess:async()=>({member:true,appCode:'xb',initialized:false})})},
  XBCloudbaseChildReader:{create:()=>({listActiveChildren:async()=>({
    activeChildren:stock?[{id:child}]:[]
  })})},
  XBChildScopeGuard:{},
  XBInventoryClient:{create:()=>({readReconciliation:async()=>({
    complete:true,actorUid:'u1',rows:['NB','S','M','L','XL','XXL'].map((size,i)=>({
     size,quantity:i,revision:1
    }))
   })})}
 };
 const storageApi={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 return {app:M.create({host,storage:storageApi,view,scriptLoader:async()=>{}}),
  events,calls,storage};
}
test('independent UI retains original 5 tabs and major buy/stock functions',()=>{
 for(const token of ['备货总览','好价比对','采购记录','成长','个性设置',
  'function addBuy(q)','function saveStocks()','function renderHistory()',
  'function renderReferenceTable()'])assert.ok(html.includes(token),token);
});
test('preview never references or renames production v1.1.2 localStorage key',()=>{
 assert.match(html,/const KEY='xiaobao_v120_m1_local_sandbox'/);
 assert.match(html,/const ACTIVE_TAB_KEY='xiaobao_v120_m1_active_tab'/);
 assert.doesNotMatch(html,/xiaobao_diaper_planner_v1/);
 assert.doesNotMatch(html,/xiaobao_active_tab_v1/);
 assert.doesNotMatch(html,/serviceWorker\.register|<script src="\.\/pwa\.js"/);
});
test('old real backup import is blocked in preview and existing view remains local-only',()=>{
 assert.match(html,/测试版已禁止历史导入/);
 assert.match(html,/禁止将演练导出当成历史备份/);
 assert.match(html,/绝不上传云端/);
 assert.match(html,/M1-02 真实 A\/B/);
});
test('first initialization does not send OTP or purchase writes',async()=>{
 const m=mock();
 assert.equal(await m.app.connect(),'FAMILY_READY_NO_BUSINESS_CHILD');
 assert.ok(m.events.some(x=>x[0]==='family'&&x[1]===true));
 assert.ok(m.events.some(x=>x[0]==='stock'&&x[1]===null));
});
test('real read-only stock is separate from sandbox stock',async()=>{
 const m=mock({stock:true});
 assert.equal(await m.app.connect(),'CLOUD_READ_ONLY_CONNECTED');
 const row=m.events.find(x=>x[0]==='stock'&&Array.isArray(x[1]));
 assert.equal(row[1].length,6);
 assert.equal(row[1][1].quantity,1);
});
test('missing SDK login yields login required, not cloud ready',async()=>{
 const m=mock({session:false});
 assert.equal(await m.app.connect(),'LOGIN_REQUIRED');
});
test('offline session never represents local demo as synchronized',async()=>{
 const m=mock();
 m.app.savePublicKeyOnce('public-example');
 assert.equal(await m.app.connect(),'FAMILY_READY_NO_BUSINESS_CHILD');
});
test('public key is opt-in and local test only, without leaking service credentials',()=>{
 assert.equal(M.parsePublicKey('',null),'');
 assert.equal(M.parsePublicKey('abc',''),'abc');
 assert.equal(M.parsePublicKey('some key',''),'');
 assert.doesNotMatch(controller,/(service_secret|secret_key|API_SECRET_KEY)\s*[:=]\s*['"]/i);
});
test('one-time OTP field is cleared immediately on submit',()=>{
 assert.match(controller,/m1Otp'\)\.value=''/);
});
test('M1-01 controller exposes no mutation or historical migration endpoint',()=>{
 for(const bad of [
  /\.applyOperation\s*\(/, /\.enqueue\s*\(/,/\.initializeInventory\s*\(/,
  /\.importData\s*\(/,/\.insert\s*\(/,/\.upsert\s*\(/,
  /\.update\s*\(/,/\.delete\s*\(/,/\.rpc\s*\(/,/xb_create_smoke_child/,
  /xb_promote_legacy_archive|xb_stage_legacy_archive/
 ])assert.doesNotMatch(controller,bad);
 assert.match(controller,/M1-01-READ-ONLY/);
});
