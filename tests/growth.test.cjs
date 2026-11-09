const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../growth.js');
const base={dueDate:'2027-01-08',birthDate:'2027-01-08',currentSize:'NB',babyWeight:'',babyProfile:{name:'小宝',sex:'',birthTime:'08:30:00',birthWeight:3.2,birthLength:50},weightRecords:[],sizeMode:'manual',autoSize:'NB',inventory:{NB:16,S:36,M:20,L:0,XL:0,XXL:0},target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},transactions:[],goalPrice:1.5};
test('legacy data migration defaults to manual and preserves size',()=>{const x=G.extras({currentSize:'M',babyWeight:'5.4',inventory:{M:11}});assert.equal(x.sizeMode,'manual');assert.equal(x.autoSize,'M');assert.deepEqual(x.weightRecords,[]);});
test('birth weight is virtual and not a duplicated stored measurement',()=>{const s={...base,weightRecords:[{id:'a',date:'2027-01-10',time:'',weight:3.5,note:''}]};assert.equal(G.measurements(s).length,2);assert.equal(s.weightRecords.length,1);assert.equal(G.measurements(s)[0].isBirth,true);});
test('manual setting beats auto suggestion',()=>{const s={...base,currentSize:'M',weightRecords:[{id:'a',date:'2027-02-10',time:'',weight:8.2}],sizeMode:'manual'};assert.equal(G.effectiveSize(s),'M');});
test('overlap does not force NB to S',()=>assert.equal(G.recommendSize(4.8,'NB'),'NB'));
test('size passes upper limits without skipping required steps',()=>{assert.equal(G.recommendSize(5.1,'NB'),'S');assert.equal(G.recommendSize(8.1,'NB'),'M');assert.equal(G.recommendSize(15,'S'),'XL');});
test('older size with inventory is kept at bottom and never in reorder proposal',()=>{const s={...base,currentSize:'S'};const p=G.stockPlan(s);assert.deepEqual(p.past,['NB']);const h=G.dashboard(s);assert.ok(h.hasHistorical);assert.match(h.historical,/NB/);assert.doesNotMatch(h.cards,/NB · 正在用/);assert.match(h.cards,/S · 正在用/);});
test('older size with empty inventory stays hidden',()=>{const s={...base,currentSize:'S',inventory:{...base.inventory,NB:0}};assert.deepEqual(G.stockPlan(s).past,[]);});
test('later sizes with default zero target use 7 days temporary target',()=>{const s={...base,currentSize:'M'};const p=G.stockPlan(s);assert.equal(p.target,49);assert.equal(p.shortage,29);});
test('legacy weight is fallback without fabricated measurement date',()=>{const s={...base,birthDate:'',babyProfile:{birthWeight:''},babyWeight:'5.4'};assert.equal(G.measurements(s).length,0);assert.equal(G.latestWeight(s).source,'legacy');});
test('validation rejects future invalid date and time',()=>{assert.equal(G.dateOK('2027-02-30'),false);assert.equal(G.dateOK('2027-01-31'),true);assert.equal(G.timeOK('25:30:00'),false);assert.equal(G.timeOK('12:30:45'),true);});
test('chart escapes unsafe measurement notes in history',()=>{const s={...base,weightRecords:[{id:'a',date:'2027-02-10',time:'',weight:4.4,note:'<script>alert(1)</script>'}]};assert.doesNotMatch(G.history(s),/<script>/);assert.match(G.history(s),/&lt;script&gt;/);});
test('no mutation of purchase, price or inventory datasets',()=>{const s=JSON.parse(JSON.stringify(base)),before=JSON.stringify(s);G.dashboard(s);G.history(s);G.chart(s,'all');assert.equal(JSON.stringify(s),before);});

test('policy defaults to seven days and migrates without changing old targets',()=>{
 const x=G.extras({currentSize:'L',target:{NB:80,S:60,L:32},plannedBudget:300});
 assert.deepEqual(x.replenishPolicy,{mode:'days',days:7});
 assert.equal(G.targetForSize({...base,currentSize:'L',target:{...base.target,L:32}},'L').target,42);
});
test('five, seven and ten day replenishment use the current size daily rate',()=>{
 for(const days of [5,7,10]){
  const s={...base,currentSize:'L',replenishPolicy:{mode:'days',days},daily:{...base.daily,L:6}};
  const p=G.stockPlan(s);
  assert.equal(p.target,days*6);assert.equal(p.shortage,days*6);
  assert.equal(p.targetSource,'days');
 }
});
test('custom target is respected and zero target safely falls back to seven days',()=>{
 const s={...base,currentSize:'L',replenishPolicy:{mode:'custom',days:5},target:{...base.target,L:48}};
 assert.equal(G.stockPlan(s).target,48);
 assert.equal(G.stockPlan({...s,target:{...base.target,L:0}}).target,42);
 assert.equal(G.stockPlan({...s,target:{...base.target,L:0}}).targetSource,'fallback');
});
test('home day-policy labels show actual selected days and not the old custom goal',()=>{
 const s={...base,currentSize:'L',replenishPolicy:{mode:'days',days:5},target:{...base.target,L:100}};
 const ui=G.dashboard(s);
 assert.equal(ui.plan.target,30);
 assert.match(ui.kpis,/按5天用量/);
 assert.doesNotMatch(ui.kpis,/补至 100 片/);
});

test('new automatic algorithm ignores legacy autoSize anchor and moves down when weight falls',()=>{
 const s={...base,birthDate:'2025-01-08',currentSize:'L',autoSize:'XXL',sizeMode:'auto',weightRecords:[{id:'w1',date:'2025-06-08',time:'10:00',weight:4.5}]};
 assert.equal(G.effectiveSize(s),'NB');
 assert.equal(G.latestRecommendation(s),'NB');
 assert.equal(s.autoSize,'XXL','must not mutate old field');
 assert.equal(G.syncAutoSize(s),'NB');
 assert.equal(s.autoSize,'XXL');
});
test('latest recorded weight always wins by measurement date, not insertion order',()=>{
 const s={...base,birthDate:'2025-01-08',sizeMode:'auto',autoSize:'XL',weightRecords:[
 {id:'new',date:'2025-07-01',time:'15:30',weight:6.2},
 {id:'old',date:'2025-06-01',time:'09:00',weight:4.2}
 ]};
 assert.equal(G.latestWeight(s).weight,6.2);
 assert.equal(G.effectiveSize(s),'S');
 s.weightRecords.push({id:'same-day-earlier',date:'2025-07-01',time:'09:00',weight:9.2});
 assert.equal(G.latestWeight(s).weight,6.2);
});
test('editing or deleting the most recent measurement can return to smaller size',()=>{
 const s={...base,birthDate:'2025-01-08',sizeMode:'auto',autoSize:'M',weightRecords:[
 {id:'w1',date:'2025-06-01',time:'',weight:4.5},
 {id:'w2',date:'2025-06-02',time:'',weight:6.2}
 ]};
 assert.equal(G.effectiveSize(s),'S');
 s.weightRecords[1].weight=4.3;
 assert.equal(G.effectiveSize(s),'NB');
 s.weightRecords[1].weight=11.2;
 assert.equal(G.effectiveSize(s),'L');
 s.weightRecords.pop();
 assert.equal(G.effectiveSize(s),'NB');
});
test('manual selection is never overwritten by weight changes',()=>{
 const s={...base,birthDate:'2025-01-08',sizeMode:'manual',currentSize:'L',autoSize:'XXL',weightRecords:[{id:'a',date:'2025-06-01',time:'',weight:4.5}]};
 assert.equal(G.effectiveSize(s),'L');
 assert.equal(G.latestRecommendation(s),'NB');
});
test('common ranges cover all six sizes and are shared by exported API',()=>{
 for(const size of G.SIZES)assert.ok(G.sizeRange(size).length>0);
 assert.equal(G.sizeRange('S'),'约 4–8 kg');
 assert.match(G.dashboard({...base,birthDate:'2025-01-08'}).cards,/建议体重/);
});
