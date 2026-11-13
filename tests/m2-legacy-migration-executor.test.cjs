const test=require('node:test'),assert=require('node:assert/strict');
const Executor=require('../sync/legacy-migration-executor.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const PRIMARY='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const STAGE='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const MIGRATION='3984f752-5b02-4f81-bd15-5eb9e4b126b7';
const DIGEST='f'.repeat(64);
const sizes=['NB','S','M','L','XL','XXL'];
const source={
 inventory:{NB:10,S:23,M:0,L:0,XL:0,XXL:0},
 transactions:[{id:'old-purchase',type:'buy',date:'2026-11-01',brand:'好奇',series:'小森林',size:'S',pieces:60,price:60},
  {id:'old-use',type:'use',date:'2026-11-03',size:'S',pieces:37,price:0}],
 quotes:[{id:'old-quote',date:'2026-11-02',brand:'好奇',series:'小森林',size:'S',per:60,packs:1,pieces:60,price:60,unit:1}],
 weightRecords:[{id:'weight1',date:'2026-11-01',time:'10:00',weight:3.25,note:'合成'}],
 babyProfile:{name:'合成宝宝',sex:'男'},dueDate:'2027-01-08',birthDate:'',babyWeight:'',
 target:{NB:100,S:300},daily:{NB:10,S:9},
 referenceOverrides:{'好奇|小森林|S':1.123},preset:'balanced'
};
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture({enabled=false,receipt=false,stageAckLost=false,
 promoteAckLost=false,changed=false,receiptConflict=false,
 badBaseline=false,badNativeGrowth=false}={}){
 const raw=JSON.stringify({app:'xiaobao-diapers',version:1,
  exportedAt:'2026-11-13T02:00:00.000Z',data:source});
 const plan={status:'CUTOVER_LOCAL_REVIEW_READY',sourceSha256:DIGEST,
  differences:[],issues:[],selectedSlot:0,sourceCount:2};
 const calls=[],state={receipt,staged:false};
 const settings=copy(source);
 for(const key of ['inventory','transactions','quotes','weightRecords','babyProfile'])delete settings[key];
 const history=[
  ...source.quotes.map((payload,i)=>({kind:'quote',id:payload.id,ordinal:i+1,payload})),
  ...source.transactions.map((payload,i)=>({kind:'transaction',id:payload.id,ordinal:i+1,payload})),
  ...source.weightRecords.map((payload,i)=>({kind:'weight',id:payload.id,ordinal:i+1,payload}))
 ];
 const readHistory={
  readAll:async()=>({complete:true,total:history.length,rows:copy(history),hasMore:false}),
  readSettings:async()=>({complete:true,canEdit:false,settings:changed?
   {...settings,referenceOverrides:{}}:copy(settings)})
 };
 const db={rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='xb_stage_legacy_archive_draft'){
   state.staged=true;
   if(stageAckLost)throw Error('simulated lost response after commit');
   return {data:{status:'ARCHIVED_ONLY_NOT_MIGRATED',archive_only:true,
    can_commit:false,can_upload:false,receipt_committed:false}};
  }
  if(name==='xb_promote_legacy_archive_draft'){
   if(!state.staged)throw Error('not staged');
   state.receipt=true;
   if(promoteAckLost)throw Error('simulated lost response after commit');
   return {data:{status:'PROMOTED_HISTORY_AND_BASELINE',
     receipt_committed:true,can_upload:false}};
  }
  throw Error('no other RPC allowed');
 }};
 const executor=Executor.create({
  app:{rdb:()=>db},
  cutoverGate:{stable:function stable(x){
   if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
   if(x!==null&&typeof x==='object')
    return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
   return JSON.stringify(x);
  },
   verifyBeforeUpload:async(p,s)=>({status:s===raw?
    'SOURCE_UNCHANGED_LOCAL_CHECK':'FINAL_EXPORT_CHANGED',canUpload:false})},
  strictReview:async()=>({status:'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED'}),
  digest:async()=>DIGEST,
  receiptPreview:{inspect:async()=>({status:receiptConflict?
   'CHILD_HAS_DIFFERENT_RECEIPT':state.receipt?
   'ALREADY_RECEIPTED_SAME_SOURCE':'PLAN_ONLY_EMPTY_TARGET'})},
  resolvePrimary:async()=>({familyId:FAMILY,childId:PRIMARY,readyForMigration:false}),
  readHistory,
  readInventory:async()=>sizes.map(size=>({size,
   quantity:source.inventory[size],revision:1})),
  readPurchases:async()=>[],
  readProfile:async()=>({babyProfile:copy(source.babyProfile),dueDate:source.dueDate,
   birthDate:source.birthDate,babyWeight:source.babyWeight,
   legacySourceSha256:DIGEST}),
  readBaselineOperations:async()=>sizes.map(size=>({
   family_id:FAMILY,child_id:PRIMARY,size,kind:'migration_baseline',
   delta:null,old_quantity:0,new_quantity:badBaseline&&size==='S'?999:
    source.inventory[size],expected_revision:null,resulting_revision:1,
   legacy_transaction_id:null,reverses_operation_id:null
  })),
  readNativeWeights:async()=>source.weightRecords.map(w=>({
   family_id:FAMILY,child_id:PRIMARY,legacy_record_id:w.id,
   measured_on:w.date,measured_at:(w.time||'00:00')+':00',
   weight_kg:badNativeGrowth?4.0:w.weight,note:w.note||'',
   deleted_at:null
  })),
  cloudWritesEnabled:enabled
 });
 return {executor,plan,raw,calls,db,state,
  input:{familyId:FAMILY,childId:PRIMARY,stageId:STAGE,migrationId:MIGRATION,plan,raw,
   operatorApproved:true}};
}
test('M2 defaults to zero CloudBase writes even with an operator flag',async()=>{
 const f=fixture();
 assert.equal((await f.executor.execute(f.input)).status,'MIGRATION_WRITES_NOT_AUTHORIZED');
 assert.equal(f.calls.length,0);
});
test('M2 connects preview → 022 stage → 023 atomic promotion → 024 full readback',async()=>{
 const f=fixture({enabled:true});
 const result=await f.executor.execute(f.input);
 assert.equal(result.status,'MIGRATION_FULL_READBACK_MATCH');
 assert.equal(result.verified,true);
 assert.equal(result.stockSizes,6);
 assert.equal(result.historyCount,4);
 assert.equal(result.originalHistoricalPurchasesReplayed,false);
 assert.deepEqual(f.calls.map(x=>x.name),[
  'xb_stage_legacy_archive_draft','xb_promote_legacy_archive_draft']);
 assert.equal(f.calls[0].args.p_export_text,f.raw);
 assert.equal(f.calls[0].args.p_stage_id,STAGE);
 assert.equal(f.calls[1].args.p_migration_id,MIGRATION);
});
test('M2 requires operator approval even if separate deploy flag is on',async()=>{
 const f=fixture({enabled:true});
 const r=await f.executor.execute({...f.input,operatorApproved:false});
 assert.equal(r.status,'MIGRATION_WRITES_NOT_AUTHORIZED');assert.equal(f.calls.length,0);
});
test('M2 diff or SHA invalidation rejects before any cloud stage writes',async()=>{
 const f=fixture({enabled:true});
 const failed=await f.executor.execute({...f.input,
  plan:{...f.plan,differences:[{slot:1,sections:['inventory']}]}});
 assert.equal(failed.status,'INVALID_PRIMARY_OR_FINAL_SNAPSHOT');assert.equal(f.calls.length,0);
 const stale=await f.executor.execute({...f.input,raw:f.raw+' '});
 assert.equal(stale.status,'FINAL_EXPORT_CHANGED');assert.equal(f.calls.length,0);
});
test('stage ACK loss stops and preserves original stageId without promotion',async()=>{
 const f=fixture({enabled:true,stageAckLost:true});
 const status=await f.executor.execute(f.input);
 assert.equal(status.status,'STOP_STAGE_ACK_UNKNOWN_DO_NOT_REGENERATE_ID');
 assert.equal(f.state.staged,true);
 assert.deepEqual(f.calls.map(x=>x.name),['xb_stage_legacy_archive_draft']);
});
test('promotion ACK loss stops; a subsequent SAME-source receipt is read-only reconciled',async()=>{
 const f=fixture({enabled:true,promoteAckLost:true});
 const first=await f.executor.execute(f.input);
 assert.equal(first.status,'STOP_PROMOTION_ACK_UNKNOWN_CHECK_RECEIPT_FIRST');
 assert.equal(f.state.receipt,true);
 const second=await f.executor.execute(f.input);
 assert.equal(second.status,'MIGRATION_FULL_READBACK_MATCH');
 assert.equal(f.calls.length,2);
});
test('complete receipt does not substitute for mismatched reference prices and settings',async()=>{
 const f=fixture({enabled:true,receipt:true,changed:true});
 const r=await f.executor.execute(f.input);
 assert.equal(r.status,'PROFILE_SETTINGS_PRICE_MISMATCH');
 assert.equal(f.calls.length,0);
});
test('different existing receipt prevents staging or promotion',async()=>{
 const f=fixture({enabled:true,receiptConflict:true});
 const r=await f.executor.execute(f.input);
 assert.equal(r.status,'RECEIPT_OR_PRIMARY_TARGET_CONFLICT');assert.equal(f.calls.length,0);
});

test('completed receipt is not sufficient if any of six baseline audit operations differ',async()=>{
 const f=fixture({enabled:true,receipt:true,badBaseline:true});
 const r=await f.executor.execute(f.input);
 assert.equal(r.status,'BASELINE_OPERATION_EVENTS_MISMATCH');
 assert.equal(f.calls.length,0);
});
test('completed receipt is not sufficient if native growth rows differ',async()=>{
 const f=fixture({enabled:true,receipt:true,badNativeGrowth:true});
 const r=await f.executor.execute(f.input);
 assert.equal(r.status,'NATIVE_GROWTH_RECORDS_MISMATCH');
 assert.equal(f.calls.length,0);
});

test('B2 lost 022 ACK: explicit operator-verified recovery skips 022 and uses original migrationId',async()=>{
 const f=fixture({enabled:true,stageAckLost:true});
 assert.equal((await f.executor.execute(f.input)).status,
  'STOP_STAGE_ACK_UNKNOWN_DO_NOT_REGENERATE_ID');
 const stageReview={status:'STAGED_SAME_SOURCE_VERIFIED',operatorConfirmed:true,
  familyId:FAMILY,childId:PRIMARY,stageId:STAGE,sourceSha256:DIGEST};
 const result=await f.executor.resumeVerifiedStage({...f.input,stageReview});
 assert.equal(result.status,'MIGRATION_FULL_READBACK_MATCH');
 assert.deepEqual(f.calls.map(x=>x.name),
  ['xb_stage_legacy_archive_draft','xb_promote_legacy_archive_draft']);
 assert.equal(f.calls[1].args.p_migration_id,MIGRATION);
});
test('B2 recovery is permanently disabled by default even with operator review',async()=>{
 const f=fixture();
 const stageReview={status:'STAGED_SAME_SOURCE_VERIFIED',operatorConfirmed:true,
  familyId:FAMILY,childId:PRIMARY,stageId:STAGE,sourceSha256:DIGEST};
 assert.equal((await f.executor.resumeVerifiedStage({...f.input,stageReview})).status,
  'MIGRATION_WRITES_NOT_AUTHORIZED');
 assert.equal(f.calls.length,0);
});
test('B2 recovery rejects missing, mismatched or unconfirmed operator review',async()=>{
 const f=fixture({enabled:true});
 const clean={status:'STAGED_SAME_SOURCE_VERIFIED',operatorConfirmed:true,
  familyId:FAMILY,childId:PRIMARY,stageId:STAGE,sourceSha256:DIGEST};
 for(const stageReview of [null,{...clean,operatorConfirmed:false},
  {...clean,stageId:'e9f41d0a-9f9a-4ad1-9d44-12cb2781da92'},
  {...clean,sourceSha256:'a'.repeat(64)},{...clean,status:'STAGE_NOT_FOUND_STOP'}]){
  assert.equal((await f.executor.resumeVerifiedStage({...f.input,stageReview})).status,
   'STAGE_OPERATOR_VERIFICATION_REQUIRED');
 }
 assert.equal(f.calls.length,0);
});
test('B2 recovery with an existing same-source receipt reads only, never replays',async()=>{
 const f=fixture({enabled:true,receipt:true});
 const stageReview={status:'STAGED_SAME_SOURCE_VERIFIED',operatorConfirmed:true,
  familyId:FAMILY,childId:PRIMARY,stageId:STAGE,sourceSha256:DIGEST};
 assert.equal((await f.executor.resumeVerifiedStage({...f.input,stageReview})).status,
  'MIGRATION_FULL_READBACK_MATCH');
 assert.equal(f.calls.length,0);
});
