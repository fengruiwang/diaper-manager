const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Login=require('../preview/v1.2.0/formal-controller.js');
const html=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal/index.html'),'utf8');
const base=()=>({inventory:{NB:0,S:140,M:0,L:0,XL:0,XXL:0},
 transactions:[],quotes:[],weightRecords:[]});
function setup({session=false,primaryReady=false,pending=0,offline=false,
  otpStatus='CLOUD_READ_ONLY_CONNECTED'}={}){
 const trace=[],items=new Map(),handlers=new Map();
 const element=id=>{
  if(!items.has(id))items.set(id,{
   id,hidden:false,textContent:'',value:'',
   addEventListener(type,fn){handlers.set(id+':'+type,fn)}
  });
  return items.get(id);
 };
 const doc={
  body:{dataset:{formalState:'boot'}},
  getElementById:element,
  addEventListener(type,fn){handlers.set('doc:'+type,fn)}
 };
 const host={navigator:{onLine:!offline},crypto:{randomUUID:()=> '04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'},
  addEventListener(type,fn){handlers.set('host:'+type,fn)}};
 let authed=session,ready=primaryReady,queue=pending;
 const sdk={auth:{getSession:async()=>({data:{user:{id:'A',email:'a@example.com'},
  session:{user:{id:'A'}}}})}};
 const controller={
  connect:async()=>{trace.push('session.restore');return !authed?'LOGIN_REQUIRED':
   host.navigator.onLine?'CLOUD_READ_ONLY_CONNECTED':'OFFLINE_LOCAL_ONLY'},
  verifiedContext:()=>authed?{app:sdk,familyId:'29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   actorUid:'A'}:null,
  requestOtp:async()=> 'OTP_REQUESTED',
  confirmOtp:async()=>{authed=true;return otpStatus},
  signOut:async()=>{authed=false;trace.push('auth.signOut');return 'LOGIN_REQUIRED'}
 };
 const ui={defaults:base,show:()=>trace.push('ui.show'),
  clear:()=>trace.push('ui.clear')};
 const projected={canWrite:false,state:base()};
 const app=Login.create({
  host,doc,loginController:{create:()=>controller},
  readModelFactory:()=>({read:async()=>{trace.push('primary.read');
   return ready?{status:'PRIMARY_READ_ONLY_READY',canWrite:false}:
    {status:'PRIMARY_NOT_READY',canWrite:false};
  }}),
  primaryFactory:()=>({
   activate:async()=>{trace.push('primary.activate');
    return{status:'PRIMARY_OUTBOX_READ_ONLY_READY'}},
   pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:queue}),
   cloudWritesEnabled:false
  }),
  commandsFactory:{create:()=>({submit:async()=>({status:'NO_WRITE'})})},
  actionsFactory:{create:()=>({attach:()=>({detach(){trace.push('detach')}})})},
  projection:{project:()=>projected},ui,scriptLoader:async()=>{}
 });
 return {app,host,doc,trace,element,handlers,
  setReady:r=>{ready=r},setPending:q=>{queue=q},
  setSession:a=>{authed=a}};
}
test('formal page preserves original five tabs but uses separate non-flashing login gate',()=>{
 assert.match(html,/<body data-formal-state="boot">/);
 assert.match(html,/body:not\(\[data-formal-state="ready"\]\) \.wrap\{display:none!important\}/);
 assert.match(html,/id="formalLoginCard" hidden/);
 assert.match(html,/id="formalCurrentAccount"/);
 assert.match(html,/id="formalSignOut"/);
 assert.match(html,/src="\.\/m1-controller\.js"/);
 assert.match(html,/src="\.\/formal-controller\.js"/);
 for(const tab of ['overview','compare','history','growth','settings'])
  assert.match(html,new RegExp('data-tab="'+tab+'"'));
 assert.doesNotMatch(html,/id="m3Demo"|id="m102Create"|id="m1Email"/);
 assert.doesNotMatch(html,/xiaobao_v120_m1_local_sandbox/);
 assert.equal(Login.FORMAL_WRITE_ENABLED,false);
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
 for(const script of scripts)if(script[1].trim())
  assert.doesNotThrow(()=>new Function(script[1]));
});
test('first login → separate OTP screen; no authenticated family data flashed',async()=>{
 const f=setup();
 await f.app.start();
 assert.equal(f.app.mode,'login');
 assert.equal(f.doc.body.dataset.formalState,'login');
 assert.equal(f.trace.includes('ui.show'),false);
 assert.equal(f.element('formalLoginCard').hidden,false);
 f.element('formalOtp').value='123456';
 await f.handlers.get('formalConfirmOtp:click')();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.app.mode,'unverified');
 assert.equal(f.trace.includes('ui.show'),false);
});
test('existing SDK session restores to primary five-tab UI without OTP',async()=>{
 const f=setup({session:true,primaryReady:true});
 await f.app.start();
 assert.equal(f.app.mode,'ready');
 assert.equal(f.doc.body.dataset.formalState,'ready');
 assert.equal(f.trace.filter(x=>x==='ui.show').length,1);
 assert.equal(f.element('formalCurrentAccount').textContent,'A');
 // Email enrichment is deliberately optional and must not delay ready.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.element('formalCurrentAccount').textContent,'a@example.com');
 assert.equal(f.element('formalCurrentFamily').textContent,
  '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5');
 await f.app.restore();
 assert.equal(f.app.mode,'ready');
 assert.equal(f.trace.filter(x=>x==='session.restore').length,2);
});
test('primary not migrated hides data even for previously valid sessions',async()=>{
 const f=setup({session:true,primaryReady:true});
 await f.app.start();
 f.setReady(false);
 await f.app.restore();
 assert.equal(f.app.mode,'unverified');
 assert.equal(f.doc.body.dataset.formalState,'unverified');
 assert.equal(f.element('formalCurrentAccount').textContent,'—');
 assert.ok(f.trace.includes('ui.clear'));
 assert.ok(f.trace.includes('detach'));
});
test('network outage is not an authentication logout and never shows previous data',async()=>{
 const f=setup({session:true,primaryReady:true});
 await f.app.start();
 f.host.navigator.onLine=false;
 await f.app.restore();
 assert.equal(f.app.mode,'offline');
 assert.equal(f.doc.body.dataset.formalState,'offline');
 assert.equal(f.trace.includes('auth.signOut'),false);
});
test('active account logout blocked when durable outbox has pending operations',async()=>{
 const f=setup({session:true,primaryReady:true,pending:2});
 await f.app.start();
 assert.equal(await f.app.signOut(),'PENDING_OPERATIONS_BLOCK_SIGNOUT');
 assert.equal(f.app.mode,'ready');
 assert.equal(f.trace.includes('auth.signOut'),false);
 f.setPending(0);
 assert.equal(await f.app.signOut(),'LOGIN_REQUIRED');
 assert.equal(f.app.mode,'login');
 assert.equal(f.trace.filter(x=>x==='auth.signOut').length,1);
 assert.ok(f.trace.includes('ui.clear'));
 assert.ok(f.trace.includes('detach'));
});

test('successful OTP but unprovisioned family stays authenticated, not falsely labeled invalid code',async()=>{
 const f=setup({otpStatus:'FAMILY_READY_NO_BUSINESS_CHILD'});
 await f.app.start();
 assert.equal(f.app.mode,'login');
 f.element('formalOtp').value='729381';
 f.handlers.get('formalConfirmOtp:click')();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.app.mode,'unverified');
 assert.match(f.element('formalGateMessage').textContent,/正式宝宝|正式云端/);
 assert.equal(f.element('formalLoginCard').hidden,true);
 assert.equal(f.trace.includes('ui.show'),false);
 assert.equal(f.element('formalLoginMessage').textContent,'');
 assert.equal(f.trace.filter(x=>x==='session.restore').length,2);
});
test('startup while offline does not attempt SDK initialization, does not clear SDK credentials',async()=>{
 const f=setup({session:true,offline:true});
 await f.app.start();
 assert.equal(f.app.mode,'offline');
 assert.equal(f.trace.filter(x=>x==='session.restore').length,0);
 assert.equal(f.trace.filter(x=>x==='auth.signOut').length,0);
 assert.equal(f.doc.body.dataset.formalState,'offline');
 assert.equal(f.trace.includes('ui.show'),false);
});

test('formal static upload uses exactly two same-directory scripts and inline modules match Feature sources',()=>{
 const assets=[...html.matchAll(/<(?:script|link|img|source)\b[^>]*\b(?:src|href)="([^"]+)"/gi)]
  .map(m=>m[1]);
 assert.deepEqual(assets,['./m1-controller.js','./formal-controller.js']);
 for(const name of [
  'primary-cloud-operations','primary-business-commands',
  'primary-formal-ui-actions','primary-stocktake-batch-client',
  'primary-documents-client','primary-documents-operations',
  'primary-documents-business-commands','primary-documents-overlay']){
  const code=fs.readFileSync(path.join(__dirname,'../sync/'+name+'.js'),'utf8');
  assert.ok(html.includes(code.trim()),name+' embedded code does not match source');
 }
 assert.doesNotMatch(html,/\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem|clear)\s*\(/);
 assert.doesNotMatch(html,/id="m1CloudBox"|id="m3Panel"|id="m3Demo"/);
 assert.match(fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8'),
  /const FORMAL_WRITE_ENABLED=false/);
});
test('formal controller required HTML controls exist and cannot silently deadlock without scripts',()=>{
 const controllerText=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 const needed=[...controllerText.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
 for(const id of needed)assert.ok(ids.has(id),'missing formal DOM control '+id);
 assert.match(controllerText,/正式入口组件未完整加载/);
 assert.match(html,/id="formalGateSignOut"/);
 assert.match(html,/id="formalRetry"/);
});
