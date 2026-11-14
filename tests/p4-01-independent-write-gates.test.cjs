const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const Bridge=require('../sync/primary-formal-ui-actions.js');
const Docs=require('../sync/primary-documents-operations.js');
const Business=require('../sync/primary-documents-business-commands.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const UUIDS=['04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',
 '79192488-bd70-4b88-8c66-3c5b5fb29ef5',
 '29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6',
 '6b3d0e45-bf18-4c95-889c-6f19731a8ae5',
 '826b0dc7-1bbc-41cb-bf1d-ec437e645410'];
const sizes=['NB','S','M','L','XL','XXL'];
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture({purchase=false,documents=false,approvePurchase=true,
 approveDocuments=true}={}){
 const docs={
  reference:{referenceOverrides:{}},
  quotes:{items:[]},
  growth:{items:[]},
  profile:{dueDate:'2027-01-08',birthDate:'',
   babyProfile:{name:'小宝',sex:'',birthTime:''}},
  settings:{currentSize:'NB',sizeMode:'manual',goalPrice:1.5,
   target:{NB:90,S:70,M:50,L:40,XL:30,XXL:20},
   daily:{NB:8,S:9,M:7,L:6,XL:5,XXL:4}}
 };
 const revisions=Object.fromEntries(Object.keys(docs).map(k=>[k,0]));
 const receipts=new Map(),rows=new Map(),primaryOps=[],uploads=[];
 let uuid=0,reads=0,primaryFlushes=0,docSends=0;
 const documentClient={
  async read({kind}){
   reads++;
   return {status:'PRIMARY_DOCUMENT_READ_VERIFIED',
    kind,familyId:F,actorUid:'A',childId:C,
    revision:revisions[kind],body:copy(docs[kind])};
  },
  async put({kind,expectedRevision,nextBody,requestId}){
   uploads.push({kind,requestId,expectedRevision});
   if(revisions[kind]!==expectedRevision)
    return {status:'PRIMARY_DOCUMENT_VERSION_CONFLICT'};
   docs[kind]=copy(nextBody);revisions[kind]++;
   receipts.set(requestId,{kind,revision:revisions[kind]});
   return {status:'PRIMARY_DOCUMENT_COMMITTED'};
  },
  async checkRequest({requestId}){
   const found=receipts.get(requestId);
   return found?{status:'REQUEST_COMMITTED_VERIFIED',
    kind:found.kind,revision:found.revision}:
    {status:'REQUEST_NOT_YET_RECEIPTED_SAME_ID_ONLY'};
  }
 };
 const outbox={
  async enqueue(op){rows.set(op.id,{...op,status:'pending'});return{duplicate:false};},
  async ready(){return [...rows.values()].filter(x=>x.status==='pending');},
  async stats(){return{outstanding:[...rows.values()].filter(
   x=>x.status!=='acked').length,total:rows.size,pending:0,acked:0};},
  async recordResult(_scope,id,result){
   rows.get(id).status=result.kind==='accepted'?'acked':'conflict';
  },
  async get(_scope,id){return rows.get(id)||null;}
 };
 const queue=Docs.create({
  controller:{verifiedContext:()=>({familyId:F,actorUid:'A'})},
  host:{indexedDB:{open(){}},navigator:{onLine:true}},
  documentsClient:documentClient,
  outboxFactory:{create:()=>outbox},
  contract:require('../sync/outbox-contract.js'),
  cloudWritesEnabled:documents,
  referenceAndQuotes:true,allowGrowth:true,allowProfile:true,allowSettings:true
 });
 const business=Business.create({
  client:documentClient,queue,uuid:()=>UUIDS[uuid++]
 });
 const inputs={
  saveEditedReference:{kind:'reference',action:'set',
   record:{key:'好奇|小森林|S',value:1.2}},
  saveQuote:{kind:'quotes',action:'add',
   record:{id:'q-1',size:'NB',price:120}},
  saveWeight:{kind:'growth',action:'add',
   record:{id:'w-1',date:'2026-11-14',time:'10:00',weight:3.2}},
  saveProfile:{kind:'profile',action:'patch',
   record:{dueDate:'2027-01-08',birthDate:'',
    babyProfile:{name:'新昵称'}}},
  savePlans:{kind:'settings',action:'patch',
   record:{goalPrice:1.3}}
 };
 const inventory={NB:100,S:140,M:50,L:0,XL:0,XXL:0};
 const rev={NB:1,S:1,M:1,L:1,XL:1,XXL:1};
 const primary={
  read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{...inventory},revisions:{...rev}}),
  flush:async()=>{primaryFlushes++;
   return{status:'PRIMARY_CLOUD_SYNCED_VERIFIED'};}
 };
 const stockDoc={getElementById(id){
  const sz=id.slice(4);
  return sizes.includes(sz)?{value:String(sz==='NB'?99:inventory[sz])}:null;
 }};
 const ui=Bridge.create({
  primary,commands:{submit:async(action,value,options)=>{
   primaryOps.push({action,value,options});
   return{status:'PRIMARY_OPERATION_DURABLY_QUEUED',
    operationId:'04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2'};
  }},
  readPurchase:()=>({size:'S',pieces:60,price:120}),
  readQuote:()=>({size:'S',pieces:20,price:50}),
  readTransaction:()=>({type:'buy',origin:'cloud_post_migration',
   operationId:'04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',size:'S',
   reversed:false}),
  notify:()=>{},formalModeSelected:()=>true,
  buildAllowsWrites:purchase,operatorApproved:()=>approvePurchase,
  buildAllowsDocumentWrites:documents,
  documentOperatorApproved:()=>approveDocuments,
  purchaseOnly:true,allowConsume:true,allowReverse:true,allowStocktake:true,
  allowReference:true,allowQuotes:true,allowGrowth:true,
  allowProfile:true,allowSettings:true,
  readDocumentInput:el=>inputs[el.id]||null,
  documentCommands:business,documentQueue:queue,
  readReferenceBaseline:()=>({...documentClientBase('reference'),body:docs.reference}),
  readQuotesBaseline:()=>({...documentClientBase('quotes'),body:docs.quotes}),
  readGrowthBaseline:()=>({...documentClientBase('growth'),body:docs.growth}),
  readProfileBaseline:()=>({...documentClientBase('profile'),body:docs.profile}),
  readSettingsBaseline:()=>({...documentClientBase('settings'),body:docs.settings}),
  onReferenceReadback:async()=> 'ready',
  onQuotesReadback:async()=> 'ready',
  onGrowthReadback:async()=> 'ready',
  onProfileReadback:async()=> 'ready',
  onSettingsReadback:async()=> 'ready',
  readStocktakeBaseline:()=>({inventory:{...inventory},revisions:{...rev}}),
  onPurchaseReadback:async()=> 'ready'
 });
 function documentClientBase(kind){return {
  familyId:F,actorUid:'A',childId:C,
  kind,revision:revisions[kind]
 };}
 const click=(id='',dataset={})=>ui.handle({id,dataset},stockDoc);
 return {ui,click,inputs,docs,queue,rows,receipts,
  get reads(){return reads;},get docSends(){return docSends;},
  get uploads(){return uploads;},get primaryOps(){return primaryOps;},
  get primaryFlushes(){return primaryFlushes;},get uuidCalls(){return uuid;}
 };
}
test('P4-01 both OFF: all five document writes and all inventory actions fail closed',async()=>{
 const f=fixture();
 for(const id of ['saveEditedReference','saveQuote','saveWeight',
  'saveProfile','savePlans','buyNow','saveStocks']){
  assert.equal((await f.click(id)).status,
   'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED',id);
 }
 for(const data of [{action:'consume',size:'S',count:'1'},
  {action:'deletetx',id:'cloud'},{action:'buyquote',id:'q'}]){
  assert.equal((await f.click('',data)).status,
   'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 }
 assert.equal(f.uploads.length,0);assert.equal(f.primaryOps.length,0);
 assert.equal(f.uuidCalls,0);
});
test('P4-01 only DOCUMENTS: five document types use original CAS queue and receipts',async()=>{
 const f=fixture({documents:true});
 for(const [id,kind] of [
  ['saveEditedReference','reference'],['saveQuote','quotes'],
  ['saveWeight','growth'],['saveProfile','profile'],
  ['savePlans','settings']
 ]){
  const result=await f.click(id);
  assert.equal(result.status,{
   reference:'REFERENCE_CLOUD_READBACK_VERIFIED',
   quotes:'QUOTES_CLOUD_READBACK_VERIFIED',
   growth:'GROWTH_CLOUD_READBACK_VERIFIED',
   profile:'PROFILE_CLOUD_READBACK_VERIFIED',
   settings:'SETTINGS_CLOUD_READBACK_VERIFIED'
  }[kind],kind);
 }
 assert.deepEqual(f.uploads.map(x=>x.kind),
  ['reference','quotes','growth','profile','settings']);
 assert.equal(f.rows.size,5);
 assert.ok([...f.rows.values()].every(x=>x.status==='acked'));
 assert.equal(f.uuidCalls,5);
 assert.equal(f.docs.profile.babyProfile.name,'新昵称');
 assert.equal(f.docs.settings.goalPrice,1.3);
 assert.equal(f.primaryOps.length,0);
 assert.equal(f.primaryFlushes,0);
 for(const [id,attrs] of [['buyNow',{}],['saveStocks',{}],
  ['',{action:'consume',size:'S',count:'1'}],
  ['',{action:'deletetx',id:'cloud'}],
  ['',{action:'buyquote',id:'q'}]]){
  assert.equal((await f.click(id,attrs)).status,
   'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 }
 assert.equal(f.primaryOps.length,0);
});
test('P4-01 only PURCHASE: buy, consume, reverse and stocktake stay available; document writes blocked',async()=>{
 const f=fixture({purchase:true});
 assert.equal((await f.click('buyNow')).status,
  'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED');
 assert.equal((await f.click('',{action:'consume',size:'S',count:'2'})).status,
  'PRIMARY_USE_CLOUD_READBACK_VERIFIED');
 assert.equal((await f.click('',{action:'deletetx',id:'cloud'})).status,
  'PRIMARY_REVERSE_CLOUD_READBACK_VERIFIED');
 assert.equal((await f.click('saveStocks')).status,
  'PRIMARY_STOCKTAKE_CLOUD_READBACK_VERIFIED');
 assert.deepEqual(f.primaryOps.map(x=>x.action),
  ['purchase','consume','reverse','stocktake']);
 for(const id of Object.keys(f.inputs)){
  assert.equal((await f.click(id)).status,
   'FORMAL_DOCUMENT_WRITES_NOT_AUTHORIZED');
 }
 assert.equal(f.uploads.length,0);assert.equal(f.uuidCalls,0);
});
test('P4-01 both ON: document and stock chains dispatch separately',async()=>{
 const f=fixture({purchase:true,documents:true});
 assert.equal((await f.click('savePlans')).status,
  'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.equal((await f.click('buyNow')).status,
  'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED');
 assert.deepEqual(f.uploads.map(x=>x.kind),['settings']);
 assert.deepEqual(f.primaryOps.map(x=>x.action),['purchase']);
});
test('P4-01 mismatched domain approval cannot grant the other category',async()=>{
 const docsDenied=fixture({purchase:true,documents:true,approveDocuments:false});
 assert.equal((await docsDenied.click('saveQuote')).status,
  'FORMAL_DOCUMENT_WRITES_NOT_AUTHORIZED');
 assert.equal((await docsDenied.click('buyNow')).status,
  'PRIMARY_PURCHASE_CLOUD_READBACK_VERIFIED');
 const primaryDenied=fixture({purchase:true,documents:true,approvePurchase:false});
 assert.equal((await primaryDenied.click('buyNow')).status,
  'FORMAL_CLOUD_WRITES_NOT_AUTHORIZED');
 assert.equal((await primaryDenied.click('saveWeight')).status,
  'GROWTH_CLOUD_READBACK_VERIFIED');
});
test('P4-01 formal capture blocks old localStorage handler without any grant',async()=>{
 const f=fixture(),events=new Map();
 const fakeDoc={
  addEventListener(name,fn,capture){assert.equal(capture,true);
   events.set(name,fn);},
  removeEventListener(){},getElementById(){return null}
 };
 const binding=f.ui.attach(fakeDoc);
 for(const id of ['saveProfile','savePlans','buyNow']){
  let prevented=false,stopped=false;
  const element={id,dataset:{},classList:{contains:()=>false},
   closest(){return this}};
  events.get('click')({
   target:element,preventDefault(){prevented=true},
   stopImmediatePropagation(){stopped=true}
  });
  assert.ok(prevented&&stopped,id);
 }
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.uploads.length,0);assert.equal(f.primaryOps.length,0);
 binding.detach();
});
function controllerFixture({purchase=false,documents=false,docOutstanding=0,
 batchOutstanding=0}={}){
 const events=new Map(),nodes=new Map(),trace=[];
 const el=id=>{
  if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:true,
   textContent:'',value:'',addEventListener(name,fn){
    events.set(id+':'+name,fn);
   }});
  return nodes.get(id);
 };
 const doc={body:{dataset:{}},getElementById:el,
  addEventListener(name,fn){events.set('doc:'+name,fn)}};
 const host={
  navigator:{onLine:true},
  crypto:{randomUUID:()=>UUIDS[0]},
  addEventListener(name,fn){events.set('host:'+name,fn)}
 };
 const ctx={app:{auth:{getSession:async()=>({data:{user:{id:'A'}}})}},
  familyId:F,actorUid:'A'};
 let pendingDocs=docOutstanding,pendingBatch=batchOutstanding;
 const docsModel=Object.fromEntries(['reference','quotes','growth','profile',
  'settings'].map(kind=>[kind,{childId:C,kind}]));
 const documentClient={
  readAll:async()=>({status:'PRIMARY_DOCUMENTS_FULLY_READ',
   documents:docsModel}),
  read:async({kind})=>({status:'PRIMARY_DOCUMENT_READ_VERIFIED',
   familyId:F,childId:C,kind,revision:1,
   body:kind==='reference'?{referenceOverrides:{}}:
    kind==='growth'||kind==='quotes'?{items:[]}:
     kind==='profile'?{babyProfile:{name:'宝宝'}}:
      {target:{NB:90},daily:{NB:8}}})
 };
 const docQueue={
  pending:async()=>{trace.push('doc.pending');return{
   status:'DOCUMENT_QUEUE_COUNTS_VERIFIED',outstanding:pendingDocs};},
  send:async({operatorApproved})=>{
   assert.equal(operatorApproved,true);trace.push('doc.send');pendingDocs=0;
   return{status:'DOCUMENT_SYNC_CONFIRMED'};},
  checkSavedRequest:async()=>({status:'REQUEST_ACK_RECOVERED'})
 };
 const primary={
  activate:async()=>({status:'PRIMARY_OUTBOX_READ_ONLY_READY'}),
  pending:async()=>({status:'PRIMARY_QUEUE_COUNTS_VERIFIED',outstanding:0}),
  flush:async({operatorApproved})=>{
   assert.equal(operatorApproved,true);trace.push('primary.flush');
   return{status:'PRIMARY_CLOUD_SYNCED_VERIFIED'};}
 };
 const batch={
  pending:async()=>{trace.push('batch.pending');return{
   status:'BATCH_QUEUE_VERIFIED',outstanding:pendingBatch};},
  send:async({operatorApproved})=>{
   assert.equal(operatorApproved,true);trace.push('batch.send');
   pendingBatch=0;return{status:'BATCH_ACK_RECOVERED',items:[]};}
 };
 let actionOptions=null;
 const app=Formal.create({
  host,doc,loginController:{create:()=>({
   connect:async()=> 'CLOUD_READ_ONLY_CONNECTED',
   verifiedContext:()=>ctx,
   signOut:async()=> 'LOGIN_REQUIRED'
  })},
  readModelFactory:()=>({read:async()=>({
   status:'PRIMARY_READ_ONLY_READY',canWrite:false,
   inventory:{NB:1,S:1,M:1,L:1,XL:1,XXL:1},
   revisions:{NB:0,S:0,M:0,L:0,XL:0,XXL:0},
   livePurchases:[],liveUses:[]
  })}),
  primaryFactory:()=>primary,
  commandsFactory:{create:()=>({submit:async()=>({status:'NO_WRITE'})})},
  documentsFactory:()=>documentClient,
  documentsOverlay:{apply:(data)=>({...data,canWrite:false,
   sharedBusinessDocumentsVerified:true})},
  documentOpsFactory:()=>docQueue,
  documentCommandsFactory:{create:()=>({submit:async()=>({status:'NO_WRITE'})})},
  batchStocktakeFactory:()=>batch,
  actionsFactory:{create:args=>{actionOptions=args;return{
   attach:()=>({detach(){}})
  };}},
  projection:{project:()=>({canWrite:false,state:{}})},
  ui:{defaults:()=>({}),show:()=>{},clear:()=>{}},
  scriptLoader:async()=>{},
  purchaseReleaseEnabled:purchase,
  purchaseOperatorApproved:()=>true,
  documentWritesEnabled:documents
 });
 const clickRetry=async()=>{
  events.get('formalSyncNow:click')();
  await new Promise(resolve=>setTimeout(resolve,15));
 };
 return {app,clickRetry,trace,el,docQueue,
  get actionOptions(){return actionOptions;}};
}
test('P4-01 controller only DOCUMENTS allows original document UUID retry but never primary flush',async()=>{
 const x=controllerFixture({documents:true,docOutstanding:1,
  batchOutstanding:1});
 await x.app.start();
 assert.equal(x.app.mode,'ready');
 assert.equal(x.el('formalSyncNow').disabled,false);
 assert.equal(x.actionOptions.buildAllowsWrites,false);
 assert.equal(x.actionOptions.buildAllowsDocumentWrites,true);
 await x.clickRetry();
 assert.equal(x.trace.filter(x=>x==='doc.send').length,1);
 assert.equal(x.trace.includes('primary.flush'),false);
 assert.equal(x.trace.includes('batch.pending'),false);
 await x.clickRetry();
 assert.equal(x.trace.includes('primary.flush'),false);
});
test('P4-01 controller only PURCHASE retries primary queue, not document queue',async()=>{
 const x=controllerFixture({purchase:true,docOutstanding:1});
 await x.app.start();
 assert.equal(x.el('formalSyncNow').disabled,false);
 assert.equal(x.actionOptions.buildAllowsDocumentWrites,false);
 await x.clickRetry();
 assert.ok(x.trace.includes('primary.flush'));
 assert.equal(x.trace.includes('doc.pending'),false);
 assert.equal(x.trace.includes('doc.send'),false);
});
test('P4-01 controller both OFF retry stays disabled and sends neither queue',async()=>{
 const x=controllerFixture({docOutstanding:1});
 await x.app.start();
 assert.equal(x.el('formalSyncNow').disabled,true);
 await x.clickRetry();
 assert.equal(x.trace.includes('doc.send'),false);
 assert.equal(x.trace.includes('primary.flush'),false);
});
test('P4-01 controller both ON preserves document-first retry then inventory retry',async()=>{
 const x=controllerFixture({purchase:true,documents:true,docOutstanding:1});
 await x.app.start();
 await x.clickRetry();
 assert.ok(x.trace.includes('doc.send'));
 assert.equal(x.trace.includes('primary.flush'),false);
 await x.clickRetry();
 assert.ok(x.trace.includes('primary.flush'));
});
test('P4-01 source keeps production gates OFF and CloudBase server+UUID boundaries intact',()=>{
 const controller=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 const bridge=fs.readFileSync(path.join(__dirname,
  '../sync/primary-formal-ui-actions.js'),'utf8');
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
 assert.match(controller,/documentWritesEnabled=FORMAL_WRITE_ENABLED/);
 assert.match(controller,/purchaseReleaseEnabled=FORMAL_PURCHASE_ENABLED/);
 assert.match(controller,/documentOperatorApproved:/);
 assert.match(controller,/if\(documentsApproved\(\)&&documentsGuard\)/);
 assert.match(controller,/if\(!purchasesApproved\(\)\)/);
 assert.match(bridge,/if\(documentEvent&&!documentsAuthorized\(\)\)/);
 assert.match(bridge,/if\(!documentEvent&&!purchaseAuthorized\(\)\)/);
 assert.ok(html.includes(bridge.trim()));
 for(const p of ['sync/primary-documents-operations.js',
  'sync/primary-documents-client.js',
  'sync/primary-documents-business-commands.js']){
  const source=fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  assert.match(source,/requestId/);
 }
});
