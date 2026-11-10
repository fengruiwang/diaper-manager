const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../sync/cloudbase-family-client.js');
const UUID='9dc2dd1a-2043-4a7b-bdfa-74eac91cfe19';
function stub({allowed=true,failRpc=false}={}){
 const calls=[];
 let signedIn=allowed;
 const auth={
  async getSession(){calls.push('getSession');return {data:{session:signedIn?{access_token:'hidden'}:null},error:null}},
  async signInWithOtp(arg){
   calls.push({otp:arg});
   return {data:{verifyOtp:async({token})=>{calls.push({verifyOtp:token});signedIn=true;return {data:{session:{access_token:'hidden'}},error:null}}},error:null};
  },
  async signOut(){signedIn=false;calls.push('signOut');return {data:{},error:null}}
 };
 const db={async rpc(name,params){calls.push({name,params});return failRpc?{data:null,error:{message:'sensitive backend details'}}:{data:{ok:true,name},error:null}}};
 return {app:{auth,rdb:()=>db},calls};
}
test('request OTP and confirm use CloudBase v3 closure path, not raw tokens',async()=>{
 const {app,calls}=stub({allowed:false});const x=create(app);
 assert.equal((await x.session()),null);
 await x.requestCode(' Parent@Example.COM ');
 assert.equal(calls[1].otp.email,'parent@example.com');
 assert.deepEqual(calls[1].otp.options,{shouldCreateUser:true});
 await assert.rejects(()=>x.confirmCode('abc'),/invalid_verification_code/);
 assert.deepEqual(await x.confirmCode('123456'),{authenticated:true});
 assert.ok(await x.session());
 assert.deepEqual(await x.logout(),{signedOut:true});
 assert.equal(await x.session(),null);
});
test('anonymous cannot create family or accept invite',async()=>{
 const {app,calls}=stub({allowed:false});const client=create(app);
 await assert.rejects(()=>client.createFamily('小宝家庭'),/login_required/);
 await assert.rejects(()=>client.acceptInvite(UUID),/login_required/);
 assert.equal(calls.some(x=>x&&x.name),false);
});
test('RPC values are restricted to known method names and explicit params',async()=>{
 const {app,calls}=stub();const x=create(app);
 await x.createFamily('小宝家庭');
 await x.createInvite(UUID);
 await x.acceptInvite(UUID);
 assert.deepEqual(calls.filter(x=>x?.name).map(x=>x.name),
  ['xb_create_family','xb_create_invite','xb_accept_invite']);
 assert.deepEqual(calls.filter(x=>x?.name)[0].params,{p_name:'小宝家庭'});
});
test('invalid family names and tokens never reach server',async()=>{
 const {app,calls}=stub();const x=create(app);
 await assert.rejects(()=>x.createFamily(''),/invalid_family_name/);
 await assert.rejects(()=>x.createInvite('not-a-uuid'),/invalid_family_id/);
 await assert.rejects(()=>x.acceptInvite(''),/invalid_invite_token/);
 assert.equal(calls.some(x=>x?.name),false);
});
test('server errors do not leak SDK response, email or token in thrown messages',async()=>{
 const {app}=stub({failRpc:true});const x=create(app);
 await assert.rejects(()=>x.createFamily('family'),error=>{
  assert.match(error.message,/cloudbase_request_failed/);
  assert.doesNotMatch(error.message,/sensitive backend details/);
  return true;
 });
});
test('SDK is never initialized implicitly by importing adapter',()=>{
 assert.throws(()=>create({}),/unsupported_cloudbase_app/);
 assert.throws(()=>create({auth:{},rdb(){return {}}}),/requires_cloudbase_v3/);
});

test('CloudBase v3 official auth is a property rather than a factory method',()=>{
 const {app}=stub();
 assert.equal(typeof app.auth,'object');
 assert.equal(typeof app.rdb,'function');
 assert.equal(typeof create(app).requestCode,'function');
});
test('a verifier can retry a mistyped OTP without restarting login',async()=>{
 const {app}=stub({allowed:false}), client=create(app);
 await client.requestCode('person@example.com');
 await assert.rejects(()=>client.confirmCode('xyz'),/invalid_verification_code/);
 await client.confirmCode('123456');
 assert.ok(await client.session());
});
