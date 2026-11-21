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
 for(const [jin,kg] of [['103',51.5],['103.51',51.755],['100.01',50.005],['0.01',0.005]]){
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

async function mountedWeights(items){
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
 let confirm=true,outcome='COMMITTED',pending=0,sends=0,request;
 const scope={app:{},familyId:'synthetic-family',actorUid:'synthetic-actor'};
 let snapshot={status:'READ_VERIFIED',revision:5,body:{schemaVersion:1,items}};
 const doc={
  defaultView:{confirm(message){assert.equal(this,doc.defaultView);prompts.push(message);return confirm;}},
  getElementById:get,createElement:element,addEventListener(){},
 };
 const panel=weight.mount({
  doc,host:{},controller:{verifiedContext:()=>scope},cloudWritesEnabled:true,
  clientFactory:{create:()=>({read:async()=>snapshot})},
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
 await get('maternalWeightRefresh').handlers.click();
 return {get,status,rows,chart,history,jin,prompts,queued,
  get sends(){return sends;},
  edit:index=>rows.children[index].querySelectorAll('button')[0].handlers.click(),
  remove:()=>rows.querySelectorAll('button').filter(button=>button.dataset.deleteWeight),
  setConfirm:value=>{confirm=value;},setOutcome:value=>{outcome=value;},
 };
}

const first=measurement('first','2026-11-20',51.5);
const second=measurement('second',today,52);
const other={id:'other',kind:'constipation',date:today};

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
