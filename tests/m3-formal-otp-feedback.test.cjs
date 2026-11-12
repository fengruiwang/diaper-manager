const test=require('node:test');
const assert=require('node:assert/strict');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const Family=require('../sync/cloudbase-family-client.js');
const fs=require('node:fs');
const path=require('node:path');
const PAGE=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal/index.html'),'utf8');
const OTP_KEY='xiaobao_v120_formal_otp_resend_until';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({session=false,primaryReady=false,sent='OTP_REQUESTED',
 errorDetail='',storage=new Map(),clock={time:1900000000000},pendingPromise=null}={}){
 const items=new Map(),handlers=new Map(),timerCalls=new Map();
 let nextTimer=1,otpCalls=0,loginView;
 const element=id=>{
  if(!items.has(id))items.set(id,{id,hidden:false,disabled:false,
   textContent:'',value:'',addEventListener(type,fn){handlers.set(id+':'+type,fn)}});
  return items.get(id);
 };
 const doc={body:{dataset:{}},getElementById:element,
  addEventListener(type,fn){handlers.set('doc:'+type,fn)}};
 const host={navigator:{onLine:true},Date:{now:()=>clock.time},
  localStorage:{
   getItem:key=>storage.get(key)??null,
   setItem:(key,value)=>storage.set(key,value),
   removeItem:key=>storage.delete(key)
  },
  setInterval:fn=>{const id=nextTimer++;timerCalls.set(id,fn);return id;},
  clearInterval:id=>timerCalls.delete(id),
  addEventListener:(type,fn)=>handlers.set('host:'+type,fn)
 };
 const controller={
  connect:async()=>session?'CLOUD_READ_ONLY_CONNECTED':'LOGIN_REQUIRED',
  verifiedContext:()=>session?{app:{},familyId:'29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',actorUid:'A'}:null,
  async requestOtp(){
   otpCalls++;
   if(pendingPromise)await pendingPromise;
   if(sent==='OTP_REQUEST_FAILED')loginView.status('OTP_REQUEST_FAILED',errorDetail);
   return sent;
  },
  confirmOtp:async()=> 'LOGIN_REQUIRED',
  signOut:async()=> 'LOGIN_REQUIRED'
 };
 const app=Formal.create({host,doc,loginController:{create({view}){loginView=view;return controller}},
  readModelFactory:()=>({read:async()=>({
   status:primaryReady?'PRIMARY_READ_ONLY_READY':'PRIMARY_NOT_READY',canWrite:false
  })}),
  primaryFactory:()=>{throw Error('primary never initialized before migration')},
  commandsFactory:{create(){}},actionsFactory:{create(){}},
  projection:{project:()=>({canWrite:false})},
  ui:{show(){throw Error('should not show family data')},clear(){},
   defaults:()=>({})},scriptLoader:async()=>{}
 });
 return {
  app,host,element,storage,clock,handlers,timerCalls,
  get calls(){return otpCalls},
  click(id){handlers.get(id+':click')?.()},
  tick(){for(const fn of [...timerCalls.values()])fn();}
 };
}
test('OTP first click immediately disables and displays sending, concurrent click makes one SDK call',async()=>{
 let finish;
 const pending=new Promise(resolve=>{finish=resolve});
 const f=fixture({pendingPromise:pending});
 await f.app.start();
 assert.equal(f.element('formalSendOtp').textContent,'发送验证码');
 f.element('formalEmail').value='a@example.com';
 f.click('formalSendOtp');
 await flush();
 assert.equal(f.element('formalSendOtp').disabled,true);
 assert.equal(f.element('formalSendOtp').textContent,'发送中…');
 assert.equal(f.element('formalLoginMessage').textContent,'正在向邮箱发送验证码…');
 f.click('formalSendOtp');await flush();
 assert.equal(f.calls,1);
 finish();await flush();
 assert.equal(f.element('formalSendOtp').textContent,'60 秒后重新发送');
 assert.equal(f.element('formalSendOtp').disabled,true);
 assert.match(f.element('formalLoginMessage').textContent,/验证码发送成功/);
 assert.equal(f.storage.get(OTP_KEY),String(f.clock.time+60000));
});
test('successful server ACK persists countdown over refresh, ticks and resets after sixty seconds',async()=>{
 const storage=new Map(),clock={time:1900000000000};
 const a=fixture({storage,clock});await a.app.start();
 a.click('formalSendOtp');await flush();
 clock.time+=31000;a.tick();
 assert.equal(a.element('formalSendOtp').textContent,'29 秒后重新发送');
 const refreshed=fixture({storage,clock});await refreshed.app.start();
 assert.equal(refreshed.element('formalSendOtp').textContent,'29 秒后重新发送');
 refreshed.click('formalSendOtp');await flush();
 assert.equal(refreshed.calls,0);
 clock.time+=29001;refreshed.tick();
 assert.equal(refreshed.element('formalSendOtp').textContent,'重新发送验证码');
 assert.equal(refreshed.element('formalSendOtp').disabled,false);
 assert.equal(storage.has(OTP_KEY),false);
 refreshed.click('formalSendOtp');await flush();
 assert.equal(refreshed.calls,1);
});
test('server failed ACK does not start success cooldown; generic and rate-limit messaging remain distinct',async()=>{
 const limited=fixture({sent:'OTP_REQUEST_FAILED',
  errorDetail:'family_client: rate_limited'});
 await limited.app.start();
 limited.click('formalSendOtp');await flush();
 assert.equal(limited.calls,1);
 assert.match(limited.element('formalLoginMessage').textContent,/服务器已限制请求/);
 assert.equal(limited.element('formalSendOtp').disabled,false);
 assert.equal(limited.storage.has(OTP_KEY),false);
 const generic=fixture({sent:'OTP_REQUEST_FAILED',
  errorDetail:'family_client: cloudbase_request_failed'});
 await generic.app.start();generic.click('formalSendOtp');await flush();
 assert.match(generic.element('formalLoginMessage').textContent,/发送失败/);
 assert.doesNotMatch(generic.element('formalLoginMessage').textContent,/发送成功/);
 assert.equal(generic.element('formalSendOtp').textContent,'发送验证码');
});
test('primary not ready is a static verified state: retry/switch visible, spinner hidden, no cloud write',async()=>{
 const f=fixture({session:true});
 await f.app.start();
 assert.equal(f.app.mode,'unverified');
 assert.equal(f.element('formalLoadingCard').hidden,true);
 assert.equal(f.element('formalGateActions').hidden,false);
 assert.equal(f.element('formalLoginCard').hidden,true);
 assert.equal(f.element('formalSendOtp').disabled,false);
 assert.equal(f.element('formalGateMessage').textContent,
  '正式宝宝数据尚未准备好。登录状态已确认，但正式宝宝尚未创建或完成历史迁移。');
 assert.match(PAGE,/id="formalGateActions" hidden/);
 assert.match(PAGE,/id="formalRetry"/);
 assert.match(PAGE,/id="formalGateSignOut"/);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
});
test('offline is static, no spinner or forced logout; loading spinner only during boot',async()=>{
 const f=fixture();
 await f.app.start();
 assert.equal(f.element('formalLoadingCard').hidden,true);
 f.host.navigator.onLine=false;
 await f.app.restore();
 assert.equal(f.app.mode,'offline');
 assert.equal(f.element('formalLoadingCard').hidden,true);
 assert.equal(f.element('formalGateActions').hidden,false);
 assert.equal(f.element('formalLoginCard').hidden,true);
 assert.match(f.element('formalGateMessage').textContent,/离线/);
});
test('CloudBase explicit OTP rate limits are sanitized, unknown errors stay generic',async()=>{
 const sdk=answer=>({auth:{
  getSession:async()=>({data:{session:null}}),
  signInWithOtp:async()=>answer
 },rdb:()=>({rpc(){}})});
 await assert.rejects(()=>Family.create(sdk({error:{code:429}}))
  .requestCode('a@example.com'),/family_client: rate_limited/);
 await assert.rejects(()=>Family.create(sdk({error:{code:'SOMETHING_ELSE'}}))
  .requestCode('a@example.com'),/family_client: cloudbase_request_failed/);
 const rejected=Family.create({auth:{
  getSession:async()=>({data:{session:null}}),
  signInWithOtp:async()=>{const error=Error('private server response');
   error.statusCode=429;throw error;}
 },rdb:()=>({rpc(){}})});
 await assert.rejects(()=>rejected.requestCode('a@example.com'),
  /family_client: rate_limited/);
 const sdkSource=fs.readFileSync(path.join(__dirname,
  '../sync/cloudbase-family-client.js'),'utf8');
 assert.ok(PAGE.includes(sdkSource.trim()),
  'deployed formal HTML must embed the same rate-limit-aware SDK adapter');
});
