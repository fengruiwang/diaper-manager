const test=require('node:test'),assert=require('node:assert/strict');
const Bridge=require('../sync/primary-formal-ui-actions.js');
const Formal=require('../preview/v1.2.0/formal-controller.js');
const {setImmediate:setImm}=require('node:timers/promises');
const tick=()=>setImm();
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function fixture({submit=async()=>({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'original-uuid'}),
 send=async()=>({status:'DOCUMENT_SYNC_CONFIRMED'}),readback=async()=> 'ready',
 receipt=async()=>({status:'REQUEST_ACK_RECOVERED'}),docEnabled=true,
 allowProfile=true,allowSettings=true,allowGrowth=false}={}){
 const calls={submit:0,send:0,readback:0,receipt:0,stock:0};
 const statuses=[],notifications=[],handler={},stages=[],fields={name:'测试昵称',goal:'1.6'};
 function btn(id,label,dataset={}){
  return {id,dataset,textContent:label,disabled:false,
   classList:{contains:()=>false},closest(){return this}};
 }
 const buttons={
  saveProfile:btn('saveProfile','保存宝宝基本资料'),
  profileActionFeedback:{id:'profileActionFeedback',textContent:''},
  saveWeight:btn('saveWeight','保存体重记录'),
  cancelWeight:btn('cancelWeight','取消编辑'),
  growthActionFeedback:{id:'growthActionFeedback',textContent:''},
  saveSizePreferences:btn('saveSizePreferences','保存尺码与采购偏好'),
  savePlans:btn('savePlans','保存目标与日均用量'),
  cautious:btn('','保守备货',{preset:'cautious'}),
  relaxed:btn('','宽松备货',{preset:'relaxed'})
 };
 const presets=[buttons.cautious,buttons.relaxed];
 const doc={
  addEventListener(type,fn,capture){assert.equal(capture,true);handler[type]=fn;},
  removeEventListener(){},
  getElementById(id){return buttons[id]||null;},
  querySelectorAll(selector){
   return selector==='[data-preset]'?presets:[];
  }
 };
 const ui=Bridge.create({
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  commands:{submit:async()=>{calls.stock++;return{status:'NO_STOCK'};}},
  readPurchase:()=>({}),readQuote:()=>null,readTransaction:()=>null,
  notify:x=>notifications.push(x),
  formalModeSelected:()=>true,
  onDocumentProgress:(kind,phase,timing)=>stages.push({kind,phase,timing}),
  buildAllowsWrites:false,operatorApproved:()=>false,
  buildAllowsDocumentWrites:docEnabled,documentOperatorApproved:()=>docEnabled,
  allowProfile,allowSettings,allowReference:false,allowQuotes:false,allowGrowth,
  purchaseOnly:true,allowConsume:false,allowReverse:false,allowStocktake:false,
  documentCommands:{submit:async()=>{calls.submit++;return submit();}},
  documentQueue:{
   send:async()=>{calls.send++;return send();},
   checkSavedRequest:async id=>{calls.receipt++;assert.equal(id,'original-uuid');return receipt();},
   pending:async()=>({status:'DOCUMENT_QUEUE_COUNTS_VERIFIED',outstanding:0})
  },
  readDocumentInput:el=>el.id==='saveProfile'
   ?{kind:'profile',action:'patch',record:{babyProfile:{name:fields.name}}}
   :el.id==='saveWeight'
    ?{kind:'growth',action:'add',record:{id:'weight-1',
      date:'2026-11-17',time:'09:30',weight:3.2}}
    :{kind:'settings',action:'patch',record:{goalPrice:Number(fields.goal)}},
  readProfileBaseline:()=>({familyId:'f',actorUid:'A',revision:0,
   body:{babyProfile:{name:'原昵称'}}}),
  readSettingsBaseline:()=>({familyId:'f',actorUid:'A',revision:0,
   body:{target:{NB:80},daily:{NB:8}}}),
  onProfileReadback:async()=>{calls.readback++;return readback();},
  onProfileAck:async()=> 'ready',
  readGrowthBaseline:()=>({familyId:'f',actorUid:'A',revision:0,
   body:{items:[]}}),
  onGrowthReadback:async()=>{calls.readback++;return readback();},
  onGrowthAck:async()=> 'ready',
  onSettingsReadback:async()=>{calls.readback++;return readback();}
 });
 const binding=ui.attach(doc);
 function click(id='saveProfile'){
  const el=buttons[id]||btn(id,id);
  const event={target:el,prevented:false,stopped:false,
   preventDefault(){this.prevented=true;},
   stopImmediatePropagation(){this.stopped=true;}};
  handler.click(event);return event;
 }
 function preset(which='cautious'){
  const event={target:buttons[which],prevented:false,stopped:false,
   preventDefault(){this.prevented=true;},
   stopImmediatePropagation(){this.stopped=true;}};
  handler.click(event);return event;
 }
 return {ui,binding,calls,stages,notifications,buttons,fields,click,preset};
}
test('P4-03E profile click shows immediate feedback and disables before first await',async()=>{
 const d=deferred(),f=fixture({submit:()=>d.promise});
 const e=f.click('saveProfile');
 assert.equal(e.prevented,true);
 assert.equal(f.buttons.saveProfile.disabled,true);
 assert.match(f.buttons.saveProfile.textContent,/正在保存/);
 assert.equal(f.buttons.profileActionFeedback.textContent,'正在保存宝宝资料…');
 assert.deepEqual(f.stages.map(x=>x.phase),['checking']);
 assert.equal(f.fields.name,'测试昵称');
 d.resolve({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'original-uuid'});
 await tick();await tick();
 assert.equal(f.notifications.at(-1).status,'PROFILE_CLOUD_READBACK_VERIFIED');
 assert.equal(f.buttons.saveProfile.disabled,false);
 assert.equal(f.buttons.saveProfile.textContent,'保存宝宝基本资料');
});
test('B2-03 growth click shows immediate feedback and disables its controls before first await',async()=>{
 const d=deferred(),f=fixture({submit:()=>d.promise,allowGrowth:true,
  send:async()=>({status:'DOCUMENT_GROWTH_ACK_CONFIRMED'})});
 f.click('saveWeight');
 assert.equal(f.buttons.saveWeight.disabled,true);
 assert.equal(f.buttons.growthActionFeedback.textContent,'正在保存体重记录…');
 d.resolve({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'original-uuid'});
 await tick();await tick();await tick();
 assert.equal(f.notifications.at(-1).status,'GROWTH_CLOUD_ACK_APPLIED');
 assert.equal(f.buttons.growthActionFeedback.textContent,'体重记录已保存');
 assert.equal(f.buttons.saveWeight.disabled,false);
});
test('B2-03 profile fast ACK updates the page without a readback round trip',async()=>{
 const f=fixture({send:async()=>({status:'DOCUMENT_PROFILE_ACK_CONFIRMED'})});
 f.click('saveProfile');await tick();await tick();
 assert.equal(f.calls.readback,0);
 assert.equal(f.notifications.at(-1).status,'PROFILE_CLOUD_ACK_APPLIED');
 assert.equal(f.buttons.profileActionFeedback.textContent,'宝宝资料已保存');
});
test('P4-03E settings save disables BOTH settings buttons and presets, blocks duplicate UUIDs',async()=>{
 const d=deferred(),f=fixture({submit:()=>d.promise});
 f.click('saveSizePreferences');
 assert.ok([f.buttons.saveSizePreferences,f.buttons.savePlans,
  f.buttons.cautious,f.buttons.relaxed].every(x=>x.disabled));
 assert.match(f.buttons.saveSizePreferences.textContent,/正在检查/);
 f.click('savePlans');f.preset('relaxed');f.click('saveSizePreferences');
 assert.equal(f.calls.submit,1);
 assert.equal(f.calls.send,0);
 d.resolve({status:'DOCUMENT_OPERATION_DURABLY_QUEUED',requestId:'original-uuid'});
 await tick();await tick();
 assert.equal(f.calls.send,1);
 assert.equal(f.notifications.at(-1).status,'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.ok([f.buttons.saveSizePreferences,f.buttons.savePlans,
  f.buttons.cautious,f.buttons.relaxed].every(x=>!x.disabled));
 assert.equal(f.fields.goal,'1.6');
});
test('P4-03E prenatal preset uses same settings feedback and original logic',async()=>{
 const d=deferred(),f=fixture({send:()=>d.promise});
 assert.equal(f.preset('cautious').prevented,true);
 await tick();
 assert.deepEqual(f.stages.map(x=>x.phase),['checking','queued','submitting']);
 assert.equal(f.buttons.cautious.disabled,true);
 assert.match(f.buttons.cautious.textContent,/提交云端/);
 d.resolve({status:'DOCUMENT_SYNC_CONFIRMED'});
 await tick();await tick();
 assert.equal(f.notifications.at(-1).status,'SETTINGS_CLOUD_READBACK_VERIFIED');
 assert.equal(f.buttons.cautious.disabled,false);
 assert.equal(f.buttons.cautious.textContent,'保守备货');
});
test('P4-03E neither profile nor settings claims success before cloud readback',async()=>{
 for(const kind of ['profile','settings']){
  const d=deferred(),f=fixture({readback:()=>d.promise});
  f.click(kind==='profile'?'saveProfile':'savePlans');
  await tick();await tick();
  assert.equal(f.stages.at(-1).phase,'readback');
  assert.equal(f.notifications.length,0);
  d.resolve('ready');
  await tick();await tick();
  assert.equal(f.notifications.at(-1).status,kind==='profile'
   ?'PROFILE_CLOUD_READBACK_VERIFIED':'SETTINGS_CLOUD_READBACK_VERIFIED');
  const times=f.notifications.at(-1).timings;
  for(const key of ['checkAndQueueMs','receiptAndCommitMs','readbackMs'])
   assert.ok(Number.isSafeInteger(times[key])&&times[key]>=0,key);
 }
});
test('P4-03E ambiguous ACK keeps original UUID and prevents another command',async()=>{
 for(const kind of ['profile','settings']){
  const f=fixture({send:async()=>({status:'DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID'})});
  f.click(kind==='profile'?'saveProfile':'saveSizePreferences');
  await tick();await tick();
  assert.equal(f.notifications.at(-1).status,'DOCUMENT_ACK_UNKNOWN_PRESERVE_ORIGINAL_ID');
  assert.equal(f.stages.at(-1).phase,'pending');
  f.click(kind==='profile'?'saveProfile':'savePlans');
  await tick();
  assert.equal(f.calls.submit,1);
  assert.equal(f.calls.send,1);
  const target=kind==='profile'?f.buttons.saveProfile:f.buttons.saveSizePreferences;
  assert.equal(target.disabled,true);
 }
});
test('P4-03E pending button recovers ONLY after original receipt AND verified refresh',async()=>{
 const f=fixture({readback:async()=> 'pending'});
 f.click('savePlans');
 await tick();await tick();
 assert.equal(f.notifications.at(-1).status,'SETTINGS_COMMITTED_READBACK_REQUIRED');
 assert.equal(f.binding.hasPendingDocumentReview(),true);
 assert.equal(await f.binding.recoverDocumentButtons({verified:false}),false);
 assert.equal(f.buttons.savePlans.disabled,true);
 assert.equal(await f.binding.recoverDocumentButtons({verified:true}),true);
 assert.equal(f.calls.receipt,1);
 assert.equal(f.binding.hasPendingDocumentReview(),false);
 assert.equal(f.buttons.savePlans.disabled,false);
 f.click('saveSizePreferences');await tick();await tick();
 assert.equal(f.calls.submit,2);
});
test('P4-03E missing receipt cannot unlock pending settings or profile',async()=>{
 const f=fixture({readback:async()=> 'pending',
  receipt:async()=>({status:'REQUEST_RECEIPT_NOT_VERIFIED'})});
 f.click('saveProfile');await tick();await tick();
 assert.equal(await f.binding.recoverDocumentButtons({verified:true}),false);
 assert.equal(f.buttons.saveProfile.disabled,true);
 f.click('saveProfile');await tick();
 assert.equal(f.calls.submit,1);
});
test('P4-03E revision conflict or input error restores controls and preserves user input',async()=>{
 for(const kind of ['profile','settings']){
  for(const status of ['DOCUMENT_REVISION_CHANGED_REVIEW_REQUIRED',
   kind==='profile'?'PROFILE_FORM_INVALID':'SETTINGS_FORM_INVALID']){
   const f=fixture({submit:async()=>({status})});
   f.click(kind==='profile'?'saveProfile':'savePlans');
   await tick();await tick();
   assert.equal(f.notifications.at(-1).status,status);
   assert.equal(f.buttons.saveProfile.disabled,false);
   assert.equal(f.buttons.savePlans.disabled,false);
   assert.equal(f.fields.name,'测试昵称');
   assert.equal(f.fields.goal,'1.6');
   assert.equal(f.calls.send,0);
  }
 }
});
test('P4-03E leaves reference P4-03D and purchase/inventory authorizations unchanged',async()=>{
 const f=fixture();
 for(const id of ['saveQuote','saveWeight','buyNow','saveStocks']){
  const event=f.click(id);
  assert.equal(event.prevented,true);
 }
 await tick();await tick();
 assert.equal(f.calls.submit,0);
 assert.equal(f.calls.stock,0);
 assert.equal(Formal.FORMAL_WRITE_ENABLED,false);
 assert.equal(Formal.FORMAL_DOCUMENT_WRITE_ENABLED,true);
 assert.equal(Formal.FORMAL_PURCHASE_ENABLED,false);
});
