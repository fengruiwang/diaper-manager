const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const bridge=require('../cloudbase/smoke/p2-upload-readiness-bridge.js');
const access=require('../sync/cloudbase-access-preflight.js');
const html=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/p2-upload-readiness.html'),'utf8');
const bridgeSource=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/p2-upload-readiness-bridge.js'),'utf8');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
function createFake({
 uid='fake-owner',session=true,grant=true,member=true,family=true,
 familyCount=1,identityMismatch=false,tableError=null
}={}){
 const calls=[];
 const app={
  auth:{getSession:async()=>({data:{
   user:{id:uid},session:session?{user:{id:identityMismatch?'other-user':uid}}:null
  }})},
  rdb:()=>({
   from(table){
    calls.push({table,kind:'from'});
    const filters=[];
    const q={
     select(fields){calls.push({table,kind:'select',fields});return q;},
     eq(k,v){calls.push({table,kind:'eq',key:k});filters.push([k,v]);return q;},
     async limit(n){
      calls.push({table,kind:'limit',limit:n});
      if(table===tableError)return {error:{code:'CONFIDENTIAL'}};
      if(table==='families')return {data:family?Array.from({length:familyCount},()=>({id:FAMILY})):[]};
      if(table==='family_members')return {data:member?[{family_id:FAMILY,user_uid:uid,member_role:'owner'}]:[]};
      if(table==='family_app_access')return {data:grant?[{family_id:FAMILY,user_uid:uid,app_code:'xb'}]:[]};
      throw Error('unexpected table');
     }
    };
    return q;
   },
   rpc:()=>{throw Error('WRITE_RPC_FORBIDDEN');},
   insert:()=>{throw Error('DML_FORBIDDEN');}
  })
 };
 return {app,calls};
}
test('A and B return safe AUTH_PASS_UPLOAD_BLOCKED without UID, family ID or token',async()=>{
 for(const uid of ['fake-owner','fake-member']){
  const {app,calls}=createFake({uid});
  const r=await bridge.create(app,access).run();
  assert.equal(r.status,'AUTH_PASS_UPLOAD_BLOCKED');
  assert.deepEqual(r.steps.map(s=>s.status),['PASS','PASS','PASS','PASS','BLOCKED']);
  assert.equal(r.steps.at(-1).code,'DURABLE_BASELINE_NOT_VERIFIED');
  assert.ok(!JSON.stringify(r).includes(uid));
  assert.ok(!JSON.stringify(r).includes(FAMILY));
  assert.deepEqual(calls.filter(c=>c.kind==='from').map(c=>c.table),
   ['families','families','family_members','family_app_access']);
 }
});
test('no session blocks without any DB calls and never requests an OTP',async()=>{
 const {app,calls}=createFake({session:false});
 const r=await bridge.create(app,access).run();
 assert.equal(r.status,'BLOCKED');
 assert.equal(r.steps[0].code,'LOGIN_REQUIRED');
 assert.equal(calls.length,0);
});
test('lost xb grant is not treated as a successful authorization',async()=>{
 const {app}=createFake({grant:false});
 const r=await bridge.create(app,access).run();
 assert.equal(r.status,'INCONCLUSIVE');
 assert.equal(r.steps.at(-1).code,'XB_GRANT_UNVERIFIED');
});
test('wrong actor and missing family can never open upload',async()=>{
 const mismatch=await bridge.create(createFake({identityMismatch:true}).app,access).run();
 assert.equal(mismatch.status,'INCONCLUSIVE');
 assert.equal(mismatch.steps[0].code,'IDENTITY_UNVERIFIED');
 const missing=await bridge.create(createFake({family:false}).app,access).run();
 assert.equal(missing.status,'BLOCKED');
 const tooMany=await bridge.create(createFake({familyCount:2}).app,access).run();
 assert.equal(tooMany.status,'BLOCKED');
});
test('read errors remain safely unclassified and do not expose raw errors',async()=>{
 for(const tableError of ['families','family_app_access']){
  const r=await bridge.create(createFake({tableError}).app,access).run();
  assert.equal(r.status,'INCONCLUSIVE');
  assert.ok(!JSON.stringify(r).includes('CONFIDENTIAL'));
 }
});
test('all real write buttons are disabled and page loads the shared preflight module',()=>{
 assert.match(html,/<script src="\.\/cloudbase-access-preflight\.js"><\/script>/);
 assert.match(html,/<script src="\.\/p2-upload-readiness-bridge\.js"><\/script>/);
 assert.equal((html.match(/<button type="button" disabled>/g)||[]).length,3);
 for(const src of [html,bridgeSource]){
  assert.doesNotMatch(src,/\.rpc\s*\(|\.(?:insert|update|delete|upsert)\s*\(/);
  assert.doesNotMatch(src,/\b(?:localStorage|indexedDB|sessionStorage|signInWithOtp|signOut)\s*(?:\(|\[|\.)/);
  assert.doesNotMatch(src,/\b(?:console\.log|console\.error|innerHTML)\s*(?:\(|=)/);
 }
});
