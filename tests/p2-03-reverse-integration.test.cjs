const test=require('node:test'),assert=require('node:assert/strict');
const Client=require('../sync/cloudbase-inventory-client.js');
const Runner=require('../sync/inventory-outbox-runner.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Commands=require('../sync/primary-business-commands.js');
const UI=require('../sync/primary-ui-projection.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const fs=require('node:fs'),path=require('node:path');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const BUY='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const USE='79192488-bd70-4b88-8c66-3c5b5fb29ef5';
const RB='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const RU='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6';
const AGAIN='6b3d0e45-bf18-4c95-889c-6f19731a8ae6';
const DATE='2026-11-13T13:30:00.000Z';
const sizes=['NB','S','M','L','XL','XXL'];
function server(startStock=10){
 const stock={NB:0,S:startStock,M:0,L:0,XL:0,XXL:0};
 const revision=Object.fromEntries(sizes.map(x=>[x,1]));
 const ops=new Map(),tx=[],writes=[];
 function createApp(actor){
  return {auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})},
   rdb:()=>({
    async rpc(name,p){
     assert.equal(name,'xb_apply_inventory_operation');
     assert.equal(p.p_family_id,F);assert.equal(p.p_child_id,CHILD);
     writes.push({actor,p});
     if(ops.has(p.p_operation_id)){
      const saved=ops.get(p.p_operation_id);
      return {data:{...saved.receipt,duplicate:true},error:null};
     }
     const size=p.p_size;
     let delta,original=null;
     if(p.p_kind==='buy')delta=p.p_amount;
     else if(p.p_kind==='use')delta=-p.p_amount;
     else if(p.p_kind==='reverse'){
      original=ops.get(p.p_reverses_operation_id);
      if(!original||!['buy','use'].includes(original.kind)
         ||original.size!==size)
       return{data:null,error:{code:'DATABASE_22023'}};
      if(original.reversedBy)
       return{data:null,error:{code:'DATABASE_23505'}};
      delta=-original.delta;
     }else return{data:null,error:{code:'DATABASE_42501'}};
     if(stock[size]+delta<0||stock[size]+delta>100000)
      return{data:null,error:{code:'DATABASE_23514'}};
     stock[size]+=delta;revision[size]++;
     const receipt={accepted:true,duplicate:false,
      operation_id:p.p_operation_id,child_id:CHILD,size,
      result_quantity:stock[size],result_revision:revision[size]};
     ops.set(p.p_operation_id,{kind:p.p_kind,size,delta,receipt,reversedBy:null,
      reversedOrigin:p.p_reverses_operation_id||null,
      occurredAt:p.p_occurred_at,actor});
     if(original)original.reversedBy=p.p_operation_id;
     if(p.p_kind==='buy')tx.push({operation_id:p.p_operation_id,
      brand:p.p_purchase.brand,series:p.p_purchase.series,
      size,pieces:p.p_amount,total_fen:p.p_purchase.total_fen,
      purchase_date:p.p_purchase.purchase_date,created_by:actor,
      reversed_by_operation_id:null});
     if(original?.kind==='buy'){
      const row=tx.find(t=>t.operation_id===p.p_reverses_operation_id);
      assert.ok(row);row.reversed_by_operation_id=p.p_operation_id;
     }
     return{data:receipt,error:null};
    },
    from(table){
     const query={filters:{},
      select(){return this},
      eq(k,v){this.filters[k]=v;return this},
      then(resolve,reject){
       assert.equal(this.filters.family_id,F);
       assert.equal(this.filters.child_id,CHILD);
       let data;
       if(table==='xb_transactions')data=tx.slice();
       else if(table==='xb_inventory_operations'){
        data=[...ops].filter(([_,op])=>op.kind===this.filters.kind)
         .map(([id,op])=>({
          operation_id:id,kind:op.kind,size:op.size,delta:op.delta,
          occurred_at:op.occurredAt,actor_uid:op.actor,
          reverses_operation_id:op.reversedOrigin
         }));
       }else throw Error('unexpected table');
       return Promise.resolve({data,error:null}).then(resolve,reject);
      }
     };
     return query;
    }
   })
  };
 }
 const args=(id,kind,opts={})=>({
  familyId:F,childId:CHILD,operationId:id,kind,size:'S',
  occurredAt:DATE,amount:kind==='reverse'?null:opts.amount,
  reversesOperationId:opts.original||null,
  purchase:kind==='buy'?{brand:'好奇',series:'小森林',
   totalFen:9900,purchaseDate:'2026-11-13'}:null
 });
 return {createApp,args,stock,ops,tx,writes};
}
function primary(s,actor){
 const inventory={...s.stock};
 const revisions=Object.fromEntries(sizes.map(x=>[x,1]));
 return {status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,
  familyId:F,childId:CHILD,actorUid:actor,inventory,revisions,
  settings:{currentSize:'S'},profileData:{
   babyProfile:{name:'正式宝宝'},dueDate:'2027-01-08',
   birthDate:'',babyWeight:''},
  legacyHistory:{complete:true,hasMore:false,total:1,rows:[{
   kind:'transaction',id:'old-use',payload:{
    id:'old-use',type:'use',size:'S',pieces:1,date:'2026-10-30'}
  }]},legacyPurchasesAppliedToInventory:false,livePurchases:[],liveUses:[]};
}
const defaults=()=>({transactions:[],quotes:[],weightRecords:[],
 referenceOverrides:{},inventory:{},target:{},daily:{},babyProfile:{}});
async function snapshot(s,actor){
 const client=Client.create(s.createApp(actor));
 const [purchases,uses]=await Promise.all([
  client.readPurchases({familyId:F,childId:CHILD}),
  client.readUses({familyId:F,childId:CHILD})
 ]);
 return UI.project({...primary(s,actor),livePurchases:purchases,liveUses:uses},defaults());
}
test('P2-03 reversed purchase remains readable, audit row visible; effective totals omit it',async()=>{
 const s=server();const c=Client.create(s.createApp('dad'));
 await c.applyOperation(s.args(BUY,'buy',{amount:6}));
 await c.applyOperation(s.args(RB,'reverse',{original:BUY}));
 const dad=await snapshot(s,'dad');
 assert.equal(s.stock.S,10);
 const item=dad.state.transactions.find(x=>x.operationId===BUY);
 assert.equal(item.type,'buy');assert.equal(item.reversed,true);
 assert.equal(item.reversedByOperationId,RB);
 assert.equal(dad.state.inventory.S,10);
 assert.equal(dad.state.transactions.length,2,'one historic use preserved');
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 assert.match(html,/t.type==='buy'&&t.reversed!==true/);
 assert.match(html,/t.type==='use'&&t.reversed!==true/);
 assert.match(html,/已撤销/);
});
test('P2-03 reverse of consumption restores inventory and both members see same audited use',async()=>{
 const s=server();const c=Client.create(s.createApp('dad'));
 await c.applyOperation(s.args(USE,'use',{amount:4}));
 assert.equal(s.stock.S,6);
 await c.applyOperation(s.args(RU,'reverse',{original:USE}));
 assert.equal(s.stock.S,10);
 const dad=await snapshot(s,'dad'),mom=await snapshot(s,'mom');
 for(const item of [dad,mom]){
  const row=item.state.transactions.find(x=>x.operationId===USE);
  assert.equal(row.type,'use');assert.equal(row.reversed,true);
  assert.equal(row.reversedByOperationId,RU);
  assert.equal(item.state.inventory.S,10);
 }
});
test('P2-03 same reverse UUID retry idempotent; second reverse UUID for same original rejected',async()=>{
 const s=server();const c=Client.create(s.createApp('dad'));
 await c.applyOperation(s.args(USE,'use',{amount:3}));
 const first=await c.applyOperation(s.args(RU,'reverse',{original:USE}));
 const retry=await c.applyOperation(s.args(RU,'reverse',{original:USE}));
 assert.equal(first.duplicate,false);assert.equal(retry.duplicate,true);
 assert.equal(s.stock.S,10);
 await assert.rejects(()=>c.applyOperation(s.args(AGAIN,'reverse',{original:USE})),
  /inventory_client:operation_conflict/);
 assert.equal(s.stock.S,10);
 assert.equal(s.ops.size,2);
});
test('P2-03 reversing a purchase with insufficient stock is server-rejected atomically',async()=>{
 const s=server();const c=Client.create(s.createApp('dad'));
 await c.applyOperation(s.args(BUY,'buy',{amount:5}));
 await c.applyOperation(s.args(USE,'use',{amount:12}));
 assert.equal(s.stock.S,3);
 await assert.rejects(()=>c.applyOperation(s.args(RB,'reverse',{original:BUY})),
  /inventory_client:stock_out_of_bounds/);
 assert.equal(s.stock.S,3);
 assert.equal(s.tx[0].reversed_by_operation_id,null);
 assert.equal(s.ops.size,2);
});
test('P2-03 UI queues verified buy/use reverse; old history, reversed row and unsupported writes blocked',async()=>{
 const calls=[],ctx={read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})};
 const entries={
  'old':{origin:'legacy_migration',type:'buy',operationId:BUY,size:'S'},
  'done':{origin:'cloud_post_migration',type:'use',reversed:true,
   operationId:USE,size:'S'},
  buy:{origin:'cloud_post_migration',type:'buy',reversed:false,
   operationId:BUY,size:'S'},
  use:{origin:'cloud_post_migration',type:'use',reversed:false,
   operationId:USE,size:'S'}
 };
 const ui=Actions.create({primary:ctx,commands:{
  submit:async(action,data)=>{calls.push({action,data});return{status:'QUEUED'};}
 },formalModeSelected:()=>true,buildAllowsWrites:true,
 operatorApproved:()=>true,purchaseOnly:true,allowConsume:true,allowReverse:true,
 readPurchase:()=>null,readQuote:()=>null,readTransaction:id=>entries[id],
 notify:()=>{}});
 assert.equal((await ui.handle({dataset:{action:'deletetx',id:'old'}},{})).status,
  'IMMUTABLE_LEGACY_HISTORY_NOT_REVERSIBLE');
 assert.equal((await ui.handle({dataset:{action:'deletetx',id:'done'}},{})).status,
  'IMMUTABLE_LEGACY_HISTORY_NOT_REVERSIBLE');
 for(const id of ['buy','use'])
  await ui.handle({dataset:{action:'deletetx',id}},{});
 assert.equal(calls.length,2);
 assert.deepEqual(calls.map(x=>x.action),['reverse','reverse']);
 assert.deepEqual(calls.map(x=>x.data.reversesOperationId),[BUY,USE]);
 assert.equal((await ui.handle({id:'saveStocks',dataset:{}},{})).status,
  'FORMAL_PURCHASE_ONLY');
 assert.equal(calls.length,2);
});
test('P2-03 durable reverse flow reuses original queued UUID after lost ACK',async()=>{
 const s=server(),client=Client.create(s.createApp('dad'));
 await client.applyOperation(s.args(USE,'use',{amount:2}));
 const queue=[{id:RU,type:'transaction.reverse',familyId:F,actorUid:'dad',
  createdAt:DATE,expectedRevision:null,payload:{childId:CHILD,size:'S',
   reversesOperationId:USE,occurredAt:DATE},state:'pending'}];
 const outbox={ready:async()=>queue.filter(x=>x.state!=='acked'),
  recordResult:async(_scope,id,receipt)=>{assert.equal(id,RU);
   queue[0].state=['accepted','duplicate'].includes(receipt.kind)?'acked':'retry';}};
 let first=true;
 const remote={applyOperation:async args=>{
  const ack=await client.applyOperation(args);
  if(first){first=false;throw Error('response lost');}
  return ack;
 }};
 const runner=Runner.create({outbox,remote,verifyAccess:async()=>({
  familyId:F,actorUid:'dad',member:true,appCode:'xb',initialized:true
 })});
 const scope={familyId:F,actorUid:'dad'};
 const a=await runner.flush(scope,{uploadEnabled:true,purchaseOnly:true,
  allowConsume:true,allowReverse:true});
 assert.equal(a.status,'network-or-server-failure');
 assert.equal(queue[0].state,'retry');assert.equal(s.stock.S,10);
 const b=await runner.flush(scope,{uploadEnabled:true,purchaseOnly:true,
  allowConsume:true,allowReverse:true});
 assert.equal(b.accepted,1);assert.equal(queue[0].state,'acked');
 assert.equal(s.stock.S,10);assert.equal(s.ops.size,2);
});
test('P2-03 purchase/consume compatibility retained and formal write release still disabled',async()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const s=server(),c=Client.create(s.createApp('dad'));
 await c.applyOperation(s.args(BUY,'buy',{amount:4}));
 await c.applyOperation(s.args(USE,'use',{amount:3}));
 assert.equal(s.stock.S,11);
 const p=await snapshot(s,'mom');
 assert.equal(p.state.transactions.filter(x=>x.origin==='cloud_post_migration').length,2);
 assert.equal(p.state.inventory.S,11);
});
