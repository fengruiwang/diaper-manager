const test=require('node:test');
const assert=require('node:assert/strict');
const X=require('../sync/legacy-purchase-audit.js');
const buy=(id,price,extra={})=>({id,type:'buy',date:'2026-11-10',brand:'好奇',series:'小森林',size:'S',pieces:60,price,...extra});
const use=(id,extra={})=>({id,type:'use',date:'2026-11-10',size:'S',pieces:3,price:0,...extra});
test('legacy valid purchase exactly maps to cents without modifying source',()=>{
 const original=[buy('a',29.99,{futureUnknownField:{nested:12}}),use('b')];
 const before=JSON.stringify(original);
 const result=X.audit(original);
 assert.equal(result.canMigrate,true);
 assert.equal(result.spendFen,2999);
 assert.equal(result.pieceCount,60);
 assert.equal(result.purchaseCount,1);
 assert.equal(result.useCount,1);
 assert.equal(JSON.stringify(original),before);
 assert.deepEqual(result.orders,[{legacyId:'a',priceFen:2999}]);
});
test('binary decimal precision difference is tolerated, actual third decimal rejected',()=>{
 assert.equal(X.cents(0.1+0.2),30);
 assert.equal(X.cents(2.3),230);
 assert.throws(()=>X.cents(0.333),/precision_review_required/);
 assert.throws(()=>X.cents(12.345),/precision_review_required/);
 assert.throws(()=>X.cents(0),/invalid_legacy_price/);
});
test('duplicate legacy IDs and invalid date block automatic migration',()=>{
 const result=X.audit([buy('same',12.3),buy('same',13.4),buy('other',10,{date:'2026-02-30'})]);
 assert.equal(result.canMigrate,false);
 assert.ok(result.issues.some(x=>x.code==='duplicate_record_id'));
 assert.ok(result.issues.some(x=>x.code==='invalid_purchase_or_use_date'));
});
test('third-decimal price stops migration rather than silently rounding',()=>{
 const x=X.audit([buy('a',11.337)]);
 assert.equal(x.canMigrate,false);
 assert.ok(x.issues.some(r=>r.code==='legacy_price_precision_review_required'));
 assert.equal(x.spendFen,0);
});
test('all old transactions remain read-only, including unrecognized user extension fields',()=>{
 const old=[buy('a',9.99,{memo:'user-notes',extra:[1,2,3]})];
 const before=structuredClone(old);
 X.audit(old);
 assert.deepEqual(old,before);
});
test('invalid buy brand and non-integer pieces are explicitly flagged',()=>{
 const x=X.audit([buy('a',19.99,{brand:' ',pieces:0}),buy('b',19.99,{price:Infinity})]);
 assert.equal(x.canMigrate,false);
 assert.ok(x.issues.some(r=>r.code==='invalid_brand'));
 assert.ok(x.issues.some(r=>r.code==='invalid_piece_count'));
 assert.ok(x.issues.some(r=>r.code==='invalid_legacy_price'));
});
