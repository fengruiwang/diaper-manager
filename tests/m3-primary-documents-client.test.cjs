const test=require('node:test'),assert=require('node:assert/strict');
const Client=require('../sync/primary-documents-client.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const REQUEST='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
function fixture({enabled=false,offline=false,rev=0,conflict=false,ackLost=false,
 badActor=false}={}){
 const calls=[],documents=new Map();
 const app={
  auth:{getSession:async()=>({data:{session:{user:{id:'A'}}}})},
  rdb:()=>({rpc:async(name,args)=>{
   calls.push({name,args});
   if(offline)throw Error('network_unavailable');
   if(name==='xb_read_primary_document_draft'){
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
  accessPreflight:{create:()=>({verifyAccess:async()=>({
   member:true,appCode:'xb',familyId:F,
   actorUid:badActor?'B':'A'
  })})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>({
   childId:C,familyId:F,readyForMigration:false
  })})},
  scopeGuard:{requireLegacyMigrationTarget(){}},
  cloudWritesEnabled:enabled
 });
 return {client,calls,params:{familyId:F,actorUid:'A'}};
}
test('all five document types read with strict primary scope and complete version data',async()=>{
 const f=fixture();
 const result=await f.client.readAll(f.params);
 assert.equal(result.status,'PRIMARY_DOCUMENTS_FULLY_READ');
 assert.deepEqual(Object.keys(result.documents),Client.KINDS);
 assert.equal(f.calls.length,10);
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
