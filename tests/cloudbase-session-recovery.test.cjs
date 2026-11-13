const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../sync/cloudbase-session-recovery.js');
function setup({session={expires_in:3600},readError=null,refreshError=null,
 noRefresh=false,throwOnRead=false}={}){
 const calls={get:0,refresh:0,otp:0,logout:0},auth={
  async getSession(){
   calls.get++;
   if(throwOnRead)throw Error('offline internal error');
   return {data:{session},error:readError};
  },
  async refreshSession(){calls.refresh++;return {data:{session},error:refreshError};},
  async signInWithOtp(){calls.otp++},
  async signOut(){calls.logout++}
 };
 if(noRefresh)delete auth.refreshSession;
 return {calls,api:create({auth})};
}
test('a valid persisted session restores without OTP, sign-out or manual token storage',async()=>{
 const x=setup();
 assert.equal((await x.api.restore()).status,'authenticated');
 assert.deepEqual(x.calls,{get:1,refresh:0,otp:0,logout:0});
});
test('reopen is compatible with repeated getSession calls and never automatically OTPs',async()=>{
 const x=setup();
 for(let i=0;i<5;i++)assert.equal((await x.api.restore()).status,'authenticated');
 assert.equal(x.calls.get,5);
 assert.equal(x.calls.otp,0);
});
test('short-lived session refreshes with CloudBase SDK before requiring login',async()=>{
 const x=setup({session:{expires_in:120,access_token:'never echoed'}});
 const result=await x.api.restore();
 assert.deepEqual(result,{status:'authenticated',refresh:'near-expiry'});
 assert.equal(x.calls.refresh,1);
 assert.doesNotMatch(JSON.stringify(result),/never echoed/);
});
test('expired access token can refresh via SDK without requesting an email code',async()=>{
 const x=setup({readError:{code:'token_expired'}});
 const r=await x.api.restore();
 assert.equal(r.status,'authenticated');
 assert.equal(r.refresh,'expired');
 assert.equal(x.calls.otp,0);
});
test('offline launches degrade gracefully; no network and no repeated OTP',async()=>{
 const x=setup();
 const r=await x.api.restore({online:false});
 assert.deepEqual(r,{status:'degraded',reason:'offline'});
 assert.equal(x.calls.get,0);
 assert.equal(x.calls.refresh,0);
 assert.equal(x.calls.otp,0);
});
test('missing/invalid refresh token requires user login, not an infinite retry loop',async()=>{
 const expired=setup({session:null});
 assert.equal((await expired.api.restore()).status,'auth-required');
 const noToken=setup({readError:{code:'invalid_refresh_token'}});
 assert.equal((await noToken.api.restore()).status,'auth-required');
 const refreshLost=setup({session:{expires_in:50},refreshError:{code:'refresh_token_expired'}});
 assert.equal((await refreshLost.api.restore()).status,'auth-required');
 assert.equal(refreshLost.calls.refresh,1);
});
test('network failure and unknown SDK errors never assert authenticated',async()=>{
 for(const config of [{readError:{code:'unreachable'}},{throwOnRead:true},
  {readError:{code:'unexpected_error'}},{session:{expires_in:50},refreshError:{code:'unreachable'}}]){
  const x=setup(config);
  assert.equal((await x.api.restore()).status,'degraded');
  assert.equal(x.calls.otp,0);
 }
});
test('missing refresh method does not perform invalid SDK call; valid session still works',async()=>{
 const x=setup({session:{expires_in:55},noRefresh:true});
 const r=await x.api.restore();
 assert.equal(r.status,'authenticated');
 assert.equal(x.calls.refresh,0);
});
test('restore calls coalesce in-flight but future reopen checks the session again',async()=>{
 let resolve,requests=0;
 const auth={getSession(){
  requests++;
  return new Promise(r=>{resolve=r});
 }};
 const client=create({auth});
 const a=client.restore(),b=client.restore();
 assert.equal(requests,1);
 resolve({data:{session:{expires_in:3600}},error:null});
 assert.deepEqual(await a,await b);
 const c=client.restore();
 assert.equal(requests,2);
 resolve({data:{session:{expires_in:3600}},error:null});
 assert.equal((await c).status,'authenticated');
});

test('P0 opt-in identity reuses the just-checked session without exposing tokens',async()=>{
 let calls=0;
 const sdk={getSession:async()=>{
  calls++;return {data:{user:{id:'dad'},
   session:{user:{id:'dad'},expires_in:3600,access_token:'SECRET-DO-NOT-EXPOSE'}}};
 }};
 const client=create({auth:sdk});
 const result=await client.restore({withActorUid:true});
 assert.equal(result.status,'authenticated');
 assert.equal(result.actorUid,'dad');
 assert.equal(calls,1);
 assert.doesNotMatch(JSON.stringify(result),/SECRET-DO-NOT-EXPOSE/);
});
test('P0 default session recovery still omits extra identity and refresh behavior stays compatible',async()=>{
 const x=setup();
 const old=await x.api.restore();
 assert.equal('actorUid' in old,false);
 assert.equal(x.calls.get,1);
});
