const test=require('node:test');
const assert=require('node:assert/strict');
const Model=require('../sync/primary-cloud-read-model.js');

const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const PRIMARY='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const SMOKE='6b3d0e45-bf18-4c95-889c-6f19731a8ae5';
const actor='dad';
const SIZES=['NB','S','M','L','XL','XXL'];
function fixture({primary=true,historyReady=true,changeStock=false,otherActor=false}={}){
 const calls=[];
 let inventoryReads=0;
 const rows=()=>SIZES.map(size=>({
  size,quantity:size==='S'?(changeStock&&inventoryReads>=2?61:60):0,
  revision:size==='S'?(changeStock&&inventoryReads>=2?2:1):0
 }));
 const adapter=Model.create({
  app:{rdb:()=>({from(table){
   assert.equal(table,'xb_baby_profiles');
   return {select(){return {eq(){return this},async limit(){
    calls.push(['profile',PRIMARY,FAMILY]);
    return {data:[{family_id:FAMILY,child_id:PRIMARY,profile_data:{
     babyProfile:{name:'合成小宝',sex:''},dueDate:'2027-01-08',birthDate:'',
     babyWeight:'',legacySourceSha256:'f'.repeat(64)
    }}]};
   }}}};
  }})},
  scopeGuard:{requireLegacyMigrationTarget(){}},
  accessPreflight:{create:()=>({verifyAccess:async x=>{
   calls.push(['permission',x.familyId,x.actorUid]);
   return {member:true,appCode:'xb',familyId:FAMILY,actorUid:actor};
  }})},
  childReader:{create:()=>({inspectLegacyTarget:async x=>{
   calls.push(['target',x.familyId]);
   if(!primary)throw Error('child_reader:legacy_primary_unavailable');
   return {familyId:FAMILY,childId:PRIMARY,readyForMigration:false};
  }})},
  inventoryClient:{create:()=>({
   async readReconciliation(scope){
    calls.push(['inventory',scope.childId,scope.familyId]);
    inventoryReads++;
    return {complete:true,childId:PRIMARY,familyId:FAMILY,
     actorUid:otherActor?'intruder':actor,rows:rows()};
   },
   async readPurchases(scope){
    calls.push(['purchases',scope.childId,scope.familyId]);
    return [{operationId:'79192488-bd70-4b88-8c66-3c5b5fb29ef5',
     size:'S',pieces:60,totalFen:6000}];
   },
   applyOperation(){throw Error('writes_forbidden');}
  })},
  legacyHistoryReader:{create:()=>({
   async readSettings(scope){
    calls.push(['settings',scope.childId,scope.familyId]);
    if(!historyReady)throw Error('legacy_history_reader:cloud_read_failed');
    return {complete:true,canEdit:false,canUpload:false,revision:1,
      settings:{target:{NB:100,S:100},daily:{NB:10,S:6},
       referenceOverrides:{'好奇|小森林|S':1.123}}};
   },
   async readAll(scope){
    calls.push(['history',scope.childId,scope.familyId]);
    return {complete:true,canEdit:false,canUpload:false,offset:0,total:2,
     hasMore:false,rows:[
      {kind:'transaction',id:'legacy-buy',
       payload:{id:'legacy-buy',type:'buy',size:'S',pieces:200,price:200}},
      {kind:'transaction',id:'legacy-use',
       payload:{id:'legacy-use',type:'use',size:'S',pieces:140}}
     ]};
   }
  })}
 });
 return {adapter,calls};
}
test('M3 primary view never mixes smoke S140 and never replays legacy purchases into stock',async()=>{
 const {adapter,calls}=fixture();
 const view=await adapter.read({familyId:FAMILY,actorUid:actor});
 assert.equal(view.status,'PRIMARY_READ_ONLY_READY');
 assert.equal(view.childId,PRIMARY);
 assert.equal(view.inventory.S,60);
 assert.equal(view.revisions.S,1);
 assert.equal(view.legacyHistory.total,2);
 assert.equal(view.profileData.babyProfile.name,'合成小宝');
 assert.equal(view.livePurchases.length,1);
 assert.equal(view.legacyPurchasesAppliedToInventory,false);
 assert.equal(view.canWrite,false);
 assert.equal(view.settings.referenceOverrides['好奇|小森林|S'],1.123);
 assert.ok(calls.filter(x=>['inventory','purchases','settings','history','profile'].includes(x[0]))
  .every(x=>x[1]===PRIMARY));
 assert.ok(!calls.some(x=>x.includes(SMOKE)));
 assert.equal(typeof adapter.applyOperation,'undefined');
});
test('smoke-only family must not look like an empty primary ready for upload',async()=>{
 const {adapter,calls}=fixture({primary:false});
 const result=await adapter.read({familyId:FAMILY,actorUid:actor});
 assert.equal(result.status,'PRIMARY_NOT_READY');
 assert.equal(result.canWrite,false);
 assert.equal(result.noDataImported,true);
 assert.equal(calls.some(x=>['inventory','purchases','settings','history'].includes(x[0])),false);
});
test('undeployed 024 or missing committed migration receipt fails closed',async()=>{
 const {adapter,calls}=fixture({historyReady:false});
 const result=await adapter.read({familyId:FAMILY,actorUid:actor});
 assert.equal(result.status,'MIGRATION_READ_NOT_READY');
 assert.equal(result.canWrite,false);
 assert.equal(result.noDataImported,true);
 assert.equal('inventory' in result,false);
 assert.equal(calls.some(x=>x[0]==='inventory'),false);
});
test('changing authoritative stock during read is rejected, not shown as consistent',async()=>{
 const {adapter}=fixture({changeStock:true});
 await assert.rejects(()=>adapter.read({familyId:FAMILY,actorUid:actor}),
   /primary_view:server_changed_during_read/);
});
test('server actor identity mismatch rejects even when family and child match',async()=>{
 const {adapter}=fixture({otherActor:true});
 await assert.rejects(()=>adapter.read({familyId:FAMILY,actorUid:actor}),
  /primary_view:server_scope_unverified/);
});
test('feature adapter rejects malformed inventory and never writes or reads old localStorage',()=>{
 const rows=SIZES.map(size=>({size,quantity:0,revision:0}));
 assert.equal(Model.numbers(rows).inventory.S,0);
 assert.throws(()=>Model.numbers([...rows.slice(0,5),rows[0]]),
  /primary_view:invalid_inventory/);
 assert.throws(()=>Model.numbers(rows.slice(0,5)),/primary_view:incomplete_inventory/);
 const fs=require('node:fs');
 const code=fs.readFileSync(require('node:path').join(__dirname,
  '../sync/primary-cloud-read-model.js'),'utf8');
 assert.doesNotMatch(code,/localStorage|indexedDB|\.rpc\('xb_apply_inventory/);
});
