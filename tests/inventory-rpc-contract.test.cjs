const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const S=require('../sync/inventory-rpc-simulator.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const C2='68304c46-34b5-4a55-86ad-5b4e8381e7d3';
const X='3a38fef8-8ff7-4c9d-94f4-3c7f5ea84653';
const O1='397b1791-b8d0-4d63-82d6-c5b829240f42';
const O2='e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64';
const O3='780d45fe-dd5b-48c8-9660-ec14d4c0bb96';
const O4='dddb23ca-895a-4b1b-b5e0-672e0e4f4d23';
const O5='b2c032c0-e04a-43a3-ae26-d457235daec8';
const A={uid:'dad',authenticated:true,allowedFamilies:new Set([F])};
const B={uid:'mom',authenticated:true,allowedFamilies:new Set([F])};
const NO={uid:'stranger',authenticated:true,allowedFamilies:new Set([])};
const time='2026-11-10T08:30:00.000Z';
const base=()=>S.addChild(S.initialState(),F,C);
const cmd=(kind,operationId,extra={})=>({familyId:F,childId:C,size:'S',
 kind,operationId,amount:kind==='reverse'?null:60,
 expectedRevision:kind==='stocktake'?0:null,
 reversesOperationId:null,occurredAt:time,...extra});
const step=(state,command,actor=A)=>S.apply(state,command,actor);
const qty=(state,child=C,size='S')=>state.stock.get(F+':'+child+':'+size)||{quantity:0,revision:0};

test('two family members buying +60 and +80 become +140 in serial order',()=>{
 let s=base();
 s=step(s,cmd('buy',O1,{}),A).state;
 s=step(s,cmd('buy',O2,{amount:80}),B).state;
 assert.deepEqual(qty(s),{quantity:140,revision:2});
 assert.equal(s.operations.size,2);
});
test('timeout replay with identical operation ID returns former receipt and never doubles stock',()=>{
 let s=base();
 const first=step(s,cmd('buy',O1));s=first.state;
 s=step(s,cmd('buy',O2,{amount:80}),B).state;
 const again=step(s,cmd('buy',O1),A);
 assert.strictEqual(again.state,s);
 assert.equal(again.receipt.duplicate,true);
 assert.equal(again.receipt.result_quantity,60); // receipt, not the current 140
 assert.equal(qty(s).quantity,140);
});
test('same operation ID changed amount or actor is rejected without mutation',()=>{
 const s=step(base(),cmd('buy',O1)).state;
 assert.throws(()=>step(s,cmd('buy',O1,{amount:80})),/different_payload/);
 assert.throws(()=>step(s,cmd('buy',O1),B),/different_payload/);
 assert.equal(qty(s).quantity,60);
});
test('use cannot underflow, and a failed operation writes no event',()=>{
 const s=step(base(),cmd('buy',O1,{amount:40})).state;
 assert.throws(()=>step(s,cmd('use',O2,{amount:41})),/inventory_out_of_bounds/);
 assert.equal(qty(s).quantity,40);
 assert.equal(s.operations.size,1);
});
test('stale stocktake cannot overwrite buy from another phone',()=>{
 const s=step(base(),cmd('buy',O1)).state;
 assert.throws(()=>step(s,cmd('stocktake',O2,{amount:100,expectedRevision:0}),B),/inventory_revision_conflict/);
 assert.equal(qty(s).quantity,60);
 const next=step(s,cmd('stocktake',O2,{amount:100,expectedRevision:1}),B).state;
 assert.deepEqual(qty(next),{quantity:100,revision:2});
});
test('reverse a purchase once with a new event; replay reverse is idempotent',()=>{
 let s=step(base(),cmd('buy',O1)).state;
 const reverse=cmd('reverse',O2,{reversesOperationId:O1});
 const first=step(s,reverse);s=first.state;
 assert.equal(qty(s).quantity,0);
 assert.equal(s.operations.size,2);
 assert.equal(step(s,reverse).receipt.duplicate,true);
 assert.throws(()=>step(s,cmd('reverse',O3,{reversesOperationId:O1})),/inventory_already_reversed/);
});
test('reversal cannot produce negative inventory after later consumption',()=>{
 let s=step(base(),cmd('buy',O1)).state;
 s=step(s,cmd('use',O2,{amount:40})).state;
 assert.throws(()=>step(s,cmd('reverse',O3,{reversesOperationId:O1})),/inventory_out_of_bounds/);
 assert.deepEqual(qty(s),{quantity:20,revision:2});
});
test('reverse cannot target stocktake, another size or child',()=>{
 let s=step(base(),cmd('stocktake',O1,{amount:30,expectedRevision:0})).state;
 assert.throws(()=>step(s,cmd('reverse',O2,{reversesOperationId:O1})),/reverse_target_unavailable/);
 s=step(s,cmd('buy',O3)).state;
 assert.throws(()=>step(s,cmd('reverse',O4,{size:'M',reversesOperationId:O3})),/reverse_target_unavailable/);
});
test('unauthorized, logged-out, deleted child and unknown kinds fail closed',()=>{
 const s=base();
 assert.throws(()=>step(s,cmd('buy',O1),NO),/permission_denied/);
 assert.throws(()=>step(s,cmd('buy',O1),{...A,authenticated:false}),/authentication_required/);
 assert.throws(()=>step(s,cmd('buy',O1,{childId:C2})),/child_unavailable/);
 assert.throws(()=>step(s,cmd('migration_baseline',O1)),/invalid_inventory_operation/);
 assert.equal(s.operations.size,0);
});
test('separate child and family have no mixed inventory',()=>{
 let s=S.addChild(base(),F,C2);
 s=step(s,cmd('buy',O1)).state;
 s=step(s,cmd('buy',O2,{childId:C2,amount:20})).state;
 assert.equal(qty(s,C).quantity,60);
 assert.equal(qty(s,C2).quantity,20);
 assert.throws(()=>step(s,cmd('buy',O3,{familyId:X})),/permission_denied/);
});
test('bad stocktake revision and zero or huge amount are rejected',()=>{
 const s=base();
 assert.throws(()=>step(s,cmd('stocktake',O1,{expectedRevision:null})),/invalid_stocktake_request/);
 assert.throws(()=>step(s,cmd('use',O1,{amount:0})),/invalid_inventory_delta/);
 assert.throws(()=>step(s,cmd('buy',O1,{amount:100001})),/invalid_inventory_delta/);
});
test('007 PostgreSQL draft enforces security and serializable write path',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../cloudbase/sql/007_xb_inventory_rpc_draft.sql'),'utf8');
 for(const required of [
  'SECURITY DEFINER','auth.uid()','auth.role()',
  "xb_private.can_use_app(p_family_id,'xb')",
  'sha256(','pg_advisory_xact_lock','payload_sha256','FOR UPDATE',
  'ON CONFLICT(family_id,child_id,size) DO NOTHING',
  "USING ERRCODE='40001'",'inventory_already_reversed',
  'xb_inventory_one_reverse_per_source','v_after<0','v_after>100000',
  'xb_inventory_reverse_reference_consistent'
 ])assert.ok(sql.includes(required),required);
 assert.match(sql,/WHERE family_id=p_family_id AND operation_id=p_operation_id/);
 assert.match(sql,/p_reverses_operation_id=p_operation_id/);
 assert.doesNotMatch(sql,/\bTRUNCATE\b|\bDROP TABLE\b|\bDELETE FROM\b/i);
});
