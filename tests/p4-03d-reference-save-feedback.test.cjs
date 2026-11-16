const test=require('node:test'),assert=require('node:assert/strict');
const Bridge=require('../sync/primary-formal-ui-actions.js');
const {setImmediate:setImm}=require('node:timers/promises');
const tick=()=>setImm();
function deferred(){
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b;});
 return {promise,resolve,reject};
}
function fixture({submit=async()=>({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'original-uuid'}),
 send=async()=>({status:'DOCUMENT_SYNC_CONFIRMED'}),
 readback=async()=> 'ready',docEnabled=true}={}){
 const events={},stages=[],notifications=[],calls={commands:0,sends:0,readback:0,stock:0};
 const button={id:'saveEditedReference',dataset:{},disabled:false,
  textContent:'保存新价格',closest(){return this}};
 const field={value:'1.21'};
 const nodes={'saveEditedReference':button,'editedReferencePrice':field};
 const dom={
  addEventListener(type,fn,capture){assert.equal(capture,true);events[type]=fn;},
  removeEventListener(){},
  getElementById:id=>nodes[id]||null
 };
 const ui=Bridge.create({
  commands:{submit:async()=>{calls.stock++;return {status:'UNKNOWN'};}},
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  readPurchase:()=>({}),readQuote:()=>null,readTransaction:()=>null,
  notify:x=>notifications.push(x),formalModeSelected:()=>true,
  onReferenceProgress:(phase,timing)=>stages.push({phase,timing}),
  buildAllowsWrites:false,operatorApproved:()=>false,
  buildAllowsDocumentWrites:docEnabled,documentOperatorApproved:()=>docEnabled,
  allowReference:true,allowQuotes:false,allowGrowth:false,allowProfile:false,
  allowSettings:false,purchaseOnly:true,allowConsume:false,allowReverse:false,
  allowStocktake:false,
  documentCommands:{submit:async()=>{calls.commands++;return submit();}},
  documentQueue:{send:async()=>{calls.sends++;return send();}},
  readDocumentInput:()=>({kind:'reference',action:'set',
   record:{key:'好奇|小森林|NB',value:1.21}}),
  readReferenceBaseline:()=>({familyId:'family',actorUid:'actor',
   revision:0,body:{referenceOverrides:{}}}),
  onReferenceReadback:async()=>{calls.readback++;return readback();}
 });
 const binding=ui.attach(dom);
 function click(id='saveEditedReference',dataset={}){
  const node=id==='saveEditedReference'?button:{id,dataset,closest(){return this}};
  const event={target:node,cancelled:false,
   preventDefault(){this.cancelled=true;},
   stopImmediatePropagation(){this.stopped=true;}};
  events.click(event);return event;
 }
 function formSubmit(){
  const event={target:{id:'priceEditForm'},cancelled:false,
   preventDefault(){this.cancelled=true;},
   stopImmediatePropagation(){this.stopped=true;}};
  events.submit(event);return event;
 }
 return {button,field,calls,stages,notifications,click,formSubmit,binding};
}
test('P4-03D save click gives immediate feedback and disables button before async',async()=>{
 const submit=deferred(),f=fixture({submit:()=>submit.promise});
 const event=f.click();
 assert.equal(event.cancelled,true);
 assert.equal(f.button.disabled,true);
 assert.match(f.button.textContent,/正在检查/);
 assert.deepEqual(f.stages.map(x=>x.phase),['checking']);
 assert.equal(f.field.value,'1.21');
 submit.resolve({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'original-uuid'});
 await tick();
 await tick();
 assert.equal(f.notifications.at(-1).status,'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.button.disabled,false);
 assert.equal(f.button.textContent,'保存新价格');
});
test('P4-03D button click + form submit + repeated click allocate only one command',async()=>{
 const pending=deferred(),f=fixture({submit:()=>pending.promise});
 f.click();
 f.formSubmit();f.click();
 assert.equal(f.calls.commands,1);
 assert.equal(f.button.disabled,true);
 pending.resolve({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'original-uuid'});
 await tick();await tick();
 assert.equal(f.calls.commands,1);
 assert.equal(f.calls.sends,1);
});
test('P4-03D stages reflect durable queue, receipt+commit and actual readback',async()=>{
 const sending=deferred(),read=deferred(),f=fixture({
  send:()=>sending.promise,readback:()=>read.promise
 });
 f.click();
 await tick();
 assert.deepEqual(f.stages.map(x=>x.phase),['checking','queued','submitting']);
 assert.equal(f.button.disabled,true);
 sending.resolve({status:'DOCUMENT_SYNC_CONFIRMED'});
 await tick();
 assert.equal(f.stages.at(-1).phase,'readback');
 assert.equal(f.button.disabled,true);
 assert.equal(f.notifications.length,0,'no success until cloud readback returns');
 read.resolve('ready');
 await tick();await tick();
 assert.equal(f.notifications.at(-1).status,'REFERENCE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.stages.at(-1).phase,'success');
 const times=f.notifications.at(-1).timings;
 for(const k of ['checkAndQueueMs','receiptAndCommitMs','readbackMs'])
  assert.ok(Number.isFinite(times[k])&&times[k]>=0,k);
});
test('P4-03D ambiguous ACK never shows success and locks repeated saves',async()=>{
 const f=fixture({send:async()=>({status:'DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID'})});
 f.click();
 await tick();await tick();
 assert.equal(f.notifications.at(-1).status,'DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID');
 assert.equal(f.stages.at(-1).phase,'pending');
 assert.equal(f.button.disabled,true);
 assert.match(f.button.textContent,/待确认/);
 assert.equal(f.field.value,'1.21');
 f.click();f.formSubmit();
 await tick();
 assert.equal(f.calls.commands,1,'no second UUID can be allocated while pending');
 assert.equal(f.calls.sends,1);
 assert.notEqual(f.notifications.at(-1).status,'REFERENCE_CLOUD_READBACK_VERIFIED');
});
test('P4-03D commit ACK without verified UI readback remains pending',async()=>{
 const f=fixture({readback:async()=> 'pending'});
 f.click();await tick();await tick();
 assert.equal(f.notifications.at(-1).status,'REFERENCE_COMMITTED_READBACK_REQUIRED');
 assert.equal(f.button.disabled,true);
 assert.equal(f.field.value,'1.21');
 f.click();await tick();
 assert.equal(f.calls.commands,1);
});
test('P4-03D revision conflict and invalid input restore button, retain entered value',async()=>{
 for(const status of ['DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED','REFERENCE_FORM_INVALID']){
  const f=fixture({submit:async()=>({status})});
  f.click();await tick();await tick();
  assert.equal(f.notifications.at(-1).status,status);
  assert.equal(f.button.disabled,false);
  assert.equal(f.button.textContent,'保存新价格');
  assert.equal(f.field.value,'1.21');
  assert.equal(f.calls.sends,0);
 }
});
test('P4-03D Enter submit works once, with no native local storage fallthrough',async()=>{
 const pending=deferred(),f=fixture({submit:()=>pending.promise});
 const e=f.formSubmit();
 assert.equal(e.cancelled,true);
 assert.equal(e.stopped,true);
 assert.equal(f.calls.commands,1);
 pending.resolve({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'original-uuid'});
 await tick();await tick();
 assert.equal(f.calls.commands,1);
 assert.equal(f.notifications.at(-1).status,'REFERENCE_CLOUD_READBACK_VERIFIED');
});
test('P4-03D purchase, stocktake and other document writes remain blocked in ref-only scope',async()=>{
 const f=fixture();
 for(const [id,dataset] of [
  ['buyNow',{}],['saveStocks',{}],
  ['saveQuote',{}],['saveWeight',{}],['saveProfile',{}],['savePlans',{}],
  ['',{action:'consume',size:'S',count:'1'}],
  ['',{action:'deletetx',id:'cloud'}]
 ]){
  const e=f.click(id,dataset);
  assert.equal(e.cancelled,true);
 }
 await tick();await tick();
 assert.equal(f.calls.commands,0);
 assert.equal(f.calls.sends,0);
 assert.equal(f.calls.stock,0);
 assert.ok(f.notifications.every(x=>x.status==='FORMAL_CLOUD_WRITES_NOT_AUTHORIZED'
  ||x.status==='FORMAL_PURCHASE_ONLY'));
});
