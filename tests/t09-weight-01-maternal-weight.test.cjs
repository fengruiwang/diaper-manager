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

async function mountedWeights(items,{legacy=false,profile,extensions={},autoRead=true,refreshBabyDates}={}){
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
 const prompts=[],queued=[];
 const handlers={};
 let confirm=true,outcome='COMMITTED',pending=0,sends=0,request;
 let scope={app:{},familyId:'synthetic-family',actorUid:'synthetic-actor'};
 let snapshot={status:'READ_VERIFIED',revision:5,body:{schemaVersion:1,items,...extensions}};
 if(profile)snapshot.body.maternalProfile=profile;
 let read=async()=>snapshot;
 const doc={
  defaultView:{confirm(message){assert.equal(this,doc.defaultView);prompts.push(message);return confirm;}},
  getElementById:id=>legacy&&(id.startsWith('maternalProfile')||
   ['maternalWeightTime','maternalWeightNote'].includes(id))?null:get(id),
  createElement:element,addEventListener(name,callback){handlers[name]=callback;},
 };
 const panel=weight.mount({
  doc,host:{crypto:{randomUUID:()=> 'new-record'}},
  controller:{verifiedContext:()=>scope},cloudWritesEnabled:true,
  refreshBabyDates,
  clientFactory:{create:()=>({read:context=>read(context)})},
  operationsFactory:{create:()=>({
   pending:async()=>({status:'QUEUE_VERIFIED',pending,retry:0}),
   conflicts:async()=>({status:'CONFLICTS_VERIFIED',items:[]}),
   queue:async input=>{
    queued.push(input);request={...input,requestId:'request-'+queued.length};pending=1;
    return {status:'QUEUED',requestId:request.requestId};
   },
   send:async()=>{
    sends++;
    if(outcome==='UNKNOWN')return {status:outcome};
    pending=0;
    if(outcome==='REVISION_CONFLICT')return {status:outcome,requestId:request.requestId};
    snapshot={...snapshot,revision:snapshot.revision+1,body:request.nextBody};
    return {status:'COMMITTED',requestId:request.requestId,document:snapshot};
   },
  })},
 });
 panel.setContext(scope);
 const refresh=()=>get('maternalWeightRefresh').handlers.click();
 if(autoRead)await refresh();
 return {get,status,rows,chart,history,jin,prompts,queued,
  get sends(){return sends;},
  async submit(){
   get('maternalWeightForm').handlers.submit({preventDefault(){}});
   await new Promise(resolve=>setImmediate(resolve));
  },
  saveProfile:()=>get('maternalProfileForm').handlers.submit({preventDefault(){}}),
  edit:index=>rows.children[index].querySelectorAll('button')[0].handlers.click(),
  remove:()=>rows.querySelectorAll('button').filter(button=>button.dataset.deleteWeight),
  setConfirm:value=>{confirm=value;},setOutcome:value=>{outcome=value;},
  refresh,open:()=>handlers['maternal-health-open'](),setRead:next=>{read=next;},
  setBabyDates:panel.setBabyDates,
  switchScope:(actorUid,familyId)=>{
   scope={...scope,actorUid,familyId};panel.setContext(scope);
  },
 };
}

const first=measurement('first','2026-11-20',51.5);
const second=measurement('second',today,52);
const other={id:'other',kind:'constipation',date:today};

test('manual refresh combines independent reads, preserves drafts, and reports partial failures',async()=>{
 let datesReads=0,readDates;
 const f=await mountedWeights([first],{autoRead:false,refreshBabyDates:()=>{
  datesReads++;
  return readDates();
 }});
 await f.open();
 assert.equal(datesReads,0);
 f.setBabyDates({dueDate:'2026-01-01',birthDate:''});
 f.edit(0);f.jin.value='111.25';
 f.get('maternalProfileJin').value='96.13';
 f.get('maternalProfileForm').handlers.input();
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
 await f.refresh();
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
  const svg=vm.runInContext('module.exports.chart(JSON.parse(recordsJSON))',legacy);
  assert.equal(svg,weight.chart(records));
  assert.equal([...svg.matchAll(/<circle\b/g)].length,records.length);
  assert.equal(svg.includes('<polyline'),records.length>1);
  assert.match(svg,/>2026-11-21<\/text>/);
 }
});

test('health client distinguishes missing RPCs for the undeployed preview',async()=>{
 const familyId='f1300000-0000-4000-8000-000000000001',actorUid='synthetic-a';
 const app={auth:{getSession:async()=>({data:{session:{user:{id:actorUid}}}})},
  rdb:()=>({rpc:async()=>({error:{code:'PGRST202'}})})};
 const service=client.create({controller:{verifiedContext:()=>({familyId,actorUid,app})}});
 assert.equal((await service.read({familyId,actorUid})).status,'UNAVAILABLE');
});
