const test=require('node:test');
const assert=require('node:assert/strict');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const M1=require('../preview/v1.2.0/m1-controller.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const SMOKE='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
function fixture(initialSession){
 let signedIn=initialSession;
 const trace=[],ids=new Map(),auth={
  getSession:async()=>signedIn?{data:{session:{user:{id:'person-A'}},
   user:{id:'person-A',email:'a@example.com'}}}:{data:{session:null,user:null}}
 };
 const db={from:table=>{
  if(table!=='families')throw Error('unexpected CloudBase table '+table);
  trace.push('families');
  return{select:()=>({limit:async()=>({data:[{id:FAMILY}]})})};
 }};
 const sdk={auth,rdb:()=>db};
 const html={body:{dataset:{}},getElementById:id=>{
  if(!ids.has(id))ids.set(id,{textContent:'',hidden:false,value:'',
   addEventListener(){}});
  return ids.get(id);
 },addEventListener(){}};
 const host={
  navigator:{onLine:true},addEventListener(){},
  cloudbase:{init:()=>{trace.push('sdk.init');return sdk}},
  XBCloudbaseFamilyClient:{create:()=>({
   requestCode:async()=>{trace.push('otp.sent')},
   confirmCode:async()=>{signedIn=true;trace.push('otp.confirmed')},
   logout:async()=>{signedIn=false;trace.push('logout')}
  })},
  XBSessionRecovery:{create:()=>({restore:async()=>({
   status:signedIn?'authenticated':'auth-required'
  })})},
  XBCloudbaseAccessPreflight:{create:()=>({verifyAccess:async()=>({
   member:true,appCode:'xb',familyId:FAMILY,actorUid:'person-A'})})},
  XBCloudbaseChildReader:{create:()=>({listActiveChildren:async()=>({
   activeChildren:[{id:SMOKE,legacy_slot:'__xb_smoke_v1__'}]
  })})},
  XBChildScopeGuard:{},
  XBInventoryClient:{create:()=>({readReconciliation:async()=>({
   complete:true,actorUid:'person-A',
   rows:['NB','S','M','L','XL','XXL'].map(size=>({
    size,quantity:size==='S'?140:0,revision:2}))
  })})}
 };
 let shown=0;
 const ui={defaults:()=>({inventory:{},transactions:[]}),
  show:()=>shown++,clear:()=>trace.push('cleared')};
 function app(){
  return Formal.create({
   host,doc:html,loginController:M1,
   readModelFactory:()=>({read:async()=>{trace.push('primary.checked');
    return {status:'PRIMARY_NOT_READY',canWrite:false,
     noDataImported:true};
   }}),
   primaryFactory:()=>{throw Error('NO PRIMARY MUST NEVER INIT OUTBOX')},
   commandsFactory:{create:()=>({})},
   actionsFactory:{create:()=>({})},
   projection:{project:()=>{throw Error('NO PRIMARY MUST NEVER PROJECT')}},
   ui,scriptLoader:async()=>{throw Error('SDK URL should not load')}
  });
 }
 return {app,host,ids,trace,
  get shown(){return shown},get signedIn(){return signedIn}};
}
test('actual M1 SDK session/verified-family API restores without OTP; smoke S140 cannot appear as primary',async()=>{
 const f=fixture(true);
 const formal=f.app();
 assert.equal(await formal.start(),'unverified');
 assert.equal(formal.mode,'unverified');
 assert.equal(f.shown,0);
 assert.ok(f.trace.includes('sdk.init'));
 assert.ok(f.trace.includes('primary.checked'));
 assert.equal(f.trace.includes('otp.sent'),false);
 assert.match(f.ids.get('formalGateMessage').textContent,/正式宝宝/);
 assert.equal(f.ids.get('formalCurrentFamily').textContent,'—');
 assert.equal(f.ids.get('formalLoginCard').hidden,true);
 const reopened=f.app();
 assert.equal(await reopened.start(),'unverified');
 assert.equal(f.shown,0);
 assert.equal(f.trace.filter(x=>x==='otp.sent').length,0);
});
test('actual M1 email OTP changes SDK state; formal gate recognizes authenticated but no primary',async()=>{
 const f=fixture(false),formal=f.app();
 assert.equal(await formal.start(),'login');
 const sdkController=formal.controller;
 assert.equal(await sdkController.requestOtp('a@example.com'),'OTP_REQUESTED');
 const result=await sdkController.confirmOtp('123456');
 assert.equal(result,'CLOUD_READ_ONLY_CONNECTED');
 assert.equal(f.signedIn,true);
 assert.equal(await formal.restore(),'unverified');
 assert.equal(f.shown,0);
 assert.equal(f.trace.includes('otp.confirmed'),true);
});
test('offline after valid session hides previous UI without invalidating SDK login',async()=>{
 const f=fixture(true),formal=f.app();
 await formal.start();
 f.host.navigator.onLine=false;
 assert.equal(await formal.restore(),'offline');
 assert.equal(f.signedIn,true);
 assert.equal(f.trace.includes('logout'),false);
});
