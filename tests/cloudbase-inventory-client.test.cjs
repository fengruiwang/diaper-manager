const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../sync/cloudbase-inventory-client.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const O='397b1791-b8d0-4d63-82d6-c5b829240f42';
const OR='e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64';
const t='2026-11-10T16:30:00+08:00';
const make=(kind='buy',rest={})=>({
 familyId:F,childId:C,operationId:O,kind,size:'S',occurredAt:t,
 amount:kind==='reverse'?null:kind==='stocktake'?25:60,
 expectedRevision:kind==='stocktake'?0:null,
 reversesOperationId:kind==='reverse'?OR:null,...rest
});
function fixture({signedIn=true,error=null}={}){
 const calls=[];
 const db={
  async rpc(name,p){calls.push(['rpc',name,p]);return error?{data:null,error}:{data:{
   accepted:true,duplicate:false,operation_id:p.p_operation_id,child_id:p.p_child_id,
   size:p.p_size,result_quantity:60,result_revision:1
  },error:null}},
  from(table){calls.push(['from',table]);return {
   select(columns){calls.push(['select',columns]);return {
    eq(field,value){calls.push(['eq',field,value]);return {
     eq:async(k,v)=>{calls.push(['eq',k,v]);return {data:[
       {size:'S',quantity:60,revision:1,updated_at:'2026-11-10T16:30:00Z'}],error:null}}
    }}}
   }}
  }}
 };
 const auth={async getSession(){calls.push(['session']);return {data:{session:signedIn?{token:'hidden'}:null},error:null}}};
 const c=create({auth,rdb:()=>db});
 return {c,calls};
}
test('buy operation calls only the privileged inventory RPC with stable caller UUID',async()=>{
 const {c,calls}=fixture();
 const op=make();
 const receipt=await c.applyOperation(op);
 assert.equal(receipt.quantity,60);
 assert.equal(receipt.revision,1);
 assert.equal(receipt.duplicate,false);
 const call=calls.find(x=>x[0]==='rpc');
 assert.equal(call[1],'xb_apply_inventory_operation');
 assert.equal(call[2].p_operation_id,O);
 assert.equal(call[2].p_occurred_at,'2026-11-10T08:30:00.000Z');
 assert.equal(call[2].p_amount,60);
 assert.equal(call[2].p_expected_revision,null);
 assert.deepEqual(calls.map(x=>x[0]),['session','rpc']);
});
test('stocktake and reverse create distinct, validated server params',()=>{
 const {c}=fixture();
 const stock=c.normalizeOperation(make('stocktake',{expectedRevision:5,amount:150}));
 assert.equal(stock.p_amount,150);assert.equal(stock.p_expected_revision,5);
 const reverse=c.normalizeOperation(make('reverse',{operationId:O,reversesOperationId:OR}));
 assert.equal(reverse.p_amount,null);assert.equal(reverse.p_reverses_operation_id,OR);
 assert.throws(()=>c.normalizeOperation(make('reverse',{reversesOperationId:O})),/cannot_reverse_self/);
});
test('invalid operation or missing ID never reaches network',async()=>{
 const {c,calls}=fixture();
 await assert.rejects(()=>c.applyOperation(make('buy',{operationId:'',amount:30})),/invalid_operation_id/);
 await assert.rejects(()=>c.applyOperation(make('buy',{amount:0})),/invalid_amount/);
 await assert.rejects(()=>c.applyOperation(make('stocktake',{expectedRevision:null})),/revision_required/);
 await assert.rejects(()=>c.applyOperation(make('use',{occurredAt:'2026-11-10T16:00:00'})),/invalid_occurred_at/);
 assert.equal(calls.length,0);
});
test('not logged in cannot apply or even read inventory',async()=>{
 const {c,calls}=fixture({signedIn:false});
 await assert.rejects(()=>c.applyOperation(make()),/login_required/);
 await assert.rejects(()=>c.readInventory({familyId:F,childId:C}),/login_required/);
 assert.equal(calls.filter(x=>x[0]==='rpc'||x[0]==='from').length,0);
});
test('server PostgreSQL SQLSTATE is normalized without exposing message',async()=>{
 for(const [code,expected] of [['DATABASE_40001','revision_conflict'],
   ['DATABASE_42501','permission_denied'],
   ['DATABASE_23514','stock_out_of_bounds'],['DATABASE_23505','operation_conflict']]){
  const {c}=fixture({error:{code,message:'secret DB internals'}});
  await assert.rejects(()=>c.applyOperation(make()),e=>{
   assert.match(e.message,new RegExp(expected));
   assert.doesNotMatch(e.message,/secret/);
   return true;
  });
 }
});
test('read inventory is restricted to the authenticated RLS query',async()=>{
 const {c,calls}=fixture();
 const rows=await c.readInventory({familyId:F,childId:C});
 assert.deepEqual(rows,[{size:'S',quantity:60,revision:1,updatedAt:'2026-11-10T16:30:00Z'}]);
 assert.deepEqual(calls.map(x=>x[0]),['session','from','select','eq','eq']);
 assert.equal(calls[1][1],'xb_inventory');
 assert.deepEqual(calls.slice(-2),[['eq','family_id',F],['eq','child_id',C]]);
});
test('adapter load never initiates network or creates a replacement operation ID',()=>{
 const {c,calls}=fixture();
 assert.equal(calls.length,0);
 assert.equal(typeof c.normalizeOperation,'function');
 assert.equal(typeof c.applyOperation,'function');
 assert.equal(typeof c.readInventory,'function');
});
