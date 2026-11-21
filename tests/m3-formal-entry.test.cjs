const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Login=require('../preview/v1.2.0/formal-controller.js');
const html=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal/index.html'),'utf8');
const base=()=>({inventory:{NB:0,S:140,M:0,L:0,XL:0,XXL:0},
 transactions:[],quotes:[],weightRecords:[]});
function setup({session=false,primaryReady=false,pending=0,offline=false,
  otpStatus='CLOUD_READ_ONLY_CONNECTED',primaryFailure='PRIMARY_NOT_READY',
  waitForPrimary=null}={}){
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
 let authed=session,ready=primaryReady,queue=pending,connectStatus=null;
 let actorUid='A',familyId='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
 let activeTab='overview';
 const sdk={auth:{getSession:async()=>({data:{user:{id:'A',email:'a@example.com'},
  session:{user:{id:'A'}}}})}};
 const controller={
  connect:async()=>{trace.push('session.restore');return connectStatus??(!authed?'LOGIN_REQUIRED':
   host.navigator.onLine?'CLOUD_READ_ONLY_CONNECTED':'OFFLINE_LOCAL_ONLY')},
  verifiedContext:()=>authed?{app:sdk,familyId,actorUid}:null,
  requestOtp:async()=> 'OTP_REQUESTED',
  confirmOtp:async()=>{authed=true;return otpStatus},
  signOut:async()=>{authed=false;trace.push('auth.signOut');return 'LOGIN_REQUIRED'}
 };
 const ui={defaults:base,show:()=>trace.push('ui.show'),clear:()=>trace.push('ui.clear'),
  openMaternalHealth:()=>{activeTab='maternal-health'},resetNavigation:()=>{activeTab='overview'}};
 const projected={canWrite:false,state:base()};
 const app=Login.create({
  host,doc,loginController:{create:()=>controller},
  readModelFactory:()=>({read:async()=>{trace.push('primary.read');
   if(waitForPrimary)await waitForPrimary;
   return ready?{status:'PRIMARY_READ_ONLY_READY',canWrite:false}:
    {status:primaryFailure,canWrite:false};
  }}),
  primaryFactory:()=>({
   activate:async()=>{trace.push('primary.activate');
    return{status:'PRIMARY_OUTBOX_READ_ONLY_READY'}},
   pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:queue}),
   cloudWritesEnabled:false
  }),
  commandsFactory:{create:()=>({submit:async()=>({status:'NO_WRITE'})})},
  actionsFactory:{create:()=>({attach:()=>{
   trace.push('attach');return {detach(){trace.push('detach')}};
  }})},
  projection:{project:()=>projected},ui,scriptLoader:async()=>{}
 });
 return {app,host,doc,trace,element,handlers,
  setReady:r=>{ready=r},setPending:q=>{queue=q},
  setSession:a=>{authed=a},setConnectStatus:value=>{connectStatus=value},
  setScope:(nextActor,nextFamily=familyId)=>{actorUid=nextActor;familyId=nextFamily},
  get activeTab(){return activeTab}};
}
test('formal page keeps the login gate and arranges six tabs in two mobile rows',()=>{
 assert.match(html,/<body data-formal-state="boot">/);
 assert.match(html,/body:not\(\[data-formal-state="ready"\]\) \.wrap\{display:none!important\}/);
 assert.match(html,/id="formalLoginCard" hidden/);
 assert.match(html,/id="formalCurrentAccount"/);
 assert.match(html,/id="formalSignOut"/);
 assert.match(html,/src="\.\.\/m1-controller\.js"/);
 assert.match(html,/src="\.\.\/formal-controller\.js"/);
 assert.deepEqual(Array.from(html.matchAll(/data-tab="([\w-]+)"\s*>/g),match=>match[1]),
  ['overview','compare','history','growth','settings','maternal-health']);
 assert.match(html,/\.tabs\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);gap:6px\}\.tab\{min-height:44px/);
 assert.match(html,/id="maternal-health" role="tabpanel" aria-labelledby="tabMaternalHealth"/);
 assert.match(html,/id="formalOpenMaternalHealth"[^>]* hidden>/);
 assert.doesNotMatch(html,/id="m3Demo"|id="m102Create"|id="m1Email"/);
 assert.doesNotMatch(html,/xiaobao_v120_m1_local_sandbox/);
 assert.equal(Login.FORMAL_WRITE_ENABLED,false);
 assert.equal(Login.FORMAL_DOCUMENT_WRITE_ENABLED,true);
 assert.equal(Login.FORMAL_PURCHASE_ENABLED,true);
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
test('existing SDK session restores to primary UI with the maternal tab available',async()=>{
 const f=setup({session:true,primaryReady:true});
 await f.app.start();
 assert.equal(f.app.mode,'ready');
 assert.equal(f.doc.body.dataset.formalState,'ready');
 assert.equal(f.doc.body.dataset.formalFamilyReady,'true');
 assert.equal(f.activeTab,'overview');
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
test('primary no longer ready clears the baby view and opens maternal health',async()=>{
 const f=setup({session:true,primaryReady:true});
 await f.app.start();
 f.setReady(false);
 await f.app.restore();
 assert.equal(f.app.mode,'unverified');
 assert.equal(f.doc.body.dataset.formalState,'unverified');
 assert.equal(f.doc.body.dataset.formalFamilyReady,'true');
 assert.equal(f.activeTab,'maternal-health');
 assert.equal(f.element('formalCurrentAccount').textContent,'—');
 assert.ok(f.trace.includes('ui.clear'));
 assert.ok(f.trace.includes('detach'));
});
test('verified family opens maternal health while primary read is still pending',async()=>{
 let finishPrimary;
 const f=setup({session:true,waitForPrimary:new Promise(resolve=>{finishPrimary=resolve})});
 f.setScope('B');
 const startup=f.app.start();
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.trace.includes('primary.read'));
  assert.equal(f.app.mode,'boot');
  assert.equal(f.doc.body.dataset.formalFamilyReady,'true');
  assert.equal(f.element('formalOpenMaternalHealth').hidden,false);
  f.handlers.get('formalOpenMaternalHealth:click')();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.activeTab,'maternal-health');
  assert.ok(!f.trace.includes('attach'));
 }finally{finishPrimary();await startup;}
 assert.equal(f.activeTab,'maternal-health');
 assert.ok(!f.trace.includes('ui.show'));
});
test('missing migration receipt still opens maternal health without activating baby features',async()=>{
 const f=setup({session:true,primaryFailure:'MIGRATION_READ_NOT_READY'});
 await f.app.start();
 assert.equal(f.doc.body.dataset.formalFamilyReady,'true');
 assert.equal(f.activeTab,'maternal-health');
 assert.ok(!f.trace.includes('primary.activate'));
 assert.ok(!f.trace.includes('attach'));
});
test('account and family changes reset navigation; expired and denied sessions close maternal health',async()=>{
 const f=setup({session:true});
 await f.app.start();
 assert.equal(f.activeTab,'maternal-health');
 f.setReady(true);
 f.setScope('B');
 await f.app.restore();
 assert.equal(f.activeTab,'overview');
 f.handlers.get('formalOpenMaternalHealth:click')();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.activeTab,'maternal-health');
 f.setScope('B','34b28c1b-9acb-4dad-a1d2-b63b9c69e3a5');
 await f.app.restore();
 assert.equal(f.activeTab,'overview');
 f.setConnectStatus('FAMILY_PERMISSION_DENIED');
 await f.app.restore();
 // Even a stale verifiedContext from a prior call cannot reopen the tab.
 assert.equal(f.doc.body.dataset.formalFamilyReady,undefined);
 assert.equal(f.element('formalOpenMaternalHealth').hidden,true);
 f.setConnectStatus('LOGIN_REQUIRED');
 await f.app.restore();
 assert.equal(f.app.mode,'login');
 assert.equal(f.doc.body.dataset.formalFamilyReady,undefined);
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
 assert.equal(f.trace.filter(x=>x==='session.restore').length,1);
 // OTP confirmation already verified the family; no second connect().
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

test('formal static upload references two real parent-directory controllers and inline modules match Feature sources',()=>{
 const assets=[...html.matchAll(/<(?:script|link|img|source)\b[^>]*\b(?:src|href)="([^"]+)"/gi)]
  .map(m=>m[1]);
 assert.deepEqual(assets,['../m1-controller.js','../../../sync/maternal-health-client.js',
  '../../../sync/maternal-health-operations.js','../maternal-weight.js','../formal-controller.js']);
 // Resolve URL-relative imports from the actual HTML folder; missing assets
 // must fail before a green CI can claim a deployable browser preview.
 for(const asset of assets){
  const resolved=path.resolve(__dirname,'../preview/v1.2.0/formal/',asset);
  assert.ok(fs.existsSync(resolved),'missing deployed script '+asset);
  assert.match(fs.readFileSync(resolved,'utf8'),/function|const/);
 }
 for(const name of [
  'primary-cloud-operations','primary-business-commands',
  'primary-formal-ui-actions','primary-stocktake-batch-client','idb-outbox','outbox-contract',
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
 assert.match(fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8'),
  /const FORMAL_DOCUMENT_WRITE_ENABLED=true/);
});
test('formal controller required HTML controls exist and cannot silently deadlock without scripts',()=>{
 const controllerText=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 const needed=[...controllerText.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
 for(const id of needed.filter(x=>x!=='formalRefresh'))
  assert.ok(ids.has(id),'missing formal DOM control '+id);
 assert.ok(!ids.has('formalRefresh'),'T07 removed obsolete top refresh; cloud sync button remains');
 assert.ok(ids.has('formalGetCloudLatest'));
 assert.match(controllerText,/正式入口组件未完整加载/);
 assert.match(html,/id="formalGateSignOut"/);
 assert.match(html,/id="formalRetry"/);
});
test('formal page embeds the exact standalone growth module',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../growth.js'),'utf8').trim();
 assert.ok(html.includes(source),'growth.js embedded module does not match formal page');
});
