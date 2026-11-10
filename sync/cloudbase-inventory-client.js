/* XiaoBao P2: explicit inventory RPC adapter (not loaded by production PWA).
 * No network calls, sign-in, state migrations or writes during module initialization.
 * Operation IDs and timestamps MUST be stable and created by a durable outbox elsewhere.
 */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const SIZES=new Set(['NB','S','M','L','XL','XXL']);
 const KINDS=new Set(['buy','use','stocktake','reverse']);
 function fail(code){throw new Error('inventory_client:'+code);}
 function id(value,name){if(typeof value!=='string'||!UUID.test(value))fail('invalid_'+name);return value;}
 function qty(value,minimum){if(!Number.isSafeInteger(value)||value<minimum||value>100000)fail('invalid_amount');return value;}
 function create(app){
  if(!app||!app.auth||typeof app.auth.getSession!=='function'||typeof app.rdb!=='function')
   fail('requires_cloudbase_v3');
  const auth=app.auth;
  const db=app.rdb();
  if(typeof db.rpc!=='function'||typeof db.from!=='function')fail('unsupported_database_api');
  async function checkSession(){
   const response=await auth.getSession();
   if(response?.error)fail('session_unavailable');
   if(!response?.data?.session)fail('login_required');
  }
  function normalizeOperation(input){
   if(!input||typeof input!=='object')fail('invalid_operation');
   const familyId=id(input.familyId,'family_id');
   const childId=id(input.childId,'child_id');
   const operationId=id(input.operationId,'operation_id');
   if(!KINDS.has(input.kind)||!SIZES.has(input.size))fail('invalid_operation');
   const date=new Date(input.occurredAt);
   if(typeof input.occurredAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(input.occurredAt)
       ||!/[zZ]|[+-]\d\d:\d\d$/.test(input.occurredAt)||!Number.isFinite(date.getTime()))
    fail('invalid_occurred_at');
   const occurredAt=date.toISOString();
   let amount=null,revision=null,reversed=null;
   if(input.kind==='buy'||input.kind==='use'){
    amount=qty(input.amount,1);
    if(input.expectedRevision!=null||input.reversesOperationId!=null)fail('unexpected_revision_or_reverse');
   }else if(input.kind==='stocktake'){
    amount=qty(input.amount,0);
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)
     fail('revision_required');
    revision=input.expectedRevision;
    if(input.reversesOperationId!=null)fail('unexpected_reverse_id');
   }else{
    if(input.amount!=null||input.expectedRevision!=null)fail('unexpected_amount_or_revision');
    reversed=id(input.reversesOperationId,'reverses_operation_id');
    if(operationId===reversed)fail('cannot_reverse_self');
   }
   return Object.freeze({
    p_family_id:familyId,p_child_id:childId,p_operation_id:operationId,
    p_kind:input.kind,p_size:input.size,p_amount:amount,
    p_expected_revision:revision,p_reverses_operation_id:reversed,
    p_occurred_at:occurredAt
   });
  }
  function safeRpcError(error){
   // The RPC body uses SQLSTATE (possibly wrapped by CloudBase DATABASE_*).
   // Never include raw backend messages, actor IDs, credentials or operation payload.
   const code=String(error?.code||error?.errorCode||'UNKNOWN');
   if(code==='DATABASE_40001'||code==='40001')fail('revision_conflict');
   if(code==='DATABASE_42501'||code==='42501')fail('permission_denied');
   if(code==='DATABASE_23514'||code==='23514')fail('stock_out_of_bounds');
   if(code==='DATABASE_23505'||code==='23505')fail('operation_conflict');
   fail('cloudbase_request_failed');
  }
  async function applyOperation(input){
   const params=normalizeOperation(input);
   await checkSession();
   const response=await db.rpc('xb_apply_inventory_operation',params);
   if(response?.error)safeRpcError(response.error);
   const result=Array.isArray(response?.data)?response.data[0]:response?.data;
   if(!result||result.accepted!==true||result.operation_id!==params.p_operation_id
      ||!Number.isSafeInteger(result.result_quantity)||result.result_quantity<0
      ||!Number.isSafeInteger(result.result_revision)||result.result_revision<1)
    fail('invalid_server_receipt');
   return Object.freeze({
    operationId:result.operation_id,childId:result.child_id,size:result.size,
    quantity:result.result_quantity,revision:result.result_revision,
    duplicate:result.duplicate===true
   });
  }
  async function readInventory({familyId,childId}){
   const family=id(familyId,'family_id'),child=id(childId,'child_id');
   await checkSession();
   const response=await db.from('xb_inventory')
    .select('size,quantity,revision,updated_at')
    .eq('family_id',family).eq('child_id',child);
   if(response?.error)safeRpcError(response.error);
   if(!Array.isArray(response?.data))fail('invalid_inventory_rows');
   return response.data.map(row=>{
    if(!SIZES.has(row.size)||!Number.isSafeInteger(row.quantity)||row.quantity<0
      ||row.quantity>100000||!Number.isSafeInteger(row.revision)||row.revision<0)
     fail('invalid_inventory_rows');
    return {size:row.size,quantity:row.quantity,revision:row.revision,
     updatedAt:row.updated_at};
   });
  }
  return Object.freeze({normalizeOperation,applyOperation,readInventory});
 }
 const api=Object.freeze({create});
 if(root)root.XBInventoryClient=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
