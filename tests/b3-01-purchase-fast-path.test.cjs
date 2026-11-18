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
const ORIG='87e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const NEXT='57e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const SIZES=['NB','S','M','L','XL','XXL'];
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const controllerSource=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal-controller.js'),'utf8');
const ackStart=controllerSource.indexOf('onPurchaseAck:async(ack)=>{');
const ackEnd=controllerSource.indexOf('onPurchaseReadback:',ackStart);
assert.ok(ackStart>0&&ackEnd>ackStart,'real formal purchase ACK callback');
function fixture({fromQuote=false,unknownAck=false,delayed=false,
 consume=false,stockS=140,dailyS=8,useCount=1,
 reverse=false,reverseKind='buy',legacy=false,alreadyReversed=false,
 cancel=false,reject=false,remoteOnly=false,nextKind=null,
 stocktake=false,stocktakeCount=95,stocktakeConflict=false,extraChanged=null}={}){
 let stock={NB:80,S:stockS,M:0,L:0,XL:0,XXL:0};
 let revisions={NB:1,S:2,M:0,L:0,XL:0,XXL:0};
 const server={inventory:clone(stock),revisions:clone(revisions)};
 const scope={familyId:F,actorUid:'A',childId:C};
 const trace=[],rows=new Map(),renders=[],notices=[],confirmMessages=[];
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
    const next=arg.p_operation_id===NEXT;
    assert.equal(arg.p_kind,next?nextKind:stocktake?'stocktake':reverse?'reverse':consume?'use':'buy');
    assert.equal(arg.p_operation_id,next?NEXT:ID);
    assert.equal(arg.p_amount,next?(nextKind==='use'?1:10):
     stocktake?stocktakeCount:reverse?null:consume?useCount:60);
    assert.equal(arg.p_size,'S');
    if(next){
     assert.equal(arg.p_reverses_operation_id,null);
     if(nextKind==='use')assert.equal(arg.p_purchase,null);
     else assert.deepEqual(arg.p_purchase,{brand:'好奇',series:'小森林',
      total_fen:1000,purchase_date:'2026-11-12'});
    }else if(stocktake){
     assert.equal(arg.p_expected_revision,2);
     assert.equal(arg.p_purchase,null);
     assert.equal(arg.p_reverses_operation_id,null);
    }else if(reverse){
     assert.equal(arg.p_reverses_operation_id,ORIG);
     assert.equal(arg.p_purchase,null);
    }else if(consume)assert.equal(arg.p_purchase,null);
    else assert.deepEqual(arg.p_purchase,{
     brand:'好奇',series:'小森林',total_fen:12995,
     purchase_date:'2026-11-12'
    });
    if(gate)await gate;
    if(reject)return {error:{code:'23514',message:'stock out of bounds'}};
    if(stocktakeConflict)return {error:{code:'DATABASE_40001'}};
    server.inventory.S=stocktake&&!next?stocktakeCount:server.inventory.S+(next?(nextKind==='use'?-1:10):
     reverse?(reverseKind==='buy'?-60:9):
     consume?-arg.p_amount:60);
    server.revisions.S++;
    if(unknownAck)throw Error('NETWORK_ERROR');
    return {data:{accepted:true,operation_id:ID,child_id:C,
     size:'S',result_quantity:server.inventory.S,
     result_revision:server.revisions.S,duplicate:false,
     ...(next?{operation_id:NEXT}:{})}};
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
  async enqueue(op){
   trace.push('idb.enqueue');
   if(rows.has(op.id))return rows.get(op.id);
   const stored=Contract.createOperation(op);
   rows.set(op.id,stored);return stored;
  },
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
   return {outstanding:items.filter(x=>x.status!=='acked'&&x.status!=='abandoned').length,
    total:items.length,pending:items.filter(x=>x.status==='pending').length,
    conflict:0,blocked:0,retry:0};
  },
  async recordResult(_scope,id,result){
   trace.push('idb.ack');
   rows.set(id,Contract.applyResult(rows.get(id),result));
  },
  async abandonSingleStocktakeConflict(_scope,id){
   trace.push('idb.abandonStocktakeCAS');
   const op=rows.get(id);
   assert.equal(op.type,'inventory.count');
   assert.equal(op.status,'pending');
   rows.set(id,{...op,status:'abandoned',error:'stocktake_revision_conflict'});
  },
  async recordStocktakeAck(_scope,id,receipt){
   trace.push('idb.stocktakeAck');
   assert.equal(rows.get(id).type,'inventory.count');
   rows.set(id,Contract.applyResult(rows.get(id),{
    kind:'accepted',receiptId:id}));
   local={...local,inventory:{...local.inventory,
    [receipt.size]:receipt.quantity},serverRevisions:{
     ...local.serverRevisions,[receipt.size]:receipt.revision}};
  },
  async recordReverseAck(_scope,id,receipt){
   trace.push('idb.reverseAck');
   assert.equal(rows.get(id).type,'transaction.reverse');
   rows.set(id,Contract.applyResult(rows.get(id),{
    kind:'accepted',receiptId:id}));
   local={...local,inventory:{...local.inventory,
    [receipt.size]:receipt.quantity},serverRevisions:{
     ...local.serverRevisions,[receipt.size]:receipt.revision}};
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
  allowConsume:consume||nextKind==='use',allowReverse:reverse,allowStocktake:stocktake
 });
 const base={
  status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  canWrite:false,...scope,
  state:{
   inventory:clone(stock),
   transactions:[
    ...(reverse?[{
     id:legacy?'legacy:remote':('cloud:'+ORIG),
     origin:legacy?'legacy_migration':'cloud_post_migration',
     operationId:legacy?null:ORIG,
     type:reverseKind,size:'S',pieces:reverseKind==='buy'?60:9,
     price:reverseKind==='buy'?129.95:0,
     date:'2026-11-12',brand:'好奇',series:'小森林',
     reversed:alreadyReversed,
     reversedByOperationId:alreadyReversed?ID:null
    }]:[]),
    {id:'legacy:old',origin:'legacy_migration',
     type:'buy',size:'NB',pieces:20,price:40}],
   quotes:[],weightRecords:[],referenceOverrides:{},
   babyProfile:{name:'小宝'},dueDate:'2027-01-08',
   target:{NB:90,S:150,M:80,L:50,XL:20,XXL:10},
   daily:{NB:8,S:dailyS,M:7,L:6,XL:5,XXL:4}
  },
  revisions:clone(revisions),historyCount:reverse?2:1
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
   daily:{NB:8,S:dailyS,M:7,L:6,XL:5,XXL:4}})
 }};
 const env={
  ctx:{actorUid:'A',familyId:F},controller,primary,SIZES,
  root:{XBPrimaryBusinessDate:require('../sync/primary-business-date.js')},
  actor:'A',family:F,mode:'ready',identityEpoch:1,documentEpoch:1,
  primaryViewBase:base,shownStock:{inventory:clone(stock),revisions:clone(revisions)},
  documentSnapshot:snapshot,documentScope:'A\x00'+F,
  documentsOverlay:Docs,
  showCloudView(view){trace.push('ui.show');renders.push(view);}
 };
 const onPurchaseAck=vm.runInNewContext('('+controllerSource.slice(
  ackStart+'onPurchaseAck:'.length,ackEnd).trim().replace(/,\s*$/,'')+')',env);
 const consumeStart=controllerSource.indexOf('readConsumeBaseline:()=>{');
 const consumeEnd=controllerSource.indexOf('readReverseBaseline:record=>',consumeStart);
 const readConsumeBaseline=consumeStart<0?null:vm.runInNewContext('('+
  controllerSource.slice(consumeStart+'readConsumeBaseline:'.length,
   consumeEnd).trim().replace(/,\s*$/,'')+')',env);
 const reverseStart=controllerSource.indexOf('readReverseBaseline:record=>');
 const readReverseBaseline=reverseStart<0?null:vm.runInNewContext('('+
  controllerSource.slice(reverseStart+'readReverseBaseline:'.length,
   ackStart).trim().replace(/,\s*confirmReverse:.*$/s,'').replace(/,\s*$/,'')+')',env);
 const commands=Business.create({primary,
  uuid:()=>{uuidCount++;return ID;},
  clock:()=> '2026-11-12T08:30:00.000Z'});
 const purchase={brand:'好奇',series:'小森林',size:'S',pieces:60,price:129.95};
 const ui=UI.create({
  primary,commands,readPurchase:()=>clone(purchase),
  readQuote:id=>id==='candidate'?clone(purchase):null,
  readTransaction:id=>reverse
   ?env.primaryViewBase.state.transactions.find(t=>t.id===id)||null:null,
  readPurchaseBaseline:()=>({
   status:'PRIMARY_PURCHASE_BASELINE_VERIFIED',...scope,
   inventory:clone(env.primaryViewBase.state.inventory),
   revisions:clone(env.shownStock.revisions)
  }),
  readConsumeBaseline:consume?readConsumeBaseline:null,
  readReverseBaseline:reverse?readReverseBaseline:null,
  readStocktakeBaseline:stocktake?()=>({
   ...scope,inventory:clone(env.shownStock.inventory),
   revisions:clone(env.shownStock.revisions)}):null,
  confirmReverse:record=>{
   confirmMessages.push(record.type==='buy'
    ?'确认撤销这条采购记录吗？库存将相应调整。'
    :'确认撤销这条消耗记录吗？库存将相应调整。');
   return !cancel;
  },
  onPurchaseAck,onPurchaseReadback:async()=>{readback++;return 'pending';},
  notify:a=>notices.push(a),formalModeSelected:()=>true,
  buildAllowsWrites:true,operatorApproved:()=>true,
  buildAllowsDocumentWrites:true,documentOperatorApproved:()=>true,
  purchaseOnly:true,allowConsume:consume||nextKind==='use',allowReverse:reverse,
  allowStocktake:stocktake,allowReference:true,allowQuotes:true,
  allowGrowth:true,allowProfile:true,allowSettings:true
 });
 const buttons={
  buyNow:{id:'buyNow',dataset:{},textContent:'已购买 · 立即入库',
   disabled:false,classList:{contains:()=>false},closest(){return this;}},
  candidate:{id:'',dataset:{action:'buyquote',id:'candidate'},
   textContent:'入库',disabled:false,classList:{contains:()=>false},
   closest(){return this;}},
  consumeOne:{id:'',dataset:{action:'consume',size:'S',count:'1'},
   textContent:'− 用 1 片',disabled:stockS===0,
   classList:{contains:()=>false},closest(){return this;}},
  consumeDay:{id:'',dataset:{action:'consume',size:'S',
   count:String(Math.min(stockS,Math.round(dailyS)))},
   textContent:'− 记 1 天',disabled:stockS===0,
   classList:{contains:()=>false},closest(){return this;}},
  stocktake:{id:'saveStocks',dataset:{},textContent:'保存实际库存',
   disabled:false,classList:{contains:()=>false},closest(){return this;}},
  reverse:{id:'',dataset:{action:'deletetx',
   id:legacy?'legacy:remote':'cloud:'+ORIG},
   textContent:'撤销',disabled:alreadyReversed,
   classList:{contains:()=>false},closest(){return this;}}
 };
 const feedback={
  formalCompareActionFeedback:{textContent:''},
  formalQuotePurchaseFeedback:{textContent:''},
  formalConsumeActionFeedback:{textContent:''},
  formalReverseActionFeedback:{textContent:''},
  formalStocktakeActionFeedback:{textContent:''}
 };
 const handlers={};
 const dom={
  addEventListener:(event,fn)=>{handlers[event]=fn;},
  removeEventListener(){},
  getElementById:id=>id.startsWith('inv_')?{
    value:String(id==='inv_S'?stocktakeCount:
     extraChanged&&Object.prototype.hasOwnProperty.call(extraChanged,id.slice(4))
      ?extraChanged[id.slice(4)]:stock[id.slice(4)])
   }:id==='quoteList'?{
    querySelectorAll:()=>[buttons.candidate]
   }:id==='sizeCards'?{
    querySelectorAll:()=>[buttons.consumeOne,buttons.consumeDay]
   }:id==='historyList'?{
    querySelectorAll:()=>[buttons.reverse]
   }:buttons[id]||feedback[id]||null
 };
 async function activate(){
  assert.equal((await primary.activate()).status,'PRIMARY_OUTBOX_READ_ONLY_READY');
 }
 return {
  activate,ui,primary,commands,env,trace,rows,server,renders,notices,
  confirmMessages,
  buttons,feedback,handlers,
  click:id=>ui.handle({id:id||'',dataset:id?{}:
   {action:'buyquote',id:'candidate'}},dom),
  consumeClick:mode=>ui.handle(mode==='day'?buttons.consumeDay:buttons.consumeOne,dom),
  reverseClick:()=>ui.handle(buttons.reverse,dom),
  stocktakeClick:()=>ui.handle(buttons.stocktake,dom),
  capture:id=>{
   if(!handlers.click)ui.attach(dom);
   const button=id==='buyNow'?buttons.buyNow:
    id==='consumeOne'?buttons.consumeOne:
    id==='consumeDay'?buttons.consumeDay:
    id==='reverse'?buttons.reverse:
    id==='stocktake'?buttons.stocktake:buttons.candidate;
   handlers.click({target:button,preventDefault(){},
    stopImmediatePropagation(){}});
  },
  releaseRpc:()=>resolveRpc?.(),
  get readback(){return readback;},
  get uuidCount(){return uuidCount;},
  get localSnapshot(){return clone(local);},
  get localSnapshot(){return clone(local);}
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

function fastUse(f,count,remaining){
 assert.equal(f.trace.filter(x=>x==='rpc.xb_apply_inventory_operation').length,1);
 assert.equal(f.trace.some(x=>x.startsWith('rpc.xb_read_')),false);
 assert.equal(f.trace.filter(x=>x==='ui.show').length,1);
 assert.equal(f.readback,0);
 assert.equal(f.uuidCount,1);
 assert.equal(f.rows.get(ID).status,'acked');
 assert.equal(f.env.primaryViewBase.state.inventory.S,remaining);
 assert.equal(f.env.primaryViewBase.revisions.S,3);
 assert.equal(f.env.shownStock.inventory.S,remaining);
 assert.equal(f.env.shownStock.revisions.S,3);
 assert.equal(f.env.primaryViewBase.historyCount,2);
 assert.equal(f.env.primaryViewBase.state.transactions.filter(t=>t.operationId===ID).length,1);
 const row=f.env.primaryViewBase.state.transactions[0];
 assert.equal(row.type,'use');
 assert.equal(row.price,0);
 assert.equal(row.pieces,count);
 assert.equal(row.size,'S');
 assert.equal(row.id,'cloud:'+ID);
 assert.equal(row.origin,'cloud_post_migration');
 assert.equal(row.occurredAt,'2026-11-12T08:30:00.000Z');
 assert.equal(row.date,'2026-11-12');
 assert.equal(f.renders.at(-1).state.inventory.S,remaining);
 assert.equal(f.renders.at(-1).state.transactions.filter(t=>t.type==='buy')
  .reduce((n,t)=>n+t.price,0),40);
 assert.ok(f.trace.indexOf('idb.commitInventory')<
  f.trace.indexOf('rpc.xb_apply_inventory_operation'));
}
test('B3-02 use one: one 009, ACK updates inventory and use history',async()=>{
 const f=fixture({consume:true,useCount:1});await f.activate();
 const a=await f.consumeClick('one');
 assert.equal(a.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 fastUse(f,1,139);
});
test('B3-02 one day reads current settings daily rather than stale button count',async()=>{
 const f=fixture({consume:true,dailyS:9,useCount:9});await f.activate();
 f.buttons.consumeDay.dataset.count='1';
 assert.equal((await f.consumeClick('day')).status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 fastUse(f,9,131);
});
test('B3-02 daily 9 with only five pieces consumes all five',async()=>{
 const f=fixture({consume:true,stockS:5,dailyS:9,useCount:5});await f.activate();
 assert.equal((await f.consumeClick('day')).status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 fastUse(f,5,0);
});
test('B3-02 stock 0 rejects both buttons before UUID and 009 RPC',async()=>{
 const f=fixture({consume:true,stockS:0,dailyS:9});await f.activate();
 for(const mode of ['one','day'])
  assert.equal((await f.consumeClick(mode)).status,'PRIMARY_INSUFFICIENT_STOCK');
 assert.equal(f.uuidCount,0);
 assert.equal(f.rows.size,0);
 assert.equal(f.trace.filter(x=>x.startsWith('rpc.')).length,0);
 assert.equal(f.renders.length,0);
});
test('B3-02 after use ACK, each following 026 overlay preserves use and stock',async()=>{
 const f=fixture({consume:true,dailyS:9,useCount:9});await f.activate();
 assert.equal((await f.consumeClick('day')).status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 for(const kind of ['reference','quotes','growth','profile','settings']){
  const snapshot=clone(f.env.documentSnapshot);
  snapshot.documents[kind].revision++;
  f.env.documentSnapshot=snapshot;
  const view=Docs.apply(f.env.primaryViewBase,snapshot);
  assert.equal(view.state.inventory.S,131,kind);
  assert.equal(view.state.transactions.filter(t=>t.operationId===ID).length,1,kind);
  assert.equal(view.state.transactions.filter(t=>t.type==='buy').length,1,kind);
  assert.equal(view.state.transactions.find(t=>t.type==='use').price,0,kind);
 }
});
test('B3-02 instant per-card feedback and double tap retain single UUID',async()=>{
 for(const mode of ['consumeOne','consumeDay']){
  const day=mode==='consumeDay';
  const f=fixture({consume:true,delayed:true,dailyS:9,
   useCount:day?9:1});await f.activate();
  f.capture(mode);
  assert.equal(f.feedback.formalConsumeActionFeedback.textContent,
   day?'正在记录今日消耗…':'正在记录消耗 1 片…');
  assert.equal(f.buttons.consumeOne.disabled,true);
  assert.equal(f.buttons.consumeDay.disabled,true);
  assert.equal(f.buttons.buyNow.disabled,false);
  f.capture(mode);
  await tick();await tick();
  f.releaseRpc();await tick();await tick();await tick();
  assert.equal(f.feedback.formalConsumeActionFeedback.textContent,
   day?'今日消耗已记录，库存已更新':'已消耗 1 片，库存已更新');
  assert.equal(f.notices.at(-1).status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
  fastUse(f,day?9:1,day?131:139);
  assert.equal(f.buttons.consumeOne.disabled,false);
  assert.equal(f.buttons.consumeDay.disabled,false);
 }
});
test('B3-02 ambiguous use ACK retains original UUID and unchanged visible stock',async()=>{
 const f=fixture({consume:true,unknownAck:true});await f.activate();
 const ans=await f.consumeClick('one');
 assert.equal(ans.operationId,ID);
 assert.notEqual(ans.status,'PRIMARY_USE_CLOUD_ACK_APPLIED');
 assert.equal(f.rows.get(ID).status,'retry');
 assert.equal(f.uuidCount,1);
 assert.equal(f.renders.length,0);
 assert.equal(f.env.primaryViewBase.state.inventory.S,140);
 assert.equal(f.trace.filter(x=>x==='rpc.xb_apply_inventory_operation').length,1);
});
test('B3-02 use release keeps reverse and stocktake disabled',async()=>{
 const f=fixture({consume:true});await f.activate();
 for(const [id,dataset] of [
  ['',{action:'deletetx',id:'some'}],['saveStocks',{}]
 ]){
  const ans=await f.ui.handle({id,dataset},{getElementById:()=>null});
  assert.equal(ans.status,'FORMAL_PURCHASE_ONLY');
 }
 assert.equal(f.uuidCount,0);
 assert.equal(f.trace.filter(x=>x.startsWith('rpc.')).length,0);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_DOCUMENT_WRITE_ENABLED,true);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,true);
});

test('B3-02 pending use can reuse the existing manual UUID recovery control',()=>{
 const formal=require('node:fs').readFileSync(require('node:path').join(
  __dirname,'../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.ok(formal.includes("recoverMinimalButtons?.({domain:'consume'})"));
 assert.ok(formal.includes("recoverMinimalButtons?.({domain:'purchase'})"));
});

function fastReverse(f,{remaining,kind}){
 const rpc=f.trace.filter(x=>x==='rpc.xb_apply_inventory_operation');
 assert.equal(rpc.length,1);
 assert.equal(f.trace.some(x=>x.startsWith('rpc.xb_read_')),false);
 assert.equal(f.trace.filter(x=>x==='ui.show').length,1);
 assert.equal(f.readback,0);
 assert.equal(f.uuidCount,1);
 assert.equal(f.rows.get(ID).status,'acked');
 assert.equal(f.rows.get(ID).type,'transaction.reverse');
 assert.equal(f.rows.get(ID).payload.reversesOperationId,ORIG);
 assert.equal(f.env.primaryViewBase.state.inventory.S,remaining);
 assert.equal(f.env.primaryViewBase.revisions.S,3);
 assert.equal(f.env.shownStock.inventory.S,remaining);
 assert.equal(f.env.shownStock.revisions.S,3);
 assert.equal(f.env.primaryViewBase.historyCount,2);
 const actual=f.env.primaryViewBase.state.transactions;
 assert.equal(actual.length,2);
 assert.equal(actual.filter(t=>t.operationId===ORIG).length,1);
 assert.equal(actual.filter(t=>t.operationId===ID).length,0);
 const original=actual.find(t=>t.operationId===ORIG);
 assert.equal(original.reversed,true);
 assert.equal(original.reversedByOperationId,ID);
 assert.equal(original.type,kind);
 assert.equal(f.renders.at(-1).state.inventory.S,remaining);
 assert.equal(f.renders.at(-1).state.transactions.find(t=>
  t.operationId===ORIG).reversedByOperationId,ID);
 // The original on another device is absent from local IDB history.
 assert.ok(f.trace.includes('idb.enqueue'));
 assert.ok(!f.trace.includes('idb.commitInventory'));
 assert.ok(f.trace.indexOf('idb.enqueue')<f.trace.indexOf(
  'rpc.xb_apply_inventory_operation'));
}

for(const count of [95,0]){
 test('B4-01 single S stocktake 80 -> '+count+' uses one 009 and syncs IDB',
  async()=>{
   const f=fixture({stocktake:true,stockS:80,stocktakeCount:count});
   await f.activate();
   const ans=await f.stocktakeClick();
   assert.equal(ans.status,'PRIMARY_STOCKTAKE_CLOUD_ACK_APPLIED');
   assert.equal(f.trace.filter(x=>x==='rpc.xb_apply_inventory_operation').length,1);
   assert.equal(f.trace.filter(x=>x==='idb.stocktakeAck').length,1);
   assert.ok(f.trace.indexOf('idb.enqueue')<
    f.trace.indexOf('rpc.xb_apply_inventory_operation'));
   assert.equal(f.trace.includes('idb.commitInventory'),false);
   assert.equal(f.trace.some(x=>/reconcil|xb_read_inventory/.test(x)),false);
   assert.equal(f.env.primaryViewBase.state.inventory.S,count);
   assert.equal(f.env.shownStock.inventory.S,count);
   assert.equal(f.env.primaryViewBase.revisions.S,3);
   assert.equal(f.localSnapshot.inventory.S,count);
   assert.equal(f.localSnapshot.serverRevisions.S,3);
   assert.equal(f.env.primaryViewBase.state.transactions.length,1);
   assert.equal(f.rows.get(ID).status,'acked');
   assert.equal(f.rows.get(ID).expectedRevision,2);
   assert.equal(f.rows.get(ID).payload.count,count);
   assert.equal(f.uuidCount,1);
   assert.equal(f.readback,0);
   for(const kind of ['reference','quotes','growth','profile','settings']){
    const docs=clone(f.env.documentSnapshot);docs.documents[kind].revision++;
    const view=Docs.apply(f.env.primaryViewBase,docs);
    assert.equal(view.state.inventory.S,count,kind);
   }
  });
}
test('B4-01 unchanged, invalid and multi-size edits never write or allocate UUID',async()=>{
 for(const count of [80,-1,1.5,100001,'text']){
  const f=fixture({stocktake:true,stockS:80,stocktakeCount:count});
  await f.activate();
  const ans=await f.stocktakeClick();
  assert.equal(ans.status,count===80?'PRIMARY_STOCK_UNCHANGED':'STOCK_FORM_INVALID');
  assert.equal(f.uuidCount,0);
  assert.equal(f.rows.size,0);
  assert.equal(f.trace.some(x=>x.startsWith('rpc.')),false);
 }
 const f=fixture({stocktake:true,stockS:80,stocktakeCount:95,
  extraChanged:{M:20}});
 await f.activate();
 assert.equal((await f.stocktakeClick()).status,'MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED');
 assert.equal(f.uuidCount,0);assert.equal(f.rows.size,0);
 assert.equal(f.trace.some(x=>x.startsWith('rpc.')),false);
});
test('B4-01 saveStocks displays immediate feedback and double click keeps one UUID',
 async()=>{
  const f=fixture({stocktake:true,delayed:true,stockS:80,stocktakeCount:95});
  await f.activate();
  f.capture('stocktake');
  assert.equal(f.feedback.formalStocktakeActionFeedback.textContent,
   '正在保存库存盘点…');
  assert.equal(f.buttons.stocktake.disabled,true);
  assert.equal(f.buttons.buyNow.disabled,false);
  f.capture('stocktake');
  await tick();await tick();
  f.releaseRpc();
  await tick();await tick();await tick();
  assert.equal(f.feedback.formalStocktakeActionFeedback.textContent,
   '库存盘点成功，库存已更新');
  assert.equal(f.notices.at(-1)?.status,'PRIMARY_STOCKTAKE_CLOUD_ACK_APPLIED');
  assert.equal(f.uuidCount,1);
  assert.equal(f.rows.size,1);
  assert.equal(f.trace.filter(x=>x==='rpc.xb_apply_inventory_operation').length,1);
  assert.equal(f.buttons.stocktake.disabled,false);
 });
test('B4-01 unknown ACK holds stocktake button and original UUID',async()=>{
 const f=fixture({stocktake:true,unknownAck:true,stockS:80,stocktakeCount:95});
 await f.activate();
 f.capture('stocktake');
 await tick();await tick();await tick();
 assert.equal(f.feedback.formalStocktakeActionFeedback.textContent,
  '盘点结果待核验，原请求已保留，请勿重复提交');
 assert.equal(f.buttons.stocktake.disabled,true);
 f.capture('stocktake');
 await tick();
 assert.equal(f.uuidCount,1);
 assert.equal(f.rows.size,1);
 assert.equal(f.rows.get(ID).status,'retry');
 assert.equal(f.env.primaryViewBase.state.inventory.S,80);
 assert.equal(f.trace.filter(x=>x==='rpc.xb_apply_inventory_operation').length,1);
});
test('B4-01 manual recovery includes stocktake domain and original CAS metadata',()=>{
 const controller=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 const actions=fs.readFileSync(path.join(__dirname,
  '../sync/primary-formal-ui-actions.js'),'utf8');
 assert.ok(controller.includes("recoverMinimalButtons?.({domain:'stocktake'})"));
 assert.ok(actions.includes('expectedRevision:answer?.expectedRevision'));
});
test('B4-01 CAS conflict and ambiguous 009 preserve stock and original UUID',async()=>{
 const conflict=fixture({stocktake:true,stockS:80,stocktakeCount:95,
  stocktakeConflict:true});
 await conflict.activate();
 const denied=await conflict.stocktakeClick();
 assert.equal(denied.status,'PRIMARY_STOCK_REVISION_CONFLICT');
 assert.equal(conflict.env.primaryViewBase.state.inventory.S,80);
 assert.equal(conflict.renders.length,0);
 assert.equal(conflict.rows.get(ID).status,'abandoned');
 assert.equal(conflict.trace.filter(x=>x==='idb.abandonStocktakeCAS').length,1);
 const newOp=Contract.createOperation({
  id:NEXT,type:'inventory.count',familyId:F,actorUid:'A',
  expectedRevision:2,createdAt:'2026-11-12T08:31:00.000Z',
  payload:{childId:C,size:'S',count:96,occurredAt:'2026-11-12T08:31:00.000Z'}
 });
 const newQueued=await conflict.primary.queue(newOp,{operatorApproved:true,
  verifiedStocktakeBaseline:{status:'PRIMARY_STOCKTAKE_BASELINE_VERIFIED',
   familyId:F,actorUid:'A',childId:C,
   inventory:clone(conflict.env.primaryViewBase.state.inventory),
   revisions:clone(conflict.env.shownStock.revisions)}});
 assert.equal(newQueued.status,'PRIMARY_OPERATION_DURABLY_QUEUED');
 const unknown=fixture({stocktake:true,stockS:80,stocktakeCount:95,
  unknownAck:true});
 await unknown.activate();
 const uncertain=await unknown.stocktakeClick();
 assert.equal(uncertain.operationId,ID);
 assert.notEqual(uncertain.status,'PRIMARY_STOCKTAKE_CLOUD_ACK_APPLIED');
 assert.equal(unknown.rows.get(ID).status,'retry');
 assert.equal(unknown.localSnapshot.inventory.S,80);
 assert.equal(unknown.env.primaryViewBase.state.inventory.S,80);
 assert.equal(unknown.uuidCount,1);
});
for(const nextKind of ['buy','use']){
 test('B4-01 stocktake then immediate '+nextKind+' continues fast 009',async()=>{
  const f=fixture({stocktake:true,stockS:80,stocktakeCount:95,nextKind});
  await f.activate();
  assert.equal((await f.stocktakeClick()).status,'PRIMARY_STOCKTAKE_CLOUD_ACK_APPLIED');
  const op=Contract.createOperation({
   id:NEXT,type:'inventory.delta',familyId:F,actorUid:'A',
   createdAt:'2026-11-12T08:31:00.000Z',
   payload:{childId:C,size:'S',kind:nextKind,
    amount:nextKind==='use'?1:10,
    occurredAt:'2026-11-12T08:31:00.000Z',
    ...(nextKind==='buy'?{purchase:{brand:'好奇',series:'小森林',
     totalFen:1000,purchaseDate:'2026-11-12'}}:{})}
  });
  const baseline={status:nextKind==='buy'
   ?'PRIMARY_PURCHASE_BASELINE_VERIFIED':'PRIMARY_CONSUME_BASELINE_VERIFIED',
   familyId:F,actorUid:'A',childId:C,
   inventory:clone(f.env.primaryViewBase.state.inventory),
   revisions:clone(f.env.shownStock.revisions)};
  const queued=await f.primary.queue(op,{operatorApproved:true,
   ...(nextKind==='buy'
    ?{verifiedPurchaseBaseline:baseline}:{verifiedConsumeBaseline:baseline})});
  assert.equal(queued.status,'PRIMARY_OPERATION_DURABLY_QUEUED');
  const sent=await f.primary.flush({operatorApproved:true,
   ...(nextKind==='buy'?{fastPurchaseId:NEXT}:{fastConsumeId:NEXT})});
  assert.equal(sent.status,nextKind==='buy'
   ?'PRIMARY_PURCHASE_ACK_CONFIRMED':'PRIMARY_USE_ACK_CONFIRMED');
  assert.equal(f.trace.filter(x=>x==='rpc.xb_apply_inventory_operation').length,2);
  assert.equal(f.trace.some(x=>/reconcil|xb_read_inventory/.test(x)),false);
 });
}
test('B3-03 reverse cloud purchase: one 009 and immediate stock/history ACK',async()=>{
 const f=fixture({reverse:true,reverseKind:'buy',remoteOnly:true});await f.activate();
 const ans=await f.reverseClick();
 assert.equal(ans.status,'PRIMARY_REVERSE_CLOUD_ACK_APPLIED');
 fastReverse(f,{kind:'buy',remaining:80});
 assert.equal(f.confirmMessages[0],
  '确认撤销这条采购记录吗？库存将相应调整。');
 const validBuys=f.renders.at(-1).state.transactions.filter(t=>
  t.type==='buy'&&!t.reversed);
 assert.equal(validBuys.reduce((n,t)=>n+t.price,0),40);
 assert.equal(validBuys.reduce((n,t)=>n+t.pieces,0),20);
});
test('B3-03 reverse use: restore server stock and original use status',async()=>{
 const f=fixture({reverse:true,reverseKind:'use',stockS:71});await f.activate();
 assert.equal((await f.reverseClick()).status,'PRIMARY_REVERSE_CLOUD_ACK_APPLIED');
 fastReverse(f,{kind:'use',remaining:80});
 assert.equal(f.confirmMessages[0],
  '确认撤销这条消耗记录吗？库存将相应调整。');
 assert.equal(f.renders.at(-1).state.transactions.filter(t=>
  t.type==='use'&&!t.reversed).length,0);
});

for(const [originalKind,nextKind,startingStock] of [
 ['buy','buy',140],['use','use',71]
]){
 test('B3-03 reverse '+originalKind+' then immediate '+nextKind+
  ' uses 009 without refresh',async()=>{
  const f=fixture({reverse:true,reverseKind:originalKind,
   stockS:startingStock,nextKind});
  await f.activate();
  assert.equal((await f.reverseClick()).status,'PRIMARY_REVERSE_CLOUD_ACK_APPLIED');
  assert.equal(f.localSnapshot.inventory.S,80);
  assert.equal(f.localSnapshot.serverRevisions.S,3);
  const op=Contract.createOperation({
   id:NEXT,type:'inventory.delta',familyId:F,actorUid:'A',
   createdAt:'2026-11-12T08:31:00.000Z',
   payload:{childId:C,size:'S',kind:nextKind,
    amount:nextKind==='use'?1:10,
    occurredAt:'2026-11-12T08:31:00.000Z',
    ...(nextKind==='buy'?{purchase:{brand:'好奇',series:'小森林',
     totalFen:1000,purchaseDate:'2026-11-12'}}:{})}
  });
  const baseline={status:nextKind==='buy'
   ?'PRIMARY_PURCHASE_BASELINE_VERIFIED':'PRIMARY_CONSUME_BASELINE_VERIFIED',
   familyId:F,actorUid:'A',childId:C,
   inventory:clone(f.env.primaryViewBase.state.inventory),
   revisions:clone(f.env.shownStock.revisions)};
  const queued=await f.primary.queue(op,{operatorApproved:true,
   ...(nextKind==='buy'
    ?{verifiedPurchaseBaseline:baseline}:{verifiedConsumeBaseline:baseline})});
  assert.equal(queued.status,'PRIMARY_OPERATION_DURABLY_QUEUED');
  const sent=await f.primary.flush({operatorApproved:true,
   ...(nextKind==='buy'?{fastPurchaseId:NEXT}:{fastConsumeId:NEXT})});
  assert.equal(sent.status,nextKind==='buy'
   ?'PRIMARY_PURCHASE_ACK_CONFIRMED':'PRIMARY_USE_ACK_CONFIRMED');
  assert.equal(f.trace.filter(x=>
   x==='rpc.xb_apply_inventory_operation').length,2);
  assert.equal(f.trace.filter(x=>x==='idb.reverseAck').length,1);
  assert.equal(f.trace.some(x=>/reconcil|xb_read_inventory/.test(x)),false);
 });
}
test('B3-03 old migrated transaction cannot be reversed',async()=>{
 const f=fixture({reverse:true,legacy:true});await f.activate();
 const ans=await f.reverseClick();
 assert.equal(ans.status,'IMMUTABLE_LEGACY_HISTORY_NOT_REVERSIBLE');
 assert.equal(f.confirmMessages.length,0);
 assert.equal(f.uuidCount,0);
 assert.equal(f.rows.size,0);
 assert.equal(f.trace.some(x=>x.startsWith('rpc.')),false);
});
test('B3-03 already-reversed transaction cannot be reversed twice',async()=>{
 const f=fixture({reverse:true,alreadyReversed:true});await f.activate();
 const ans=await f.reverseClick();
 assert.equal(ans.status,'IMMUTABLE_LEGACY_HISTORY_NOT_REVERSIBLE');
 assert.equal(f.confirmMessages.length,0);
 assert.equal(f.uuidCount,0);
 assert.equal(f.trace.some(x=>x.startsWith('rpc.')),false);
});
test('B3-03 confirmation cancellation does not create UUID or call RPC',async()=>{
 const f=fixture({reverse:true,cancel:true});await f.activate();
 f.capture('reverse');
 assert.equal(f.notices.at(-1)?.status,'PRIMARY_REVERSE_CANCELLED');
 assert.equal(f.feedback.formalReverseActionFeedback.textContent,
  '已取消撤销，库存和历史记录没有变化。');
 assert.equal(f.uuidCount,0);
 assert.equal(f.rows.size,0);
 assert.equal(f.trace.some(x=>x.startsWith('rpc.')),false);
 assert.equal(f.env.primaryViewBase.state.inventory.S,140);
});
test('B3-03 server stock rejection preserves stock and original active history',async()=>{
 const f=fixture({reverse:true,reject:true,stockS:20});await f.activate();
 const ans=await f.reverseClick();
 assert.equal(ans.status,'PRIMARY_REVERSE_SERVER_REJECTED');
 assert.equal(ans.rejected,true);
 assert.equal(ans.operationId,ID);
 assert.equal(f.env.primaryViewBase.state.inventory.S,20);
 assert.equal(f.env.primaryViewBase.state.transactions.find(t=>
  t.operationId===ORIG).reversed,false);
 assert.equal(f.renders.length,0);
 assert.equal(f.trace.filter(x=>
  x==='rpc.xb_apply_inventory_operation').length,1);
});
test('B3-03 026 overlays after reverse never restore stock, spend or status',async()=>{
 for(const kindOfOriginal of ['buy','use']){
  const f=fixture({reverse:true,reverseKind:kindOfOriginal,
   stockS:kindOfOriginal==='buy'?140:71});await f.activate();
  assert.equal((await f.reverseClick()).status,'PRIMARY_REVERSE_CLOUD_ACK_APPLIED');
  for(const doc of ['reference','quotes','growth','profile','settings']){
   const docs=clone(f.env.documentSnapshot);
   docs.documents[doc].revision++;
   const view=Docs.apply(f.env.primaryViewBase,docs);
   assert.equal(view.state.inventory.S,80,doc);
   assert.equal(view.state.transactions.length,2,doc);
   assert.equal(view.state.transactions.find(t=>
    t.operationId===ORIG).reversed,true,doc);
   assert.equal(view.state.transactions.find(t=>
    t.operationId===ORIG).reversedByOperationId,ID,doc);
   assert.equal(view.state.transactions.filter(t=>
    t.type==='buy'&&!t.reversed).reduce((n,t)=>n+t.price,0),40);
  }
 }
});
test('B3-03 immediate list feedback and double click use exactly one reverse UUID',async()=>{
 const f=fixture({reverse:true,delayed:true});await f.activate();
 f.capture('reverse');
 assert.equal(f.feedback.formalReverseActionFeedback.textContent,'正在撤销记录…');
 assert.equal(f.buttons.reverse.disabled,true);
 assert.equal(f.buttons.buyNow.disabled,false);
 f.capture('reverse');
 await tick();await tick();f.releaseRpc();
 await tick();await tick();await tick();
 assert.equal(f.feedback.formalReverseActionFeedback.textContent,
  '记录已撤销，库存已更新');
 assert.equal(f.notices.at(-1)?.status,'PRIMARY_REVERSE_CLOUD_ACK_APPLIED');
 fastReverse(f,{kind:'buy',remaining:80});
 assert.equal(f.confirmMessages.length,1);
 assert.equal(f.buttons.reverse.disabled,false);
});
test('B3-03 ambiguous reverse ACK retains original reverse UUID, no fake UI',async()=>{
 const f=fixture({reverse:true,unknownAck:true});await f.activate();
 const ans=await f.reverseClick();
 assert.equal(ans.operationId,ID);
 assert.notEqual(ans.status,'PRIMARY_REVERSE_CLOUD_ACK_APPLIED');
 assert.equal(f.rows.get(ID).status,'retry');
 assert.equal(f.uuidCount,1);
 assert.equal(f.renders.length,0);
 assert.equal(f.env.primaryViewBase.state.inventory.S,140);
 assert.equal(f.env.primaryViewBase.state.transactions.find(t=>
  t.operationId===ORIG).reversed,false);
});
test('B3-03 after reverse gate opens, stocktake remains closed',async()=>{
 const f=fixture({reverse:true});await f.activate();
 const ans=await f.ui.handle({id:'saveStocks',dataset:{}},
  {getElementById:()=>null});
 assert.equal(ans.status,'FORMAL_PURCHASE_ONLY');
 assert.equal(f.rows.size,0);
 assert.equal(f.uuidCount,0);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_DOCUMENT_WRITE_ENABLED,true);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,true);
});
test('B3-03 manual recovery entry retains reverse original UUID',()=>{
 const c=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.ok(c.includes("recoverMinimalButtons?.({domain:'reverse'})"));
 assert.ok(c.includes("expectedOriginalId:kind==='reverse'?reversesOperationId:null"));
 const h=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 assert.ok(h.includes('id="formalReverseActionFeedback"'));
 assert.ok(h.includes('迁移历史不可撤销'));
});
