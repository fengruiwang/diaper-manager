const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Client=require('../sync/primary-documents-client.js');
const Operations=require('../sync/primary-documents-operations.js');
const Commands=require('../sync/primary-documents-business-commands.js');
const Actions=require('../sync/primary-formal-ui-actions.js');
const Overlay=require('../sync/primary-documents-overlay.js');
const Growth=require('../growth.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const ID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const SIZES=['NB','S','M','L','XL','XXL'];
const clone=x=>JSON.parse(JSON.stringify(x));
const wait=()=>new Promise(resolve=>setImmediate(resolve));
const original={
 currentSize:'M',sizeMode:'manual',autoSize:'XXL',goalPrice:1.6,
 target:{NB:90,S:70,M:130,L:140,XL:60,XXL:20,legacyExtra:444},
 daily:{NB:8,S:9,M:7,L:6,XL:5,XXL:4,legacyDaily:7},
 replenishPolicy:{mode:'custom',days:7,legacyPolicy:'keep'},
 preset:'balanced',plannedBudget:260,futureSetting:{nested:true}
};
const html=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal/index.html'),'utf8');
const start=html.indexOf('function formalDocumentAction(el){');
const end=html.indexOf('\nwindow.XBFormalUIData=',start);
assert.ok(start>0&&end>start);
const realForm=html.slice(start,end);
const controllerSource=fs.readFileSync(path.join(__dirname,
 '../preview/v1.2.0/formal-controller.js'),'utf8');
function realAck(context){
 const p=controllerSource.indexOf('function settingsChangeVisible(');
 const q=controllerSource.indexOf('function create(',p);
 assert.ok(p>=0&&q>p);
 vm.runInNewContext(controllerSource.slice(p,q),context);
 const x=controllerSource.indexOf('onSettingsAck:async(ack)=>{');
 const y=controllerSource.indexOf('onSettingsReadback:async(expected)=>{',x);
 assert.ok(x>=0&&y>x,'settings ACK handler present');
 return vm.runInNewContext('('+controllerSource.slice(
  x+'onSettingsAck:'.length,y).trim().replace(/,\s*$/,'')+')',context);
}
function form(el,{fields={},born=false}={}){
 const values={
  sizeMode:'manual',currentSize:'S',goalPrice:'1.3',
  replenishMode:'custom',replenishDays:'5',
  ...Object.fromEntries(SIZES.flatMap((size,i)=>[
   ['target_'+size,String([120,100,80,60,40,20][i])],
   ['daily_'+size,String([10,9,8,7,6,5][i])]])),
  ...fields
 };
 const state={...clone(original),birthDate:born?'2026-01-08':''};
 const result=vm.runInNewContext(realForm+'\nformalDocumentAction(el)',{
  el,$:id=>({value:values[id]??''}),XBGrowth:Growth,
  state,SIZES,localDate:()=> '2026-11-14'
 });
 return result===null?null:clone(result);
}
function fixture({fields={},born=false,ackLost=false,conflict=false}={}){
 let body=clone(original),revision=3,readbacks=0;
 const trace=[],outbox=new Map(),rendered=[],notifications=[];
 const base={status:'PRIMARY_READ_ONLY_READY',
  source:'cloudbase-primary-receipt-verified',canWrite:false,
  familyId:F,actorUid:'A',childId:C,
  state:{inventory:{NB:120,S:80,M:12,L:0,XL:0,XXL:0},
   transactions:[{id:'legacy-purchase',size:'NB',count:60}],
   goalPrice:1.6,currentSize:'M',sizeMode:'manual'},
  revisions:{NB:2,S:1,M:0,L:0,XL:0,XXL:0}};
 const doc=(kind,body,revision=0)=>({
  status:'PRIMARY_DOCUMENT_READ_VERIFIED',kind,familyId:F,
  actorUid:'A',childId:C,revision,body:clone(body)
 });
 const other={
  reference:doc('reference',{referenceOverrides:{'好奇|系列|S':1.125}},2),
  quotes:doc('quotes',{items:[{id:'quote-one',price:1.2}]},1),
  growth:doc('growth',{items:[{id:'growth-one',weight:3.5}]},1),
  profile:doc('profile',{dueDate:'2027-01-08',
   babyProfile:{name:'小宝'}},3)
 };
 const env={
  ctx:{actorUid:'A',familyId:F},
  controller:{verifiedContext:()=>({actorUid:'A',familyId:F})},
  actor:'A',family:F,mode:'ready',
  identityEpoch:1,documentEpoch:1,
  documentScope:'A\x00'+F,primaryViewBase:base,
  documentSnapshot:{status:'PRIMARY_DOCUMENTS_FULLY_READ',
   documents:{...other,settings:doc('settings',body,revision)}},
  documentsOverlay:Overlay,
  showCloudView(view,ctx){
   trace.push('ui.render');
   assert.equal(ctx.actorUid,'A');
   rendered.push(view);
  }
 };
 const actualAck=realAck(env);
 const app={auth:{getSession:async()=>({})},
  rdb:()=>({rpc:async(name,args)=>{
   trace.push('rpc.'+name);
   if(name==='xb_put_primary_document_draft'){
    assert.equal(args.p_kind,'settings');
    assert.equal(args.p_family_id,F);
    assert.equal(args.p_child_id,C);
    if(conflict)return {error:{code:'40001'}};
    body=clone(args.p_next_body);revision++;
    if(ackLost)throw Error('ACK disappeared after commit');
    return {data:{saved:true,kind:'settings',family_id:F,
     child_id:C,request_id:args.p_request_id,revision,duplicate:false}};
   }
   if(name==='xb_check_primary_document_request_draft')
    return {data:{status:'NO_RECEIPT',family_id:F,child_id:C,
     request_id:args.p_request_id}};
   if(name==='xb_read_primary_document_draft')
    return {data:{complete:true,kind:'settings',family_id:F,
     child_id:C,revision,body:clone(body),can_upload:false}};
   throw Error('unexpected rpc '+name);
  }})};
 const client=Client.create({app,cloudWritesEnabled:true,
  accessPreflight:{create:()=>({verifyAccess:async()=>{
   throw Error('extra permission query');
  }})},
  childReader:{create:()=>({inspectLegacyTarget:async()=>{
   throw Error('extra child discovery');
  }})},scopeGuard:{requireLegacyMigrationTarget(){}}
 });
 client.acceptVerifiedPrimary(base);
 const store={
  async get(_scope,id){trace.push('idb.get');return outbox.get(id)||null;},
  async enqueue(op){trace.push('idb.enqueue');
   outbox.set(op.id,{...clone(op),status:'pending'});return{duplicate:false};},
  async ready(){return [...outbox.values()].filter(o=>o.status==='pending');},
  async stats(){return{outstanding:[...outbox.values()]
   .filter(x=>x.status!=='acked').length};},
  async recordResult(_scope,id,result){trace.push('idb.result');
   outbox.get(id).status=result.kind==='accepted'?'acked':'conflict';}
 };
 const queue=Operations.create({
  controller:env.controller,host:{indexedDB:{open(){}},
   navigator:{onLine:true}},documentsClient:client,
  outboxFactory:{create:()=>store},
  contract:{createOperation:clone},cloudWritesEnabled:true,
  referenceAndQuotes:true,allowGrowth:true,allowProfile:true,
  allowSettings:true,fastSettingsEnabled:true
 });
 const cmds=Commands.create({client,queue,uuid:()=>ID});
 let submitted=null,ackRecord=null;
 const actions=Actions.create({
  primary:{read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED'})},
  commands:{submit:async()=>{throw Error('purchase must remain off');}},
  notify:ans=>notifications.push(ans),
  formalModeSelected:()=>true,buildAllowsWrites:false,
  operatorApproved:()=>false,buildAllowsDocumentWrites:true,
  documentOperatorApproved:()=>true,purchaseOnly:true,
  allowReference:false,allowQuotes:false,allowGrowth:false,
  allowProfile:false,allowSettings:true,
  readPurchase:()=>null,readQuote:()=>null,readTransaction:()=>null,
  documentCommands:{submit:async request=>{
   submitted=clone(request.record);return cmds.submit(request);
  }},
  documentQueue:queue,
  readSettingsBaseline:()=>({...env.documentSnapshot.documents.settings,
   actorUid:'A'}),
  readDocumentInput:el=>form(el,{fields,born}),
  onSettingsAck:async ack=>{
   ackRecord=clone(ack.record);
   const applied=await actualAck(ack);
   trace.push('ui.ack:'+applied);
   if(applied!=='ready'){
    const previous=env.documentSnapshot.documents.settings;
    const revised={...previous,revision:ack.revision,body:ack.nextBody};
    trace.push('ui.scope:'+JSON.stringify({
     actor:env.actor,family:env.family,documentScope:env.documentScope,
     previousRevision:previous.revision,identityEpoch:env.identityEpoch,
     documentEpoch:env.documentEpoch,
     ack:{familyId:ack.familyId,actorUid:ack.actorUid,childId:ack.childId,
      kind:ack.kind,revision:ack.revision,expectedRevision:ack.expectedRevision}
    }));
    try{trace.push('ui.visible:'+env.settingsChangeVisible(revised,
     {record:ack.record,expectedRevision:ack.expectedRevision}));}
    catch(error){trace.push('ui.visible.error:'+error.message);}
    try{Overlay.apply(base,{...env.documentSnapshot,
     documents:{...env.documentSnapshot.documents,settings:revised}});
     trace.push('ui.overlay.check:ok');}
    catch(error){trace.push('ui.overlay.check:'+error.message);}
   }
   return applied;
  },
  onSettingsReadback:async()=>{readbacks++;return 'pending';}
 });
 return {actions,trace,outbox,env,rendered,notifications,
  click:(id,ds={})=>actions.handle({id,dataset:ds},
   {getElementById:()=>null}),
  get body(){return body;},get revision(){return revision;},
  get submitted(){return submitted;},get ackRecord(){return ackRecord;},
  get readbacks(){return readbacks;}};
}
function fastResult(f,status='SETTINGS_CLOUD_ACK_APPLIED'){
 assert.equal(status,'SETTINGS_CLOUD_ACK_APPLIED');
 assert.equal(f.revision,4);
 assert.deepEqual(f.submitted,f.ackRecord);
 assert.equal(f.trace.filter(x=>
  x==='rpc.xb_put_primary_document_draft').length,1);
 assert.equal(f.trace.filter(x=>
  x==='rpc.xb_read_primary_document_draft').length,0);
 assert.equal(f.trace.filter(x=>
  x==='rpc.xb_check_primary_document_request_draft').length,0);
 assert.equal(f.trace.filter(x=>x==='ui.render').length,1);
 assert.equal(f.readbacks,0);
 assert.equal(f.env.documentSnapshot.documents.settings.revision,4);
 assert.equal(f.outbox.get(ID).status,'acked');
 assert.ok(f.trace.indexOf('idb.enqueue')<
  f.trace.indexOf('rpc.xb_put_primary_document_draft'));
 const view=f.rendered[0];
 assert.equal(view.sharedBusinessDocumentsVerified,true);
 assert.deepEqual(view.state.inventory,
  {NB:120,S:80,M:12,L:0,XL:0,XXL:0});
 assert.deepEqual(view.state.transactions,
  [{id:'legacy-purchase',size:'NB',count:60}]);
 assert.equal(view.documentRevisions.reference,2);
 assert.equal(view.documentRevisions.quotes,1);
 assert.equal(view.documentRevisions.growth,1);
 assert.equal(view.documentRevisions.profile,3);
}
test('B2-04 manual size and personal price: exact patch, one 026, five-document overlay',async()=>{
 const f=fixture();
 const a=await f.click('saveSizePreferences');
 assert.equal(a.status,'SETTINGS_CLOUD_ACK_APPLIED',f.trace.join(' | '));
 fastResult(f,a.status);
 assert.deepEqual(f.submitted,{currentSize:'S',goalPrice:1.3});
 assert.equal(f.rendered[0].state.currentSize,'S');
 assert.equal(f.rendered[0].state.goalPrice,1.3);
 assert.equal(f.body.sizeMode,'manual');
 assert.equal(f.body.autoSize,'XXL');
 assert.deepEqual(f.body.futureSetting,{nested:true});
});
test('B2-04 automatic size: never commit pinned manual currentSize',async()=>{
 const f=fixture({fields:{sizeMode:'auto',currentSize:'NB',goalPrice:'1.6'}});
 const a=await f.click('saveSizePreferences');
 assert.equal(a.status,'SETTINGS_CLOUD_ACK_APPLIED');
 fastResult(f,a.status);
 assert.deepEqual(f.submitted,{sizeMode:'auto'});
 assert.equal(f.body.currentSize,'M');
 assert.equal(f.rendered[0].state.sizeMode,'auto');
});
test('B2-04 pre-birth plan: all six sizes, daily rates and unknown fields preserved',async()=>{
 const f=fixture();
 const a=await f.click('savePlans');
 assert.equal(a.status,'SETTINGS_CLOUD_ACK_APPLIED');
 fastResult(f,a.status);
 assert.equal(f.submitted.preset,'custom');
 assert.equal(Object.keys(f.submitted.target).length,6);
 assert.equal(Object.keys(f.submitted.daily).length,6);
 assert.equal(f.body.target.NB,120);
 assert.equal(f.body.daily.XXL,5);
 assert.equal(f.body.target.legacyExtra,444);
 assert.equal(f.body.daily.legacyDaily,7);
 assert.deepEqual(f.body.replenishPolicy,
  {mode:'custom',days:7,legacyPolicy:'keep'});
 assert.deepEqual(f.body.futureSetting,{nested:true});
});
test('B2-04 post-birth days replenishment leaves original manual targets unchanged',async()=>{
 const f=fixture({born:true,fields:{
  replenishMode:'days',replenishDays:'10'
 }});
 const a=await f.click('savePlans');
 assert.equal(a.status,'SETTINGS_CLOUD_ACK_APPLIED');
 fastResult(f,a.status);
 assert.equal(f.submitted.target,undefined);
 assert.equal(f.submitted.replenishPolicy.mode,'days');
 assert.equal(f.submitted.replenishPolicy.days,10);
 assert.equal(f.body.target.M,130);
 assert.equal(f.body.target.NB,90);
 assert.equal(f.body.replenishPolicy.legacyPolicy,'keep');
});
test('B2-04 post-birth custom mode writes targets but preserves unrelated fields',async()=>{
 const f=fixture({born:true,fields:{replenishMode:'custom',replenishDays:'7'}});
 const a=await f.click('savePlans');
 assert.equal(a.status,'SETTINGS_CLOUD_ACK_APPLIED');
 fastResult(f,a.status);
 assert.ok(f.submitted.target);
 assert.equal(f.body.target.M,80);
 assert.equal(f.body.target.legacyExtra,444);
 assert.equal(f.body.daily.legacyDaily,7);
});
test('B2-04 three prenatal presets use one identical settings queue and change NB/S only',async()=>{
 for(const [preset,nb,s] of [
  ['cautious',80,60],['balanced',100,60],['relaxed',120,80]
 ]){
  const f=fixture();
  const a=await f.click('',{preset});
  assert.equal(a.status,'SETTINGS_CLOUD_ACK_APPLIED',preset);
  fastResult(f,a.status);
  assert.deepEqual(f.submitted,{preset,target:{NB:nb,S:s}});
  assert.equal(f.body.target.NB,nb);
  assert.equal(f.body.target.S,s);
  assert.equal(f.body.target.M,130);
  assert.equal(f.body.target.XXL,20);
  assert.equal(f.body.target.legacyExtra,444);
 }
});
test('B2-04 no-op and post-birth presets allocate no UUID and make no 026 request',async()=>{
 const same=fixture({fields:{sizeMode:'manual',currentSize:'M',goalPrice:'1.6'}});
 assert.equal((await same.click('saveSizePreferences')).status,'SETTINGS_UNCHANGED');
 assert.equal(same.outbox.size,0);
 assert.equal(same.trace.some(x=>x.startsWith('rpc.')),false);
 const born=fixture({born:true});
 assert.equal((await born.click('',{preset:'relaxed'})).status,'SETTINGS_FORM_INVALID');
 assert.equal(born.outbox.size,0);
});
test('B2-04 ambiguous ACK keeps original UUID, never falsely claims applied',async()=>{
 const f=fixture({ackLost:true});
 const a=await f.click('saveSizePreferences');
 assert.notEqual(a.status,'SETTINGS_CLOUD_ACK_APPLIED');
 assert.equal(a.requestId,ID);
 assert.equal(f.trace.filter(x=>
  x==='rpc.xb_put_primary_document_draft').length,1);
 // The receipt recovery may stop before RPC if its fallback identity is unavailable.
 assert.equal(f.outbox.get(ID).id,ID);
 assert.equal(f.rendered.length,0);
 assert.equal(f.outbox.get(ID).status,'pending');
});
test('B2-04 definite CAS conflict does not render stale settings or retry with new UUID',async()=>{
 const f=fixture({conflict:true});
 const a=await f.click('saveSizePreferences');
 assert.equal(a.status,'DOCUMENT_CONFLICT_REQUIRES_USER_REVIEW');
 assert.equal(a.requestId,ID);
 assert.equal(f.rendered.length,0);
 assert.equal(f.outbox.get(ID).status,'conflict');
 assert.equal(f.trace.filter(x=>
  x==='rpc.xb_put_primary_document_draft').length,1);
});
test('B2-04 all setting buttons show immediate feedback near their own controls',async()=>{
 for(const [id,dataset,feedbackId,working,success] of [
  ['saveSizePreferences',{},'sizeSettingsActionFeedback',
   '正在保存设置…','尺码与采购偏好已保存'],
  ['savePlans',{},'planSettingsActionFeedback',
   '正在保存备货计划…','备货计划已保存'],
  ['',{preset:'cautious'},'presetSettingsActionFeedback',
   '正在应用并保存方案…','备货方案已保存']
 ]){
  const f=fixture();
  const handler={};
  const button=(id,dataset={})=>({
   id,dataset,textContent:id||'预设备货',disabled:false,
   classList:{contains:()=>false},closest(){return this;}
  });
  const btns={saveSizePreferences:button('saveSizePreferences'),
   savePlans:button('savePlans'),...Object.fromEntries([
    'cautious','balanced','relaxed'].map(name=>
     [name,button('',{preset:name})]))};
  const feedback=Object.fromEntries([
   'sizeSettingsActionFeedback','planSettingsActionFeedback',
   'presetSettingsActionFeedback'].map(id=>[id,{textContent:''}]));
  const dom={
   addEventListener:(event,fn)=>{handler[event]=fn;},
   removeEventListener(){},
   getElementById:id=>btns[id]||feedback[id]||null,
   querySelectorAll:selector=>selector==='[data-preset]'
    ?[btns.cautious,btns.balanced,btns.relaxed]:[]
  };
  f.actions.attach(dom);
  const target=dataset.preset?btns[dataset.preset]:btns[id];
  const event={target,preventDefault(){},stopImmediatePropagation(){}};
  handler.click(event);
  assert.equal(feedback[feedbackId].textContent,working);
  assert.ok([btns.saveSizePreferences,btns.savePlans,
   btns.cautious,btns.balanced,btns.relaxed].every(x=>x.disabled));
  await wait();await wait();
  assert.equal(f.notifications.at(-1)?.status,'SETTINGS_CLOUD_ACK_APPLIED');
  assert.equal(feedback[feedbackId].textContent,success);
  assert.ok([btns.saveSizePreferences,btns.savePlans,
   btns.cautious,btns.balanced,btns.relaxed].every(x=>!x.disabled));
 }
});
