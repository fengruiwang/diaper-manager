'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const weight=require('../preview/v1.2.0/maternal-weight.js');
const client=require('../sync/maternal-health-client.js');

const today='2026-11-21';
const measurement=(id,date,weightKg)=>({id,kind:'weight',date,weightKg});

test('jin and kg round-trip at the supported decimal precision',()=>{
 assert.equal(weight.localDate(new Date(2026,10,21,0,2)),today);
 for(const [jin,kg] of [['96',48],['95.98',47.99],['103',51.5],['103.51',51.755],['100.01',50.005],['0.01',0.005]]){
  assert.deepEqual(weight.weightInput(today,jin,today),{date:today,weightKg:kg});
  assert.equal(weight.formatJin(kg),jin);
  assert.deepEqual(weight.weightInput(today,weight.formatJin(kg),today),{date:today,weightKg:kg});
 }
});

test('invalid, future and impossible dates or malformed weights are rejected',()=>{
 for(const date of ['', '2026-02-29', '2026-11-22', '2026-1-01', '0000-01-01'])
  assert.match(weight.weightInput(date,'103',today).error,/测量日期/);
 for(const jin of ['', '0', '-3', '100.001', '1e2', 'Infinity', '103斤'])
  assert.match(weight.weightInput(today,jin,today).error,/大于 0/);
 assert.equal(weight.weightInput('2024-02-29','103',today).date,'2024-02-29');
});

test('new measurements and edits preserve other health records, metadata and IDs',()=>{
 const earlier=measurement('weight-a','2026-11-19',51.5);
 const extra={id:'recovery-a',kind:'postpartum_recovery',date:today,detail:{level:1}};
 const original={schemaVersion:1,items:[earlier,extra]};
 const added=weight.updateDocument(original,measurement('weight-b',today,52));
 const edited=weight.updateDocument(added,measurement('weight-a','2026-11-20',51.755));
 assert.equal(original.items.length,2);
 assert.deepEqual(edited.items,[
  measurement('weight-a','2026-11-20',51.755),extra,measurement('weight-b',today,52)
 ]);
 assert.equal(weight.updateDocument(original,measurement('recovery-a',today,52)),null);
});

test('deletion removes only the matching weight ID and preserves the immutable source document',()=>{
 const first=measurement('first',today,51.5),second=measurement('second',today,52);
 const constipation={id:'other',kind:'constipation',date:today};
 const recovery={id:'recovery',kind:'postpartum_recovery',date:today};
 const body=Object.freeze({schemaVersion:1,source:'synthetic',
  items:Object.freeze([first,constipation,second,recovery])});
 assert.deepEqual(weight.deleteDocument(body,'first'),{
  schemaVersion:1,source:'synthetic',items:[constipation,second,recovery]
 });
 assert.equal(weight.deleteDocument(body,'missing'),null);
 assert.equal(weight.deleteDocument(body,'other'),null);
 assert.deepEqual(body.items,[first,constipation,second,recovery]);
});

async function mountedWeights(items,{legacy=false,profile,extensions={},autoRead=true,
 refreshBabyDates,constipationFactory,reopenedRequest=null}={}){
 const nodes=new Map();
 function element(tag){
  return {
   tag,children:[],dataset:{},handlers:{},attributes:{},
   classList:{contains:()=>false,toggle(){}},
   append(...children){this.children.push(...children);},
   replaceChildren(){this.children=[];},
   querySelectorAll(selector){
    return this.children.flatMap(child=>child.tag===selector?[child]:child.querySelectorAll(selector));
   },
   setAttribute(name,value){this.attributes[name]=value;},
   set textContent(value){this.text=value;this.innerHTML='';},
   get textContent(){return this.text;},
   addEventListener(name,callback){this.handlers[name]=callback;},
   focus(){},
  };
 }
 const get=id=>{
  if(!nodes.has(id))nodes.set(id,element(id));
  return nodes.get(id);
 };
 const status=get('maternalWeightStatus');
 const rows=get('maternalWeightRows');
 const chart=get('maternalWeightChart');
 const history=get('maternalWeightTable');
 const jin=get('maternalWeightJin');
 const prompts=[],queued=[],sentIds=[];
 const periods=new Map(['day','week','month','all'].map(period=>{
  const button=element('button');
  button.dataset.period=period;
  return [period,button];
 }));
 get('maternalWeightPeriods').querySelectorAll=()=>[...periods.values()];
 const handlers={};
 let confirm=true,outcome='COMMITTED',pending=Number(Boolean(reopenedRequest)),sends=0,reads=0;
 let request=reopenedRequest,storageReady=true;
 let readPending=async()=>storageReady?{status:'QUEUE_VERIFIED',pending,retry:0}:{status:'QUEUE_UNVERIFIED'};
 let readConflicts=async()=>({status:'CONFLICTS_VERIFIED',items:[]});
 let enqueue=async()=>({status:'QUEUED'});
 let scope={app:{},familyId:'synthetic-family',actorUid:'synthetic-actor'};
 let snapshot={status:'READ_VERIFIED',revision:5,body:{schemaVersion:1,items,...extensions}};
 if(profile)snapshot.body.maternalProfile=profile;
 let read=async()=>snapshot;
 const doc={
  defaultView:{confirm(message){assert.equal(this,doc.defaultView);prompts.push(message);return confirm;}},
  getElementById:id=>legacy&&(id.startsWith('maternalProfile')||
   ['maternalWeightTime','maternalWeightNote','maternalWeightPregnancy','maternalWeightPostpartum'].includes(id))?null:get(id),
  createElement:element,addEventListener(name,callback){handlers[name]=callback;},
 };
 const panel=weight.mount({
  doc,host:{crypto:{randomUUID:()=> 'new-record'}},
  controller:{verifiedContext:()=>scope},cloudWritesEnabled:true,
  refreshBabyDates,constipationFactory,
  clientFactory:{validConstipation:require('../sync/maternal-health-client.js').validConstipation,
   create:()=>({read:context=>{reads++;return read(context);}})},
  operationsFactory:{create:()=>({
   pending:()=>readPending(),
   conflicts:()=>readConflicts(),
   queue:async input=>{
    queued.push(input);
    const result=await enqueue();
    if(result.status==='QUEUED'||result.requestId){
     request={...input,requestId:result.requestId||'request-'+queued.length};pending=1;
     return {...result,requestId:request.requestId};
    }
    return result;
   },
   send:async()=>{
    sends++;
    sentIds.push(request?.requestId);
    if(['UNKNOWN','UNAVAILABLE','COMMITTED_QUEUE_UNVERIFIED'].includes(outcome))return {status:outcome,requestId:request?.requestId};
    pending=0;
    if(outcome==='REVISION_CONFLICT')return {status:outcome,requestId:request.requestId};
    snapshot={...snapshot,revision:snapshot.revision+1,body:request.nextBody};
    return {status:outcome,requestId:request.requestId,document:snapshot};
   },
  })},
 });
 panel.setContext(scope);
 const refresh=()=>get('maternalWeightRefresh').handlers.click();
 if(autoRead)await refresh();
 return {get,status,rows,chart,history,jin,prompts,queued,sentIds,
  get sends(){return sends;},
  get reads(){return reads;},get revision(){return snapshot.revision;},
  periods,selectPeriod:period=>periods.get(period).handlers.click(),
  async submit(){
   get('maternalWeightForm').handlers.submit({preventDefault(){}});
   await new Promise(resolve=>setImmediate(resolve));
  },
  saveProfile:()=>get('maternalProfileForm').handlers.submit({preventDefault(){}}),
  edit:index=>rows.children[index].querySelectorAll('button')[0].handlers.click(),
  remove:()=>rows.querySelectorAll('button').filter(button=>button.dataset.deleteWeight),
  setConfirm:value=>{confirm=value;},setOutcome:value=>{outcome=value;},
  setStorageReady:value=>{storageReady=value;},
  setQueueChecks:(queue,conflicts)=>{readPending=queue;readConflicts=conflicts;},
  setEnqueue:next=>{enqueue=next;},
  refresh,open:()=>handlers['maternal-health-open'](),setRead:next=>{read=next;},
  refreshCloudRecords:panel.refreshCloudRecords,canPullRefresh:panel.canPullRefresh,
  setBabyDates:panel.setBabyDates,
  switchScope:(actorUid,familyId)=>{
   scope=actorUid?{...scope,app:scope?.app||{},actorUid,familyId}:null;panel.setContext(scope);
  },
 };
}

const first=measurement('first','2026-11-20',51.5);
const second=measurement('second',today,52);
const other={id:'other',kind:'constipation',date:today};
const bowelDefaults={Date:weight.localDate(new Date()),DidDefecate:'',Count:'',StoolType:'',
 Difficulty:'none',Bloating:'none',Pain:'false',Water:'',Note:''};
const recordedBowel={...other,entryVersion:1,didDefecate:true,defecationCount:2,
 stoolType:4,difficulty:'mild',bloating:'moderate',abdominalPain:true,
 waterIntakeRange:'500_999',note:'synthetic note',details:[{id:'synthetic-detail'}],
 extension:{keep:true}};

async function mountedBowel(items=[]){
 const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
 const selects=['DidDefecate','Count','StoolType','Difficulty','Bloating','Pain','Water'];
 const f=await mountedWeights(items,{constipationFactory:options=>{
  for(const name of selects)options.doc.getElementById('maternalConstipation'+name).options=[{}];
  return mount(options);
 }});
 const b=name=>f.get('maternalConstipation'+name);
 const change=(name,value)=>{b(name).value=value;b(name).handlers.change();};
 const values=()=>Object.fromEntries(Object.keys(bowelDefaults).map(name=>[name,b(name).value]));
 const submit=()=>b('Form').handlers.submit({preventDefault(){}});
 const edit=index=>b('History').children[index].querySelectorAll('button')[0].handlers.click();
 return {b,change,values,submit,edit,get:f.get,queued:f.queued,setOutcome:f.setOutcome};
}

test('R2-02: a new bowel form starts today with symptom defaults and explicit bowel choices',async()=>{
 const f=await mountedBowel();
 assert.deepEqual(f.values(),bowelDefaults);
 assert.equal(f.b('DidDefecate').options[0].textContent,'未选择');
 assert.equal(f.b('Count').options[0].textContent,'未选择');
 assert.equal(f.b('StoolType').options[0].textContent,'不记录');
 assert.equal(f.b('Water').options[0].textContent,'不记录');
 await f.submit();
 assert.equal(f.queued.length,0);
});

test('R2-02: bowel choice and manual count stay in sync without selecting a Bristol type',async()=>{
 const f=await mountedBowel();
 f.change('DidDefecate','true');
 assert.equal(f.b('Count').value,'1');
 assert.equal(f.b('StoolType').value,'');
 f.b('StoolType').value='4';
 f.change('DidDefecate','false');
 assert.equal(f.b('Count').value,'0');
 assert.equal(f.b('StoolType').value,'');
 f.change('Count','2');
 assert.equal(f.b('DidDefecate').value,'true');
 assert.equal(f.b('StoolType').value,'');
 f.change('Count','0');
 assert.equal(f.b('DidDefecate').value,'false');
 f.change('Count','');
 assert.equal(f.b('DidDefecate').value,'');
});

test('R2-02: historical missing values display as unrecorded in edit mode',async()=>{
 const f=await mountedBowel([other]);
 f.edit(0);
 for(const name of ['DidDefecate','Count','StoolType','Difficulty','Bloating','Pain','Water']){
  assert.equal(f.b(name).value,'',name);
  assert.equal(f.b(name).options[0].textContent,'未记录',name);
 }
});

test('R2-02: a legacy note-only edit preserves missing values, details and extensions',async()=>{
 const entry={...other,difficulty:null,details:[{id:'synthetic-detail'}],extension:{keep:true}};
 const f=await mountedBowel([entry]);
 f.edit(0);
 f.b('Note').value='synthetic correction';
 await f.submit();
 assert.deepEqual(f.queued[0].nextBody.items,[{...entry,note:'synthetic correction'}]);
});

test('R2-02: a confirmed new bowel save resets to the new form defaults',async()=>{
 const f=await mountedBowel();
 f.change('Date','2026-01-01');
 f.change('DidDefecate','false');
 f.b('Note').value='synthetic draft';
 await f.submit();
 assert.deepEqual(f.queued[0].nextBody.items,[{
  id:'new-record',kind:'constipation',entryVersion:1,date:'2026-01-01',
  didDefecate:false,defecationCount:0,stoolType:null,difficulty:'none',bloating:'none',
  abdominalPain:false,waterIntakeRange:null,note:'synthetic draft',details:[]
 }]);
 assert.deepEqual(f.values(),bowelDefaults);
 assert.equal(f.b('Heading').textContent,'每日排便记录');
});

test('R2-02: cancelling a bowel edit restores the new form defaults',async()=>{
 const f=await mountedBowel([recordedBowel]);
 f.edit(0);
 f.b('Cancel').handlers.click();
 assert.deepEqual(f.values(),bowelDefaults);
 assert.equal(f.b('Heading').textContent,'每日排便记录');
 assert.equal(f.b('Cancel').hidden,true);
 assert.equal(f.queued.length,0);
});

test('R2-02: an uncertain bowel save keeps every form value until confirmation',async()=>{
 const f=await mountedBowel([recordedBowel]);
 f.edit(0);
 f.b('Note').value='synthetic draft';
 const draft=f.values();
 f.setOutcome('UNKNOWN');
 await f.submit();
 assert.deepEqual(f.values(),draft);
 assert.equal(f.b('Heading').textContent,'编辑排便记录');
 assert.match(f.b('Status').textContent,/保存结果未确认/);
 f.setOutcome('COMMITTED');
 await f.get('maternalWeightRecover').handlers.click();
 assert.deepEqual(f.values(),bowelDefaults);
});

test('R2-02: selecting a recorded date opens its full record and shows the edit notice',async()=>{
 const f=await mountedBowel([recordedBowel]);
 f.change('Date',today);
 assert.equal(f.b('Heading').textContent,'编辑排便记录');
 assert.equal(f.b('Status').textContent,'该日期已有记录，已切换为编辑模式。');
 assert.deepEqual(f.values(),{Date:today,DidDefecate:'true',Count:'2',StoolType:'4',
  Difficulty:'mild',Bloating:'moderate',Pain:'true',Water:'500_999',Note:'synthetic note'});
 assert.equal(f.queued.length,0);
});

test('R2-02: submitting on an existing date enters edit mode before queueing a save',async()=>{
 const f=await mountedBowel([{...recordedBowel,date:bowelDefaults.Date}]);
 await f.submit();
 assert.equal(f.b('Heading').textContent,'编辑排便记录');
 assert.equal(f.b('Status').textContent,'该日期已有记录，已切换为编辑模式。');
 assert.equal(f.b('Note').value,recordedBowel.note);
 assert.equal(f.queued.length,0);
});

test('R2-02: saving after automatic edit selection updates the original ID and preserves other data',async()=>{
 const f=await mountedBowel([second,recordedBowel]);
 f.change('Date',today);
 f.b('Note').value='synthetic correction';
 await f.submit();
 assert.deepEqual(f.queued[0].nextBody.items,[second,{...recordedBowel,note:'synthetic correction'}]);
 assert.equal(f.b('History').children.length,1);
 assert.deepEqual(f.values(),bowelDefaults);
});

test('R2-02: duplicate bowel dates require selecting a specific historical record',async()=>{
 const duplicate={...recordedBowel,id:'synthetic-duplicate'};
 const f=await mountedBowel([recordedBowel,duplicate]);
 f.change('Date',today);
 assert.match(f.b('Warning').textContent,/同日多条/);
 assert.match(f.b('Status').textContent,/选择要编辑/);
 assert.equal(f.b('Heading').textContent,'每日排便记录');
 await f.submit();
 assert.equal(f.queued.length,0);
 f.edit(1);
 f.b('Note').value='synthetic correction';
 await f.submit();
 assert.deepEqual(f.queued[0].nextBody.items,[recordedBowel,{...duplicate,note:'synthetic correction'}]);
 assert.equal(f.b('History').children.length,2);
 assert.equal(f.b('Warning').hidden,false);
});

test('R2-02: a weight can still be added on a day with both weight and bowel records',async()=>{
 const f=await mountedWeights([second,recordedBowel],{constipationFactory:
  require('../preview/v1.3.0/maternal-constipation.js').mount});
 f.get('maternalWeightDate').value=today;
 f.jin.value='105';
 await f.submit();
 const items=f.queued[0].nextBody.items;
 assert.deepEqual(items.slice(0,2),[second,recordedBowel]);
 assert.deepEqual(items.filter(item=>item.kind==='weight').map(item=>item.date),[today,today]);
});

test('bowel Save follows the verified read, storage, pending receipt and account state',async()=>{
 const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
 const f=await mountedWeights([],{constipationFactory:mount,autoRead:false});
 const b=name=>f.get('maternalConstipation'+name);
 const submit=()=>b('Form').handlers.submit({preventDefault(){}});
 const assertBlocked=pattern=>{
  assert.equal(b('Save').disabled,true);
  assert.match(b('Blocker').textContent,pattern);
 };
 assertBlocked(/正在读取/);
 f.setRead(async()=>({status:'UNKNOWN'}));
 assert.equal(await f.open(),'failure');
 assertBlocked(/请先刷新云端记录/);
 assert.match(f.status.textContent,/云端读取失败/);
 let finish;
 f.setRead(()=>new Promise(resolve=>{finish=resolve;}));
 const reading=f.refresh();
 assertBlocked(/正在读取/);
 finish({status:'READ_VERIFIED',revision:5,body:{schemaVersion:1,items:[]}});
 assert.equal(await reading,'success');
 assert.equal(b('Save').disabled,false);
 assert.equal(b('Blocker').hidden,true);
 for(const [name,value] of Object.entries(bowelDefaults))
  assert.equal(b(name).value,value,name);
 await submit();
 assert.match(b('Status').textContent,/明确选择/);
 assert.equal(f.queued.length,0);
 f.setRead(async()=>({status:'READ_VERIFIED',revision:f.revision,body:{schemaVersion:1,items:[]}}));
 f.setStorageReady(false);
 await f.refresh();
 assertBlocked(/检查浏览器存储/);
 f.setStorageReady(true);
 await f.refresh();
 b('DidDefecate').value='false';b('DidDefecate').handlers.change();
 b('Difficulty').value='none';b('Bloating').value='mild';b('Pain').value='false';
 const saving=submit();
 assertBlocked(/正在处理/);
 await saving;
 assert.equal(f.queued.length,1);
 assert.equal(b('Save').disabled,false);
 assert.equal(b('Blocker').hidden,true);
 f.switchScope(null);
 assertBlocked(/等待家庭账号验证完成/);
 f.switchScope('synthetic-b','synthetic-family');
 assertBlocked(/正在读取/);
 await f.open();
 assert.equal(b('Save').disabled,false);
 assert.equal(b('Note').value,'');
 assert.equal(b('History').children.length,0);
});

test('a stalled maternal read releases the disabled state for a fresh verified retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
 const f=await mountedWeights([],{constipationFactory:mount,autoRead:false});
 let lateRead;
 f.setRead(()=>new Promise(resolve=>{lateRead=resolve;}));
 const stalled=f.open();
 assert.match(f.get('maternalConstipationBlocker').textContent,/正在读取/);
 t.mock.timers.tick(12000);
 assert.equal(await stalled,'failure');
 assert.equal(f.get('maternalConstipationSave').disabled,true);
 assert.match(f.get('maternalConstipationBlocker').textContent,/请先刷新云端记录/);
 f.setRead(async()=>({status:'READ_VERIFIED',revision:5,body:{schemaVersion:1,items:[]}}));
 assert.equal(await f.refresh(),'success');
 assert.equal(f.get('maternalConstipationSave').disabled,false);
 lateRead({status:'UNKNOWN'});
 assert.equal(f.get('maternalConstipationSave').disabled,false);
});

const queueClear=()=>({status:'QUEUE_VERIFIED',pending:0,retry:0});
const conflictsClear=()=>({status:'CONFLICTS_VERIFIED',items:[]});
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));

const savedRequest={requestId:'persisted-original',nextBody:{schemaVersion:1,items:[first]}};
for(const cloudRead of ['failure','timeout']){
 test('reopened page verifies the original request after cloud read '+cloudRead,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
  const f=await mountedWeights([],{autoRead:false,constipationFactory:mount,reopenedRequest:savedRequest});
  f.setRead(cloudRead==='failure'?async()=>({status:'UNKNOWN'}):()=>new Promise(()=>{}));
  const recover=f.get('maternalWeightRecover');
  assert.equal(recover.hidden,true);
  const refreshing=f.open();
  if(cloudRead==='timeout')t.mock.timers.tick(12000);
  assert.equal(await refreshing,'failure');
  assert.match(f.status.textContent,/云端读取失败.*请先核验原请求/);
  assert.equal(recover.hidden,false);
  assert.equal(recover.disabled,false);
  for(const id of ['maternalWeightSave','maternalProfileSave','maternalConstipationSave'])
   assert.equal(f.get(id).disabled,true);
  assert.equal(f.sends,0);
  await recover.handlers.click();
  assert.deepEqual(f.sentIds,[savedRequest.requestId]);
  assert.deepEqual(f.queued,[]);
  assert.equal(recover.hidden,true);
  assert.equal(f.get('maternalWeightSave').disabled,false);
 });
}

test('failure in both cloud and queue reads hides any stale recovery status and reports both reasons',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=await mountedWeights([],{reopenedRequest:savedRequest});
 const recover=f.get('maternalWeightRecover');
 assert.equal(recover.hidden,false);
 f.setRead(async()=>({status:'UNKNOWN'}));
 f.setQueueChecks(()=>new Promise(()=>{}),conflictsClear);
 const refreshing=f.refresh();
 await nextTurn();
 t.mock.timers.tick(12000);
 assert.equal(await refreshing,'failure');
 assert.match(f.status.textContent,/云端读取失败.*本地保存队列核验超时/);
 assert.equal(recover.hidden,true);
 assert.equal(recover.disabled,true);
 await recover.handlers.click();
 assert.equal(f.sends,0);
});

for(const stalled of ['pending','conflicts','both']){
 test('local '+stalled+' read times out, and late responses cannot replace a verified retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
  const f=await mountedWeights([first],{autoRead:false,constipationFactory:mount});
  const late=[];
  const wait=response=>()=>new Promise(resolve=>late.push(()=>resolve(response)));
  f.setQueueChecks(stalled==='conflicts'?queueClear:wait({status:'QUEUE_VERIFIED',pending:9,retry:0}),
   stalled==='pending'?conflictsClear:wait({status:'CONFLICTS_VERIFIED',items:[{expectedRevision:0}]}));
  const refresh=f.open();
  await nextTurn();
  assert.match(f.status.textContent,/正在核验本地保存队列/);
  assert.equal(f.rows.children.length,1);
  assert.equal(f.get('maternalConstipationSave').disabled,true);
  t.mock.timers.tick(12000);
  assert.equal(await refresh,'partial');
  assert.equal(late.length,stalled==='both'?2:1);
  assert.match(f.status.textContent,/部分刷新.*核验超时/);
  for(const id of ['maternalWeightSave','maternalProfileSave','maternalConstipationSave'])
   assert.equal(f.get(id).disabled,true);
  assert.equal(f.get('maternalWeightRefresh').disabled,false);
  f.setQueueChecks(queueClear,conflictsClear);
  assert.equal(await f.refresh(),'success');
  for(const resolve of late)resolve();
  await nextTurn();
  for(const id of ['maternalWeightSave','maternalProfileSave','maternalConstipationSave'])
   assert.equal(f.get(id).disabled,false);
  assert.equal(f.get('maternalWeightRecover').hidden,true);
  assert.equal(f.get('maternalWeightArchive').hidden,true);
 });
}

test('account changes discard in-flight queue results and keep V1.2 weight writes blocked until verification',async()=>{
 const f=await mountedWeights([first],{autoRead:false,legacy:true});
 let finish;
 f.setQueueChecks(()=>new Promise(resolve=>{finish=resolve;}),conflictsClear);
 const old=f.refresh();
 await nextTurn();
 f.switchScope('synthetic-b','another-family');
 f.setQueueChecks(queueClear,()=>{throw Error('synthetic storage rejection');});
 assert.equal(await f.refresh(),'partial');
 assert.equal(f.get('maternalWeightSave').disabled,true);
 assert.match(f.status.textContent,/检查浏览器存储/);
 f.setQueueChecks(queueClear,conflictsClear);
 assert.equal(await f.refresh(),'success');
 finish({status:'QUEUE_VERIFIED',pending:1,retry:0});
 await old;
 assert.equal(f.get('maternalWeightRecover').hidden,true);
 assert.equal(f.get('maternalWeightSave').disabled,false);
});

test('bowel save distinguishes enqueue rejection, unknown receipts, and post-ACK review failure',async()=>{
 const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
 const f=await mountedWeights([],{constipationFactory:mount});
 const b=name=>f.get('maternalConstipation'+name);
 const submit=()=>b('Form').handlers.submit({preventDefault(){}});
 b('DidDefecate').value='false';b('DidDefecate').handlers.change();
 b('Difficulty').value='none';b('Bloating').value='none';b('Pain').value='false';
 b('Note').value='保留的草稿';
 f.setEnqueue(async()=>({status:'QUEUE_WRITE_FAILED'}));
 await submit();
 assert.match(b('Status').textContent,/本地入队失败/);
 assert.equal(f.sends,0);
 f.setEnqueue(async()=>({status:'QUEUE_UNVERIFIED',requestId:'ambiguous-original'}));
 await submit();
 assert.match(b('Status').textContent,/本地队列状态未确认/);
 assert.equal(f.sends,0);
 assert.equal(b('Note').value,'保留的草稿');
 f.setOutcome('UNAVAILABLE');
 await f.get('maternalWeightRecover').handlers.click();
 assert.match(b('Status').textContent,/云端提交未完成/);
 assert.equal(b('History').children.length,0);
 f.setOutcome('UNKNOWN');
 await f.get('maternalWeightRecover').handlers.click();
 assert.match(b('Status').textContent,/保存结果未确认/);
 assert.equal(b('Note').value,'保留的草稿');
 await submit();
 assert.equal(f.queued.length,2);
 f.setOutcome('COMMITTED');
 f.setQueueChecks(queueClear,()=>{throw Error('synthetic post-save storage rejection');});
 await f.get('maternalWeightRecover').handlers.click();
 assert.match(b('Status').textContent,/已保存至云端.*保存后的本地队列未确认/);
 assert.equal(b('History').children.length,1);
 assert.equal(b('Save').disabled,true);
});

test('an incomplete legacy bowel record can save a note and only upgrades after explicit completion',async()=>{
 const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
 const {validBody}=require('../sync/maternal-health-client.js');
 const entry={...other,details:[{id:'legacy-marker'}],extension:{keep:true}};
 const f=await mountedWeights([first,entry],{constipationFactory:mount});
 const b=name=>f.get('maternalConstipation'+name);
 const edit=()=>b('History').querySelectorAll('button')[0].handlers.click();
 const submit=()=>b('Form').handlers.submit({preventDefault(){}});
 const cardText=node=>[node.textContent,...node.children.flatMap(cardText)];
 edit();
 assert.equal(b('Difficulty').value,'');
 b('Note').value='仅修改备注';
 await submit();
 const legacy=f.queued[0].nextBody;
 assert.equal(validBody(legacy),true);
 assert.deepEqual(legacy.items,[first,{...entry,note:'仅修改备注'}]);
 assert.ok(cardText(b('History')).includes('未记录'));
 edit();
 b('DidDefecate').value='true';b('DidDefecate').handlers.change();
 b('Difficulty').value='none';b('Bloating').value='mild';b('Pain').value='false';
 await submit();
 const upgraded=f.queued[1].nextBody;
 assert.equal(validBody(upgraded),true);
 assert.deepEqual(upgraded.items[1],{...entry,note:'仅修改备注',entryVersion:1,
  didDefecate:true,defecationCount:1,stoolType:null,difficulty:'none',bloating:'mild',
  abdominalPain:false,waterIntakeRange:null});
});

test('bowel summary shares revision, protects both drafts and only acknowledges confirmed saves',async()=>{
 const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
 const f=await mountedWeights([first],{constipationFactory:mount,
  profile:{prePregnancyWeightKg:48},extensions:{tag:'keep'}});
 const b=name=>f.get('maternalConstipation'+name);
 const submit=()=>b('Form').handlers.submit({preventDefault(){}});
 assert.equal(f.canPullRefresh(),true);
 f.edit(0);
 f.jin.value='105';
 f.get('maternalProfileJin').value='97';
 f.get('maternalProfileForm').handlers.input();
 b('DidDefecate').value='true';b('DidDefecate').handlers.change();
 assert.equal(b('Count').value,'1');
 b('Count').value='0';b('Count').handlers.change();
 assert.equal(b('DidDefecate').value,'false');
 assert.equal(b('StoolType').disabled,true);
 b('Count').value='3';b('Count').handlers.change();
 assert.equal(b('DidDefecate').value,'true');
 b('StoolType').value='7';
 b('Difficulty').value='none';b('Bloating').value='none';b('Pain').value='false';
 b('Date').value='9999-12-31';
 await submit();
 assert.equal(f.queued.length,0);
 b('Date').value='2026-01-01';b('Date').handlers.change();
 b('Note').value='补录';
 f.setOutcome('UNKNOWN');
 await submit();
 assert.doesNotMatch(b('Status').textContent,/已保存至云端/);
 assert.equal(b('History').children.length,0);
 assert.equal(b('Save').disabled,true);
 assert.match(b('Blocker').textContent,/请先核验待确认保存/);
 await submit();
 assert.equal(f.queued.length,1);
 f.setOutcome('COMMITTED');
 await f.get('maternalWeightRecover').handlers.click();
 assert.equal(f.queued.length,1);
 assert.equal(f.revision,6);
 assert.equal(b('History').children.length,1);
 assert.match(b('Status').textContent,/已保存至云端/);
 assert.equal(f.jin.value,'105');
 assert.equal(f.get('maternalProfileJin').value,'97');
 assert.equal(f.queued[0].nextBody.tag,'keep');
 assert.deepEqual(f.queued[0].nextBody.items[0],first);
 assert.equal(f.queued[0].nextBody.maternalProfile.prePregnancyWeightKg,48);
 const summary=f.queued[0].nextBody.items[1];
 assert.equal(summary.defecationCount,3);
 b('Date').value=summary.date;b('Date').handlers.change();
 assert.equal(b('Note').value,'补录');
 b('Note').value='未保存的排便草稿';b('Form').handlers.input();
 await f.submit();
 assert.equal(b('Note').value,'未保存的排便草稿');
 assert.deepEqual(f.queued[1].nextBody.items.find(item=>item.kind==='constipation'),summary);
 await f.refreshCloudRecords();
 assert.equal(b('Note').value,'未保存的排便草稿');
 f.switchScope('other-actor','other-family');
 assert.equal(b('Note').value,'');
 assert.equal(b('History').children.length,0);
 assert.equal(b('Save').disabled,true);
});

test('bowel editing blocks pull refresh, and duplicate legacy days stay visible until explicitly removed',async()=>{
 const {mount}=require('../preview/v1.3.0/maternal-constipation.js');
 const f=await mountedWeights([first,other,{...other,id:'legacy-duplicate'}],{constipationFactory:mount});
 const b=name=>f.get('maternalConstipation'+name);
 assert.equal(f.canPullRefresh(),true);
 assert.match(b('Warning').textContent,/同日多条/);
 assert.equal(b('History').children.length,2);
 b('Date').value=today;b('Date').handlers.change();
 assert.match(b('Status').textContent,/选择要编辑/);
 await b('Form').handlers.submit({preventDefault(){}});
 assert.equal(f.queued.length,0);
 assert.equal(f.canPullRefresh(),false);
 const [edit,remove]=b('History').children[1].querySelectorAll('button');
 edit.handlers.click();
 assert.equal(b('Difficulty').value,'');
 assert.equal(b('Pain').value,'');
 f.setConfirm(false);
 await remove.handlers.click();
 assert.equal(f.queued.length,0);
 f.setConfirm(true);
 await remove.handlers.click();
 assert.deepEqual(f.queued[0].nextBody.items,[first,other]);
 assert.match(b('Status').textContent,/已从云端删除/);
 assert.equal(b('Warning').hidden,true);
 assert.equal(b('History').children.length,1);
 assert.equal(f.canPullRefresh(),true);
 f.setRead(async()=>({status:'READ_VERIFIED',revision:f.revision+1,
  body:{schemaVersion:1,items:[first,second,other,{...other,id:'new-bowel',date:'2026-01-01'}]}}));
 assert.equal(await f.refreshCloudRecords(),'success');
 assert.equal(f.rows.children.length,2);
 assert.equal(b('History').children.length,2);
});

test('verified birth date partitions chart and history without writes or loss of a selected stage',async()=>{
 const previous={...first,time:'09:30',note:'历史备注'};
 const birth={...second,time:'00:05'};
 const later=measurement('later','2026-11-22',50.5);
 const items=Object.freeze([previous,birth,later,other]);
 const f=await mountedWeights(items,{profile:{prePregnancyWeightKg:48,deliveryDate:'2026-01-01'}});
 const pregnancy=f.get('maternalWeightPregnancy'),postpartum=f.get('maternalWeightPostpartum');
 const visibleIds=()=>f.remove().map(button=>button.dataset.deleteWeight);
 const plotted=()=>[...f.chart.innerHTML.matchAll(/<title>([^<]+)<\/title>/g)].map(match=>match[1]);
 assert.equal(pregnancy.attributes['aria-pressed'],'true');
 assert.equal(postpartum.hidden,true);
 postpartum.handlers.click();
 assert.deepEqual(visibleIds(),['later','second','first']);
 f.setBabyDates({dueDate:'2026-11-10',birthDate:'2026-02-30'});
 assert.equal(postpartum.hidden,true);

 f.setBabyDates({dueDate:'2026-11-10',birthDate:today});
 assert.equal(postpartum.hidden,false);
 assert.equal(postpartum.attributes['aria-pressed'],'true');
 assert.deepEqual(visibleIds(),['later','second']);
 assert.deepEqual(plotted(),['2026-11-21 · 104 斤 · 00:05','2026-11-22 · 101 斤']);
 assert.match(f.chart.innerHTML,/孕前参考体重 · 96 斤/);
 pregnancy.handlers.click();
 assert.deepEqual(visibleIds(),['first']);
 assert.deepEqual(plotted(),['2026-11-20 · 103 斤 · 09:30']);
 assert.match(f.chart.innerHTML,/孕前参考体重 · 96 斤/);
 assert.equal(f.rows.children[0].children[3].textContent,'历史备注');

 f.setBabyDates({dueDate:'2026-11-29',birthDate:today});
 assert.equal(pregnancy.attributes['aria-pressed'],'true');
 assert.deepEqual(visibleIds(),['first']);
 f.setBabyDates({dueDate:'2026-11-29',birthDate:'2026-11-22'});
 assert.deepEqual(visibleIds(),['second','first']);
 assert.equal(f.sends,0);
 assert.deepEqual(f.queued,[]);
 assert.deepEqual(items,[previous,birth,later,other]);
 f.setBabyDates(null);
 assert.equal(postpartum.hidden,true);
 assert.deepEqual(visibleIds(),['later','second','first']);
});

test('day, Monday-based week and month take the latest measurement across calendar boundaries',()=>{
 const item=(id,date,time)=>({...measurement(id,date,50),...(time?{time}:{})});
 const items=[
  item('dec29','2024-12-29'),item('dec30','2024-12-30'),item('dec31','2024-12-31'),
  item('jan1','2025-01-01'),item('jan5-pm','2025-01-05','17:35'),
  item('jan5-am','2025-01-05','08:00'),item('jan5-legacy','2025-01-05'),
  item('jan6','2025-01-06'),
  item('may27','2024-05-27'),item('may31','2024-05-31'),item('jun2','2024-06-02'),
 ];
 const records=weight.history({items});
 const ids=period=>weight.trendRecords(records,period).map(record=>record.id);
 assert.deepEqual(ids('day'),['jan6','jan5-pm','jan1','dec31','dec30','dec29','jun2','may31','may27']);
 assert.deepEqual(ids('week'),['jan6','jan5-pm','dec29','jun2']);
 assert.deepEqual(ids('month'),['jan6','dec31','jun2','may31']);
 assert.deepEqual(ids('all'),records.map(record=>record.id));
});

test('period changes only the chart while comparison uses raw records from the selected stage',async()=>{
 const early={...second,id:'early',time:'08:00',weightKg:51.75};
 const late={...second,id:'late',time:'18:30',weightKg:52};
 const f=await mountedWeights([early,first,late,other],{profile:{prePregnancyWeightKg:48}});
 f.setBabyDates({birthDate:today});
 const state=()=>['maternalWeightLatest','maternalWeightLatestDate','maternalWeightDelta','maternalWeightPreviousDate']
  .map(id=>f.get(id).textContent);
 const points=()=>[...f.chart.innerHTML.matchAll(/<circle cx="([^"]+)"/g)].map(match=>match[1]);
 const expected=['104 斤','2026-11-21 · 18:30','+0.50 斤','上一条 · 2026-11-21'];
 assert.equal(f.periods.get('all').attributes['aria-pressed'],'true');
 assert.deepEqual(state(),expected);
 assert.equal(new Set(points()).size,2);
 const rows=[...f.rows.children];
 for(const period of ['day','week','month','all']){
  f.selectPeriod(period);
  assert.equal(f.periods.get(period).attributes['aria-pressed'],'true');
  assert.equal(points().length,period==='all'?2:1);
  assert.match(f.chart.innerHTML,/孕前参考体重 · 96 斤/);
  assert.deepEqual(state(),expected);
  assert.deepEqual(f.rows.children,rows);
  assert.equal(f.rows.children[0],rows[0]);
 }
 f.selectPeriod('week');
 f.get('maternalWeightPregnancy').handlers.click();
 assert.equal(f.periods.get('week').attributes['aria-pressed'],'true');
 assert.deepEqual(state(),['103 斤','2026-11-20','暂无可比较记录','']);
 assert.equal(f.get('maternalWeightPreviousDate').hidden,true);
 assert.equal(points().length,1);
 assert.equal(f.reads,1);
 assert.equal(f.revision,5);
 assert.equal(f.sends,0);
 assert.deepEqual(f.queued,[]);
});

test('comparison shows precision, signed losses, zero and empty stages without borrowing records',async()=>{
 const a={...first,weightKg:51.655};
 const earlier={...first,id:'earlier',date:'2026-11-19',weightKg:51.805};
 const f=await mountedWeights([earlier,a,{...second,weightKg:51.5}]);
 f.setBabyDates({birthDate:today});
 const delta=f.get('maternalWeightDelta');
 assert.equal(delta.textContent,'暂无可比较记录');
 f.get('maternalWeightPregnancy').handlers.click();
 assert.equal(delta.textContent,'-0.30 斤');
 assert.equal(f.get('maternalWeightPreviousDate').textContent,'上一条 · 2026-11-19');
 f.setRead(async()=>({status:'READ_VERIFIED',revision:6,body:{schemaVersion:1,items:[
  {...earlier,weightKg:a.weightKg},a
 ]}}));
 await f.refresh();
 assert.equal(delta.textContent,'0.00 斤');
 f.get('maternalWeightPostpartum').handlers.click();
 assert.match(f.get('maternalWeightLatest').textContent,/暂无.*体重记录/);
 assert.equal(delta.textContent,'暂无可比较记录');
 assert.equal(f.chart.textContent,'暂无产后体重记录');
 assert.equal(f.get('maternalWeightLatestDate').hidden,true);
});

test('saving, backfilling and deleting in a stage preserves the other stage and health data',async()=>{
 const f=await mountedWeights([first,second,other],{extensions:{custom:'preserved'}});
 f.setBabyDates({birthDate:today});
 const pregnancy=f.get('maternalWeightPregnancy'),postpartum=f.get('maternalWeightPostpartum');
 f.edit(0);
 f.get('maternalWeightNote').value='产后回填';
 await f.submit();
 assert.equal(f.queued[0].baseline.revision,5);
 assert.deepEqual(f.queued[0].nextBody,{schemaVersion:1,custom:'preserved',
  items:[first,{...second,note:'产后回填'},other]});
 pregnancy.handlers.click();
 f.get('maternalWeightDate').value='2026-11-19';
 f.jin.value='100';
 await f.submit();
 assert.equal(f.queued[1].baseline.revision,6);
 assert.equal(f.queued[1].nextBody.items[3].id,'new-record');
 assert.match(f.chart.innerHTML,/2026-11-19 · 100 斤/);
 postpartum.handlers.click();
 await f.remove()[0].handlers.click();
 assert.equal(f.queued[2].nextBody.items.length,3);
 assert.equal(f.history.hidden,true);
 assert.equal(f.chart.textContent,'暂无产后体重记录');
 pregnancy.handlers.click();
 assert.deepEqual(f.remove().map(button=>button.dataset.deleteWeight),['first','new-record']);
 assert.equal(f.queued[2].nextBody.items[1],other);
});

test('manual refresh combines independent reads, preserves drafts, and reports partial failures',async()=>{
 let datesReads=0,readDates;
 const f=await mountedWeights([first],{autoRead:false,refreshBabyDates:()=>{
  datesReads++;
  return readDates();
 }});
 await f.open();
 assert.equal(datesReads,0);
 assert.equal(f.refreshCloudRecords,f.get('maternalWeightRefresh').handlers.click);
 assert.equal(f.canPullRefresh(),true);
 f.setBabyDates({dueDate:'2026-01-01',birthDate:''});
 f.edit(0);f.jin.value='111.25';
 f.get('maternalProfileJin').value='96.13';
 f.get('maternalProfileForm').handlers.input();
 assert.equal(f.canPullRefresh(),false);
 readDates=async()=>{
  f.setBabyDates({dueDate:'2026-01-02',birthDate:'2026-01-01'});
  return true;
 };
 await f.refresh();
 assert.equal(datesReads,1);
 assert.equal(f.get('maternalProfileDue').textContent,'2026-01-02');
 assert.equal(f.get('maternalProfileStage').textContent,'产后');
 assert.match(f.status.textContent,/体重记录已刷新。.*宝宝日期已刷新/);
 assert.deepEqual([f.jin.value,f.get('maternalProfileJin').value,f.rows.children.length],['111.25','96.13',1]);
 assert.equal(f.get('maternalWeightCancel').hidden,false);

 readDates=async()=>{throw Error('synthetic profile read failure');};
 assert.equal(await f.refreshCloudRecords(),'partial');
 assert.match(f.status.textContent,/部分刷新。.*体重记录已刷新。.*保留上次已验证的日期/);
 assert.equal(f.get('maternalProfileDue').textContent,'2026-01-02');

 f.setRead(async()=>({status:'UNAVAILABLE'}));
 readDates=async()=>{f.setBabyDates({dueDate:'2026-01-03',birthDate:''});return true;};
 await f.refresh();
 assert.equal(f.get('maternalProfileDue').textContent,'2026-01-03');
 assert.equal(f.get('maternalProfileStage').textContent,'孕期');
 assert.match(f.status.textContent,/部分刷新。.*妈妈健康云端服务.*宝宝日期已刷新/);
 assert.deepEqual([f.jin.value,f.get('maternalProfileJin').value,f.rows.children.length],['111.25','96.13',1]);
 assert.equal(f.queued.length,0);
});

test('new weight drafts and existing edit mode block pulls until the form is reset',async()=>{
 const f=await mountedWeights([first]);
 const form=f.get('maternalWeightForm'),cancel=f.get('maternalWeightCancel');
 f.jin.value='99.23';
 form.handlers.input();
 assert.equal(f.canPullRefresh(),false);
 cancel.handlers.click();
 assert.equal(f.canPullRefresh(),true);
 f.edit(0);
 assert.equal(f.canPullRefresh(),false);
 cancel.handlers.click();
 assert.equal(f.canPullRefresh(),true);
});

test('first maternal read reports loading and failure independently of the baby stage',async()=>{
 const f=await mountedWeights([],{autoRead:false});
 const stage=f.get('maternalProfileStage'),save=f.get('maternalProfileSave');
 const feedback=f.get('maternalProfileStatus');
 assert.equal(stage.textContent,'未关联宝宝资料');
 assert.match(feedback.textContent,/尚未读取/);
 assert.equal(save.disabled,true);
 f.setRead(async()=>{throw Error('synthetic read rejection');});
 await f.refresh();
 assert.equal(stage.textContent,'未关联宝宝资料');
 assert.match(feedback.textContent,/暂时无法读取.*刷新云端记录/);
 assert.equal(save.disabled,true);
 let resolve;
 f.setRead(()=>new Promise(done=>{resolve=done;}));
 const reading=f.open();
 assert.equal(feedback.textContent,'正在读取妈妈健康档案…');
 assert.equal(f.get('maternalProfileJin').disabled,true);
 resolve({status:'READ_VERIFIED',revision:0,body:{schemaVersion:1,items:[]}});
 await reading;
 assert.equal(stage.textContent,'未关联宝宝资料');
 assert.equal(save.disabled,false);
 assert.equal(f.get('maternalProfileStatus').textContent,'');
});

test('repeat entry refreshes silently, blocks stale writes, and preserves drafts until switching scope',async()=>{
 const profile={prePregnancyWeightKg:48,dueDate:'2026-01-09',deliveryDate:'2026-01-05'};
 const f=await mountedWeights([first],{profile});
 const stage=f.get('maternalProfileStage'),jin=f.get('maternalProfileJin'),due=f.get('maternalProfileDue');
 f.setBabyDates({dueDate:'2026-01-01',birthDate:''});
 assert.equal(stage.textContent,'孕期');
 f.edit(0);
 f.jin.value='105.23';
 let resolve;
 let reads=0;
 f.setRead(()=>{reads++;return new Promise(done=>{resolve=done;});});
 const reentry=f.open();
 assert.equal(reads,1);
 assert.equal(stage.textContent,'孕期');
 assert.equal(jin.value,'96');
 assert.equal(f.rows.children.length,1);
 assert.equal(f.get('maternalProfileSave').disabled,true);
 assert.equal(f.get('maternalWeightSave').disabled,true);
 await f.saveProfile();
 assert.equal(f.queued.length,0);
 const result={status:'READ_VERIFIED',revision:6,body:{schemaVersion:1,items:[first],
  maternalProfile:{...profile,prePregnancyWeightKg:48.005,deliveryDate:'2026-01-02'}}};
 resolve(result);
 await reentry;
 assert.equal(stage.textContent,'孕期');
 assert.equal(jin.value,'96.01');
 assert.equal(f.jin.value,'105.23');
 assert.equal(f.get('maternalProfileSave').disabled,false);

 f.setRead(async()=>({status:'OFFLINE'}));
 const failed=f.open();
 assert.equal(stage.textContent,'孕期');
 assert.equal(jin.value,'96.01');
 await failed;
 assert.equal(stage.textContent,'孕期');
 assert.equal(due.textContent,'2026-01-01');
 assert.match(f.get('maternalProfileStatus').textContent,/当前显示上次读取的数据/);
 assert.equal(f.get('maternalProfileSave').disabled,true);

 f.setRead(async()=>({...result,revision:5,body:{...result.body,maternalProfile:{
  ...profile,prePregnancyWeightKg:47.99
 }}}));
 await f.open();
 assert.equal(jin.value,'96.01');
 assert.equal(f.get('maternalProfileSave').disabled,true);

 jin.value='96.15';
 f.get('maternalProfileForm').handlers.input();
 f.setBabyDates({dueDate:'2026-01-03',birthDate:'2026-01-02'});
 assert.equal(stage.textContent,'产后');
 f.setRead(async()=>result);
 await f.open();
 assert.equal(stage.textContent,'产后');
 assert.equal(due.textContent,'2026-01-03');
 assert.equal(jin.value,'96.15');
 assert.equal(f.queued.length,0);

 f.setRead(()=>new Promise(done=>{resolve=done;}));
 const oldRead=f.open();
 f.switchScope('synthetic-b','synthetic-family');
 assert.equal(stage.textContent,'未关联宝宝资料');
 assert.deepEqual([jin.value,due.textContent],['','未填写']);
 assert.equal(f.rows.children.length,0);
 resolve(result);
 await oldRead;
 assert.equal(stage.textContent,'未关联宝宝资料');
 assert.equal(jin.value,'');
 assert.equal(f.rows.children.length,0);
});

test('stage uses verified baby dates and profile input only accepts pre-pregnancy weight',()=>{
 const fields={jin:'94.01',dueDate:'2026-01-01',deliveryDate:'2025-12-31'};
 assert.deepEqual(weight.profileInput(fields),{prePregnancyWeightKg:47.005});
 assert.equal(weight.maternalStage(null),'未关联宝宝资料');
 assert.equal(weight.maternalStage({dueDate:'2026-01-01'}),'孕期');
 assert.equal(weight.maternalStage({dueDate:'2099-01-01'}),'孕期');
 assert.equal(weight.maternalStage({dueDate:'2026-01-01',birthDate:'2025-12-31'}),'产后');
 assert.equal(weight.maternalStage({dueDate:'2026-01-01',birthDate:'2026-02-29'}),'孕期');
 assert.equal(weight.maternalStage({}),'未填写宝宝日期');
 for(const jin of ['0','-1','94.001','NaN','1e2'])
  assert.match(weight.profileInput({...fields,jin}).error,/孕前体重/);
});

test('profile saves, refills and clears without replacing history, extensions or a weight draft',async()=>{
 const record={...first,time:'08:30',note:'保留'};
 const extension={familyPreference:true};
 const legacyProfile={dueDate:'2026-01-09',deliveryDate:'2026-01-05',custom:'synthetic'};
 const f=await mountedWeights([record,other],{extensions:{extension},profile:legacyProfile});
 const jin=f.get('maternalProfileJin'),due=f.get('maternalProfileDue');
 const delivery=f.get('maternalProfileDelivery'),stage=f.get('maternalProfileStage');
 assert.deepEqual([stage.textContent,jin.value,due.textContent,delivery.textContent],
  ['未关联宝宝资料','','未填写','未填写']);
 f.edit(0);
 f.jin.value='103.27';
 f.get('maternalWeightNote').value='未保存的修改';
 f.setBabyDates({dueDate:'2026-01-01',birthDate:''});
 jin.value='94.01';
 await f.saveProfile();
 const firstBody=f.queued[0].nextBody;
 assert.deepEqual(firstBody,{schemaVersion:1,items:[record,other],extension,
  maternalProfile:{...legacyProfile,prePregnancyWeightKg:47.005}});
 assert.equal(stage.textContent,'孕期');
 assert.match(f.get('maternalProfileStatus').textContent,/已保存至云端/);
 assert.deepEqual([f.jin.value,f.get('maternalWeightNote').value],['103.27','未保存的修改']);
 assert.equal(delivery.textContent,'未填写');
 f.setBabyDates({dueDate:'2026-01-01',birthDate:'2025-12-31'});
 assert.equal(stage.textContent,'产后');
 assert.equal(delivery.textContent,'2025-12-31');
 assert.equal(f.queued.length,1);
 jin.value='';
 await f.saveProfile();
 assert.equal(stage.textContent,'产后');
 assert.deepEqual(f.queued[1].nextBody,{...firstBody,maternalProfile:{...legacyProfile,prePregnancyWeightKg:null}});
 assert.equal(f.get('maternalWeightCancel').hidden,false);
 assert.equal(f.jin.value,'103.27');
});

test('profile receipt recovery keeps the original request and the weight draft',async()=>{
 const f=await mountedWeights([first]);
 f.edit(0);f.jin.value='103.25';
 f.get('maternalProfileJin').value='96';
 f.setOutcome('UNKNOWN');
 await f.saveProfile();
 assert.equal(f.get('maternalProfileStage').textContent,'未关联宝宝资料');
 assert.equal(f.get('maternalProfileSave').disabled,true);
 assert.match(f.get('maternalProfileStatus').textContent,/原请求已保留/);
 f.setOutcome('COMMITTED');
 await f.get('maternalWeightRecover').handlers.click();
 assert.equal(f.queued.length,1);
 assert.equal(f.sends,2);
 assert.equal(f.get('maternalProfileStage').textContent,'未关联宝宝资料');
 assert.deepEqual(f.queued[0].nextBody.maternalProfile,{prePregnancyWeightKg:48});
 assert.equal(f.jin.value,'103.25');
});

test('new records default to the local minute and save the selected time and optional note verbatim',async()=>{
 const before=new Date();
 const f=await mountedWeights([]);
 const after=new Date();
 const date=f.get('maternalWeightDate'),time=f.get('maternalWeightTime'),note=f.get('maternalWeightNote');
 const localMinute=now=>weight.localDate(now)+' '+[now.getHours(),now.getMinutes()]
  .map(part=>String(part).padStart(2,'0')).join(':');
 assert.ok([localMinute(before),localMinute(after)].includes(date.value+' '+time.value));
 assert.equal(date.max,date.value);
 assert.equal(note.value,'');

 date.value='2026-01-04';f.jin.value='103.51';time.value='24:00';
 await f.submit();
 assert.match(f.status.textContent,/HH:mm/);
 assert.equal(f.queued.length,0);
 time.value='06:05';note.value='早起测量\n补录';
 await f.submit();
 assert.deepEqual(f.queued[0].nextBody.items,[
  {id:'new-record',kind:'weight',date:'2026-01-04',weightKg:51.755,time:'06:05',note:'早起测量\n补录'}
 ]);
 assert.deepEqual(f.rows.children[0].children.slice(0,4).map(cell=>cell.textContent),
  ['2026-01-04','06:05','103.51','早起测量\n补录']);
});

test('history sorts by local time and edits both timed and legacy rows without losing extensions',async()=>{
 const early={...second,id:'early',time:'07:00',note:'早上'};
 const late={...second,id:'late',time:'21:30',note:'晚上',extension:{source:'synthetic'}};
 const f=await mountedWeights([second,early,other,late]);
 const time=f.get('maternalWeightTime'),note=f.get('maternalWeightNote');
 assert.deepEqual(f.rows.children.map(row=>row.children[1].textContent),['21:30','07:00','未记录']);
 assert.equal(f.rows.children[2].children[3].textContent,'');
 f.edit(0);
 assert.deepEqual([f.get('maternalWeightDate').value,time.value,f.jin.value,note.value],
  [today,'21:30','104','晚上']);
 time.value='22:00';note.value='';
 await f.submit();
 assert.deepEqual(f.queued[0].nextBody.items,[second,early,other,{...late,time:'22:00',note:''}]);

 f.edit(2);
 assert.equal(time.value,'');
 assert.equal(note.value,'');
 note.value='历史补录';
 await f.submit();
 assert.deepEqual(f.queued[1].nextBody.items[0],{...second,note:'历史补录'});
 f.edit(2);
 time.value='06:00';
 await f.submit();
 assert.deepEqual(f.queued[2].nextBody.items[0],{...second,time:'06:00',note:'历史补录'});
});

test('the older preview markup still edits weight without erasing the new fields',async()=>{
 const record={...second,time:'19:15',note:'保留'};
 const f=await mountedWeights([record],{legacy:true});
 assert.equal(f.rows.children[0].children.length,3);
 f.edit(0);f.jin.value='100';
 await f.submit();
 assert.deepEqual(f.queued[0].nextBody.items,[{...record,weightKg:50}]);
});

test('cancel keeps the active edit and creates no request',async()=>{
 const f=await mountedWeights([first,second]);
 f.edit(0);f.jin.value='105';f.setConfirm(false);
 const [remove]=f.remove();
 assert.match(remove.attributes['aria-label'],/删除 2026-11-21 的体重记录/);
 await remove.handlers.click();
 assert.deepEqual(f.prompts,['确定删除 2026-11-21 的妈妈体重记录？删除后无法撤销。']);
 assert.equal(f.jin.value,'105');
 assert.equal(f.rows.children.length,2);
 assert.deepEqual(f.queued,[]);
 assert.equal(f.sends,0);
});

test('confirmed deletion sends once, preserves another edit, and clears the deleted edit and last chart point',async()=>{
 const f=await mountedWeights([first,second,other]);
 f.edit(1);f.jin.value='99';
 const [remove]=f.remove();
 const saving=remove.handlers.click();
 assert.ok(f.remove().every(button=>button.disabled));
 assert.equal(f.rows.children.length,2);
 await remove.handlers.click();
 await saving;
 assert.equal(f.queued.length,1);
 assert.equal(f.sends,1);
 assert.equal(f.queued[0].baseline.revision,5);
 assert.deepEqual(f.queued[0].nextBody.items,[first,other]);
 assert.equal(f.rows.children.length,1);
 assert.match(f.chart.innerHTML,/共1个数据点/);
 assert.match(f.status.textContent,/已从云端删除/);
 assert.equal(f.jin.value,'99');
 assert.equal(f.get('maternalWeightCancel').hidden,false);
 await f.remove()[0].handlers.click();
 assert.equal(f.jin.value,'');
 assert.equal(f.get('maternalWeightCancel').hidden,true);
 assert.equal(f.history.hidden,true);
 assert.equal(f.get('maternalWeightEmpty').textContent,'暂无体重记录');
 assert.equal(f.get('maternalWeightEmpty').hidden,false);
 assert.equal(f.chart.textContent,'暂无体重记录');
});

test('unconfirmed deletion blocks another delete; CAS conflict keeps the original list and chart',async()=>{
 const f=await mountedWeights([first,second]);
 f.setOutcome('UNKNOWN');
 await f.remove()[0].handlers.click();
 assert.ok(f.remove().every(button=>button.disabled));
 await f.remove()[1].handlers.click();
 assert.equal(f.queued.length,1);
 assert.equal(f.rows.children.length,2);
 f.setOutcome('REVISION_CONFLICT');
 await f.get('maternalWeightRecover').handlers.click();
 assert.equal(f.rows.children.length,2);
 assert.match(f.chart.innerHTML,/共2个数据点/);
 assert.match(f.status.textContent,/另一端已更新/);
 assert.ok(f.remove().every(button=>button.disabled));
});

test('receipt recovery confirms the original deletion without queuing a replacement',async()=>{
 const f=await mountedWeights([first]);
 f.edit(0);
 f.setOutcome('UNKNOWN');
 await f.remove()[0].handlers.click();
 assert.equal(f.rows.children.length,1);
 assert.equal(f.get('maternalWeightRecover').hidden,false);
 f.setOutcome('COMMITTED');
 await f.get('maternalWeightRecover').handlers.click();
 assert.equal(f.queued.length,1);
 assert.equal(f.sends,2);
 assert.equal(f.rows.children.length,0);
 assert.equal(f.get('maternalWeightCancel').hidden,true);
 assert.match(f.status.textContent,/已从云端删除/);
});

test('history sorts descending and SVG uses the same records plotted by date in jin',()=>{
 const body={schemaVersion:1,items:[
  measurement('last','2026-11-21',52),
  {id:'other',kind:'constipation',date:'2026-11-21'},
  measurement('middle','2026-11-13',51.755),
  measurement('first','2026-11-11',51.5)
 ]};
 const history=weight.history(body);
 assert.deepEqual(history.map(item=>item.id),['last','middle','first']);
 const svg=weight.chart(history);
 assert.match(svg,/单位斤，共3个数据点/);
 assert.match(svg,/2026-11-11 · 103 斤/);
 assert.match(svg,/2026-11-13 · 103\.51 斤/);
 assert.match(svg,/2026-11-21 · 104 斤/);
 const xs=[...svg.matchAll(/<circle cx="([^"]+)"/g)].map(match=>Number(match[1]));
 assert.equal(xs.length,3);
 assert.equal((xs[1]-xs[0])*5,xs[2]-xs[0]);
 assert.doesNotMatch(weight.chart(history.slice(0,1)),/<polyline/);
 assert.equal(weight.chart([]),'');
});

test('trend SVG renders single and multiple measurements without Array.prototype.at',()=>{
 const filename=require.resolve('../preview/v1.2.0/maternal-weight.js');
 const legacy=vm.createContext({module:{exports:{}}});
 vm.runInContext('delete Array.prototype.at',legacy);
 assert.equal(vm.runInContext('typeof Array.prototype.at',legacy),'undefined');
 vm.runInContext(fs.readFileSync(filename,'utf8'),legacy,{filename});
 const newest=measurement('last','2026-11-21',52);
 const oldest=measurement('first','2026-11-11',51.5);
 for(const records of [[newest],[newest,oldest]]){
  legacy.recordsJSON=JSON.stringify(records);
  const svg=vm.runInContext('module.exports.chart(JSON.parse(recordsJSON), 47.99)',legacy);
  assert.equal(svg,weight.chart(records,47.99));
  assert.equal([...svg.matchAll(/<circle\b/g)].length,records.length);
  assert.equal(svg.includes('<polyline'),records.length>1);
  assert.match(svg,/>2026-11-21<\/text>/);
 }
});

test('confirmed pre-pregnancy weight adds a dashed reference without changing measurements',()=>{
 const records=Object.freeze([Object.freeze(second),Object.freeze(first)]);
 const plain=weight.chart(records);
 const svg=weight.chart(records,47.99);
 assert.doesNotMatch(plain,/孕前参考体重|stroke-dasharray/);
 assert.equal(weight.chart(records,null),plain);
 assert.match(svg,/孕前参考体重 · 95\.98 斤/);
 assert.match(svg,/<path d="M 56 [\d.]+ H 716"[^>]*stroke-dasharray="7 5"/);
 const titleText=chart=>[...chart.matchAll(/<title>([^<]+)<\/title>/g)].map(match=>match[1]);
 assert.deepEqual(titleText(svg),titleText(plain));
 assert.equal(records[0].weightKg,52);
 assert.equal(records[1].weightKg,51.5);
});

test('health client distinguishes missing RPCs for the undeployed preview',async()=>{
 const familyId='f1300000-0000-4000-8000-000000000001',actorUid='synthetic-a';
 const app={auth:{getSession:async()=>({data:{session:{user:{id:actorUid}}}})},
  rdb:()=>({rpc:async()=>({error:{code:'PGRST202'}})})};
 const service=client.create({controller:{verifiedContext:()=>({familyId,actorUid,app})}});
 assert.equal((await service.read({familyId,actorUid})).status,'UNAVAILABLE');
});
