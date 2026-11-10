/* XiaoBao v1.2.0 offline outbox domain, pure functions only.
   Does not perform persistence or network requests. */
(function(root){
 'use strict';
 const TYPES=Object.freeze(['inventory.delta','inventory.count','transaction.reverse','weight.upsert','weight.delete','profile.patch','settings.patch','quote.upsert','quote.delete','reference.patch']);
 const NEED_REV=new Set(['inventory.count','weight.upsert','weight.delete','profile.patch','settings.patch','quote.upsert','quote.delete','reference.patch']);
 const WAITING=new Set(['pending','retry','conflict']);
 const validString=x=>typeof x==='string'&&x.length>0&&x.length<=160;
 const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 function check(ok,msg){if(!ok)throw Error('outbox_contract: '+msg)}
 function createOperation({id,type,familyId,actorUid,payload,expectedRevision=null,createdAt}){
  check(validString(id),'bad_operation_id');
  check(TYPES.includes(type),'unknown_operation_type');
  check(validString(familyId)&&validString(actorUid),'bad_identity');
  check(isObject(payload),'bad_payload');
  check(typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt)),'bad_date');
  if(NEED_REV.has(type))check(Number.isInteger(expectedRevision)&&expectedRevision>=0,'revision_required');
  return {id,type,familyId,actorUid,payload:JSON.parse(JSON.stringify(payload)),expectedRevision,
   createdAt,status:'pending',attempts:0,receipt:null,error:null};
 }
 function waiting(ops){
  check(Array.isArray(ops),'queue_not_array');
  return ops.filter(x=>WAITING.has(x.status)).slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 }
 function mode({enabled=true,network=true,authenticated=true,serverAvailable=true,conflicts=0,pendingCount=0,permitted=true}={}){
  if(!enabled)return 'local-only';
  if(!permitted)return 'permission-denied';
  if(!authenticated)return 'auth-required';
  if(!network||!serverAvailable)return 'degraded';
  if(conflicts>0)return 'conflict';
  return pendingCount>0?'recovering':'synced';
 }
 function applyResult(op,result){
  check(isObject(op)&&validString(op.id),'bad_operation');
  check(isObject(result)&&typeof result.kind==='string','bad_result');
  if(op.status==='acked')return {...op};
  if(result.kind==='accepted'||result.kind==='duplicate'){
   check(validString(result.receiptId),'missing_server_receipt');
   return {...op,status:'acked',receipt:result.receiptId,error:null};
  }
  const errorKinds=['conflict','offline','timeout','rate_limited','server_error','auth_expired','forbidden'];
  check(errorKinds.includes(result.kind),'unsupported_result');
  const status=result.kind==='conflict'?'conflict':result.kind==='forbidden'?'blocked':'retry';
  return {...op,status,error:result.kind,attempts:op.attempts+1};
 }
 function forFamily(ops,familyId,actorUid){
  return waiting(ops).filter(x=>x.familyId===familyId&&x.actorUid===actorUid);
 }
 function mergeQueue(existing,incoming){
  check(Array.isArray(existing)&&Array.isArray(incoming),'invalid_queues');
  const map=new Map();
  for(const op of [...existing,...incoming]){
   check(isObject(op)&&validString(op.id),'bad_queued_operation');
   const previous=map.get(op.id);
   if(previous){
    check(JSON.stringify([previous.familyId,previous.actorUid,previous.type,previous.payload,previous.expectedRevision])===
     JSON.stringify([op.familyId,op.actorUid,op.type,op.payload,op.expectedRevision]),'same_id_different_payload');
    if(previous.status==='acked')continue;
    if(op.status==='acked'||op.attempts>previous.attempts)map.set(op.id,{...op});
   }else map.set(op.id,{...op});
  }
  return [...map.values()];
 }
 const api=Object.freeze({TYPES,NEED_REV,createOperation,waiting,mode,applyResult,forFamily,mergeQueue});
 if(root)root.XBOutboxContract=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
