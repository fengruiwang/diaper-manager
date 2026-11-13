const test=require('node:test'),assert=require('node:assert/strict');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
function fixture({authed=true,documentPending=false,sessionPending=false,
 readPending=false,activatePending=false,fastTimeout=false}={}){
 const trace=[],handlers=new Map(),elements=new Map();
 const element=id=>{
  if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',value:'',
   addEventListener(type,fn){handlers.set(id+':'+type,fn)}});
  return elements.get(id);
 };
 const doc={body:{dataset:{}},visibilityState:'visible',
  getElementById:element,addEventListener:(type,fn)=>handlers.set('doc:'+type,fn)};
 const host={navigator:{onLine:true},crypto:{randomUUID:()=> '04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'},
  addEventListener:(type,fn)=>handlers.set('host:'+type,fn),
  setTimeout:fastTimeout?(fn=>setTimeout(fn,5)):setTimeout,clearTimeout};
 let actor='dad',loggedIn=authed,readInvalid=false,docCalls=0,activations=0;
 const never=()=>new Promise(()=>{});
 const sdk={auth:{getSession:()=>sessionPending?never():Promise.resolve({
  data:{user:{id:actor,email:actor+'@example.com'},session:{user:{id:actor}}}
 })}};
 const controller={connect:async()=>loggedIn?'CLOUD_READ_ONLY_CONNECTED':'LOGIN_REQUIRED',
  verifiedContext:()=>loggedIn?{app:sdk,actorUid:actor,familyId:FAMILY}:null,
  confirmOtp:async()=>{loggedIn=true;return'CLOUD_READ_ONLY_CONNECTED'},
  requestOtp:async()=>'OTP_REQUESTED',signOut:async()=>{loggedIn=false;return'LOGIN_REQUIRED'}};
 const app=Formal.create({host,doc,loginController:{create:()=>controller},
  readModelFactory:()=>({read:()=>readPending?never():Promise.resolve({
   status:readInvalid?'PRIMARY_NOT_READY':'PRIMARY_READ_ONLY_READY',canWrite:false
  })}),
  primaryFactory:()=>({activate:()=>{activations++;
   return activatePending?never():Promise.resolve({status:'PRIMARY_OUTBOX_READ_ONLY_READY'});
  },pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0})}),
  commandsFactory:{create:()=>({})},
  actionsFactory:{create:()=>({attach:()=>({detach(){trace.push('detach')}})})},
  projection:{project:()=>({canWrite:false,state:{},revisions:{}})},
  ui:{defaults:()=>({}),show:()=>trace.push('show:'+actor),clear:()=>trace.push('clear')},
  documentsFactory:()=>({readAll:()=>{docCalls++;
   return documentPending?never():Promise.resolve({status:'PRIMARY_DOCUMENT_SNAPSHOT_INCOMPLETE'});
  }}),
  documentsOverlay:{apply:()=>({canWrite:false,sharedBusinessDocumentsVerified:true})},
  scriptLoader:async()=>{}
 });
 return {app,doc,handlers,element,trace,setActor:x=>actor=x,
  setAuthed:x=>loggedIn=x,setReadInvalid:x=>readInvalid=x,
  get documentCalls(){return docCalls},get activations(){return activations}};
}
test('P0: restored session renders primary without blocking on document or email reads',async()=>{
 const f=fixture({documentPending:true,sessionPending:true});
 assert.equal(await f.app.start(),'ready');
 assert.equal(f.doc.body.dataset.formalState,'ready');
 assert.equal(f.documentCalls,1);
});
test('P0: visibility revalidation retains ready view and avoids duplicate document loops',async()=>{
 const f=fixture({documentPending:true});
 await f.app.start();
 f.handlers.get('doc:visibilitychange')();
 await new Promise(r=>setImmediate(r));
 assert.equal(f.doc.body.dataset.formalState,'ready');
 assert.equal(f.documentCalls,1);
});
test('P0: first OTP login and browser refresh recover without stale history',async()=>{
 const f=fixture({authed:false});
 assert.equal(await f.app.start(),'login');
 f.setAuthed(true);
 assert.equal(await f.app.restore(),'ready');
 const fresh=fixture();
 assert.equal(await fresh.app.start(),'ready');
});
test('P0: critical cloud read and IDB activation timeouts never hang boot',async()=>{
 for(const options of [{readPending:true},{activatePending:true}]){
  const f=fixture({...options,fastTimeout:true});
  assert.equal(await f.app.start(),'unverified');
  assert.equal(f.doc.body.dataset.formalState,'unverified');
  assert.equal(f.element('formalLoadingCard').hidden,true);
 }
});
test('P0: two actor scopes never reuse prior visible business state',async()=>{
 const f=fixture();
 await f.app.start();
 f.setActor('wife');
 assert.equal(await f.app.restore(),'ready');
 assert.ok(f.trace.includes('clear'));
 assert.ok(f.trace.includes('show:wife'));
 f.setAuthed(false);
 assert.equal(await f.app.restore(),'login');
 assert.equal(f.element('formalCurrentAccount').textContent,'—');
});
test('P0: revoked primary scope clears already-rendered data',async()=>{
 const f=fixture();
 await f.app.start();
 f.setReadInvalid(true);
 assert.equal(await f.app.restore(),'unverified');
 assert.equal(f.element('formalCurrentFamily').textContent,'—');
});
test('P0: feature build still denies every formal business write',()=>{
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
});
