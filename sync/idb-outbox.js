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
 const DB_VERSION=2;
 const STORE='operations';
 const SNAPSHOTS='inventory_snapshots';
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
 function create({indexedDB:factory,contract,projection=null,reconciler=null,dbName=DB_NAME}={}){
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
     // Version 1 outbox records are never dropped or rewritten by v2 upgrade.
     if(!db.objectStoreNames.contains(SNAPSHOTS))
      db.createObjectStore(SNAPSHOTS,{keyPath:'key'});
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
  async function run(mode,work,storeNames=[STORE]){
   const db=await database();
   return new Promise((resolve,reject)=>{
    let tx,output,logicalError=null,finished=false;
    const done=(ok,v)=>{
     if(finished)return;
     finished=true;
     if(ok)resolve(clone(v));
     else reject(v);
    };
    try{tx=db.transaction(storeNames,mode);}catch(_){done(false,new Error('outbox_store:transaction_unavailable'));return;}
    tx.oncomplete=()=>logicalError?done(false,logicalError):done(true,output);
    tx.onabort=()=>done(false,logicalError||new Error('outbox_store:transaction_aborted'));
    tx.onerror=()=>{}; // the abort event is authoritative
    const succeed=x=>{output=x;};
    const abort=e=>{
     logicalError=e instanceof Error?e:new Error('outbox_store:transaction_failed');
     try{tx.abort();}catch(_){done(false,logicalError);}
    };
    try{work(tx.objectStore(storeNames[0]),succeed,abort,tx);}
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

  function identityKey(scope,childId){
   const item=scopeOf(scope);
   return JSON.stringify([item.familyId,item.actorUid,id(childId,'child_id')]);
  }
  function requiredProjection(){
   if(!projection||typeof projection.createSnapshot!=='function'
     ||typeof projection.apply!=='function')fail('projection_required');
  }
  // Only explicit, already-verified baseline initialization is allowed;
  // callers must not pass default empty stock for an existing family.
  async function initializeInventory(scopeInput,{childId,inventory,serverRevisions,source}={}){
   requiredProjection();
   const scope=scopeOf(scopeInput),key=identityKey(scope,childId);
   const initial=projection.createSnapshot({
    familyId:scope.familyId,actorUid:scope.actorUid,childId,
    inventory,serverRevisions,source
   });
   const record={key,...initial};
   return run('readwrite',(operations,complete,abort,tx)=>{
    const snapshots=tx.objectStore(SNAPSHOTS);
    const read=snapshots.get(key);
    read.onerror=()=>abort(new Error('outbox_store:snapshot_read_failed'));
    read.onsuccess=()=>{
     if(read.result){
      abort(new Error('outbox_store:snapshot_already_initialized'));return;
     }
     // Old v1 outbox operations cannot be silently ignored when a baseline
     // arrives later. Never overwrite a pending event by seeding a new stock.
     const queued=operations.index('by_identity').getAll([scope.familyId,scope.actorUid]);
     queued.onerror=()=>abort(new Error('outbox_store:read_failed'));
     queued.onsuccess=()=>{
      if((queued.result||[]).some(x=>x.payload?.childId===childId)){
       abort(new Error('outbox_store:queue_exists_before_baseline'));return;
      }
      const insert=snapshots.add(record);
      insert.onerror=()=>abort(new Error('outbox_store:snapshot_write_failed'));
      insert.onsuccess=()=>complete(record);
     };
    };
   },[STORE,SNAPSHOTS]);
  }
  async function readInventory(scopeInput,childId){
   const scope=scopeOf(scopeInput),key=identityKey(scope,childId);
   return run('readonly',(snapshots,complete,abort)=>{
    const req=snapshots.get(key);
    req.onerror=()=>abort(new Error('outbox_store:snapshot_read_failed'));
    req.onsuccess=()=>complete(req.result||null);
   },[SNAPSHOTS]);
  }
  // The local inventory projection and network outbox event must commit
  // atomically in the SAME IndexedDB transaction. Never mutate old localStorage.
  async function commitInventory(scopeInput,operation){
   requiredProjection();
   const scope=scopeOf(scopeInput),item=validateNewOperation(operation);
   if(item.familyId!==scope.familyId||item.actorUid!==scope.actorUid)
    fail('operation_not_in_scope');
   const childId=id(item.payload?.childId,'child_id');
   const key=identityKey(scope,childId);
   return run('readwrite',(operations,complete,abort,tx)=>{
    const snapshots=tx.objectStore(SNAPSHOTS);
    const snapReq=snapshots.get(key);
    snapReq.onerror=()=>abort(new Error('outbox_store:snapshot_read_failed'));
    snapReq.onsuccess=()=>{
     if(!snapReq.result){
      abort(new Error('outbox_store:snapshot_not_initialized'));return;
     }
     const opReq=operations.get(item.id);
     opReq.onerror=()=>abort(new Error('outbox_store:read_failed'));
     opReq.onsuccess=()=>{
      const existing=opReq.result;
      if(existing){
       if(existing._signature!==item._signature){
        abort(new Error('outbox_store:same_id_different_payload'));return;
       }
       if(existing.familyId!==scope.familyId||existing.actorUid!==scope.actorUid)
        {abort(new Error('outbox_store:operation_not_in_scope'));return;}
       complete({duplicate:true,operation:existing,snapshot:snapReq.result});
       return;
      }
      let next;
      try{next=projection.apply(snapReq.result,item);}
      catch(e){abort(e);return;}
      if(next.familyId!==scope.familyId||next.actorUid!==scope.actorUid
        ||next.childId!==childId){
       abort(new Error('outbox_store:projection_identity_changed'));return;
      }
      const stored={...next,key};
      let writes=0;
      const finish=()=>{
       writes++;
       if(writes===2)complete({duplicate:false,operation:item,snapshot:stored});
      };
      const writeSnapshot=snapshots.put(stored);
      writeSnapshot.onerror=()=>abort(new Error('outbox_store:snapshot_write_failed'));
      writeSnapshot.onsuccess=finish;
      const writeOperation=operations.add(item);
      writeOperation.onerror=()=>abort(new Error('outbox_store:write_failed'));
      writeOperation.onsuccess=finish;
     };
    };
   },[STORE,SNAPSHOTS]);
  }

  function requiredReconciler(){
   if(!reconciler||typeof reconciler.build!=='function')
    fail('reconciler_required');
  }
  // The caller must request ALL IDs, including already-ACKed IDs, from the
  // server. Never truncate to 50: that could silently erase evidence that a
  // previously confirmed cloud operation has disappeared.
  async function reconciliationIds(scopeInput,childId){
   const scope=scopeOf(scopeInput),child=id(childId,'child_id');
   const rows=await list(scope,{includeAcked:true});
   const matches=rows.filter(row=>row.payload?.childId===child);
   if(matches.length>50)fail('reconciliation_requires_pagination');
   return matches.map(row=>row.id);
  }
  // Runs only AFTER explicit authenticated server snapshot read.
  // No legacy localStorage writes; both the local projection and all receipt
  // ACKs commit or roll back together. A changed local queue after the remote
  // read causes 'stale_checked_set', not an overwrite of a newer local edit.
  async function reconcileInventory(scopeInput,childId,response){
   requiredReconciler();
   const scope=scopeOf(scopeInput),child=id(childId,'child_id');
   const key=identityKey(scope,child);
   return run('readwrite',(opsStore,complete,abort,tx)=>{
    const snaps=tx.objectStore(SNAPSHOTS);
    const pendingReq=opsStore.index('by_identity').getAll([scope.familyId,scope.actorUid]);
    pendingReq.onerror=()=>abort(new Error('outbox_store:read_failed'));
    pendingReq.onsuccess=()=>{
     const scoped=(pendingReq.result||[]).filter(op=>op.payload?.childId===child);
     if(scoped.length>50){
      abort(new Error('outbox_store:reconciliation_requires_pagination'));return;
     }
     const snapReq=snaps.get(key);
     snapReq.onerror=()=>abort(new Error('outbox_store:snapshot_read_failed'));
     snapReq.onsuccess=()=>{
      if(!snapReq.result){
       abort(new Error('outbox_store:snapshot_not_initialized'));return;
      }
      let plan,updates;
      try{
       plan=reconciler.build({snapshot:snapReq.result,operations:scoped,response});
       const seen=new Set(plan.acknowledgedIds);
       updates=scoped.filter(op=>seen.has(op.id)).map(op=>{
        const updated=contract.applyResult(op,{kind:'accepted',receiptId:op.id});
        if(updated.id!==op.id||updated._signature!==op._signature
          ||updated.actorUid!==op.actorUid||updated.familyId!==op.familyId)
         fail('reconcile_operation_identity_changed');
        return updated;
       });
      }catch(e){abort(e);return;}
      const stored={...plan.snapshot,key};
      const total=1+updates.length;
      let completed=0;
      const success=()=>{
       completed++;
       if(completed===total)complete({
        snapshot:stored,acknowledgedIds:plan.acknowledgedIds,
        pendingCount:plan.pendingCount,status:plan.status
       });
      };
      const snapshotWrite=snaps.put(stored);
      snapshotWrite.onerror=()=>abort(new Error('outbox_store:snapshot_write_failed'));
      snapshotWrite.onsuccess=success;
      for(const row of updates){
       const write=opsStore.put(row);
       write.onerror=()=>abort(new Error('outbox_store:receipt_write_failed'));
       write.onsuccess=success;
      }
     };
    };
   },[STORE,SNAPSHOTS]);
  }
  return Object.freeze({enqueue,get,list,ready,recordResult,stats,initializeInventory,readInventory,commitInventory,reconciliationIds,reconcileInventory});
 }
 const api=Object.freeze({create,DB_NAME,DB_VERSION});
 if(root)root.XBDurableOutbox=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
