const test=require('node:test'),assert=require('node:assert/strict');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Commands=require('../sync/primary-business-commands.js');
const Client=require('../sync/cloudbase-inventory-client.js');
const Runner=require('../sync/inventory-outbox-runner.js');
const Model=require('../sync/primary-cloud-read-model.js');
const Project=require('../sync/primary-ui-projection.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const OP='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const SIZES=['NB','S','M','L','XL','XXL'];
function cloud(){
 const stock={NB:0,S:10,M:0,L:0,XL:0,XXL:0};
 const revision=Object.fromEntries(SIZES.map(size=>[size,1]));
 const uses=[],orders=[],applied=new Map();
 let rpcWrites=0;
 const rows=()=>SIZES.map(size=>({size,quantity:stock[size],revision:revision[size]}));
 const app=actor=>({
  auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})},
  rdb:()=>({
   rpc:async(name,p)=>{
    if(name==='xb_read_inventory_reconciliation')
     return{data:{complete:true,family_id:F,child_id:CHILD,actor_uid:actor,
      checked_operation_ids:p.p_operation_ids,
      seen_operation_ids:p.p_operation_ids.filter(id=>applied.has(id)),
      rows:rows()},error:null};
    assert.equal(name,'xb_apply_inventory_operation');
    assert.equal(p.p_family_id,F);assert.equal(p.p_child_id,CHILD);
    rpcWrites++;
    if(applied.has(p.p_operation_id))
     return {data:{...applied.get(p.p_operation_id),duplicate:true},error:null};
    if(p.p_kind!=='use'&&p.p_kind!=='buy')
     return{data:null,error:{code:'DATABASE_42501'}};
    const delta=p.p_kind==='use'?-p.p_amount:p.p_amount;
    if(stock[p.p_size]+delta<0)return{data:null,error:{code:'DATABASE_23514'}};
    stock[p.p_size]+=delta;revision[p.p_size]++;
    if(p.p_kind==='use')uses.push({operation_id:p.p_operation_id,kind:'use',
     size:p.p_size,delta,occurred_at:p.p_occurred_at,actor_uid:actor,
     family_id:F,child_id:CHILD});
    else orders.push({operation_id:p.p_operation_id,brand:p.p_purchase.brand,
     series:p.p_purchase.series,size:p.p_size,pieces:p.p_amount,
     total_fen:p.p_purchase.total_fen,purchase_date:p.p_purchase.purchase_date,
     reversed_by_operation_id:null,created_by:actor,family_id:F,child_id:CHILD});
    const ack={accepted:true,duplicate:false,operation_id:p.p_operation_id,
     child_id:CHILD,size:p.p_size,result_quantity:stock[p.p_size],
     result_revision:revision[p.p_size]};
    applied.set(p.p_operation_id,ack);
    return {data:ack,error:null};
   },
   from(table){
    const filter={};let limit=null;
    const query={
     select(){return this},
     eq(key,val){filter[key]=val;return this},
     limit(count){limit=count;return Promise.resolve(resolve())},
     then(ok,fail){return Promise.resolve(resolve()).then(ok,fail)}
    };
    function resolve(){
     assert.equal(filter.family_id,F);assert.equal(filter.child_id,CHILD);
     const data=table==='xb_inventory_operations'
      ?uses.filter(r=>r.kind===filter.kind)
      :table==='xb_transactions'?orders
      :table==='xb_baby_profiles'?[{family_id:F,child_id:CHILD,profile_data:{
       babyProfile:{name:'正式宝宝'},dueDate:'2027-01-08',birthDate:'',babyWeight:''
      }}]:null;
     assert.ok(data,'unexpected table '+table);
     return {data:limit?data.slice(0,limit):data,error:null};
    }
    return query;
   }
  })
 });
 return {app,stock,revision,uses,orders,rows,get rpcWrites(){return rpcWrites}};
}
function view(cloudState,actor){
 const app=cloudState.app(actor);
 const reader=Model.create({
  app,scopeGuard:{requireLegacyMigrationTarget(){}},
  accessPreflight:{create:()=>({verifyAccess:async()=>({
   member:true,appCode:'xb',familyId:F,actorUid:actor
  })})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>({
   familyId:F,childId:CHILD,readyForMigration:false
  })})},
  inventoryClient:{create:()=>Client.create(app)},
  legacyHistoryReader:{create:()=>({
   readSettings:async()=>({complete:true,canEdit:false,canUpload:false,
    revision:0,settings:{currentSize:'S',target:{S:100},daily:{S:8}}}),
   readAll:async()=>({complete:true,canEdit:false,canUpload:false,
    offset:0,hasMore:false,total:1,rows:[{
     kind:'transaction',id:'old-use',payload:{id:'old-use',
      type:'use',date:'2026-10-30',size:'S',pieces:2,price:0}
    }]})
  })}
 });
 return reader.read({familyId:F,actorUid:actor});
}
const defaults=()=>({transactions:[],quotes:[],weightRecords:[],
 inventory:{},referenceOverrides:{},babyProfile:{},target:{},daily:{}});
test('P2-02 consume button queues one use UUID, cloud stock decrements once and both accounts read it',async()=>{
 const db=cloud(),client=Client.create(db.app('dad')),pending=[];
 const outbox={ready:async()=>pending.filter(x=>x.status==='pending'||x.status==='retry'),
  recordResult:async(_scope,id,result)=>{const op=pending.find(x=>x.id===id);
   assert.ok(op);op.status=['duplicate','accepted'].includes(result.kind)?'acked':'retry';}};
 const runner=Runner.create({outbox,remote:client,verifyAccess:async()=>({
  familyId:F,actorUid:'dad',member:true,appCode:'xb',initialized:true
 })});
 let generated=0,drawn=null;
 const primary={cloudWritesEnabled:true,
  selectedScope:()=>({familyId:F,childId:CHILD,actorUid:'dad'}),
  read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{...db.stock},revisions:{...db.revision}}),
  queue:async op=>{pending.push({...op,status:'pending'});
   return{status:'PRIMARY_OPERATION_DURABLY_QUEUED',operationId:op.id}},
  flush:async()=>{const r=await runner.flush({familyId:F,actorUid:'dad'},
   {uploadEnabled:true,purchaseOnly:true,allowConsume:true});
   return{status:r.accepted===1?'PRIMARY_CLOUD_SYNCED_VERIFIED':'PRIMARY_ACK_UNKNOWN'}}
 };
 const commands=Commands.create({primary,uuid:()=>{generated++;return OP},
  clock:()=> '2026-11-13T13:30:00.000Z'});
 const actions=Actions.create({primary,commands,formalModeSelected:()=>true,
  buildAllowsWrites:true,operatorApproved:()=>true,purchaseOnly:true,
  allowConsume:true,readPurchase:()=>null,readQuote:()=>null,
  readTransaction:()=>null,notify:()=>{},
  onPurchaseReadback:async({operationId,kind})=>{
   assert.equal(kind,'use');assert.equal(operationId,OP);
   const fresh=await view(db,'dad');
   assert.equal(fresh.liveUses.some(x=>x.operationId===OP),true);
   drawn=Project.project(fresh,defaults());
   return 'ready';
  }});
 const result=await actions.handle({id:'',dataset:{
  action:'consume',size:'S',count:'3'}},{});
 assert.equal(result.status,'PRIMARY_USE_CLOUD_READBACK_VERIFIED');
 assert.equal(generated,1);assert.equal(db.stock.S,7);
 assert.equal(db.uses.length,1);assert.equal(db.uses[0].delta,-3);
 assert.equal(drawn.state.inventory.S,7);
 assert.equal(drawn.state.transactions.length,2);
 assert.equal(drawn.state.transactions[0].origin,'legacy_migration');
 assert.equal(drawn.state.transactions[1].origin,'cloud_post_migration');
 assert.equal(drawn.state.transactions[1].type,'use');
 const mom=Project.project(await view(db,'mom'),defaults());
 assert.equal(mom.state.inventory.S,7);
 assert.equal(mom.state.transactions[1].operationId,OP);
 assert.equal(mom.state.transactions[1].pieces,3);
 assert.equal(db.rpcWrites,1);
});
test('P2-02 insufficient or malformed count is blocked before UUID generation and queue',async()=>{
 const calls=[];let ids=0;
 const primary={cloudWritesEnabled:true,
  selectedScope:()=>({familyId:F,childId:CHILD,actorUid:'dad'}),
  read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{NB:0,S:2,M:0,L:0,XL:0,XXL:0},
   revisions:{NB:1,S:1,M:1,L:1,XL:1,XXL:1}}),
  queue:async()=>{calls.push('queue');return{status:'QUEUED'}}
 };
 const cmd=Commands.create({primary,uuid:()=>{ids++;return OP},
  clock:()=> '2026-11-13T13:30:00.000Z'});
 assert.equal((await cmd.submit('consume',{size:'S',count:3},
  {operatorApproved:true})).status,'PRIMARY_INSUFFICIENT_STOCK');
 assert.equal((await cmd.submit('consume',{size:'S',count:0},
  {operatorApproved:true})).status,'PRIMARY_OPERATION_REVIEW_REQUIRED');
 assert.equal((await cmd.submit('consume',{size:'BAD',count:1},
  {operatorApproved:true})).status,'PRIMARY_OPERATION_REVIEW_REQUIRED');
 assert.equal(ids,0);assert.equal(calls.length,0);
});
test('P2-02 original use UUID retry and server negative-stock rejection',async()=>{
 const db=cloud(),client=Client.create(db.app('dad'));
 const request={familyId:F,childId:CHILD,operationId:OP,kind:'use',
  size:'S',amount:3,occurredAt:'2026-11-13T13:30:00.000Z'};
 const first=await client.applyOperation(request);
 const duplicate=await client.applyOperation(request);
 assert.equal(first.duplicate,false);assert.equal(duplicate.duplicate,true);
 assert.equal(db.stock.S,7);assert.equal(db.uses.length,1);
 await assert.rejects(()=>client.applyOperation({...request,
  operationId:'79192488-bd70-4b88-8c66-3c5b5fb29ef5',amount:8}),
  /stock_out_of_bounds/);
 assert.equal(db.stock.S,7);assert.equal(db.uses.length,1);
});
test('P2-02 unknown ACK keeps same queued UUID, recovery applies at most once',async()=>{
 const db=cloud(),client=Client.create(db.app('dad'));
 const op={id:OP,type:'inventory.delta',familyId:F,actorUid:'dad',
  createdAt:'2026-11-13T13:30:00Z',payload:{
   childId:CHILD,size:'S',kind:'use',amount:2,occurredAt:'2026-11-13T13:30:00Z'},
  status:'pending'};
 const outbox={ready:async()=>op.status==='acked'?[]:[op],
  recordResult:async(_scope,id,result)=>{
   assert.equal(id,OP);op.status=['accepted','duplicate'].includes(result.kind)?'acked':'retry';
  }};
 let lost=true;
 const remote={applyOperation:async request=>{
  const receipt=await client.applyOperation(request);
  if(lost){lost=false;throw Error('network lost response after commit');}
  return receipt;
 }};
 const runner=Runner.create({outbox,remote,verifyAccess:async()=>({
  familyId:F,actorUid:'dad',appCode:'xb',member:true,initialized:true
 })});
 const scope={familyId:F,actorUid:'dad'};
 const a=await runner.flush(scope,{uploadEnabled:true,purchaseOnly:true,allowConsume:true});
 assert.equal(a.status,'network-or-server-failure');
 assert.equal(op.status,'retry');assert.equal(db.stock.S,8);
 const b=await runner.flush(scope,{uploadEnabled:true,purchaseOnly:true,allowConsume:true});
 assert.equal(b.accepted,1);assert.equal(op.status,'acked');
 assert.equal(db.stock.S,8);assert.equal(db.uses.length,1);
});
test('P2-02 only buys and uses may upload; stocktake, reverse, document commands still blocked',async()=>{
 const submitted=[],actions=Actions.create({
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  commands:{submit:async kind=>{submitted.push(kind);return{status:'QUEUED'}}},
  formalModeSelected:()=>true,buildAllowsWrites:true,
  operatorApproved:()=>true,purchaseOnly:true,allowConsume:true,
  readPurchase:()=>({}),readQuote:()=>null,readTransaction:()=>null,notify:()=>{}
 });
 for(const el of [{id:'saveStocks',dataset:{}},
  {id:'saveWeight',dataset:{}},{id:'',dataset:{action:'deletetx',id:'old'}}])
  assert.equal((await actions.handle(el,{})).status,'FORMAL_PURCHASE_ONLY');
 assert.deepEqual(submitted,[]);
 const outbox={ready:async()=>[{id:OP,type:'inventory.count',familyId:F,
  actorUid:'dad',payload:{childId:CHILD,size:'S',count:6}}],
  recordResult:async()=>{throw Error('must not send')}};
 const runner=Runner.create({outbox,remote:{applyOperation:async()=>{throw Error('must not upload')}},
  verifyAccess:async()=>({familyId:F,actorUid:'dad',appCode:'xb',
   member:true,initialized:true})});
 assert.equal((await runner.flush({familyId:F,actorUid:'dad'},
  {uploadEnabled:true,purchaseOnly:true,allowConsume:true})).attempted,0);
});
test('P2-02 both release switches remain off; server grants unchanged',()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 const fs=require('node:fs'),path=require('node:path');
 const sql=fs.readFileSync(path.join(__dirname,
  '../cloudbase/sql/009_xb_purchase_atomic_rpc_draft.sql'),'utf8');
 const schema=fs.readFileSync(path.join(__dirname,
  '../cloudbase/sql/005_xb_core_schema_draft.sql'),'utf8');
 assert.match(sql,/ELSIF p_kind='use' THEN/);
 assert.match(sql,/IF v_after<0 OR v_after>100000 THEN/);
 assert.match(sql,/WHERE family_id=p_family_id AND operation_id=p_operation_id/);
 assert.match(schema,/GRANT SELECT ON public.xb_children/);
 assert.match(schema,/xb_inventory_ops_family_read/);
});

test('P2-02 formal five-tab history distinguishes live uses from post-migration buys',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 assert.ok(html.includes("t.type==='use'?'迁移后云端消耗':'迁移后云端采购'"));
});
