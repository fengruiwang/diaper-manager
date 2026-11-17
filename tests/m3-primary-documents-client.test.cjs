const test=require('node:test'),assert=require('node:assert/strict');
const Client=require('../sync/primary-documents-client.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const REQUEST='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
function fixture({enabled=false,offline=false,rev=0,conflict=false,ackLost=false,
 badActor=false,readGate=null,deniedKind=null}={}){
 const calls=[],documents=new Map(),scopes={access:0,child:0};
 const app={
  auth:{getSession:async()=>({data:{session:{user:{id:'A'}}}})},
  rdb:()=>({rpc:async(name,args)=>{
   calls.push({name,args});
   if(offline)throw Error('network_unavailable');
   if(name==='xb_read_primary_document_draft'){
    if(readGate)await readGate;
    if(args.p_kind===deniedKind)return {error:{code:'42501'}};
    return {data:{complete:true,kind:args.p_kind,family_id:F,
     child_id:C,revision:documents.get(args.p_kind)?.revision??rev,
     body:documents.get(args.p_kind)?.body??(args.p_kind==='quotes'||args.p_kind==='growth'
      ?{items:[]}:{referenceOverrides:{}}),can_upload:false}};
   }
   if(name==='xb_put_primary_document_draft'){
    if(conflict)return {error:{code:'40001'}};
    const next={body:args.p_next_body,revision:args.p_expected_revision+1};
    documents.set(args.p_kind,next);
    if(ackLost)throw Error('ACK_LOST_AFTER_COMMIT');
    return {data:{saved:true,request_id:args.p_request_id,
     family_id:F,child_id:C,kind:args.p_kind,revision:next.revision,
     duplicate:false}};
   }
   if(name==='xb_check_primary_document_request_draft'){
    return {data:{status:documents.size?'COMMITTED':'NO_RECEIPT',
     family_id:F,child_id:C,request_id:args.p_request_id,
     kind:'reference',resulting_revision:1}};
   }
   throw Error('unknown RPC '+name);
  }})
 };
 const client=Client.create({app,
  accessPreflight:{create:()=>({verifyAccess:async()=>{
   scopes.access++;return {member:true,appCode:'xb',familyId:F,
    actorUid:badActor?'B':'A'};
  }})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>{
   scopes.child++;return {childId:C,familyId:F,readyForMigration:false};
  }})},
  scopeGuard:{requireLegacyMigrationTarget(){}},
  cloudWritesEnabled:enabled
 });
 return {client,calls,scopes,params:{familyId:F,actorUid:'A'}};
}
test('all five document types read with strict primary scope and complete version data',async()=>{
 const f=fixture();
 const result=await f.client.readAll(f.params);
 assert.equal(result.status,'PRIMARY_DOCUMENTS_FULLY_READ');
 assert.deepEqual(Object.keys(result.documents),Client.KINDS);
 assert.equal(f.calls.length,5);
 assert.deepEqual(f.scopes,{access:1,child:1});
 assert.ok(f.calls.every(x=>x.name==='xb_read_primary_document_draft'
  &&x.args.p_child_id===C));
});
test('default client denies business writes without touching SQL or generating request IDs',async()=>{
 const f=fixture();
 const r=await f.client.put({...f.params,operatorApproved:true,
  kind:'reference',requestId:REQUEST,expectedRevision:0,
  nextBody:{referenceOverrides:{foo:1.123}}});
 assert.equal(r.status,'PRIMARY_DOCUMENT_WRITES_NOT_AUTHORIZED');
 assert.equal(f.calls.length,0);
});
test('an approved client uses CAS and exact stable request UUID and reads A/B result',async()=>{
 const f=fixture({enabled:true});
 const saved=await f.client.put({...f.params,operatorApproved:true,
  kind:'reference',requestId:REQUEST,expectedRevision:0,
  nextBody:{referenceOverrides:{foo:1.123}}});
 assert.equal(saved.status,'PRIMARY_DOCUMENT_COMMITTED');
 assert.equal(saved.revision,1);
 assert.equal(f.calls[0].args.p_request_id,REQUEST);
 const read=await f.client.read({...f.params,kind:'reference',readEnabled:true});
 assert.equal(read.body.referenceOverrides.foo,1.123);
 assert.equal(read.revision,1);
});
test('stale version conflicts or bad actor leave no announced write success',async()=>{
 const conflict=fixture({enabled:true,conflict:true});
 const q=await conflict.client.put({...conflict.params,operatorApproved:true,
  kind:'reference',requestId:REQUEST,expectedRevision:0,
  nextBody:{referenceOverrides:{foo:1.123}}});
 assert.equal(q.status,'PRIMARY_DOCUMENT_VERSION_CONFLICT');
 const bad=fixture({badActor:true});
 assert.equal((await bad.client.read({...bad.params,kind:'quotes',readEnabled:true}))
  .status,'PRIMARY_DOCUMENT_READ_UNVERIFIED');
});
test('ACK loss cannot regenerate request ID, read-only receipt reports COMMITTED',async()=>{
 const f=fixture({enabled:true,ackLost:true});
 const q=await f.client.put({...f.params,operatorApproved:true,
  kind:'reference',requestId:REQUEST,expectedRevision:0,
  nextBody:{referenceOverrides:{foo:1.123}}});
 assert.equal(q.status,'PRIMARY_DOCUMENT_ACK_UNKNOWN_KEEP_REQUEST_ID');
 assert.equal(q.requestId,REQUEST);
 const check=await f.client.checkRequest({...f.params,readEnabled:true,
  requestId:REQUEST});
 assert.equal(check.status,'REQUEST_COMMITTED_VERIFIED');
 assert.equal(check.requestId,REQUEST);
 assert.equal(f.calls.length,2);
});
test('offline read is unverified but does not invalidate the CloudBase SDK session',async()=>{
 const f=fixture({offline:true});
 assert.equal((await f.client.read({...f.params,kind:'quotes',readEnabled:true}))
  .status,'PRIMARY_DOCUMENT_READ_UNVERIFIED');
 assert.equal((await f.client.checkRequest({...f.params,requestId:REQUEST,
  readEnabled:true})).status,'REQUEST_RECEIPT_UNVERIFIED');
});

test('B1 five parallel RPC calls, one scope discovery, and reuse for next direct read',async()=>{
 let release;
 const readGate=new Promise(resolve=>{release=resolve;});
 const f=fixture({readGate});
 const loading=f.client.readAll(f.params);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.length,5,'all RPCs started without waiting for previous body');
 assert.deepEqual(f.scopes,{access:1,child:1});
 release();
 assert.equal((await loading).status,'PRIMARY_DOCUMENTS_FULLY_READ');
 assert.equal((await f.client.read({...f.params,kind:'reference',readEnabled:true})).status,
  'PRIMARY_DOCUMENT_READ_VERIFIED');
 assert.equal(f.calls.length,6);
 assert.deepEqual(f.scopes,{access:1,child:1},'no repeat SELECT chain');
});
test('B1 verified primary scope makes five-document read exactly five RPC and zero SELECT',async()=>{
 const f=fixture({rev:3});
 assert.equal(f.client.acceptVerifiedPrimary({
  status:'PRIMARY_READ_ONLY_READY',source:'cloudbase-primary-receipt-verified',
  canWrite:false,actorUid:'A',familyId:F,childId:C
 }),true);
 const docs=await f.client.readAll(f.params);
 assert.equal(docs.status,'PRIMARY_DOCUMENTS_FULLY_READ');
 assert.deepEqual(Object.keys(docs.documents),Client.KINDS);
 assert.ok(Client.KINDS.every(kind=>docs.documents[kind].revision===3));
 assert.equal(f.calls.length,5);
 assert.deepEqual(f.scopes,{access:0,child:0});
});
test('B1 switching actor invalidates old verified scope',async()=>{
 const f=fixture();
 f.client.acceptVerifiedPrimary({status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,
  actorUid:'A',familyId:F,childId:C});
 assert.equal((await f.client.readAll(f.params)).status,'PRIMARY_DOCUMENTS_FULLY_READ');
 assert.equal((await f.client.read({...f.params,actorUid:'B',kind:'quotes',readEnabled:true})).status,
  'PRIMARY_DOCUMENT_READ_UNVERIFIED');
 assert.equal(f.scopes.access,1);
 assert.equal((await f.client.read({...f.params,kind:'reference',readEnabled:true})).status,
  'PRIMARY_DOCUMENT_READ_VERIFIED');
 assert.equal(f.scopes.access,2,'A cannot reuse previous proof after B failed');
});
test('B1 one 42501 denied document makes whole batch incomplete, retry rechecks scope',async()=>{
 const f=fixture({deniedKind:'settings'});
 f.client.acceptVerifiedPrimary({status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,
  actorUid:'A',familyId:F,childId:C});
 assert.equal((await f.client.readAll(f.params)).status,'PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE');
 assert.equal(f.calls.length,5);
 assert.equal((await f.client.read({...f.params,kind:'reference',readEnabled:true})).status,
  'PRIMARY_DOCUMENT_READ_VERIFIED');
 assert.equal(f.scopes.access,1);
});
test('B1 put still performs original scope checks despite fast read proof',async()=>{
 const f=fixture({enabled:true});
 f.client.acceptVerifiedPrimary({status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,
  actorUid:'A',familyId:F,childId:C});
 const saved=await f.client.put({...f.params,operatorApproved:true,
  kind:'reference',requestId:REQUEST,expectedRevision:0,
  nextBody:{referenceOverrides:{a:1.25}}});
 assert.equal(saved.status,'PRIMARY_DOCUMENT_COMMITTED');
 assert.deepEqual(f.scopes,{access:1,child:1});
});
