/* XiaoBao v1.2.0 P3. IndexedDB-backed durable outbox, deliberately
 * NOT imported by v1.1.2 production PWA and NEVER reads legacy localStorage.
 *
 * Guarantees only within one browser origin whose storage still exists:
 * - enlist an immutable operation in a single IndexedDB transaction
 * - do not return success until the transaction commits
 * - only ACK a receipt with the original operation ID
 * - preserve queue across reloads; login + family scopes are enforced locally
 * - forbid any automatic network calls or implicit upload at import time
 */
(function(root){
 'use strict';
 const DB_NAME='xiaobao-family-sync-v1';
 const DB_VERSION=1;
 const STORE='operations';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const SENDABLE=new Set(['pending','retry']);
 const OUTSTANDING=new Set(['pending','retry','conflict','blocked']);
 function fail(code){throw new Error('outbox_store:'+code);}
 function id(v,name){if(typeof v!=='string'||!UUID.test(v))fail('invalid_'+name);return v;}
 function actor(v){if(typeof v!=='string'||!v||v.length>128)fail('invalid_actor');return v;}
 function scopeOf(scope){
  if(!scope||typeof scope!=='object')fail('scope_required');
  return {familyId:id(scope.familyId,'family_id'),actorUid:actor(scope.actorUid)};
 }
 function stable(v){
  if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
  if(v!==null&&typeof v==='object'){
   const keys=Object.keys(v).sort();
   return '{'+keys.map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
  }
  const s=JSON.stringify(v);
  if(s===undefined)fail('unsupported_payload');
  return s;
 }
 function signature(op){
  return stable({id:op.id,familyId:op.familyId,actorUid:op.actorUid,
   type:op.type,payload:op.payload,expectedRevision:op.expectedRevision,
   createdAt:op.createdAt});
 }
 function clone(x){return JSON.parse(JSON.stringify(x));}
 function create({indexedDB:factory,contract,dbName=DB_NAME}={}){
  if(!factory||typeof factory.open!=='function')fail('indexeddb_unavailable');
  if(!contract||typeof contract.createOperation!=='function'
    ||typeof contract.applyResult!=='function')fail('contract_required');
  if(typeof dbName!=='string'||!dbName.trim())fail('db_name_invalid');
  let dbPromise=null;
  function database(){
   if(dbPromise)return dbPromise;
   dbPromise=new Promise((resolve,reject)=>{
    let request;
    try{request=factory.open(dbName,DB_VERSION);}
    catch(_){reject(new Error('outbox_store:open_failed'));return;}
    request.onupgradeneeded=()=>{
     const db=request.result;
     if(!db.objectStoreNames.contains(STORE)){
      const store=db.createObjectStore(STORE,{keyPath:'id'});
      store.createIndex('by_identity',['familyId','actorUid'],{unique:false});
     }
    };
    request.onblocked=()=>reject(new Error('outbox_store:open_blocked'));
    request.onerror=()=>reject(new Error('outbox_store:open_failed'));
    request.onsuccess=()=>{
     const db=request.result;
     db.onversionchange=()=>{
      try{db.close();}catch(_){}
      dbPromise=null;
     };
     resolve(db);
    };
   }).catch(e=>{dbPromise=null;throw e;});
   return dbPromise;
  }
  async function run(mode,work){
   const db=await database();
   return new Promise((resolve,reject)=>{
    let tx,output,logicalError=null,finished=false;
    const done=(ok,v)=>{
     if(finished)return;
     finished=true;
     if(ok)resolve(clone(v));
     else reject(v);
    };
    try{tx=db.transaction(STORE,mode);}catch(_){done(false,new Error('outbox_store:transaction_unavailable'));return;}
    tx.oncomplete=()=>logicalError?done(false,logicalError):done(true,output);
    tx.onabort=()=>done(false,logicalError||new Error('outbox_store:transaction_aborted'));
    tx.onerror=()=>{}; // the abort event is authoritative
    const succeed=x=>{output=x;};
    const abort=e=>{
     logicalError=e instanceof Error?e:new Error('outbox_store:transaction_failed');
     try{tx.abort();}catch(_){done(false,logicalError);}
    };
    try{work(tx.objectStore(STORE),succeed,abort);}
    catch(e){abort(e);}
   });
  }
  function validateNewOperation(op){
   if(!op||typeof op!=='object')fail('operation_required');
   id(op.id,'operation_id');id(op.familyId,'family_id');actor(op.actorUid);
   const item=contract.createOperation({
    id:op.id,type:op.type,familyId:op.familyId,
    actorUid:op.actorUid,payload:op.payload,
    expectedRevision:op.expectedRevision??null,createdAt:op.createdAt
   });
   return {...item,_signature:signature(item)};
  }
  function checkIdentity(item,scope){
   if(!item||item.familyId!==scope.familyId||item.actorUid!==scope.actorUid)
    fail('operation_not_in_scope');
  }
  async function enqueue(op){
   const item=validateNewOperation(op);
   return run('readwrite',(store,complete,abort)=>{
    const get=store.get(item.id);
    get.onerror=()=>abort(new Error('outbox_store:read_failed'));
    get.onsuccess=()=>{
     const existing=get.result;
     if(existing){
      if(existing._signature!==item._signature) {
       abort(new Error('outbox_store:same_id_different_payload'));return;
      }
      complete(existing);
      return;
     }
     const add=store.add(item);
     add.onerror=()=>abort(new Error('outbox_store:write_failed'));
     add.onsuccess=()=>complete(item);
    };
   });
  }
  async function get(scopeInput,operationId){
   const scope=scopeOf(scopeInput),oid=id(operationId,'operation_id');
   return run('readonly',(store,complete,abort)=>{
    const req=store.get(oid);
    req.onerror=()=>abort(new Error('outbox_store:read_failed'));
    req.onsuccess=()=>{
     if(!req.result){complete(null);return;}
     try{checkIdentity(req.result,scope);complete(req.result);}
     catch(e){abort(e);}
    };
   });
  }
  async function list(scopeInput,{includeAcked=false}={}){
   const scope=scopeOf(scopeInput);
   return run('readonly',(store,complete,abort)=>{
    const req=store.index('by_identity').getAll([scope.familyId,scope.actorUid]);
    req.onerror=()=>abort(new Error('outbox_store:read_failed'));
    req.onsuccess=()=>{
     const rows=(req.result||[])
      .filter(x=>includeAcked||OUTSTANDING.has(x.status))
      .sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
     complete(rows);
    };
   });
  }
  async function ready(scopeInput){
   const rows=await list(scopeInput);
   return rows.filter(x=>SENDABLE.has(x.status));
  }
  async function recordResult(scopeInput,operationId,result){
   const scope=scopeOf(scopeInput),oid=id(operationId,'operation_id');
   if(!result||typeof result!=='object')fail('result_required');
   if((result.kind==='accepted'||result.kind==='duplicate')&&result.receiptId!==oid)
    fail('receipt_operation_id_mismatch');
   return run('readwrite',(store,complete,abort)=>{
    const req=store.get(oid);
    req.onerror=()=>abort(new Error('outbox_store:read_failed'));
    req.onsuccess=()=>{
     let current;
     try{
      current=req.result;
      checkIdentity(current,scope);
      const updated=contract.applyResult(current,result);
      if(updated.id!==current.id||updated.familyId!==current.familyId
        ||updated.actorUid!==current.actorUid||updated._signature!==current._signature)
       fail('immutable_operation_changed');
      const put=store.put(updated);
      put.onerror=()=>abort(new Error('outbox_store:write_failed'));
      put.onsuccess=()=>complete(updated);
     }catch(e){abort(e);}
    };
   });
  }
  async function stats(scopeInput){
   const rows=await list(scopeInput,{includeAcked:true});
   const counts={pending:0,retry:0,conflict:0,blocked:0,acked:0};
   for(const row of rows){
    if(!Object.prototype.hasOwnProperty.call(counts,row.status))fail('unknown_status');
    counts[row.status]++;
   }
   return {...counts,total:rows.length,outstanding:rows.length-counts.acked};
  }
  return Object.freeze({enqueue,get,list,ready,recordResult,stats});
 }
 const api=Object.freeze({create,DB_NAME,DB_VERSION});
 if(root)root.XBDurableOutbox=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
