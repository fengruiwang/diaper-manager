const test=require('node:test');
const assert=require('node:assert/strict');
const Contract=require('../sync/outbox-contract.js');
const Durable=require('../sync/idb-outbox.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const OTHER='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const O1='397b1791-b8d0-4d63-82d6-c5b829240f42';
const O2='e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64';
const scope={familyId:F,actorUid:'user-dad'};
const otherScope={familyId:F,actorUid:'user-mom'};
const remoteScope={familyId:OTHER,actorUid:'user-dad'};
function op(id=O1,options={}){
 return {id,type:'inventory.delta',familyId:F,actorUid:'user-dad',
  payload:{kind:'buy',size:'S',amount:60,brand:'好奇'},
  createdAt:'2026-11-10T08:30:00Z',expectedRevision:null,...options};
}
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function fakeIndexedDB(){
 const databases=new Map();
 return {
  open(name,version){
   const r={result:null,onupgradeneeded:null,onsuccess:null,onerror:null,onblocked:null};
   queueMicrotask(()=>{
    let backing=databases.get(name),fresh=!backing;
    if(fresh){backing={records:new Map(),indexes:new Set()};databases.set(name,backing);}
    const db={
     objectStoreNames:{contains:n=>n==='operations'&&!fresh||backing.indexes.has('operations')},
     createObjectStore(n){
      if(n!=='operations')throw Error('unexpected store');
      backing.indexes.add('operations');
      return {createIndex(index){backing.indexes.add(index)}};
     },
     close(){},
     transaction(name,mode){
      if(name!=='operations')throw Error('unexpected store');
      let copy=new Map([...backing.records].map(([k,v])=>[k,clone(v)]));
      let outstanding=0,aborted=false,finished=false;
      const tx={oncomplete:null,onabort:null,onerror:null,abort(){
       if(aborted||finished)return;
       aborted=true;
       queueMicrotask(()=>tx.onabort?.());
      }};
      function scheduleFinish(){
       setTimeout(()=>{
        if(finished||aborted||outstanding)return;
        finished=true;
        if(mode==='readwrite')backing.records=copy;
        tx.oncomplete?.();
       },0);
      }
      function req(work){
       const r={result:undefined,error:null,onsuccess:null,onerror:null};
       outstanding++;
       queueMicrotask(()=>{
        if(aborted){outstanding--;return;}
        try{
         r.result=work();
         r.onsuccess?.({target:r});
        }catch(error){
         r.error=error;
         r.onerror?.({target:r});
         tx.abort();
        }finally{outstanding--;scheduleFinish();}
       });
       return r;
      }
      tx.objectStore=()=>({
       get:id=>req(()=>clone(copy.get(id))),
       add:value=>req(()=>{
        if(copy.has(value.id))throw Error('ConstraintError');
        copy.set(value.id,clone(value));return value.id;
       }),
       put:value=>req(()=>{copy.set(value.id,clone(value));return value.id}),
       index:index=>{
        if(index!=='by_identity')throw Error('unexpected index');
        return {getAll:key=>req(()=>[...copy.values()].filter(v=>v.familyId===key[0]
         &&v.actorUid===key[1]).map(clone))};
       }
      });
      scheduleFinish();
      return tx;
     }
    };
    r.result=db;
    if(fresh)r.onupgradeneeded?.({target:r});
    r.onsuccess?.({target:r});
   });
   return r;
  },
  _read(name){return databases.get(name)?.records}
 };
}
function make(factory,name='idb-test'){
 return Durable.create({indexedDB:factory,contract:Contract,dbName:name});
}
test('no IndexedDB writes before first explicit action, even after module import',()=>{
 const f=fakeIndexedDB();
 const x=make(f);
 assert.equal(f._read('idb-test'),undefined);
 assert.equal(typeof x.enqueue,'function');
});
test('a committed event is durable through simulated browser reload',async()=>{
 const f=fakeIndexedDB(),x=make(f);
 const written=await x.enqueue(op());
 assert.equal(written.id,O1);
 assert.equal(written.status,'pending');
 const reloaded=make(f);
 const rows=await reloaded.ready(scope);
 assert.equal(rows.length,1);
 assert.equal(rows[0].id,O1);
 assert.deepEqual(rows[0].payload,op().payload);
});
test('re-enqueue same operation is idempotent and cannot reset durable retry or ACK',async()=>{
 const f=fakeIndexedDB(),x=make(f);
 await x.enqueue(op());
 await x.recordResult(scope,O1,{kind:'timeout'});
 assert.equal((await x.enqueue(op())).status,'retry');
 await x.recordResult(scope,O1,{kind:'duplicate',receiptId:O1});
 assert.equal((await x.enqueue(op())).status,'acked');
 assert.equal((await make(f).ready(scope)).length,0);
 assert.equal((await x.stats(scope)).acked,1);
});
test('same operation ID cannot be used for different price or family or actor',async()=>{
 const x=make(fakeIndexedDB());
 await x.enqueue(op());
 for(const altered of [
  op(O1,{payload:{...op().payload,amount:61}}),
  op(O1,{familyId:OTHER}),
  op(O1,{actorUid:'user-mom'})
 ]){
  await assert.rejects(()=>x.enqueue(altered),/same_id_different_payload/);
 }
 assert.equal((await x.list(scope)).length,1);
});
test('cross-identity list/get/update are denied, not silently copied',async()=>{
 const x=make(fakeIndexedDB());
 await x.enqueue(op(O1));
 await x.enqueue(op(O2,{actorUid:'user-mom'}));
 assert.deepEqual((await x.ready(scope)).map(y=>y.id),[O1]);
 assert.deepEqual((await x.ready(otherScope)).map(y=>y.id),[O2]);
 assert.equal((await x.ready(remoteScope)).length,0);
 await assert.rejects(()=>x.get(otherScope,O1),/operation_not_in_scope/);
 await assert.rejects(()=>x.recordResult(otherScope,O1,{kind:'accepted',receiptId:O1}),/operation_not_in_scope/);
 assert.equal((await x.get(scope,O1)).status,'pending');
});
test('cannot ACK with a mismatched server receipt, timeout remains pending for replay',async()=>{
 const f=fakeIndexedDB(),x=make(f);
 await x.enqueue(op());
 await assert.rejects(()=>x.recordResult(scope,O1,{kind:'accepted',receiptId:O2}),/receipt_operation_id_mismatch/);
 const offline=await x.recordResult(scope,O1,{kind:'offline'});
 assert.equal(offline.status,'retry');
 assert.equal(offline.receipt,null);
 assert.equal((await make(f).ready(scope)).length,1);
 await x.recordResult(scope,O1,{kind:'accepted',receiptId:O1});
 assert.equal((await x.ready(scope)).length,0);
});
test('conflict and permission removal remain visible but not auto-sendable',async()=>{
 const x=make(fakeIndexedDB());
 await x.enqueue(op());
 const conflict=await x.recordResult(scope,O1,{kind:'conflict'});
 assert.equal(conflict.status,'conflict');
 assert.equal((await x.ready(scope)).length,0);
 assert.equal((await x.stats(scope)).outstanding,1);
 const blocked=await x.recordResult(scope,O1,{kind:'forbidden'});
 assert.equal(blocked.status,'blocked');
 assert.equal((await x.list(scope)).length,1);
 assert.equal((await x.ready(scope)).length,0);
});
test('50 offline operations survive reload and retain their distinct IDs',async()=>{
 const f=fakeIndexedDB(),x=make(f);
 const uuids=Array.from({length:50},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
 for(let i=0;i<uuids.length;i++){
  await x.enqueue(op(uuids[i],{payload:{size:'S',amount:i+1}}));
 }
 const reopened=make(f),items=await reopened.ready(scope);
 assert.equal(items.length,50);
 assert.equal(new Set(items.map(row=>row.id)).size,50);
 assert.equal((await reopened.stats(scope)).outstanding,50);
});
test('persistent store fails closed when IndexedDB is unavailable',async()=>{
 assert.throws(()=>make(null),/indexeddb_unavailable/);
 const x=make({open(){throw new Error('SecurityError')}});
 await assert.rejects(()=>x.enqueue(op()),/open_failed/);
});
test('input failures and transaction aborts do not mark operation persisted',async()=>{
 const x=make(fakeIndexedDB());
 await assert.rejects(()=>x.enqueue(op('invalid-id')),/invalid_operation_id/);
 assert.equal((await x.list(scope)).length,0);
 await x.enqueue(op(O1));
 await assert.rejects(()=>x.enqueue(op(O1,{createdAt:'2026-11-10T08:31:00Z'})),/same_id_different_payload/);
 assert.equal((await x.ready(scope)).length,1);
});
