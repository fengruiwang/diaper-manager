const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const Contract=require('../sync/migration-contract.js');

function fixture(){
 return {
  dueDate:'2027-01-08',birthDate:'',currentSize:'NB',babyWeight:'',
  babyProfile:{name:'小宝',sex:'',birthTime:'',birthWeight:'',birthLength:''},
  inventory:{NB:18,S:72,M:0,L:0,XL:0,XXL:0},
  target:{NB:100,S:60,M:0,L:0,XL:0,XXL:0},
  daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},
  transactions:[
   {id:'a-01',type:'buy',date:'2026-11-01',size:'S',pieces:72,price:98.28},
   {id:'a-02',type:'use',date:'2026-11-02',size:'NB',pieces:5,price:0}
  ],
  quotes:[{id:'q-1',size:'S',unit:1.43}],
  weightRecords:[{id:'w-1',date:'2027-01-08',weight:3.25}],
  referenceOverrides:{'帮宝适|一级帮|NB':0.98},
  replenishPolicy:{mode:'days',days:7},
  customForwardCompatibleField:{keep:'untouched'}
 };
}
test('read-only preflight preserves nested legacy records and returns counts',async()=>{
 const v=fixture(),before=JSON.stringify(v);
 const info=await Contract.inspect(v,webcrypto);
 assert.equal(info.summary.totalInventory,90);
 assert.equal(info.summary.transactionCount,2);
 assert.equal(info.summary.purchaseCount,1);
 assert.equal(info.summary.consumptionCount,1);
 assert.equal(info.summary.totalPurchaseCents,9828);
 assert.equal(info.summary.quoteCount,1);
 assert.equal(info.summary.weightRecordCount,1);
 assert.equal(info.summary.referenceOverrideCount,1);
 assert.match(info.sha256,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(v),before,'preflight must not mutate user data');
});
test('canonical fingerprint stable for object key order but not purchase contents',async()=>{
 const v=fixture();
 const reordered=Object.fromEntries(Object.entries(v).reverse());
 assert.equal((await Contract.inspect(v,webcrypto)).sha256,(await Contract.inspect(reordered,webcrypto)).sha256);
 const altered=fixture();altered.transactions[0].price+=1;
 assert.notEqual((await Contract.inspect(v,webcrypto)).sha256,(await Contract.inspect(altered,webcrypto)).sha256);
});
test('missing original inventory, targets, duplicate transaction ids are blocked',()=>{
 const x=fixture();delete x.inventory;assert.throws(()=>Contract.count(x),/inventory_must_be_object/);
 const y=fixture();y.inventory.NB=-5;assert.throws(()=>Contract.count(y),/inventory_invalid_NB/);
 const z=fixture();z.transactions.push({...z.transactions[0]});assert.throws(()=>Contract.count(z),/duplicate_id/);
});
test('different record order is intentional data and changes checksum',async()=>{
 const v=fixture(),r=fixture();r.transactions.reverse();
 assert.notEqual((await Contract.inspect(v,webcrypto)).sha256,(await Contract.inspect(r,webcrypto)).sha256);
});
test('unknown fields remain in canonical snapshot',()=>{
 assert.match(Contract.stableStringify(fixture()),/customForwardCompatibleField/);
});
