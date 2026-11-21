'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Client=require('../sync/maternal-health-client.js');
const Ops=require('../sync/maternal-health-operations.js');
const Contract=require('../sync/outbox-contract.js');
const Durable=require('../sync/idb-outbox.js');
const {deleteDocument}=require('../preview/v1.2.0/maternal-weight.js');

const familyId='f1300000-0000-4000-8000-000000000001';
const otherFamily='f1300000-0000-4000-8000-000000000002';
const A={familyId,actorUid:'synthetic-a'};
const B={familyId,actorUid:'synthetic-b'};
const C={familyId:otherFamily,actorUid:'synthetic-c'};
const recordId='a1300000-0000-4000-8000-000000000099';
const EMPTY={schemaVersion:1,items:[]};
const body=weightKg=>({schemaVersion:1,
 items:[{id:recordId,kind:'weight',date:'2026-11-21',weightKg}]});

function fakeIndexedDB(){
 const databases=new Map();
 return {
  databases,
  open(name){
   const request={};
   setImmediate(()=>{
    const fresh=!databases.has(name);
    if(fresh)databases.set(name,new Map());
    const stores=databases.get(name);
    request.result={
     objectStoreNames:{contains:key=>stores.has(key)},
     createObjectStore(key){stores.set(key,new Map());return {createIndex(){}}},
     transaction([key],mode){
      const records=structuredClone(stores.get(key));
      const tx={};
      let aborted=false,pending=0;
      const finish=()=>setImmediate(()=>{
       if(aborted||pending)return;
       aborted=true;
       if(mode==='readwrite')stores.set(key,records);
       tx.oncomplete();
      });
      tx.abort=()=>{aborted=true;setImmediate(()=>tx.onabort());};
      function request(work){
       const req={};
       pending++;
       setImmediate(()=>{
        if(aborted)return;
        req.result=work();req.onsuccess();
        if(--pending===0)finish();
       });
       return req;
      }
      tx.objectStore=()=>({
       get:id=>request(()=>records.get(id)),
       add:op=>request(()=>records.set(op.id,structuredClone(op))),
       put:op=>request(()=>records.set(op.id,structuredClone(op))),
       index:()=>({getAll:([familyId,actorUid])=>request(()=>
        [...records.values()].filter(row=>row.familyId===familyId&&row.actorUid===actorUid))})
      });
      return tx;
     }
    };
    if(fresh)request.onupgradeneeded();
    request.onsuccess();
   });
   return request;
  }
 };
}

function fixture(){
 const indexedDB=fakeIndexedDB();
 const docs=new Map(),receipts=new Map(),calls=[];
 const grants=new Map([[A.actorUid,familyId],[B.actorUid,familyId],[C.actorUid,otherFamily]]);
 const host={indexedDB,navigator:{onLine:true}};
 let who=A,sdkActor=A.actorUid,generated=0,intercept=null;
 const sdk={
  auth:{getSession:async()=>({data:{session:{user:{id:sdkActor}}}})},
  rdb:()=>({async rpc(name,args){
   const actor=sdkActor;
   calls.push({name,args:structuredClone(args),actor});
   return intercept?intercept(name,args,()=>server(actor,name,args)):server(actor,name,args);
  }})
 };
 function server(actor,name,args){
  const {p_family_id:family,p_request_id:id,p_expected_revision:expected,p_next_body:nextBody}=args;
  if(grants.get(actor)!==family)return {error:{code:'42501'}};
  const current=docs.get(family)||{revision:0,body:EMPTY};
  const key=family+'/'+id;
  const receipt=receipts.get(key);
  const reply=response=>({data:{family_id:family,...response}});
  if(name==='xb_read_maternal_health')return reply(structuredClone(current));
  if(name==='xb_check_maternal_health_request'){
   if(receipt?.actor!==actor)return reply({request_id:id,status:'NO_RECEIPT'});
   return reply({request_id:id,status:'COMMITTED',revision:receipt.revision});
  }
  assert.equal(name,'xb_put_maternal_health');
  assert.ok(indexedDB.databases.get(Ops.DB_NAME)?.get('operations').has(id)
   ||!indexedDB.databases.has(Ops.DB_NAME),'queue commits before any queued PUT');
  if(receipt){
   if(receipt.actor!==actor||receipt.expected!==expected
    ||JSON.stringify(nextBody)!==JSON.stringify(receipt.body))return {error:{code:'23505'}};
   return reply({request_id:id,saved:true,duplicate:true,revision:receipt.revision});
  }
  if(expected!==current.revision)return {error:{code:'40001'}};
  const revision=expected+1;
  docs.set(family,{revision,body:structuredClone(nextBody)});
  receipts.set(key,{actor,expected,revision,body:structuredClone(nextBody)});
  return reply({request_id:id,saved:true,duplicate:false,revision});
 }
 const controller={verifiedContext:()=>who?{app:sdk,...who}:null};
 function make(enabled=true){
  const client=Client.create({controller,cloudWritesEnabled:enabled});
  const ops=Ops.create({controller,client,host,cloudWritesEnabled:enabled,
   uuid:()=> 'a1300000-0000-4000-8000-'+String(++generated).padStart(12,'0')});
  return {client,ops};
 }
 return {
  ...make(),make,controller,host,indexedDB,calls,docs,
  actAs(scope){who=scope;sdkActor=scope?.actorUid;},
  sdkAs(actorUid){sdkActor=actorUid;},
  intercept(fn){intercept=fn;},
  get generated(){return generated;}
 };
}

test('family-only RPC read verifies the empty baseline and does not require child infrastructure',async()=>{
 const f=fixture();
 assert.deepEqual(await f.client.read(A),{status:'READ_VERIFIED',...A,revision:0,body:EMPTY});
 assert.deepEqual(f.calls,[{name:'xb_read_maternal_health',args:{p_family_id:familyId},actor:A.actorUid}]);
 assert.equal(f.indexedDB.databases.size,0);
 f.actAs({...C,familyId});
 assert.equal((await f.client.read({...C,familyId})).status,'PERMISSION_DENIED');
 f.actAs(C);
 assert.equal((await f.client.read({...C,familyId})).status,'PERMISSION_DENIED');
 f.sdkAs(A.actorUid);
 assert.equal((await f.client.read(C)).status,'PERMISSION_DENIED');
 assert.equal(f.calls.length,2);
});

test('default gates prevent IDB writes, UUID generation and put RPCs',async()=>{
 const f=fixture(),client=Client.create({controller:f.controller});
 const ops=Ops.create({controller:f.controller,client,host:f.host,
  uuid:()=>assert.fail('writes disabled must not request a UUID')});
 assert.equal((await client.put({...A})).status,'WRITES_DISABLED');
 assert.equal((await ops.queue({})).status,'WRITES_DISABLED');
 assert.equal((await ops.send()).status,'WRITES_DISABLED');
 assert.equal(f.calls.length,0);
 assert.equal(f.indexedDB.databases.size,0);
 assert.equal(f.generated,0);
});

test('A and B see each other edits, with the first save advancing 0 to 1',async()=>{
 const f=fixture();
 const a=await f.client.read(A);
 const queued=await f.ops.queue({baseline:a,nextBody:body(51.75)});
 assert.equal(queued.status,'QUEUED');
 assert.equal((await f.ops.pending()).pending,1);
 assert.deepEqual([...f.indexedDB.databases.keys()],[Ops.DB_NAME]);
 const saved=await f.ops.send();
 assert.equal(saved.status,'COMMITTED');
 assert.equal(saved.revision,1);
 assert.deepEqual(saved.document.body,body(51.75));
 assert.equal((await f.ops.pending()).acked,1);
 assert.deepEqual(f.calls.find(x=>x.name==='xb_put_maternal_health').args,{
  p_family_id:familyId,p_request_id:queued.requestId,p_expected_revision:0,p_next_body:body(51.75)
 });

 f.actAs(B);
 const b=await f.client.read(B);
 assert.deepEqual(b.body,body(51.75));
 assert.equal((await f.ops.queue({baseline:b,nextBody:body(52)})).status,'QUEUED');
 assert.equal((await f.ops.send()).revision,2);
 f.actAs(A);
 assert.deepEqual((await f.client.read(A)).body,body(52));
});

test('a CAS deletion through the durable queue is visible to both family accounts',async()=>{
 const f=fixture();
 const initial=await f.client.read(A);
 await f.ops.queue({baseline:initial,nextBody:body(52)});
 assert.equal((await f.ops.send()).revision,1);
 f.actAs(B);
 const baseline=await f.client.read(B);
 const queued=await f.ops.queue({baseline,nextBody:deleteDocument(baseline.body,recordId)});
 assert.equal(queued.status,'QUEUED');
 const deleted=await f.ops.send();
 assert.equal(deleted.status,'COMMITTED');
 assert.equal(deleted.requestId,queued.requestId);
 assert.equal(deleted.revision,2);
 assert.deepEqual(deleted.document.body,EMPTY);
 f.actAs(A);
 const refreshed=await f.client.read(A);
 assert.equal(refreshed.revision,2);
 assert.deepEqual(refreshed.body,EMPTY);
});

test('optional local time and note round-trip across the family without changing old rows',async()=>{
 const f=fixture();
 const initial=await f.client.read(A);
 const next=body(52);
 const id='new-weight';
 next.items.push({id,kind:'weight',date:'2026-11-20',time:'06:05',weightKg:51.755,note:'早起测量'});
 await f.ops.queue({baseline:initial,nextBody:next});
 assert.equal((await f.ops.send()).status,'COMMITTED');
 f.actAs(B);
 const baseline=await f.client.read(B);
 assert.deepEqual(baseline.body,next);
 const edited={...next,items:[next.items[0],{...next.items[1],time:'07:10',note:''}]};
 await f.ops.queue({baseline,nextBody:edited});
 assert.equal((await f.ops.send()).revision,2);
 f.actAs(A);
 assert.deepEqual((await f.client.read(A)).body,edited);
});

test('CAS conflict remains after a revised save and explicit archival preserves its history',async()=>{
 const f=fixture(),a=await f.client.read(A);
 f.actAs(B);
 const b=await f.client.read(B);
 await f.ops.queue({baseline:b,nextBody:body(52)});
 await f.ops.send();

 f.actAs(A);
 const stale=await f.ops.queue({baseline:a,nextBody:body(51)});
 assert.deepEqual(await f.ops.send(),{status:'REVISION_CONFLICT',requestId:stale.requestId});
 assert.equal((await f.ops.pending()).conflict,1);
 assert.equal((await f.ops.send()).status,'EMPTY');
 const latest=await f.client.read(A);
 const edited=await f.ops.queue({baseline:latest,nextBody:body(53)});
 assert.notEqual(edited.requestId,stale.requestId);
 assert.equal((await f.ops.send()).revision,2);
 assert.equal((await f.ops.pending()).conflict,1);
 const original=(await f.ops.conflicts()).items[0];
 assert.equal(original.requestId,stale.requestId);
 assert.equal(original.expectedRevision,0);
 assert.deepEqual(original.nextBody,body(51));
 const archive={requestId:stale.requestId,baseline:latest,userConfirmed:true};
 assert.equal((await f.ops.abandonConflict({...archive,userConfirmed:false})).status,
  'CONFIRMATION_REQUIRED');
 assert.equal((await f.ops.abandonConflict({...archive,baseline:a})).status,
  'LATEST_REVISION_REQUIRED');

 for(const other of [B,{...A,familyId:otherFamily}]){
  f.actAs(other);
  assert.deepEqual(await f.ops.conflicts(),{status:'CONFLICTS_VERIFIED',items:[]});
  const rpcCount=f.calls.length;
  assert.notEqual((await f.ops.abandonConflict(archive)).status,'ABANDONED');
  assert.equal(f.calls.length,rpcCount);
 }
 f.actAs(A);
 assert.equal((await f.ops.pending()).outstanding,1);
 assert.deepEqual(await f.ops.abandonConflict(archive),{status:'ABANDONED',requestId:stale.requestId});
 const counts=await f.ops.pending();
 assert.equal(counts.outstanding,0);
 assert.equal(counts.abandoned,1);
 assert.equal(counts.acked,1);
 assert.deepEqual((await f.ops.conflicts()).items,[]);
 const storage=Durable.create({indexedDB:f.indexedDB,contract:Contract,dbName:Ops.DB_NAME});
 const retained=await storage.get(A,stale.requestId);
 assert.equal(retained.status,'abandoned');
 assert.equal(retained.receipt,null);
 assert.equal(retained.id,original.requestId);
 assert.equal(retained.expectedRevision,original.expectedRevision);
 assert.equal(retained.createdAt,original.createdAt);
 assert.deepEqual(retained.payload,{nextBody:original.nextBody});
 const puts=f.calls.filter(call=>call.name==='xb_put_maternal_health').length;
 assert.equal((await f.make().ops.send()).status,'EMPTY');
 assert.equal(f.calls.filter(call=>call.name==='xb_put_maternal_health').length,puts);
});

test('archival refuses pending, retry, other operation types and an unverified receipt',async()=>{
 const f=fixture();
 const baseline=await f.client.read(A);
 const pending=await f.ops.queue({baseline,nextBody:body(51.75)});
 const storage=Durable.create({indexedDB:f.indexedDB,contract:Contract,dbName:Ops.DB_NAME});
 const archive={requestId:pending.requestId,baseline,userConfirmed:true};
 assert.equal((await f.ops.abandonConflict(archive)).status,'CONFLICT_NOT_FOUND');
 await storage.recordResult(A,pending.requestId,{kind:'timeout'});
 assert.equal((await f.ops.abandonConflict(archive)).status,'CONFLICT_NOT_FOUND');

 const other=Contract.createOperation({id:recordId,...A,type:'profile.patch',expectedRevision:0,
  createdAt:'2026-11-21T00:00:00Z',payload:{kind:'profile'}});
 await storage.enqueue(other);
 await storage.recordResult(A,other.id,{kind:'conflict'});
 assert.equal((await f.ops.abandonConflict({...archive,requestId:other.id})).status,'CONFLICT_NOT_FOUND');
 assert.deepEqual((await f.ops.conflicts()).items,[]);

 // Simulate a newer family document and a definite CAS rejection for the original request.
 f.docs.set(familyId,{revision:1,body:body(52)});
 assert.equal((await f.ops.send()).status,'REVISION_CONFLICT');
 const latest=await f.client.read(A);
 for(const response of ['UNKNOWN','COMMITTED']){
  f.intercept(()=>response==='UNKNOWN'?{error:{code:'503'}}:{data:{
   status:'COMMITTED',revision:1,family_id:familyId,request_id:pending.requestId}});
  assert.equal((await f.ops.abandonConflict({...archive,baseline:latest})).status,'RECEIPT_UNVERIFIED');
  assert.equal((await storage.get(A,pending.requestId)).status,'conflict');
 }
 f.intercept(null);
 f.host.navigator.onLine=false;
 assert.equal((await f.ops.abandonConflict({...archive,baseline:latest})).status,'OFFLINE');
 f.host.navigator.onLine=true;
 assert.equal((await f.ops.abandonConflict({...archive,baseline:latest})).status,'ABANDONED');
 assert.equal((await storage.get(A,other.id)).status,'conflict');
});

test('lost save response recovers after reload with the original receipt and the latest document',async()=>{
 const f=fixture();
 const a=await f.client.read(A);
 const queued=await f.ops.queue({baseline:a,nextBody:body(51.75)});
 let lost=false;
 f.intercept((name,_args,next)=>{
  if(name==='xb_put_maternal_health'){
   next();lost=true;throw Error('synthetic network timeout after commit');
  }
  if(lost&&name==='xb_check_maternal_health_request')throw Error('receipt temporarily unreachable');
  return next();
 });
 assert.deepEqual(await f.ops.send(),{status:'UNKNOWN',requestId:queued.requestId});
 assert.equal((await f.ops.pending()).retry,1);
 assert.deepEqual(await f.ops.queue({baseline:a,nextBody:body(51.75)}),
  {status:'PENDING_REQUEST',requestId:queued.requestId});
 assert.equal(f.generated,1);

 f.intercept(null);
 f.actAs(B);
 const b=await f.client.read(B);
 await f.ops.queue({baseline:b,nextBody:body(52)});
 assert.equal((await f.ops.send()).revision,2);
 f.actAs(A);
 const reloaded=f.make();
 const writesBefore=f.calls.filter(x=>x.name==='xb_put_maternal_health').length;
 const saved=await reloaded.ops.send();
 assert.equal(saved.requestId,queued.requestId);
 assert.equal(saved.status,'COMMITTED');
 assert.equal(saved.revision,1);
 assert.deepEqual(saved.document.body,body(52));
 assert.equal(saved.document.revision,2);
 assert.equal(f.calls.filter(x=>x.name==='xb_put_maternal_health').length,writesBefore);
 assert.equal((await reloaded.ops.pending()).outstanding,0);
 assert.equal(f.generated,2);
});

test('no receipt after transport failure replays exactly the immutable queued request',async()=>{
 const f=fixture();
 const nextBody=body(51.75);
 const queued=await f.ops.queue({baseline:await f.client.read(A),nextBody});
 nextBody.items[0].weightKg=99;
 f.intercept((name,_args,next)=>{
  if(name==='xb_put_maternal_health')throw Error('disconnected before commit');
  return next();
 });
 assert.equal((await f.ops.send()).status,'UNKNOWN');
 f.intercept(null);
 const reloaded=f.make();
 assert.equal((await reloaded.ops.send()).status,'COMMITTED');
 const writes=f.calls.filter(x=>x.name==='xb_put_maternal_health');
 assert.equal(writes.length,2);
 assert.deepEqual(writes[0].args,writes[1].args);
 assert.equal(writes[1].args.p_request_id,queued.requestId);
 assert.deepEqual(writes[1].args.p_next_body,body(51.75));
 assert.equal(f.generated,1);

 const original={...A,requestId:queued.requestId,expectedRevision:0,nextBody:body(51.75)};
 const duplicate=await f.client.put(original);
 assert.equal(duplicate.duplicate,true);
 assert.equal(duplicate.revision,1);
 assert.equal((await f.client.put({...original,nextBody:body(52)})).status,'REQUEST_ID_CONFLICT');
 assert.equal((await f.client.read(A)).revision,1);
});

test('pending work survives offline and is isolated by account, family and database',async()=>{
 const f=fixture();
 const baseline=await f.client.read(A);
 const queued=await f.ops.queue({baseline,nextBody:body(51.75)});
 const before=f.calls.length;
 f.host.navigator.onLine=false;
 assert.equal((await f.ops.send()).status,'OFFLINE');
 assert.equal((await f.ops.queue({baseline,nextBody:body(52)})).status,'OFFLINE');
 assert.equal((await f.ops.pending()).pending,1);
 assert.equal(f.calls.length,before);
 assert.equal(f.generated,1);

 f.host.navigator.onLine=true;
 for(const scope of [B,C,{...A,familyId:otherFamily}]){
  f.actAs(scope);
  assert.equal((await f.ops.pending()).outstanding,0);
  assert.equal((await f.ops.send()).status,'EMPTY');
 }
 const babyOutbox=Durable.create({indexedDB:f.indexedDB,contract:Contract,dbName:'xiaobao-primary-documents-v120'});
 assert.equal((await babyOutbox.stats(A)).total,0);
 f.actAs(A);
 assert.equal((await f.make().ops.send()).requestId,queued.requestId);
});

test('malformed identities and revisions are never accepted as receipt or write success',async()=>{
 const f=fixture();
 const queued=await f.ops.queue({baseline:await f.client.read(A),nextBody:body(51.75)});
 f.intercept((name,args,next)=>name==='xb_put_maternal_health'?{
  data:{family_id:familyId,request_id:args.p_request_id,saved:true,duplicate:false,revision:2}
 }:next());
 assert.equal((await f.ops.send()).status,'UNKNOWN');
 assert.equal((await f.ops.pending()).retry,1);
 f.intercept((name,args,next)=>name==='xb_check_maternal_health_request'?{
  data:{family_id:otherFamily,request_id:args.p_request_id,status:'COMMITTED',revision:1}
 }:next());
 assert.equal((await f.client.checkRequest({...A,requestId:queued.requestId})).status,'UNKNOWN');
 assert.equal((await f.ops.send()).status,'UNKNOWN');
 assert.equal(f.calls.filter(x=>x.name==='xb_put_maternal_health').length,1);
 f.intercept((name,args,next)=>name==='xb_check_maternal_health_request'?{
  data:{family_id:familyId,request_id:recordId,status:'NO_RECEIPT'}
 }:next());
 assert.equal((await f.ops.send()).status,'UNKNOWN');
 assert.equal(f.calls.filter(x=>x.name==='xb_put_maternal_health').length,1);
});

test('switching account during a receipt check never replays the previous account request',async()=>{
 const f=fixture();
 await f.ops.queue({baseline:await f.client.read(A),nextBody:body(51.75)});
 f.intercept((name,_args,next)=>{
  assert.equal(name,'xb_check_maternal_health_request');
  const result=next();
  f.actAs(B);
  return result;
 });
 assert.equal((await f.ops.send()).status,'SCOPE_CHANGED');
 assert.equal(f.calls.filter(x=>x.name==='xb_put_maternal_health').length,0);
 assert.equal((await f.ops.pending()).outstanding,0);
 f.actAs(A);
 assert.equal((await f.ops.pending()).pending,1);
});

test('explicit write denial keeps the request; a later confirmed save can require a fresh read',async()=>{
 const f=fixture();
 const queued=await f.ops.queue({baseline:await f.client.read(A),nextBody:body(51.75)});
 f.intercept((name,_args,next)=>name==='xb_put_maternal_health'
  ?{error:{code:'42501'}}:next());
 assert.deepEqual(await f.ops.send(),{status:'PERMISSION_DENIED',requestId:queued.requestId});
 assert.equal((await f.ops.pending()).pending,1);
 assert.equal(f.docs.size,0);
 f.intercept((name,_args,next)=>name==='xb_read_maternal_health'
  ?{error:{code:'503'}}:next());
 assert.deepEqual(await f.ops.send(),{status:'COMMITTED_NEEDS_REFRESH',requestId:queued.requestId,revision:1});
 assert.equal((await f.ops.pending()).acked,1);
 assert.equal(f.generated,1);
});

test('outbox contract registers health writes with a required revision',()=>{
 const input={id:recordId,type:'maternal-health.upsert',...A,
  payload:{nextBody:body(51.75)},createdAt:'2026-11-21T00:00:00Z'};
 assert.throws(()=>Contract.createOperation(input),/revision_required/);
 assert.equal(Contract.createOperation({...input,expectedRevision:0}).status,'pending');
});
