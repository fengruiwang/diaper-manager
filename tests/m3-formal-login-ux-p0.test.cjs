const test=require('node:test'),assert=require('node:assert/strict');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const M1=require('../preview/v1.2.0/m1-controller.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const flush=()=>new Promise(r=>setImmediate(r));
function setup({signedIn=false,confirmOutcome='FORMAL_FAMILY_VERIFIED',
 pendingConfirm=null}={}){
 const elements=new Map(),handlers=new Map(),trace=[];
 const el=id=>{
  if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,
   disabled:false,value:'',addEventListener(type,fn){handlers.set(id+':'+type,fn)}});
  return elements.get(id);
 };
 const doc={body:{dataset:{formalState:'boot'}},visibilityState:'visible',
  getElementById:el,addEventListener:(type,fn)=>handlers.set('doc:'+type,fn)};
 const host={navigator:{onLine:true},crypto:{randomUUID:()=> '04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'},
  addEventListener:(type,fn)=>handlers.set('host:'+type,fn)};
 let authenticated=signedIn,connectCalls=0,confirmCalls=0,permission=true;
 const sdk={auth:{getSession:async()=>({
  data:{user:{id:'actor',email:'a@example.com'},session:{user:{id:'actor'}}}
 })}};
 const controller={
  connect:async()=>{connectCalls++;return authenticated?'FORMAL_FAMILY_VERIFIED':'LOGIN_REQUIRED'},
  verifiedContext:()=>authenticated&&permission?{app:sdk,familyId:FAMILY,actorUid:'actor'}:null,
  confirmOtp:async()=>{confirmCalls++;
   if(pendingConfirm)await pendingConfirm;
   if(confirmOutcome==='FORMAL_FAMILY_VERIFIED')authenticated=true;
   return confirmOutcome;
  },
  requestOtp:async()=>'OTP_REQUESTED',signOut:async()=>{authenticated=false;return 'LOGIN_REQUIRED'}
 };
 const app=Formal.create({host,doc,loginController:{create:()=>controller},
  readModelFactory:()=>({read:async()=>{trace.push('primary.read');
   return{status:'PRIMARY_READ_ONLY_READY',canWrite:false};}}),
  primaryFactory:()=>({activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
   pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0})}),
  commandsFactory:{create:()=>({})},
  actionsFactory:{create:()=>({attach:()=>({detach(){trace.push('detach')}})})},
  projection:{project:()=>({canWrite:false})},
  ui:{show:()=>trace.push('show'),clear:()=>trace.push('clear'),defaults:()=>({})},
  scriptLoader:async()=>{}
 });
 return {app,el,handlers,doc,trace,setPermission:x=>permission=x,
  get confirms(){return confirmCalls},get connects(){return connectCalls}};
}
test('P0: pending OTP keeps digits and blocks duplicate clicks; success clears after ready',async()=>{
 let finish;const pending=new Promise(r=>finish=r);
 const f=setup({pendingConfirm:pending});
 assert.equal(await f.app.start(),'login');
 f.el('formalOtp').value='123456';
 const click=f.handlers.get('formalConfirmOtp:click');
 click();click();await flush();
 assert.equal(f.el('formalOtp').value,'123456');
 assert.equal(f.el('formalConfirmOtp').disabled,true);
 assert.match(f.el('formalConfirmOtp').textContent,/正在验证/);
 assert.equal(f.confirms,1);
 finish();await flush();await flush();
 assert.equal(f.el('formalConfirmOtp').disabled,false);
 assert.equal(f.el('formalOtp').value,'');
 assert.equal(f.app.mode,'ready');
 assert.equal(f.connects,1,'no second family check after OTP, but primary is read');
 assert.ok(f.trace.includes('primary.read'));
});
test('P0: invalid OTP keeps editable input and restores button',async()=>{
 const f=setup({confirmOutcome:'OTP_INVALID_OR_EXPIRED'});await f.app.start();
 f.el('formalOtp').value='654321';f.handlers.get('formalConfirmOtp:click')();
 await flush();await flush();
 assert.equal(f.el('formalOtp').value,'654321');
 assert.equal(f.el('formalConfirmOtp').disabled,false);
 assert.match(f.el('formalLoginMessage').textContent,/不正确或已过期/);
 assert.equal(f.app.mode,'login');
});
test('P0: network OTP failure is distinct from invalid code and retains input',async()=>{
 const f=setup({confirmOutcome:'OTP_VERIFY_FAILED'});await f.app.start();
 f.el('formalOtp').value='654321';f.handlers.get('formalConfirmOtp:click')();
 await flush();await flush();
 assert.equal(f.el('formalOtp').value,'654321');
 assert.equal(f.el('formalConfirmOtp').disabled,false);
 assert.match(f.el('formalLoginMessage').textContent,/网络/);
 assert.equal(f.app.mode,'login');
});
test('P0: logout, refresh, recheck do not retain previous identity on login screen',async()=>{
 const f=setup({signedIn:true});
 assert.equal(await f.app.start(),'ready');
 f.handlers.get('doc:visibilitychange')();await flush();await flush();
 assert.equal(f.doc.body.dataset.formalState,'ready');
 assert.equal(await f.app.signOut(),'LOGIN_REQUIRED');
 assert.equal(f.doc.body.dataset.formalState,'login');
 assert.equal(await f.app.restore(),'login');
 assert.equal(f.el('formalCurrentAccount').textContent,'—');
});
test('P0: neutral loading prompt and formal writes disabled',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const html=fs.readFileSync(path.join(__dirname,'../preview/v1.2.0/formal/index.html'),'utf8');
 assert.match(html,/正在打开小宝管家…/);
 assert.doesNotMatch(html,/正在检查 CloudBase 会话与家庭权限…/);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
});
test('P0: formal-only M1 path still checks SDK identity and family grant, but defers child inventory',async()=>{
 let childCalls=0,grantCalls=0;
 const sdk={auth:{getSession:async()=>({data:{session:{user:{id:'actor'}}}})},
  rdb:()=>({from:()=>({select:()=>({limit:async()=>({data:[{id:FAMILY}]})})})})};
 const host={navigator:{onLine:true},cloudbase:{init:()=>sdk},
  XBCloudbaseFamilyClient:{create:()=>({})},
  XBSessionRecovery:{create:()=>({restore:async()=>({status:'authenticated'})})},
  XBCloudbaseAccessPreflight:{create:()=>({verifyAccess:async()=>{grantCalls++;return{
   member:true,appCode:'xb',familyId:FAMILY,actorUid:'actor'
  }}})},
  XBCloudbaseChildReader:{create:()=>({listActiveChildren:async()=>{childCalls++;return{activeChildren:[]}}})},
  XBChildScopeGuard:{},XBInventoryClient:{create:()=>({})}
 };
 const view={status(){},needsKey(){},identity(){},family(){},cloudStock(){}};
 const m1=M1.create({host,storage:null,view,scriptLoader:async()=>{},
  deferChildReadToFormal:true});
 assert.equal(await m1.connect(),'FORMAL_FAMILY_VERIFIED');
 assert.equal(grantCalls,1);
 assert.equal(childCalls,0);
 assert.equal(m1.verifiedContext().actorUid,'actor');
});
