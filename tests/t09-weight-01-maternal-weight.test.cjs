'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
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

test('health client distinguishes missing RPCs for the undeployed preview',async()=>{
 const familyId='f1300000-0000-4000-8000-000000000001',actorUid='synthetic-a';
 const app={auth:{getSession:async()=>({data:{session:{user:{id:actorUid}}}})},
  rdb:()=>({rpc:async()=>({error:{code:'PGRST202'}})})};
 const service=client.create({controller:{verifiedContext:()=>({familyId,actorUid,app})}});
 assert.equal((await service.read({familyId,actorUid})).status,'UNAVAILABLE');
});
