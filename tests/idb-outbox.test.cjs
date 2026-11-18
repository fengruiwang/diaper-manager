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
    if(fresh){backing={stores:new Map(),indexes:new Set()};databases.set(name,backing);}
    const db={
     objectStoreNames:{contains:n=>backing.indexes.has(n)},
     createObjectStore(n){
      if(!['operations','inventory_snapshots'].includes(n))
       throw Error('unexpected store');
      backing.indexes.add(n);
      if(!backing.stores.has(n))backing.stores.set(n,new Map());
      return {createIndex(index){backing.indexes.add(index)}};
     },
     close(){},
     transaction(names,mode){
      if(!Array.isArray(names)||!names.length
        ||names.some(n=>!backing.stores.has(n)))
       throw Error('unexpected stores');
      const copies=new Map(names.map(n=>[n,
       new Map([...backing.stores.get(n)].map(([k,v])=>[k,clone(v)]))]));
      let outstanding=0,aborted=false,finished=false;
      const tx={oncomplete:null,onabort:null,onerror:null,abort(){
       if(aborted||finished)return;
       aborted=true;queueMicrotask(()=>tx.onabort?.());
      }};
      function scheduleFinish(){
       setTimeout(()=>{
        if(finished||aborted||outstanding)return;
        finished=true;
        if(mode==='readwrite')
         for(const [store,records] of copies)backing.stores.set(store,records);
        tx.oncomplete?.();
       },0);
      }
      function req(work){
       const r={result:undefined,error:null,onsuccess:null,onerror:null};
       outstanding++;
       queueMicrotask(()=>{
        if(aborted){outstanding--;return;}
        try{r.result=work();r.onsuccess?.({target:r});}
        catch(error){r.error=error;r.onerror?.({target:r});tx.abort();}
        finally{outstanding--;scheduleFinish();}
       });
       return r;
      }
      tx.objectStore=name=>{
       if(!copies.has(name))throw Error('store_not_in_transaction');
       const records=copies.get(name);
       const keyOf=value=>name==='operations'?value.id:value.key;
       const store={
        get:key=>req(()=>clone(records.get(key))),
        add:value=>req(()=>{
         const key=keyOf(value);
         if(records.has(key))throw Error('ConstraintError');
         records.set(key,clone(value));return key;
        }),
        put:value=>req(()=>{
         const key=keyOf(value);records.set(key,clone(value));return key;
        })
       };
       if(name==='operations')store.index=index=>{
        if(index!=='by_identity')throw Error('unexpected index');
        return {getAll:key=>req(()=>[...records.values()]
         .filter(v=>v.familyId===key[0]&&v.actorUid===key[1]).map(clone))};
       };
       return store;
      };
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
  _read(name,store='operations'){return databases.get(name)?.stores.get(store);}
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

const CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const SIZES=['NB','S','M','L','XL','XXL'];
function stock(s=100){return Object.fromEntries(SIZES.map(k=>[k,k==='S'?s:0]));}
function revisions(s=2){return Object.fromEntries(SIZES.map(k=>[k,k==='S'?s:1]));}
function delta(id=O1,child=CHILD){
 return Contract.createOperation({id,type:'inventory.delta',familyId:F,
  actorUid:'user-dad',expectedRevision:null,
  createdAt:'2026-11-18T10:00:00.000Z',
  payload:{childId:child,kind:'buy',size:'S',amount:5,
   purchase:{brand:'好奇',series:'小森林',totalFen:500,
    purchaseDate:'2026-11-18'}}});
}
function verifiedUpdate(s=120,rev=3,child=CHILD){
 return {childId:child,inventory:stock(s),serverRevisions:revisions(rev)};
}
test('T02-P1-02 verified refresh updates an existing six-size snapshot and preserves local fields',async()=>{
 const f=fakeIndexedDB(),x=make(f,'refresh-update');
 const initial=await x.initializeInventory(scope,{childId:CHILD,
  inventory:stock(100),serverRevisions:revisions(2),source:'verified-server'});
 const op=delta();
 await x.commitInventory(scope,op);
 await x.recordDeltaAck(scope,O1,{operationId:O1,childId:CHILD,
  size:'S',quantity:105,revision:3,duplicate:false});
 const before=await x.readInventory(scope,CHILD);
 const result=await x.updateVerifiedInventory(scope,verifiedUpdate(120,4));
 assert.equal(result.status,'UPDATED');
 const after=await x.readInventory(scope,CHILD);
 assert.equal(after.inventory.S,120);
 assert.equal(after.serverRevisions.S,4);
 assert.equal(after.source,'verified-server');
 assert.equal(after.localRevision,before.localRevision);
 assert.deepEqual(after.transactions,before.transactions);
 assert.equal(after.transactions.length,1);
 assert.equal(after.transactions[0].id,O1);
 assert.equal(after.familyId,initial.familyId);
 assert.equal(after.actorUid,initial.actorUid);
 assert.equal(after.childId,CHILD);
 assert.equal(after.key,before.key,'storage identity is preserved');
});
test('T02-P1-02 pending, retry, conflict and blocked 009 operations prevent baseline replacement',async()=>{
 const cases=[
  ['pending',null],['retry',{kind:'timeout'}],
  ['conflict',{kind:'conflict'}],['blocked',{kind:'forbidden'}]
 ];
 for(const [status,result] of cases){
  const x=make(fakeIndexedDB(),'queue-'+status);
  await x.initializeInventory(scope,{childId:CHILD,inventory:stock(100),
   serverRevisions:revisions(2),source:'verified-server'});
  await x.enqueue(delta());
  if(result)await x.recordResult(scope,O1,result);
  const before=await x.readInventory(scope,CHILD);
  const answer=await x.updateVerifiedInventory(scope,verifiedUpdate(160,3));
  assert.equal(answer.status,'LOCAL_OPERATIONS_PENDING',status);
  assert.equal(answer.outstanding,1);
  const after=await x.readInventory(scope,CHILD);
  assert.deepEqual(after,before);
  const rows=await x.list(scope,{includeAcked:true});
  assert.equal(rows[0].id,O1);
  assert.equal(rows[0].status,status);
  assert.deepEqual(rows[0].payload,delta().payload);
 });
});
test('T02-P1-02 ACKed and abandoned history does not block a verified baseline update or initialization',async()=>{
 const x=make(fakeIndexedDB(),'terminal-history');
 await x.enqueue(delta(O1));
 await x.recordResult(scope,O1,{kind:'accepted',receiptId:O1});
 const stocktake=Contract.createOperation({id:O2,type:'inventory.count',
  familyId:F,actorUid:'user-dad',expectedRevision:2,
  createdAt:'2026-11-18T10:01:00.000Z',
  payload:{childId:CHILD,kind:'stocktake',size:'S',count:90}});
 await x.enqueue(stocktake);
 await x.abandonSingleStocktakeConflict(scope,O2);
 const initial=await x.initializeInventory(scope,{childId:CHILD,
  inventory:stock(100),serverRevisions:revisions(2),source:'verified-server'});
 assert.equal(initial.inventory.S,100);
 const answer=await x.updateVerifiedInventory(scope,verifiedUpdate(110,3));
 assert.equal(answer.status,'UPDATED');
 assert.equal((await x.readInventory(scope,CHILD)).inventory.S,110);
 const history=await x.list(scope,{includeAcked:true});
 assert.deepEqual(history.map(x=>x.status).sort(),['abandoned','acked']);
});
test('T02-P1-02 lower server revision and equal-revision quantity mismatch never overwrite the snapshot',async()=>{
 const x=make(fakeIndexedDB(),'revision-guard');
 await x.initializeInventory(scope,{childId:CHILD,inventory:stock(100),
  serverRevisions:revisions(3),source:'verified-server'});
 const lower=await x.updateVerifiedInventory(scope,verifiedUpdate(90,2));
 assert.equal(lower.status,'SERVER_REVISION_ROLLBACK');
 assert.equal((await x.readInventory(scope,CHILD)).inventory.S,100);
 const mismatch=await x.updateVerifiedInventory(scope,verifiedUpdate(90,3));
 assert.equal(mismatch.status,'SERVER_REVISION_QUANTITY_MISMATCH');
 assert.equal((await x.readInventory(scope,CHILD)).inventory.S,100);
 const newer=await x.updateVerifiedInventory(scope,verifiedUpdate(110,4));
 assert.equal(newer.status,'UPDATED');
 assert.equal((await x.readInventory(scope,CHILD)).inventory.S,110);
});
test('T02-P1-02 family, actor and child scopes cannot update another snapshot',async()=>{
 const x=make(fakeIndexedDB(),'scope-guard');
 await x.initializeInventory(scope,{childId:CHILD,inventory:stock(100),
  serverRevisions:revisions(2),source:'verified-server'});
 const otherChild='e7d936c8-00c1-45c9-8d2e-6f1424f97c91';
 const wrongActor=await x.updateVerifiedInventory(otherScope,
  verifiedUpdate(160,3,CHILD));
 const wrongFamily=await x.updateVerifiedInventory(remoteScope,
  verifiedUpdate(160,3,CHILD));
 const wrongChild=await x.updateVerifiedInventory(scope,
  verifiedUpdate(160,3,otherChild));
 assert.equal(wrongActor.status,'SNAPSHOT_NOT_INITIALIZED');
 assert.equal(wrongFamily.status,'SNAPSHOT_NOT_INITIALIZED');
 assert.equal(wrongChild.status,'SNAPSHOT_NOT_INITIALIZED');
 assert.equal((await x.readInventory(scope,CHILD)).inventory.S,100);
});
