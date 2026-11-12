const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Gate=require('../sync/final-cutover-gate.js');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const clean=async()=>({status:'MAPPING_PREFLIGHT_CLEAN_UPLOAD_DISABLED',canUpload:false});
const bad=async()=>({status:'SILENT_DATA_CHANGE_REVIEW_REQUIRED',canUpload:false});
const state=(S=100)=>({inventory:{NB:0,S,M:0,L:0,XL:0,XXL:0},
 transactions:[{id:'old-purchase',type:'buy',size:'S',pieces:60,price:60}],
 quotes:[],weightRecords:[],referenceOverrides:{'brand|series|S':1.123},
 babyProfile:{name:'synthetic'},babyWeight:'',dueDate:'2027-01-08',
 birthDate:'',target:{NB:100,S:70},daily:{NB:10,S:9}});
const pack=(data,exportedAt='2026-11-13T01:00:00.000Z')=>
 JSON.stringify({app:'xiaobao-diapers',version:1,exportedAt,data});
const run=({sources,selectedSlot=0,allDevicesEnumerated=true,oldWritesStopped=true,
 freezeAt='2026-11-13T00:00:00.000Z',strictReview=clean}={})=>
 Gate.prepare({sources:sources.map(raw=>({raw})),selectedSlot,allDevicesEnumerated,
 oldWritesStopped,freezeAt,strictReview,digest:async raw=>sha(raw)});
test('two devices with equal business state but different export timestamp are acceptable for final manual review',async()=>{
 const a=pack(state()),b=pack(state(),'2026-11-13T02:00:00.000Z');
 const v=await run({sources:[a,b]});
 assert.equal(v.status,'CUTOVER_LOCAL_REVIEW_READY');
 assert.equal(v.sourceSha256,sha(a));
 assert.equal(v.stateSha256,sha(Gate.stable(state())));
 assert.equal(v.canUpload,false);assert.equal(v.canCommit,false);
 assert.equal(v.serverReceiptPresent,false);assert.equal(v.differences.length,0);
});
test('a newly purchased item on another browser blocks selecting arbitrary stale backup',async()=>{
 const a=pack(state()),b=pack(state(140));
 const v=await run({sources:[a,b]});
 assert.equal(v.status,'BLOCKED');assert.ok(v.issues.includes('MULTIPLE_DEVICE_STATES_DIFFER'));
 assert.ok(v.differences[0].sections.includes('inventory'));
 assert.equal(v.canUpload,false);
});
test('unknown newly introduced field is shown as divergence, not silently dropped',async()=>{
 const a=pack(state()),b=pack({...state(),newFutureField:{nested:true}});
 const v=await run({sources:[a,b]});
 assert.equal(v.status,'BLOCKED');assert.ok(v.differences[0].sections.includes('newFutureField'));
});
test('even matching data blocks before confirming all devices and stopping old writes',async()=>{
 const a=pack(state());
 const v=await run({sources:[a],allDevicesEnumerated:false,oldWritesStopped:false});
 assert.equal(v.status,'BLOCKED');
 assert.ok(v.issues.includes('DEVICE_INVENTORY_UNCONFIRMED'));
 assert.ok(v.issues.includes('OLD_VERSION_WRITES_NOT_STOPPED'));
});
test('strict preflight failure blocks all source plans despite matching inventory',async()=>{
 const v=await run({sources:[pack(state())],strictReview:bad});
 assert.equal(v.status,'BLOCKED');assert.ok(v.issues.includes('STRICT_PREFLIGHT_NOT_PASSED'));
});
test('last-minute source change invalidates a prior review and never grants upload',async()=>{
 const initial=pack(state());const v=await run({sources:[initial]});
 const changed=await Gate.verifyBeforeUpload(v,pack(state(101)),clean,async s=>sha(s));
 assert.equal(changed.status,'FINAL_EXPORT_CHANGED');assert.equal(changed.canUpload,false);
 const unchanged=await Gate.verifyBeforeUpload(v,initial,clean,async s=>sha(s));
 assert.equal(unchanged.status,'SOURCE_UNCHANGED_LOCAL_CHECK');
 assert.equal(unchanged.canUpload,false);
 assert.equal(unchanged.requiresSeparateCloudApproval,true);
});
test('improper source, unjustified approvals and invalid digest reject closed',async()=>{
 await assert.rejects(()=>run({sources:[pack(state())],selectedSlot:1}),/cutover:invalid_selected_slot/);
 await assert.rejects(()=>Gate.prepare({sources:[{raw:pack(state())}],selectedSlot:0,
  allDevicesEnumerated:true,oldWritesStopped:true,strictReview:clean,digest:async()=>''}),
  /cutover:invalid_digest/);
 await assert.rejects(()=>run({sources:['{}']}),/cutover:invalid_export_envelope/);
});

test('backup exported before final old-write stop point is stale and blocked',async()=>{
 const prior=pack(state(),'2026-11-12T23:59:59.000Z');
 const v=await run({sources:[prior]});
 assert.equal(v.status,'BLOCKED');
 assert.ok(v.issues.includes('SOURCE_EXPORTED_BEFORE_FREEZE'));
 const noStop=await run({sources:[pack(state())],freezeAt:null});
 assert.ok(noStop.issues.includes('FREEZE_TIMESTAMP_MISSING'));
});
