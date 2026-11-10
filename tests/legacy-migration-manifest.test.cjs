const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const Audit=require('../sync/legacy-purchase-audit.js');
const Contract=require('../sync/migration-contract.js');
const M=require('../sync/legacy-migration-manifest.js');
function state(){
 return {
  dueDate:'2027-01-08',birthDate:'',currentSize:'NB',babyWeight:'',
  babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''},
  weightRecords:[{id:'w-1',date:'2027-01-08',time:'10:30',weight:3.267,note:'体重'}],
  sizeMode:'manual',autoSize:'NB',replenishPolicy:{mode:'days',days:7},
  goalPrice:1.5,plannedBudget:250,
  target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
  daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
  inventory:{NB:21,S:42,M:0,L:0,XL:0,XXL:0},
  quotes:[{id:'q1',date:'2026-11-10',brand:'好奇',series:'小森林',
    size:'S',per:20,packs:3,pieces:60,price:29.99,unit:29.99/60}],
  transactions:[
   {id:'buy1',type:'buy',date:'2026-11-10',brand:'好奇',
    series:'小森林',size:'S',pieces:60,price:29.99},
   {id:'use1',type:'use',date:'2026-11-10',size:'S',pieces:5,price:0}],
  referenceOverrides:{'好奇|小森林|S':1.235},
  preset:'balanced'
 };
}
const inspect=s=>M.audit(s,Contract,Audit,webcrypto);
test('read-only preflight maps every stock + known preference field and never permits auto-upload',async()=>{
 const s=state(),before=JSON.stringify(s);
 const result=await inspect(s);
 assert.equal(result.readOnlyPreflightPass,true);
 assert.equal(result.canUpload,false);
 assert.equal(result.requiresExplicitApproval,true);
 assert.deepEqual(result.unknownFields,[]);
 assert.deepEqual(result.issues,[]);
 assert.deepEqual(result.inventoryBaseline,s.inventory);
 assert.equal(result.summary.totalInventory,63);
 assert.equal(result.summary.totalPurchaseCents,2999);
 assert.equal(result.historyTotals.purchaseFen,2999);
 assert.equal(result.historyTotals.purchaseCount,1);
 assert.equal(Object.keys(result.knownMapping).length,18);
 assert.match(result.source.sha256,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(s),before);
});
test('legacy purchase history is NOT replayed into stocktake baseline',async()=>{
 const s=state();s.inventory.S=3;
 s.transactions[0].pieces=100;
 const r=await inspect(s);
 assert.equal(r.inventoryBaseline.S,3);
 assert.equal(r.summary.totalInventory,24);
 assert.equal(r.historyTotals.purchasePieces,100);
 assert.ok(r.warnings.includes('legacy_purchase_history_is_not_inventory_baseline'));
});
test('three decimal per-piece reference prices remain valid',async()=>{
 const s=state();s.referenceOverrides['好奇|小森林|S']=1.235;
 const r=await inspect(s);
 assert.ok(!r.issues.some(x=>x.code==='invalid_reference_unit_price'));
 assert.equal(r.readOnlyPreflightPass,true);
});
test('third decimal purchase amount must block; summary must NOT silently round',async()=>{
 const s=state();s.transactions[0].price=29.995;
 const r=await inspect(s);
 assert.equal(r.readOnlyPreflightPass,false);
 assert.equal(r.summary.totalPurchaseCents,null);
 assert.equal(r.summary.purchasePrecisionIssueCount,1);
 assert.ok(r.issues.some(x=>x.code==='legacy_price_precision_review_required'));
 assert.equal(r.canUpload,false);
});
test('unknown top-level and nested extension fields cause explicit review, without data loss',async()=>{
 const s=state();
 s.futureFeedingRecords=[{type:'formula',quantity:90}];
 s.weightRecords[0].customNote={keep:true};
 s.transactions[0].voucherCode='hello';
 const before=JSON.stringify(s),r=await inspect(s);
 assert.equal(r.readOnlyPreflightPass,false);
 assert.equal(r.unknownFields.length,3);
 assert.ok(r.unknownFields.some(x=>x.path==='state.futureFeedingRecords'));
 assert.ok(r.unknownFields.some(x=>x.path==='weightRecords[0].customNote'));
 assert.ok(r.unknownFields.some(x=>x.path==='transactions[0].voucherCode'));
 assert.equal(JSON.stringify(s),before);
});
test('quote amount, pack-count mismatch and wrong unit price are flagged',async()=>{
 const s=state();
 s.quotes[0].pieces=900;
 s.quotes[0].unit=0.6;
 s.quotes[0].price=29.995;
 const r=await inspect(s);
 assert.equal(r.readOnlyPreflightPass,false);
 assert.ok(r.issues.some(x=>x.code==='invalid_quote_pack_count'));
 assert.ok(r.issues.some(x=>x.code==='legacy_price_precision_review_required'));
 assert.ok(r.issues.some(x=>x.code==='quote_unit_mismatch'));
});
test('invalid weight/unknown baby profile field must not be discarded',async()=>{
 const s=state();
 s.weightRecords[0].weight=40.3456;
 s.babyProfile.customHealth='private';
 const r=await inspect(s);
 assert.equal(r.readOnlyPreflightPass,false);
 assert.ok(r.issues.some(x=>x.code==='invalid_weight_measurement'));
 assert.ok(r.unknownFields.some(x=>x.path==='babyProfile.customHealth'));
});
test('source SHA changes with modifications and does not reveal raw transactions',async()=>{
 const a=state(),b=state();b.inventory.NB+=1;
 const x=await inspect(a),y=await inspect(b);
 assert.notEqual(x.source.sha256,y.source.sha256);
 assert.equal(JSON.stringify(x).includes('"brand":"好奇"'),false);
 assert.equal(JSON.stringify(x).includes('customHealth'),false);
});
