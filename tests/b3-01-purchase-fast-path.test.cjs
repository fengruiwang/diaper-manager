const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Ops=require('../sync/primary-cloud-operations.js');
const Business=require('../sync/primary-business-commands.js');
const Runner=require('../sync/inventory-outbox-runner.js');
const Client=require('../sync/cloudbase-inventory-client.js');
const Contract=require('../sync/outbox-contract.js');
const Projection=require('../sync/inventory-local-projection.js');
const UI=require('../sync/primary-formal-ui-actions.js');
const Docs=require('../sync/primary-documents-overlay.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const SIZES=['NB','S','M','L','XL','XXL'];
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const controllerSource=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal-controller.js'),'utf8');
const ackStart=controllerSource.indexOf('onPurchaseAck:async(ack)=>{');
const ackEnd=controllerSource.indexOf('onPurchaseReadback:',ackStart);
assert.ok(ackStart>0&&ackEnd>ackStart,'real formal purchase ACK callback');
function fixture({fromQuote=false,unknownAck=false,delayed=false}={}){
 let stock={NB:80,S:140,M:0,L:0,XL:0,XXL:0};
 let revisions={NB:1,S:2,M:0,L:0,XL:0,XXL:0};
 const server={inventory:clone(stock),revisions:clone(revisions)};
 const scope={familyId:F,actorUid:'A',childId:C};
 const trace=[],rows=new Map(),renders=[],notices=[];
 let readback=0,uuidCount=0;
 let resolveRpc=null;
 const gate=delayed?new Promise(resolve=>{resolveRpc=resolve;}):null;
 const app={
  auth:{getSession:async()=>({data:{session:{user:{id:'A'}}}})},
  rdb:()=>({
   rpc:async(name,arg)=>{
    trace.push('rpc.'+name);
    assert.equal(name,'xb_apply_inventory_operation');
    assert.equal(arg.p_family_id,F);
    assert.equal(arg.p_child_id,C);
    assert.equal(arg.p_kind,'buy');
    assert.equal(arg.p_operation_id,ID);
    assert.equal(arg.p_amount,60);
    assert.equal(arg.p_size,'S');
    assert.deepEqual(arg.p_purchase,{
     brand:'好奇',series:'小森林',total_fen:12995,
     purchase_date:'2026-11-12'
    });
    if(gate)await gate;
    server.inventory.S+=60;
    server.revisions.S++;
    if(unknownAck)throw Error('NETWORK_ERROR');
    return {data:{accepted:true,operation_id:ID,child_id:C,
     size:'S',result_quantity:server.inventory.S,
     result_revision:server.revisions.S,duplicate:false}};
   },
   from(){throw Error('unexpected inventory SQL SELECT');}
  })
 };
 const currentCtx={app,familyId:F,actorUid:'A'};
 const controller={verifiedContext:()=>currentCtx};
 let local=Projection.createSnapshot({...scope,inventory:stock,
  serverRevisions:revisions,source:'verified-server'});
 const store={
  async initializeInventory(){throw Error('unexpected inventory init');},
  async readInventory(){trace.push('idb.readInventory');return clone(local);},
  async commitInventory(_scope,op){
   trace.push('idb.commitInventory');
   if(rows.has(op.id))return {duplicate:true,operation:rows.get(op.id)};
   local=Projection.apply(local,op);
   rows.set(op.id,Contract.createOperation(op));
   return {duplicate:false,operation:rows.get(op.id)};
  },
  async ready(){trace.push('idb.ready');
   return [...rows.values()].filter(x=>['pending','retry'].includes(x.status));},
  async stats(){trace.push('idb.stats');
   const items=[...rows.values()];
   return {outstanding:items.filter(x=>x.status!=='acked').length,
    total:items.length,pending:items.filter(x=>x.status==='pending').length,
    conflict:0,blocked:0,retry:0};
  },
  async recordResult(_scope,id,result){
   trace.push('idb.ack');
   rows.set(id,Contract.applyResult(rows.get(id),result));
  }
 };
 const primary=Ops.create({
  controller,host:{indexedDB:{open(){}},navigator:{onLine:true}},
  accessPreflight:{create:()=>({verifyAccess:async()=>({
   member:true,appCode:'xb',familyId:F,actorUid:'A'
  })})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>({
   familyId:F,childId:C,readyForMigration:false
  })})},
  scopeGuard:{requireLegacyMigrationTarget(){}},
  legacyHistoryReader:{create:()=>({readSettings:async()=>({
   complete:true,canEdit:false,canUpload:false
  })})},
  inventoryClient:Client,outboxFactory:{create:()=>store},
  outboxContract:Contract,inventoryProjection:Projection,
  inventoryReconciler:{build(){}},
  runnerFactory:Runner,syncFactory:{create(){throw Error('unexpected reconcile');}},
  cloudWritesEnabled:true,purchaseOnly:true,
  allowConsume:false,allowReverse:false,allowStocktake:false
 });
 const base={
  status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  canWrite:false,...scope,
  state:{
   inventory:clone(stock),
   transactions:[{id:'legacy:old',origin:'legacy_migration',
    type:'buy',size:'NB',pieces:20,price:40}],
   quotes:[],weightRecords:[],referenceOverrides:{},
   babyProfile:{name:'小宝'},dueDate:'2027-01-08',
   target:{NB:90,S:150,M:80,L:50,XL:20,XXL:10},
   daily:{NB:8,S:8,M:7,L:6,XL:5,XXL:4}
  },
  revisions:clone(revisions),historyCount:1
 };
 const doc=(kind,body,revision=1)=>({
  status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind,
  familyId:F,actorUid:'A',childId:C,revision,body
 });
 const snapshot={status:'PRIMARY_DOCUMENTS_FULLY_READ',documents:{
  reference:doc('reference',{referenceOverrides:{'好奇|小森林|S':1.25}}),
  quotes:doc('quotes',{items:[{
   id:'candidate',brand:'好奇',series:'小森林',
   size:'S',per:30,packs:2,pieces:60,price:129.95,unit:2.16583333
  }]}),
  growth:doc('growth',{items:[]}),
  profile:doc('profile',{babyProfile:{name:'小宝'},dueDate:'2027-01-08'}),
  settings:doc('settings',{currentSize:'S',sizeMode:'manual',goalPrice:1.5,
   target:{NB:90,S:150,M:80,L:50,XL:20,XXL:10},
   daily:{NB:8,S:8,M:7,L:6,XL:5,XXL:4}})
 }};
 const env={
  ctx:{actorUid:'A',familyId:F},controller,primary,
  actor:'A',family:F,mode:'ready',identityEpoch:1,documentEpoch:1,
  primaryViewBase:base,shownStock:{inventory:clone(stock),revisions:clone(revisions)},
  documentSnapshot:snapshot,documentScope:'A\x00'+F,
  documentsOverlay:Docs,
  showCloudView(view){trace.push('ui.show');renders.push(view);}
 };
 const onPurchaseAck=vm.runInNewContext('('+controllerSource.slice(
  ackStart+'onPurchaseAck:'.length,ackEnd).trim().replace(/,\s*$/,'')+')',env);
 const commands=Business.create({primary,
  uuid:()=>{uuidCount++;return ID;},
  clock:()=> '2026-11-12T08:30:00.000Z'});
 const purchase={brand:'好奇',series:'小森林',size:'S',pieces:60,price:129.95};
 const ui=UI.create({
  primary,commands,readPurchase:()=>clone(purchase),
  readQuote:id=>id==='candidate'?clone(purchase):null,
  readTransaction:()=>null,
  readPurchaseBaseline:()=>({
   status:'PRIMARY_PURCHASE_BASELINE_VERIFIED',...scope,
   inventory:clone(env.primaryViewBase.state.inventory),
   revisions:clone(env.shownStock.revisions)
  }),
  onPurchaseAck,onPurchaseReadback:async()=>{readback++;return 'pending';},
  notify:a=>notices.push(a),formalModeSelected:()=>true,
  buildAllowsWrites:true,operatorApproved:()=>true,
  buildAllowsDocumentWrites:true,documentOperatorApproved:()=>true,
  purchaseOnly:true,allowConsume:false,allowReverse:false,
  allowStocktake:false,allowReference:true,allowQuotes:true,
  allowGrowth:true,allowProfile:true,allowSettings:true
 });
 const buttons={
  buyNow:{id:'buyNow',dataset:{},textContent:'已购买 · 立即入库',
   disabled:false,classList:{contains:()=>false},closest(){return this;}},
  candidate:{id:'',dataset:{action:'buyquote',id:'candidate'},
   textContent:'入库',disabled:false,classList:{contains:()=>false},
   closest(){return this;}}
 };
 const feedback={
  formalCompareActionFeedback:{textContent:''},
  formalQuotePurchaseFeedback:{textContent:''}
 };
 const handlers={};
 const dom={
  addEventListener:(event,fn)=>{handlers[event]=fn;},
  removeEventListener(){},
  getElementById:id=>id==='quoteList'?{
    querySelectorAll:()=>[buttons.candidate]
   }:buttons[id]||feedback[id]||null
 };
 async function activate(){
  assert.equal((await primary.activate()).status,'PRIMARY_OUTBOX_READ_ONLY_READY');
 }
 return {
  activate,ui,primary,commands,env,trace,rows,server,renders,notices,
  buttons,feedback,handlers,
  click:id=>ui.handle({id:id||'',dataset:id?{}:
   {action:'buyquote',id:'candidate'}},dom),
  capture:id=>{
   if(!handlers.click)ui.attach(dom);
   const button=id==='buyNow'?buttons.buyNow:buttons.candidate;
   handlers.click({target:button,preventDefault(){},
    stopImmediatePropagation(){}});
  },
  releaseRpc:()=>resolveRpc?.(),
  get readback(){return readback;},
  get uuidCount(){return uuidCount;}
 };
}
function fast(f){
 assert.equal(f.trace.filter(x=>
  x==='rpc.xb_apply_inventory_operation').length,1);
 assert.equal(f.trace.some(x=>/reconcil|xb_read_inventory|receipt/.test(x)),false);
 assert.equal(f.trace.filter(x=>x==='ui.show').length,1);
 assert.equal(f.readback,0);
 assert.equal(f.uuidCount,1);
 assert.equal(f.rows.get(ID).status,'acked');
 assert.equal(f.env.primaryViewBase.state.inventory.S,200);
 assert.equal(f.env.primaryViewBase.revisions.S,3);
 assert.equal(f.env.shownStock.inventory.S,200);
 assert.equal(f.env.shownStock.revisions.S,3);
 assert.equal(f.env.primaryViewBase.state.transactions.filter(
  x=>x.operationId===ID).length,1);
 assert.equal(f.renders.at(-1).state.transactions.filter(
  x=>x.operationId===ID).length,1);
 assert.equal(f.renders.at(-1).state.inventory.S,200);
 assert.ok(f.trace.indexOf('idb.commitInventory')<
  f.trace.indexOf('rpc.xb_apply_inventory_operation'));
}
test('B3-01 compare-page purchase: one 009 and direct verified 009 ACK UI',async()=>{
 const f=fixture();await f.activate();
 const result=await f.click('buyNow');
 assert.equal(result.status,'PRIMARY_PURCHASE_CLOUD_ACK_APPLIED');
 fast(f);
 const row=f.env.primaryViewBase.state.transactions[0];
 assert.deepEqual({
  id:row.id,size:row.size,pieces:row.pieces,
  date:row.date,price:row.price,origin:row.origin
 },{id:'cloud:'+ID,size:'S',pieces:60,
  date:'2026-11-12',price:129.95,origin:'cloud_post_migration'});
});
test('B3-01 candidate purchase uses same 009 command, no extra buy path',async()=>{
 const f=fixture({fromQuote:true});await f.activate();
 assert.equal((await f.click('')).status,'PRIMARY_PURCHASE_CLOUD_ACK_APPLIED');
 fast(f);
});
test('B3-01 future 026 document overlays do not regress ACK stock or purchases',async()=>{
 const f=fixture();await f.activate();
 assert.equal((await f.click('buyNow')).status,'PRIMARY_PURCHASE_CLOUD_ACK_APPLIED');
 const old=f.env.documentSnapshot;
 for(const kind of ['reference','quotes','growth','profile','settings']){
  const fresh=clone(old);
  fresh.documents[kind].revision++;
  f.env.documentSnapshot=fresh;
  const view=Docs.apply(f.env.primaryViewBase,f.env.documentSnapshot);
  assert.equal(view.state.inventory.S,200,kind);
  assert.equal(view.state.transactions.filter(t=>t.operationId===ID).length,1,kind);
  assert.equal(view.state.transactions.length,2,kind);
 }
});
test('B3-01 both buttons respond immediately and second click has no duplicate UUID',async()=>{
 for(const candidate of [false,true]){
  const f=fixture({delayed:true});await f.activate();
  f.capture(candidate?'candidate':'buyNow');
  const node=candidate?f.feedback.formalQuotePurchaseFeedback:
   f.feedback.formalCompareActionFeedback;
  assert.equal(node.textContent,
   candidate?'正在将候选价入库…':'正在采购入库…');
  assert.equal(f.buttons.buyNow.disabled,true);
  assert.equal(f.buttons.candidate.disabled,true);
  f.capture(candidate?'candidate':'buyNow');
  await tick();await tick();
  f.releaseRpc();await tick();await tick();await tick();
  assert.equal(node.textContent,
   candidate?'候选商品已入库':'采购入库成功，库存已更新');
  assert.equal(f.notices.at(-1).status,'PRIMARY_PURCHASE_CLOUD_ACK_APPLIED');
  fast(f);
  assert.equal(f.buttons.buyNow.disabled,false);
  assert.equal(f.buttons.candidate.disabled,false);
 }
});
test('B3-01 lost 009 ACK preserves original UUID and never updates UI speculatively',async()=>{
 const f=fixture({unknownAck:true});await f.activate();
 const answer=await f.click('buyNow');
 assert.equal(answer.operationId,ID);
 assert.notEqual(answer.status,'PRIMARY_PURCHASE_CLOUD_ACK_APPLIED');
 assert.equal(f.uuidCount,1);
 assert.equal(f.rows.get(ID).status,'retry');
 assert.equal(f.renders.length,0);
 assert.equal(f.trace.filter(x=>x==='rpc.xb_apply_inventory_operation').length,1);
});
test('B3-01 purchase-only gate keeps consumption, reversal and all stocktakes closed',async()=>{
 const f=fixture();await f.activate();
 for(const [id,dataset] of [
  ['',{action:'consume',size:'S',count:'1'}],
  ['',{action:'deletetx',id:'some'}],
  ['saveStocks',{}]
 ]){
  const ans=await f.ui.handle({id,dataset},{getElementById:()=>null});
  assert.equal(ans.status,'FORMAL_PURCHASE_ONLY');
 }
 assert.equal(f.uuidCount,0);
 assert.equal(f.trace.some(x=>x.startsWith('rpc.')),false);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_DOCUMENT_WRITE_ENABLED,true);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,true);
});
