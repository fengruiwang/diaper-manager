const test=require('node:test'),assert=require('node:assert/strict');
const Runtime=require('../sync/legacy-migration-runtime.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
function fixture({enabled=false}={}){
 const calls=[],app={
  auth:{getSession:async()=>({data:{session:{user:{id:'dad'}}}})},
  rdb:()=>({from:table=>{
   calls.push(table);
   assert.equal(table,'xb_baby_profiles');
   return {select(){return{eq(){return this},async limit(){
    return {data:[{family_id:F,child_id:C,
     profile_data:{babyProfile:{name:'合成宝宝'},
      dueDate:'2027-01-08',birthDate:'',babyWeight:''}}]};
   }}}}
  }})
 };
 let injected=null;
 const deps={
  app,
  cutoverGate:{prepare:async x=>({status:'BLOCKED',count:x.sources.length}),
   verifyBeforeUpload:async()=>({status:'CUTOVER_BLOCKED',canUpload:false}),
   stable:JSON.stringify},
  strictReview:async()=>({status:'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED'}),
  digest:async()=> 'f'.repeat(64),
  receiptModule:{create:()=>({inspect:async()=>({status:'PLAN_ONLY_EMPTY_TARGET'})})},
  childModule:{create:()=>({inspectLegacyTarget:async()=>({
   familyId:F,childId:C,readyForMigration:false})})},
  scopeGuard:{requireLegacyMigrationTarget(){}},
  legacyModule:{create:()=>({readAll:async()=>({complete:true}),
   readSettings:async()=>({complete:true})})},
  inventoryModule:{create:()=>({
   readInventory:async()=>[{size:'S',quantity:140,revision:2}],
   readPurchases:async()=>[]})},
  nativeReadbackModule:{create:()=>({
   readBaselineOperations:async()=>[{kind:'migration_baseline'}],
   readNativeWeights:async()=>[{legacy_record_id:'w1'}]})},
  executorModule:{create:options=>{
   injected=options;
   return {preflight:async()=>({status:'NOT_AUTHORIZED'}),
    execute:async()=>({status:enabled?'REQUIRES_SERVER_AUTHORIZATION':
     'MIGRATION_WRITES_NOT_AUTHORIZED'}),
    reconcile:async()=>({status:'MIGRATION_READBACK_PENDING'}),
    get cloudWritesEnabled(){return options.cloudWritesEnabled===true;}}
  }},
  cloudWritesEnabled:enabled
 };
 return {runtime:Runtime.create(deps),get injected(){return injected},calls};
}
test('M2 runtime combines existing receipt/child/history/inventory/native modules, never creates a new SQL client',async()=>{
 const f=fixture();
 assert.equal(f.runtime.cloudWritesEnabled,false);
 assert.equal(typeof f.injected.resolvePrimary,'function');
 assert.equal(typeof f.injected.readNativeWeights,'function');
 assert.equal(typeof f.injected.readBaselineOperations,'function');
 assert.equal(f.calls.length,0);
 const target=await f.injected.resolvePrimary({familyId:F});
 assert.equal(target.childId,C);
 const profile=await f.injected.readProfile({familyId:F,childId:C});
 assert.equal(profile.babyProfile.name,'合成宝宝');
 assert.deepEqual(f.calls,['xb_baby_profiles']);
});
test('prepare final multi-device snapshot uses existing strict review and digest',async()=>{
 const f=fixture();
 const result=await f.runtime.prepare({sources:[{raw:'{}'},{raw:'{}'}]});
 assert.equal(result.status,'BLOCKED');assert.equal(result.count,2);
});
test('no authorized cloud mutation is possible with normal runtime defaults',async()=>{
 const f=fixture();
 assert.equal((await f.runtime.execute({operatorApproved:true})).status,
  'MIGRATION_WRITES_NOT_AUTHORIZED');
});
test('scope from account A cannot be silently replaced with an unverified child',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.injected.readProfile({familyId:F,childId:'smoke'}),
  /migration_runtime:invalid_profile_scope/);
 assert.equal(f.calls.length,0);
});
