const test=require('node:test');
const assert=require('node:assert/strict');
const Outbox=require('../sync/idb-outbox.js');
const Contract=require('../sync/outbox-contract.js');
const Projection=require('../sync/inventory-local-projection.js');
const Reconciler=require('../sync/inventory-reconciler.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const CHILD='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const O1='397b1791-b8d0-4d63-82d6-c5b829240f42';
const O2='e26ec34a-30cd-4e4f-8f3f-cc5a6cd6ed64';
const O3='780d45fe-dd5b-48c8-9660-ec14d4c0bb96';
const O4='dddb23ca-895a-4b1b-b5e0-672e0e4f4d23';
const dad={familyId:FAMILY,actorUid:'test-dad'};
const mom={familyId:FAMILY,actorUid:'test-mom'};
const deep=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const stock=(S=0)=>({NB:0,S,M:0,L:0,XL:0,XXL:0});
const source='test-fixture';
function purchase(){return {brand:'好奇',series:'小森林',totalFen:2999,purchaseDate:'2026-11-10'};}
function event(id=O1,more={}){
 const base={id,type:'inventory.delta',familyId:FAMILY,actorUid:dad.actorUid,
  expectedRevision:null,createdAt:'2026-11-10T08:30:00Z',
  payload:{childId:CHILD,kind:'buy',size:'S',amount:60,
   purchase:purchase(),occurredAt:'2026-11-10T08:30:00Z'}};
 return {...base,...more,payload:{...base.payload,...(more.payload||{})}};
}
function idbFake(){
 const databases=new Map();
 let failNextOperationAdd=false,failNextOperationPut=false;
 function indexedDBRecord(name){return databases.get(name)}
 return {
  _db:indexedDBRecord,
  failOperationAdd(){failNextOperationAdd=true},
  failOperationPut(){failNextOperationPut=true},
  open(name,version){
   const request={onupgradeneeded:null,onerror:null,onsuccess:null,onblocked:null,result:null,error:null};
   queueMicrotask(()=>{
    let state=databases.get(name);
    if(!state){state={version:0,stores:new Map()};databases.set(name,state);}
    if(version<state.version){
     request.error=Error('VersionError');request.onerror?.({target:request});return;
    }
    const db={
     objectStoreNames:{contains:key=>state.stores.has(key)},
     createObjectStore(key,{keyPath}){
      if(state.stores.has(key))throw Error('already_exists');
      state.stores.set(key,{keyPath,rows:new Map(),indexes:new Map()});
      return {createIndex(index,fields){state.stores.get(key).indexes.set(index,fields)}};
     },
     close(){},
     transaction(storeNames,mode){
      if(!Array.isArray(storeNames))throw Error('names_must_be_array');
      if(storeNames.some(x=>!state.stores.has(x)))throw Error('missing_store');
      let pending=0,aborted=false,complete=false;
      const copies=new Map(storeNames.map(name=>[
       name,new Map([...state.stores.get(name).rows].map(([k,v])=>[k,deep(v)]))
      ]));
      const tx={oncomplete:null,onabort:null,onerror:null,abort(){
       if(aborted||complete)return;
       aborted=true;
       queueMicrotask(()=>tx.onabort?.());
      }};
      function maybeFinish(){
       setTimeout(()=>{
        if(aborted||complete||pending)return;
        complete=true;
        if(mode==='readwrite'){
         for(const [name,rows] of copies)state.stores.get(name).rows=rows;
        }
        tx.oncomplete?.();
       },0);
      }
      function requestFor(action){
       const req={result:undefined,error:null,onsuccess:null,onerror:null};
       pending++;
       queueMicrotask(()=>{
        if(aborted){pending--;return;}
        try{
         req.result=deep(action());
         req.onsuccess?.({target:req});
        }catch(e){
         req.error=e;req.onerror?.({target:req});
         tx.abort();
        }finally{pending--;maybeFinish();}
       });
       return req;
      }
      tx.objectStore=name=>{
       const rows=copies.get(name),schema=state.stores.get(name);
       if(!rows||!schema)throw Error('unknown_object_store');
       const get=id=>requestFor(()=>rows.get(id));
       const put=value=>requestFor(()=>{
        if(mode!=='readwrite')throw Error('readonly');
        if(name==='operations'&&failNextOperationPut){
         failNextOperationPut=false;throw Error('QuotaExceededError');
        }
        rows.set(value[schema.keyPath],deep(value));
        return value[schema.keyPath];
       });
       const add=value=>requestFor(()=>{
        if(mode!=='readwrite')throw Error('readonly');
        if(name==='operations'&&failNextOperationAdd){
         failNextOperationAdd=false;throw Error('QuotaExceededError');
        }
        const key=value[schema.keyPath];
        if(rows.has(key))throw Error('ConstraintError');
        rows.set(key,deep(value));return key;
       });
       const index=idx=>{
        const fields=schema.indexes.get(idx);
        if(!fields)throw Error('index_missing');
        return {getAll:key=>requestFor(()=>[...rows.values()].filter(r=>
         Array.isArray(fields)&&fields.every((f,i)=>r[f]===key[i])))};
       };
       return {get,add,put,index};
      };
      maybeFinish();
      return tx;
     }
    };
    request.result=db;
    if(version>state.version){
     request.onupgradeneeded?.({target:request,oldVersion:state.version});
     state.version=version;
    }
    request.onsuccess?.({target:request});
   });
   return request;
  }
 };
}
const make=(idb,name='atomic-v2')=>Outbox.create({
 indexedDB:idb,contract:Contract,projection:Projection,reconciler:Reconciler,dbName:name
});
async function seeded({scope=dad,s=0,db=null,name='atomic-v2'}={}){
 const idb=db||idbFake(),store=make(idb,name);
 await store.initializeInventory(scope,{
  childId:CHILD,inventory:stock(s),source
 });
 return {idb,store};
}
test('v2 creates separate inventory snapshot without touching old key',async()=>{
 const {idb,store}=await seeded({s:10});
 const snap=await store.readInventory(dad,CHILD);
 assert.equal(snap.inventory.S,10);
 assert.equal(snap.localRevision,0);
 assert.equal(idb._db('atomic-v2').version,2);
 assert.ok(idb._db('atomic-v2').stores.has('inventory_snapshots'));
 assert.ok(idb._db('atomic-v2').stores.has('operations'));
});
test('purchase commits snapshot and outbox together; data survives app reload',async()=>{
 const {idb,store}=await seeded({s:10});
 const r=await store.commitInventory(dad,event());
 assert.equal(r.duplicate,false);
 assert.equal(r.snapshot.inventory.S,70);
 assert.equal(r.snapshot.transactions[0].totalFen,2999);
 assert.equal(r.operation.id,O1);
 const restarted=make(idb);
 assert.equal((await restarted.readInventory(dad,CHILD)).inventory.S,70);
 assert.deepEqual((await restarted.ready(dad)).map(x=>x.id),[O1]);
});
test('injected operation-store write failure atomically rolls back inventory',async()=>{
 const {idb,store}=await seeded({s:10});
 idb.failOperationAdd();
 await assert.rejects(()=>store.commitInventory(dad,event()),/write_failed/);
 assert.equal((await store.readInventory(dad,CHILD)).inventory.S,10);
 assert.equal((await store.ready(dad)).length,0);
 const retried=await store.commitInventory(dad,event());
 assert.equal(retried.snapshot.inventory.S,70);
});
test('projection rejection does not write any outbox event or change stock',async()=>{
 const {store}=await seeded({s:10});
 await assert.rejects(()=>store.commitInventory(dad,event(O1,{
  type:'inventory.delta',payload:{kind:'use',amount:11,purchase:null}
 })),/inventory_out_of_bounds/);
 assert.equal((await store.readInventory(dad,CHILD)).inventory.S,10);
 assert.equal((await store.ready(dad)).length,0);
});
test('same operation replay cannot double-add; changing price or identity is denied',async()=>{
 const {store}=await seeded();
 await store.commitInventory(dad,event());
 const again=await store.commitInventory(dad,event());
 assert.equal(again.duplicate,true);
 assert.equal(again.snapshot.inventory.S,60);
 assert.equal((await store.ready(dad)).length,1);
 await assert.rejects(()=>store.commitInventory(dad,event(O1,{
  payload:{purchase:{...purchase(),totalFen:3000}}
 })),/same_id_different_payload/);
 await assert.rejects(()=>store.commitInventory(mom,event()),/operation_not_in_scope/);
 assert.equal((await store.readInventory(dad,CHILD)).localRevision,1);
});
test('two accounts in same family do not share local queue/snapshot by accident',async()=>{
 const idb=idbFake(),dadStore=make(idb);
 await dadStore.initializeInventory(dad,{childId:CHILD,inventory:stock(30),source});
 await dadStore.initializeInventory(mom,{childId:CHILD,inventory:stock(30),source});
 await dadStore.commitInventory(dad,event(O1));
 await dadStore.commitInventory(mom,event(O2,{actorUid:mom.actorUid,
  payload:{kind:'use',amount:2,purchase:null}}));
 assert.equal((await dadStore.readInventory(dad,CHILD)).inventory.S,90);
 assert.equal((await dadStore.readInventory(mom,CHILD)).inventory.S,28);
 assert.deepEqual((await dadStore.ready(dad)).map(x=>x.id),[O1]);
 assert.deepEqual((await dadStore.ready(mom)).map(x=>x.id),[O2]);
});
test('buy/use/stocktake/reversal preserve exact amounts and cancellation history',async()=>{
 const {store}=await seeded({s:20});
 await store.commitInventory(dad,event(O1));
 await store.commitInventory(dad,event(O2,{payload:{kind:'use',amount:10,purchase:null}}));
 const count=event(O3,{type:'inventory.count',expectedRevision:0,
  payload:{size:'S',count:60,purchase:null}});
 await store.commitInventory(dad,count);
 const reverse=event(O4,{type:'transaction.reverse',payload:{
  size:'S',reversesOperationId:O1,purchase:null
 }});
 const r=await store.commitInventory(dad,reverse);
 assert.equal(r.snapshot.inventory.S,0); // after 80 + purchase, -10 use, stocktake 60, -60 reverse
 assert.equal(r.snapshot.transactions.length,4);
 assert.equal(r.snapshot.transactions[0].reversedBy,O4);
 await assert.rejects(()=>store.commitInventory(dad,event(
  'f1e69174-b9d4-46ef-a1aa-24897dd528a0',{type:'transaction.reverse',payload:{
   size:'S',reversesOperationId:O1,purchase:null}
  })),/already_reversed/);
});
test('seed never resets an already initialized local snapshot',async()=>{
 const {store}=await seeded({s:17});
 await assert.rejects(()=>store.initializeInventory(dad,{
  childId:CHILD,inventory:stock(0),source
 }),/snapshot_already_initialized/);
 assert.equal((await store.readInventory(dad,CHILD)).inventory.S,17);
});
test('v1 operations survive upgrade and prevent unsafe stock reseeding',async()=>{
 const idb=idbFake(),old=Outbox.create({indexedDB:idb,contract:Contract,dbName:'v1upgrade'});
 await old.enqueue(event());
 // Simulate the first release's schema by removing new snapshot store and
 // resetting schemaVersion only; the original operation record is untouched.
 const backing=idb._db('v1upgrade');
 backing.version=1;
 backing.stores.delete('inventory_snapshots');
 const fresh=make(idb,'v1upgrade');
 assert.equal((await fresh.ready(dad)).length,1);
 await assert.rejects(()=>fresh.initializeInventory(dad,{
  childId:CHILD,inventory:stock(0),source
 }),/queue_exists_before_baseline/);
 assert.equal((await fresh.ready(dad)).length,1);
});
test('a missing verified inventory baseline blocks all writes',async()=>{
 const store=make(idbFake());
 await assert.rejects(()=>store.commitInventory(dad,event()),/snapshot_not_initialized/);
 assert.equal((await store.ready(dad)).length,0);
});
test('50 independent offline purchases remain durable with matching stock and event count',async()=>{
 const {idb,store}=await seeded();
 for(let i=0;i<50;i++){
  const uuid='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
  await store.commitInventory(dad,event(uuid,{payload:{amount:1}}));
 }
 const reopened=make(idb),snapshot=await reopened.readInventory(dad,CHILD);
 assert.equal(snapshot.inventory.S,50);
 assert.equal(snapshot.transactions.length,50);
 assert.equal((await reopened.ready(dad)).length,50);
});

const SIZES=['NB','S','M','L','XL','XXL'];
function server({ids=[],seen=[],qty=0,rev=0,actor='test-dad',family=FAMILY}={}){
 return {familyId:family,childId:CHILD,actorUid:actor,
  complete:true,checkedOperationIds:ids,seenOperationIds:seen,
  rows:SIZES.map(size=>({size,quantity:size==='S'?qty:0,revision:size==='S'?rev:0}))};
}
test('ACK lost after server commit: reconciliation confirms purchase but NEVER double-adds it',async()=>{
 const {idb,store}=await seeded();
 await store.commitInventory(dad,event(O1)); // local 60
 const ids=await store.reconciliationIds(dad,CHILD);
 assert.deepEqual(ids,[O1]);
 const result=await store.reconcileInventory(dad,CHILD,server({ids,seen:[O1],qty:60,rev:1}));
 assert.equal(result.snapshot.inventory.S,60);
 assert.equal(result.pendingCount,0);
 assert.deepEqual(result.acknowledgedIds,[O1]);
 assert.equal((await store.ready(dad)).length,0);
 const reopened=make(idb);
 assert.equal((await reopened.readInventory(dad,CHILD)).inventory.S,60);
 assert.equal((await reopened.get(dad,O1)).status,'acked');
});
test('remote mom purchase plus local dad pending buy: 80 + 60 = provisional 140',async()=>{
 const {store}=await seeded();
 await store.commitInventory(dad,event(O1));
 const ids=await store.reconciliationIds(dad,CHILD);
 const result=await store.reconcileInventory(dad,CHILD,server({ids,seen:[],qty:80,rev:1}));
 assert.equal(result.snapshot.inventory.S,140);
 assert.equal(result.pendingCount,1);
 assert.equal(result.status,'local-pending');
 assert.equal((await store.ready(dad)).length,1);
 assert.equal((await store.readInventory(dad,CHILD)).serverRevisions.S,1);
});
test('changed local queue during remote read causes atomic rejection with no data loss',async()=>{
 const {store}=await seeded();
 await store.commitInventory(dad,event(O1));
 const before=await store.readInventory(dad,CHILD);
 await assert.rejects(()=>store.reconcileInventory(dad,CHILD,
  server({ids:[],seen:[],qty:50,rev:1})),/stale_checked_set/);
 assert.deepEqual(await store.readInventory(dad,CHILD),before);
 assert.equal((await store.ready(dad)).length,1);
});
test('receipt ACK IDB write fails: server baseline and ACK are both rolled back',async()=>{
 const {idb,store}=await seeded();
 await store.commitInventory(dad,event(O1));
 idb.failOperationPut();
 await assert.rejects(()=>store.reconcileInventory(dad,CHILD,
  server({ids:[O1],seen:[O1],qty:60,rev:1})),/receipt_write_failed/);
 assert.equal((await store.readInventory(dad,CHILD)).serverRevisions.S,0);
 assert.equal((await store.readInventory(dad,CHILD)).inventory.S,60);
 assert.equal((await store.get(dad,O1)).status,'pending');
});
test('pending stocktake is not blindly rebased over remote purchase',async()=>{
 const {store}=await seeded();
 const count=event(O1,{type:'inventory.count',expectedRevision:0,
  payload:{size:'S',count:10,purchase:null}});
 await store.commitInventory(dad,count);
 await assert.rejects(()=>store.reconcileInventory(dad,CHILD,
  server({ids:[O1],seen:[],qty:25,rev:1})),/needs_manual_or_sequential_rebase/);
 assert.equal((await store.readInventory(dad,CHILD)).inventory.S,10);
 assert.equal((await store.get(dad,O1)).status,'pending');
});
test('remote loss of previously ACKed event blocks automatic overwrite',async()=>{
 const {store}=await seeded();
 await store.commitInventory(dad,event(O1));
 await store.recordResult(dad,O1,{kind:'accepted',receiptId:O1});
 await assert.rejects(()=>store.reconcileInventory(dad,CHILD,
  server({ids:[O1],seen:[],qty:0,rev:1})),/confirmed_operation_missing_server/);
 assert.equal((await store.readInventory(dad,CHILD)).inventory.S,60);
 assert.equal((await store.get(dad,O1)).status,'acked');
});
test('reconciliation refuses cross-actor cloud response and does not ack dad events',async()=>{
 const {store}=await seeded();
 await store.commitInventory(dad,event(O1));
 await assert.rejects(()=>store.reconcileInventory(dad,CHILD,
  server({ids:[O1],seen:[O1],qty:60,rev:1,actor:'test-mom'})),/unverified_scope/);
 assert.equal((await store.get(dad,O1)).status,'pending');
});
test('more than 50 outstanding or acked IDs is explicit pagination blocker',async()=>{
 const {store}=await seeded();
 for(let i=0;i<51;i++){
  const id='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
  await store.commitInventory(dad,event(id,{payload:{amount:1}}));
 }
 await assert.rejects(()=>store.reconciliationIds(dad,CHILD),/reconciliation_requires_pagination/);
 assert.equal((await store.readInventory(dad,CHILD)).inventory.S,51);
 assert.equal((await store.ready(dad)).length,51);
});
test('verified server read for empty queue can update local baseline without submitting anything',async()=>{
 const {store}=await seeded();
 const r=await store.reconcileInventory(dad,CHILD,
  server({ids:[],seen:[],qty:75,rev:3}));
 assert.equal(r.snapshot.inventory.S,75);
 assert.equal(r.pendingCount,0);
 assert.equal((await store.ready(dad)).length,0);
});
