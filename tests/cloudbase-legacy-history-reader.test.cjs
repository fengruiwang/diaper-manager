const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Reader=require('../sync/cloudbase-legacy-history-reader.js');
const SOURCE=fs.readFileSync(path.join(__dirname,'../sync/cloudbase-legacy-history-reader.js'),'utf8');
const F='9b8d0e45-bf18-4c95-889c-6f19731a8ae5';
const C='7b5f0e45-bf18-4c95-889c-6f19731a8ae5';
const args={familyId:F,childId:C};
const row=(kind,id,ordinal,payloadExtra={})=>({
 kind,id,ordinal,payload:{id,...payloadExtra}
});
const sample=[
 row('quote','q1',1,{price:15.5,unit:0.775}),
 row('transaction','b1',1,{type:'buy',pieces:60,price:29.99}),
 row('transaction','u1',2,{type:'use',pieces:5}),
 row('weight','w1',1,{weight:3.267})
];
const page=(over={})=>({
 complete:true,record_kind:'all',offset:0,limit:20,total:4,
 has_more:false,rows:sample,can_edit:false,can_upload:false,...over
});
const settings=(over={})=>({
 complete:true,revision:0,
 settings:{
  referenceOverrides:{'合成品牌|合成系列|S':1.235},
  target:{NB:100,S:60},daily:{NB:10,S:9}
 },can_edit:false,can_upload:false,...over
});
function fake({session=true,identity='owner',mismatch=false,throwSession=false,
 throwRpc=false,error=null,history=page(),settingsResult=settings()}={}){
 const calls=[];let sessions=0;
 const app={
  auth:{getSession:async()=>{
   sessions++;
   if(throwSession)throw Error('PRIVATE_COOKIE_TOKEN');
   return {data:{
    session:session?{user:{id:mismatch?'another-member':identity}}:null,
    user:{id:identity}
   }};
  }},
  rdb:()=>({rpc:async(name,params)=>{
   calls.push({name,params});
   if(throwRpc)throw Error('PRIVATE_DB_REQUEST_LOG');
   if(error)return {error:{code:error,message:'PRIVATE_DB_ERROR'}};
   return {data:name==='xb_read_legacy_history_page_draft'?history:settingsResult};
  }})
 };
 return {reader:Reader.create(app),calls,get sessions(){return sessions;}};
}
test('module construction is inert; reads require explicit action and never auto-login',()=>{
 const s=fake();
 assert.equal(s.sessions,0);assert.equal(s.calls.length,0);
 assert.deepEqual(Object.keys(s.reader).sort(),['readAll','readPage','readSettings']);
});
test('authorized family member reads full immutable purchase/use/quote/weight history',async()=>{
 const f=fake();
 const r=await f.reader.readPage(args);
 assert.equal(r.complete,true);assert.equal(r.total,4);
 assert.equal(r.rows.length,4);assert.equal(r.hasMore,false);
 assert.equal(r.rows[1].payload.price,29.99);
 assert.equal(r.rows[3].payload.weight,3.267);
 assert.equal(r.canEdit,false);assert.equal(r.canUpload,false);
 assert.equal(f.calls[0].name,'xb_read_legacy_history_page_draft');
 assert.deepEqual(f.calls[0].params,{
  p_family_id:F,p_child_id:C,p_record_kind:'all',p_offset:0,p_limit:20
 });
});
test('query by transaction kind supports bounded paging and preserves immutable totals',async()=>{
 const f=fake({history:page({
  record_kind:'transaction',offset:0,limit:1,total:2,
  has_more:true,rows:[sample[1]]
 })});
 const x=await f.reader.readPage({...args,kind:'transaction',limit:1});
 assert.equal(x.hasMore,true);assert.equal(x.total,2);
 assert.deepEqual(x.rows.map(z=>z.kind),['transaction']);
});
test('second page can read immutable original entries without exposing unrelated categories',async()=>{
 const f=fake({history:page({
  offset:2,limit:2,total:4,has_more:false,rows:sample.slice(2)
 })});
 const x=await f.reader.readPage({...args,offset:2,limit:2});
 assert.equal(x.hasMore,false);assert.equal(x.rows[0].id,'u1');
 assert.equal(x.rows[1].id,'w1');
});
test('settings retain 0.001 yuan reference price but never advertise edit or sync',async()=>{
 const f=fake();
 const x=await f.reader.readSettings(args);
 assert.equal(x.revision,0);
 assert.equal(x.settings.referenceOverrides['合成品牌|合成系列|S'],1.235);
 assert.equal(x.settings.daily.NB,10);
 assert.equal(x.canEdit,false);assert.equal(x.canUpload,false);
 assert.equal(f.calls[0].name,'xb_read_legacy_settings_draft');
 assert.deepEqual(f.calls[0].params,{p_family_id:F,p_child_id:C});
});
test('invalid scopes, offset, limit, kind are rejected before any SDK call',async()=>{
 for(const override of [
  {familyId:'not-a-uuid'},{childId:'x'}, {kind:'unknown'},
  {offset:-1},{offset:10001},{offset:1.2},
  {limit:0},{limit:51},{limit:NaN}
 ]){
  const f=fake();
  await assert.rejects(f.reader.readPage({...args,...override}),
    /legacy_history_reader:invalid_/);
  assert.equal(f.sessions,0);assert.equal(f.calls.length,0);
 }
});
test('invalid settings scope is rejected before reading identity or data',async()=>{
 const f=fake();
 await assert.rejects(f.reader.readSettings({familyId:'bad',childId:C}),
  /legacy_history_reader:invalid_family_id/);
 assert.equal(f.sessions,0);assert.equal(f.calls.length,0);
});
test('missing, contradictory or unreadable login session prevents any history RPC',async()=>{
 for(const opts of [
  {session:false},{mismatch:true},{throwSession:true}
 ]){
  const f=fake(opts);
  await assert.rejects(f.reader.readPage(args),
   /legacy_history_reader:(login_required|identity_unverified|session_unavailable)/);
  assert.equal(f.calls.length,0);
 }
});
test('owner permission denial and backend errors are sanitized',async()=>{
 for(const [opts,expected] of [
  [{error:'DATABASE_42501'},'permission_denied'],
  [{error:'42501'},'permission_denied'],
  [{error:'DATABASE_500'},'cloud_read_failed'],
  [{throwRpc:true},'cloud_read_failed']
 ]){
  const f=fake(opts);
  await assert.rejects(f.reader.readPage(args),
   new RegExp('legacy_history_reader:'+expected));
  assert.equal(f.calls.length,1);
 }
});
test('malicious server cannot enable data changes or upload despite otherwise valid rows',async()=>{
 for(const override of [
  {can_edit:true},{can_upload:true},{complete:false},{record_kind:'quote'},
  {offset:10},{limit:500},{has_more:true},{total:0}
 ]){
  const f=fake({history:page(override)});
  await assert.rejects(f.reader.readPage(args),
   /legacy_history_reader:(invalid_history_page|history_page_incomplete)/);
 }
});
test('malformed row, missing payload ID, duplicate or unsorted results fail closed',async()=>{
 for(const rows of [
  [{...sample[0],kind:'other'},...sample.slice(1)],
  [{...sample[0],payload:{id:'different'}},...sample.slice(1)],
  [sample[0],sample[0],sample[2],sample[3]],
  [sample[1],sample[0],sample[2],sample[3]],
  [{...sample[0],ordinal:-1},...sample.slice(1)]
 ]){
  const f=fake({history:page({rows})});
  await assert.rejects(f.reader.readPage(args),
   /legacy_history_reader:(invalid_history_row|duplicate_history_row|unordered_history_rows)/);
 }
});
test('short or overlong page and conflicting total/has_more are rejected',async()=>{
 for(const override of [
  {rows:sample.slice(0,2)},
  {rows:sample.slice(0,2),total:4,has_more:false},
  {total:-1},{total:30001},{rows:[...sample,...sample],limit:4}
 ]){
  const f=fake({history:page(override)});
  await assert.rejects(f.reader.readPage(args),
   /legacy_history_reader:(invalid_history_page|history_page_incomplete|duplicate_history_row)/);
 }
});
test('malformed settings, permission flags, revision or missing references fail closed',async()=>{
 for(const override of [
  {can_edit:true},{can_upload:true},{revision:-1},
  {revision:'0'},{complete:false},{settings:{target:{},daily:{}}},
  {settings:null}
 ]){
  const f=fake({settingsResult:settings(override)});
  await assert.rejects(f.reader.readSettings(args),
   /legacy_history_reader:invalid_settings_response/);
 }
});
test('SDK returning multiple/no RPC items cannot masquerade as one authoritative result',async()=>{
 for(const payload of [[],[page(),page()],null]){
  const f=fake({history:payload});
  await assert.rejects(f.reader.readPage(args),
   /legacy_history_reader:invalid_server_response/);
 }
});
test('reader source has no direct mutation, storage access, login workflow or stock calls',()=>{
 for(const bad of [
  /\.(?:insert|update|upsert|delete|applyOperation|initializeInventory|recordPurchase)\s*\(/,
  /\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage|signInWithOtp)\s*(?:\(|\.|\[)/,
  /\b(?:console\.log|console\.error)\s*\(/
 ])assert.doesNotMatch(SOURCE,bad);
 assert.match(SOURCE,/canEdit:false,canUpload:false/);
 assert.match(SOURCE,/xb_read_legacy_history_page_draft/);
 assert.match(SOURCE,/xb_read_legacy_settings_draft/);
});
