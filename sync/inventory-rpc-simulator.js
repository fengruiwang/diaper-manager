/* XiaoBao v1.2.0 P2: deterministic simulator for RPC acceptance rules.
 * Pure in-memory model ONLY, not SQL execution, not a persistence adapter.
 * It guards the contract for concurrency order, idempotency, bounds and reverse.
 */
'use strict';

const MAX=100000;
const SIZES=new Set(['NB','S','M','L','XL','XXL']);
const KINDS=new Set(['buy','use','stocktake','reverse']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function err(code){throw Object.assign(new Error('inventory_contract:'+code),{code})}
function initialState(children=[]){
 return {children:new Set(children),stock:new Map(),operations:new Map(),reversed:new Map()};
}
function addChild(state,familyId,childId){
 if(!UUID.test(familyId)||!UUID.test(childId))err('invalid_child');
 return {...state,children:new Set([...state.children,familyId+':'+childId])};
}
function apply(state,input,auth){
 if(!auth||!auth.authenticated||typeof auth.uid!=='string'||!auth.uid)
  err('authentication_required');
 if(!UUID.test(input.familyId)||!UUID.test(input.childId)||!UUID.test(input.operationId)
    ||!SIZES.has(input.size)||!KINDS.has(input.kind)
    ||!input.occurredAt||!Number.isFinite(new Date(input.occurredAt).getTime()))
  err('invalid_inventory_operation');
 if(input.kind==='buy'||input.kind==='use'){
  if(!Number.isInteger(input.amount)||input.amount<1||input.amount>MAX
     ||input.expectedRevision!=null||input.reversesOperationId!=null)err('invalid_inventory_delta');
 }else if(input.kind==='stocktake'){
  if(!Number.isInteger(input.amount)||input.amount<0||input.amount>MAX
    ||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0
    ||input.reversesOperationId!=null)err('invalid_stocktake_request');
 }else if(input.amount!=null||input.expectedRevision!=null
  ||!UUID.test(String(input.reversesOperationId||''))
  ||input.reversesOperationId===input.operationId)err('invalid_reverse_request');
 if(!auth.allowedFamilies?.has(input.familyId))err('permission_denied');

 const key=input.familyId+':'+input.operationId;
 // The simulator's fingerprint is deliberately NOT the PostgreSQL SHA256 digest.
 // It compares normalized typed request values; SQL computes its own SHA256.
 const request=JSON.stringify(['xb.inventory.v1',input.familyId,input.childId,input.kind,input.size,
  input.amount??null,input.expectedRevision??null,input.reversesOperationId??null,
  new Date(input.occurredAt).toISOString(),auth.uid]);
 const prior=state.operations.get(key);
 if(prior){
  if(prior.fingerprint!==request||prior.actorUid!==auth.uid)
   err('inventory_operation_id_reused_with_different_payload');
  return {state,receipt:{...prior.receipt,duplicate:true}};
 }
 if(!state.children.has(input.familyId+':'+input.childId))err('child_unavailable');

 const stockKey=[input.familyId,input.childId,input.size].join(':');
 const current=state.stock.get(stockKey)||{quantity:0,revision:0};
 let delta=null;
 if(input.kind==='buy')delta=input.amount;
 if(input.kind==='use')delta=-input.amount;
 if(input.kind==='reverse'){
  const src=state.operations.get(input.familyId+':'+input.reversesOperationId);
  if(!src||src.childId!==input.childId||src.size!==input.size
   ||!['buy','use'].includes(src.kind))err('reverse_target_unavailable');
  if(state.reversed.has(input.familyId+':'+input.reversesOperationId))
   err('inventory_already_reversed');
  delta=-src.delta;
 }
 if(input.kind==='stocktake'&&current.revision!==input.expectedRevision)
  err('inventory_revision_conflict');
 const quantity=input.kind==='stocktake'?input.amount:current.quantity+delta;
 if(quantity<0||quantity>MAX)err('inventory_out_of_bounds');
 const revision=current.revision+1;
 const receipt={
  accepted:true,duplicate:false,operation_id:input.operationId,
  child_id:input.childId,size:input.size,
  result_quantity:quantity,result_revision:revision
 };
 const next={
  children:state.children,
  stock:new Map(state.stock),operations:new Map(state.operations),reversed:new Map(state.reversed)
 };
 next.stock.set(stockKey,{quantity,revision});
 next.operations.set(key,{
  fingerprint:request,actorUid:auth.uid,childId:input.childId,size:input.size,
  kind:input.kind,delta,receipt
 });
 if(input.kind==='reverse')
  next.reversed.set(input.familyId+':'+input.reversesOperationId,input.operationId);
 return {state:next,receipt};
}
module.exports={initialState,addChild,apply};
