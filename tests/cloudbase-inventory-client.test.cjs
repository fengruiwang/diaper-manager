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
 reversesOperationId:kind==='reverse'?OR:null,
 purchase:kind==='buy'?{brand:'好奇',series:'小森林',totalFen:2999,purchaseDate:'2026-11-10'}:null,
 ...rest
});
function fixture({signedIn=true,error=null}={}){
 const calls=[];
 const db={
  async rpc(name,p){calls.push(['rpc',name,p]);return error?{data:null,error}:{data:{
   accepted:true,duplicate:false,operation_id:p.p_operation_id,child_id:p.p_child_id,
   size:p.p_size,result_quantity:60,result_revision:1
  },error:null}},
  from(table){
   calls.push(['from',table]);
   return {
    select(columns){
     calls.push(['select',columns]);
     return {
      eq(field,value){
       calls.push(['eq',field,value]);
       return {
        async eq(k,v){
         calls.push(['eq',k,v]);
         return {data:[
          {size:'S',quantity:60,revision:1,updated_at:'2026-11-10T16:30:00Z'}
         ],error:null};
        }
       };
      }
     };
    }
   };
  }
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
 assert.deepEqual(call[2].p_purchase,{brand:'好奇',series:'小森林',total_fen:2999,purchase_date:'2026-11-10'});
 assert.deepEqual(calls.map(x=>x[0]),['session','rpc']);
});
test('stocktake and reverse create distinct, validated server params',()=>{
 const {c}=fixture();
 const stock=c.normalizeOperation(make('stocktake',{expectedRevision:5,amount:150}));
 assert.equal(stock.p_amount,150);assert.equal(stock.p_expected_revision,5);
 const reverse=c.normalizeOperation(make('reverse',{operationId:O,reversesOperationId:OR}));
 assert.equal(reverse.p_amount,null);assert.equal(reverse.p_reverses_operation_id,OR);
 assert.equal(reverse.p_purchase,null);
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

test('reject incomplete or invalid purchase metadata before any network call',async()=>{
 const {c,calls}=fixture();
 await assert.rejects(()=>c.applyOperation(make('buy',{purchase:null})),/purchase_details_required/);
 await assert.rejects(()=>c.applyOperation(make('buy',{purchase:{
  brand:'好奇',series:'小森林',totalFen:100.5,purchaseDate:'2026-11-10'
 }})),/invalid_purchase_amount/);
 await assert.rejects(()=>c.applyOperation(make('buy',{purchase:{
  brand:'好奇',series:'小森林',totalFen:1000,purchaseDate:'2026-02-30'
 }})),/invalid_purchase_date/);
 await assert.rejects(()=>c.applyOperation(make('use',{purchase:{
  brand:'好奇',series:'小森林',totalFen:1000,purchaseDate:'2026-11-10'
 }})),/unexpected_purchase_details/);
 assert.equal(calls.length,0);
});
test('purchase order payload participates in RPC and preserves exact price cents',async()=>{
 const {c,calls}=fixture();
 const operation=make('buy',{purchase:{
  brand:' Babycare ',series:' 皇室Pro ',totalFen:1386,purchaseDate:'2026-11-09'
 }});
 await c.applyOperation(operation);
 const params=calls.find(x=>x[0]==='rpc')[2];
 assert.deepEqual(params.p_purchase,{
  brand:'Babycare',series:'皇室Pro',total_fen:1386,purchase_date:'2026-11-09'
 });
 assert.equal(params.p_amount,60);
 assert.equal(params.p_size,'S');
});
test('SQL final purchase RPC removes old 9-parameter signature and rejects orphan buys',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const rpc=fs.readFileSync(path.join(__dirname,'../cloudbase/sql/009_xb_purchase_atomic_rpc_draft.sql'),'utf8');
 const schema=fs.readFileSync(path.join(__dirname,'../cloudbase/sql/008_xb_transactions_schema_draft.sql'),'utf8');
 for(const term of ["DROP FUNCTION IF EXISTS public.xb_apply_inventory_operation",
  'p_purchase jsonb','purchase_details_required',
  "INSERT INTO public.xb_transactions",
  'UPDATE public.xb_transactions',
  'v_purchase_json','purchase_receipt_missing'])
  assert.ok(rpc.includes(term),term);
 assert.ok(schema.includes("CREATE TABLE IF NOT EXISTS public.xb_transactions"));
 assert.match(schema,/xb_private\.can_use_app\(family_id,'xb'\)/);
 assert.doesNotMatch(rpc,/DO \$\n/);
 assert.doesNotMatch(schema,/DO \$\n/);
 assert.equal((rpc.match(/\bCOMMIT;/g)||[]).length,1);
 assert.equal((rpc.match(/CREATE OR REPLACE FUNCTION public\.xb_apply_inventory_operation/g)||[]).length,1);
});
