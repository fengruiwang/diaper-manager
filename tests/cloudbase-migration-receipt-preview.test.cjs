const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Preview=require('../sync/cloudbase-migration-receipt-preview.js');
const SOURCE=fs.readFileSync(path.join(__dirname,'../sync/cloudbase-migration-receipt-preview.js'),'utf8');
const F='a28d0e45-bf18-4c95-889c-6f19731a8ae5';
const C='b35f0e45-bf18-4c95-889c-6f19731a8ae5';
const request={familyId:F,childId:C,sourceSha256:'a'.repeat(64),readEnabled:true};
function make({session=true,identityMismatch=false,status='PLAN_ONLY_EMPTY_TARGET',
 malformed=false,error=null,throwRpc=false}={}){
 const calls=[];
 const app={auth:{getSession:async()=>({data:{
  user:{id:'synthetic-owner'},session:session?
   {user:{id:identityMismatch?'wrong-user':'synthetic-owner'}}:null
 }})},rdb:()=>({rpc:async(name,args)=>{
  calls.push({name,args});
  if(throwRpc)throw Error('PRIVATE_SECRET_RAW_SQL');
  if(error)return {error:{code:error,message:'SECRET PRIVATE DATABASE'}};
  return {data:malformed?{status,can_upload:true}:{
   status,can_upload:false,can_commit:false,receipt_committed:false,
   requires_separate_approval:true
  }};
 }})};
 return {api:Preview.create(app),calls};
}
function forbidden(x){
 assert.equal(x.canUpload,false);assert.equal(x.canCommit,false);
 assert.equal(x.canReplaceLocalState,false);assert.equal(x.receiptCommitted,false);
 assert.equal(x.requiresSeparateApproval,true);
 assert.ok(!JSON.stringify(x).includes(F));
 assert.ok(!JSON.stringify(x).includes(C));
 assert.ok(!JSON.stringify(x).includes('synthetic-owner'));
}
test('preview is disabled and does not read session or invoke RPC without explicit click',async()=>{
 const f=make();
 forbidden(await f.api.inspect({...request,readEnabled:false}));
 assert.equal((await f.api.inspect({...request,readEnabled:false})).status,'DISABLED');
 assert.deepEqual(f.calls,[]);
});
test('owner-only draft preview can only report PLAN, never enable migration',async()=>{
 const f=make();
 const x=await f.api.inspect(request);
 assert.equal(x.status,'PLAN_ONLY_EMPTY_TARGET');
 forbidden(x);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].name,'xb_preview_legacy_migration_receipt');
 assert.deepEqual(f.calls[0].args,{
  p_family_id:F,p_child_id:C,p_source_sha256:'a'.repeat(64),
  p_source_format:'xiaobao-diapers:v1'
 });
});
test('duplicate receipt, changed source, other child and existing data are all non-authorizing',async()=>{
 for(const status of [
  'ALREADY_RECEIPTED_SAME_SOURCE','CHILD_HAS_DIFFERENT_RECEIPT',
  'SOURCE_RECEIPTED_FOR_OTHER_CHILD','TARGET_ALREADY_HAS_BUSINESS_DATA'
 ]){
  const x=await make({status}).api.inspect(request);
  assert.equal(x.status,status);forbidden(x);
 }
});
test('no SDK session or inconsistent actor IDs block before RPC',async()=>{
 for(const [opts,code] of [
  [{session:false},'LOGIN_REQUIRED'],
  [{identityMismatch:true},'SESSION_IDENTITY_UNVERIFIED']
 ]){
  const f=make(opts);const r=await f.api.inspect(request);
  assert.equal(r.status,code);forbidden(r);assert.equal(f.calls.length,0);
 }
});
test('invalid source digest or different child UUID is rejected before RPC',async()=>{
 for(const mod of [
  {sourceSha256:'A'.repeat(64)},{sourceSha256:'bad-digest'},
  {familyId:'bad'},{childId:null}
 ]){
  const f=make(),r=await f.api.inspect({...request,...mod});
  assert.equal(r.status,'INVALID_PREVIEW_SCOPE');forbidden(r);
  assert.equal(f.calls.length,0);
 }
});
test('server read network errors and CloudBase owner denials are sanitized',async()=>{
 for(const [opts,code] of [
  [{throwRpc:true},'CLOUD_READ_UNVERIFIED'],
  [{error:'DATABASE_42501'},'OWNER_PERMISSION_DENIED'],
  [{error:'DATABASE_500'},'CLOUD_READ_UNVERIFIED']
 ]){
  const r=await make(opts).api.inspect(request);
  assert.equal(r.status,code);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  forbidden(r);
 }
});
test('malformed or malicious server response cannot enable write or claim receipt',async()=>{
 for(const opts of [
  {malformed:true},
  {status:'ALLOW_WRITE_NOW'},
  {status:null}
 ]){
  const r=await make(opts).api.inspect(request);
  assert.equal(r.status,'UNEXPECTED_SERVER_PREVIEW');forbidden(r);
 }
});
test('read-only preview source contains no storage, purchase, RPC writes or auto-signin',()=>{
 assert.doesNotMatch(SOURCE,/\.applyOperation\s*\(|\.initializeInventory\s*\(|\.reconcileInventory\s*\(/);
 assert.doesNotMatch(SOURCE,/\.(?:insert|update|upsert|delete)\s*\(/);
 assert.doesNotMatch(SOURCE,/\b(?:localStorage|indexedDB|sessionStorage|fetch|WebSocket|signInWithOtp)\s*(?:\(|\.|\[)/);
 assert.match(SOURCE,/canUpload:false,canCommit:false/);
});
