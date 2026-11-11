const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const preflight=require('../sync/cloudbase-access-preflight.js');
const replay=require('../sync/inventory-outbox-runner.js');
const syncReader=require('../sync/inventory-sync-reader.js');
const source=fs.readFileSync(path.join(__dirname,'../sync/cloudbase-access-preflight.js'),'utf8');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const OTHER='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6';
const CHILD='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const A='synthetic-owner',B='synthetic-member';
function fake({uid=A,session=true,hasFamily=true,hasMember=true,hasGrant=true,
 grantsOverride=null,memberOverride=null,wrongSessionUser=null,errorTable=null,
 networkError=false,role='owner'}={}){
 const calls=[];
 const auth={getSession:async()=>({data:{
  user:{id:uid},session:session?{user:{id:wrongSessionUser||uid}}:null
 }})};
 const app={auth,rdb(){
  return {
   from(table){
    calls.push({table,kind:'from'});
    const filters=[];
    const query={
     select(cols){calls.push({table,kind:'select',cols});return query;},
     eq(field,value){calls.push({table,kind:'eq',field});filters.push([field,value]);return query;},
     limit:async(limit)=>{
      calls.push({table,kind:'limit',limit});
      if(networkError)throw Error('SDK ERROR PRIVATE_UID='+uid);
      if(errorTable===table)return {error:{message:'SERVER SECRET'}};
      const check=(col,value)=>filters.some(([f,v])=>f===col&&v===value);
      if(table==='families')
       return {data:hasFamily&&check('id',FAMILY)?[{id:FAMILY}]:[]};
      if(table==='family_members')
       return {data:hasMember&&check('family_id',FAMILY)&&check('user_uid',uid)?
        [memberOverride||{family_id:FAMILY,user_uid:uid,member_role:role}]:[]};
      if(table==='family_app_access')
       return {data:hasGrant&&check('family_id',FAMILY)&&check('user_uid',uid)&&check('app_code','xb')?
        [grantsOverride||{family_id:FAMILY,user_uid:uid,app_code:'xb'}]:[]};
      throw Error('unexpected table');
     },
     insert:()=>{throw Error('DIRECT_WRITE_FORBIDDEN');},
     update:()=>{throw Error('DIRECT_WRITE_FORBIDDEN');},
     delete:()=>{throw Error('DIRECT_WRITE_FORBIDDEN');}
    };
    return query;
   },
   rpc:()=>{throw Error('RPC_FORBIDDEN');}
  };
 }};
 return {app,calls};
}
test('A/B sessions require matched session identity and fresh RLS family, member and xb grant reads',async()=>{
 for(const [uid,role] of [[A,'owner'],[B,'member']]){
  const {app,calls}=fake({uid,role});
  const result=await preflight.create(app).verifyAccess({familyId:FAMILY,actorUid:uid});
  assert.deepEqual(result,{familyId:FAMILY,actorUid:uid,appCode:'xb',member:true,initialized:false});
  assert.deepEqual(calls.filter(c=>c.kind==='from').map(c=>c.table),
   ['families','family_members','family_app_access']);
  assert.ok(calls.some(c=>c.table==='family_members'&&c.field==='user_uid'));
  assert.ok(calls.some(c=>c.table==='family_app_access'&&c.field==='user_uid'));
  assert.equal(calls.filter(c=>c.kind==='limit').every(c=>c.limit===2),true);
 }
});
test('preflight denies missing session or mistaken actor without any DB reads',async()=>{
 for(const variant of [
  {app:fake({session:false}).app,actorUid:A,expected:'login_required'},
  {app:fake().app,actorUid:B,expected:'actor_session_mismatch'},
  {app:fake({wrongSessionUser:B}).app,actorUid:A,expected:'session_identity_unverified'}
 ]){
  const error=await assert.rejects(
   ()=>preflight.create(variant.app).verifyAccess({familyId:FAMILY,actorUid:variant.actorUid}),
   e=>e.message==='access_preflight:'+variant.expected);
  assert.equal(error,undefined);
 }
});
test('RLS denies orphan session, missing family/membership/xb grant',async()=>{
 for(const [overrides,errorCode] of [
  [{hasFamily:false},'family_not_visible'],
  [{hasMember:false},'membership_unverified'],
  [{hasGrant:false},'xb_grant_unverified'],
  [{memberOverride:{family_id:FAMILY,user_uid:B,member_role:'member'}},'membership_unverified'],
  [{grantsOverride:{family_id:FAMILY,user_uid:B,app_code:'xb'}},'xb_grant_unverified'],
  [{grantsOverride:{family_id:FAMILY,user_uid:A,app_code:'jj'}},'xb_grant_unverified']
 ]){
  await assert.rejects(
   ()=>preflight.create(fake(overrides).app).verifyAccess({familyId:FAMILY,actorUid:A}),
   e=>e.message==='access_preflight:'+errorCode);
 }
});
test('invalid scopes and unsupported SDK fail before network request',async()=>{
 const {app,calls}=fake();
 await assert.rejects(()=>preflight.create(app).verifyAccess({familyId:'bad',actorUid:A}),
  /invalid_scope/);
 await assert.rejects(()=>preflight.create(app).verifyAccess({familyId:OTHER,actorUid:''}),
  /invalid_scope/);
 assert.equal(calls.length,0);
 assert.throws(()=>preflight.create({auth:{}}),/sdk_required/);
});
test('missing or mismatched user identity fails even when session object exists',async()=>{
 const f=fake();
 f.app.auth.getSession=async()=>({data:{session:{access_token:'fake'}}});
 await assert.rejects(
  ()=>preflight.create(f.app).verifyAccess({familyId:FAMILY,actorUid:A}),
  /session_identity_unverified/);
 const mismatch=fake();
 mismatch.app.auth.getSession=async()=>({data:{user:{id:A},session:{user:{id:B}}}});
 await assert.rejects(
  ()=>preflight.create(mismatch.app).verifyAccess({familyId:FAMILY,actorUid:A}),
  /session_identity_unverified/);
});
test('backend errors are sanitized; never expose raw SDK messages or actor UID',async()=>{
 for(const config of [{networkError:true},{errorTable:'family_app_access'}]){
  await assert.rejects(
   ()=>preflight.create(fake(config).app).verifyAccess({familyId:FAMILY,actorUid:A}),
   e=>e.message==='access_preflight:cloud_select_unavailable'&&
      !e.message.includes('PRIVATE_UID'));
 }
});
test('actual outbox runner remains blocked even if uploadEnabled true (no verified baseline)',async()=>{
 let readyCalled=0,remoteCalled=0;
 const {app}=fake();
 const verifyAccess=preflight.create(app).verifyAccess;
 const outbox={
  ready:async()=>{readyCalled++;return [];},
  recordResult:async()=>{throw Error('UNEXPECTED_RESULT');}
 };
 const remote={applyOperation:async()=>{remoteCalled++;throw Error('UNEXPECTED_REMOTE');}};
 const run=replay.create({outbox,remote,verifyAccess});
 const result=await run.flush({familyId:FAMILY,actorUid:A},{uploadEnabled:true});
 assert.equal(result.status,'family-not-initialized');
 assert.equal(result.attempted,0);
 assert.equal(readyCalled,0);
 assert.equal(remoteCalled,0);
 const disabled=await run.flush({familyId:FAMILY,actorUid:A},{uploadEnabled:false});
 assert.equal(disabled.status,'upload-disabled');
 assert.equal(readyCalled,0);
});
test('reconciliation coordinator also blocks without independently verified baseline',async()=>{
 let ids=0,reads=0,writes=0;
 const {app}=fake();
 const client=syncReader.create({
  outbox:{
   reconciliationIds:async()=>{ids++;return [];},
   reconcileInventory:async()=>{writes++;return null;}
  },
  remote:{readReconciliation:async()=>{reads++;return null;}},
  verifyAccess:preflight.create(app).verifyAccess
 });
 const result=await client.reconcile({familyId:FAMILY,childId:CHILD,actorUid:A,readEnabled:true});
 assert.equal(result.status,'family-not-initialized');
 assert.equal(result.localUnchanged,true);
 assert.deepEqual([ids,reads,writes],[0,0,0]);
});
test('read preflight contains no inventory RPC, writes, storage or OTP login',()=>{
 assert.doesNotMatch(source,/\.rpc\s*\(|\.(?:insert|update|delete|upsert)\s*\(/);
 assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|sessionStorage|signInWithOtp)\s*(?:\(|\.|\[)/);
 assert.match(source,/initialized:false/);
});
