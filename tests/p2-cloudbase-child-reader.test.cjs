const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const reader=require('../sync/cloudbase-child-reader.js');
const guard=require('../sync/child-scope-guard.js');
const code=fs.readFileSync(path.join(__dirname,'../sync/cloudbase-child-reader.js'),'utf8');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const id=n=>'6b3d0e45-bf18-4c95-889c-'+String(n).padStart(12,'0');
const primary={id:id(1),family_id:FAMILY,display_name:'正式宝宝',legacy_slot:'primary',deleted_at:null,revision:0};
const smoke={id:id(2),family_id:FAMILY,display_name:'虚拟测试宝宝',legacy_slot:'__xb_smoke_v1__',deleted_at:null,revision:0};
const retired={id:id(3),family_id:FAMILY,display_name:'已停用宝宝',legacy_slot:null,deleted_at:'2026-11-11T00:00:00Z',revision:1};
const ordinary={id:id(4),family_id:FAMILY,display_name:'第二个正式宝宝',legacy_slot:null,deleted_at:null,revision:1};
function mock({
 session=true,grant=true,familyVisible=true,
 rows=[primary,smoke,retired,ordinary],throwSdk=false
}={}){
 const calls=[];
 const nope=()=>{throw Error('UNEXPECTED_MUTATION')};
 const db={
  from(table){
   calls.push({kind:'from',table});
   let filters=[];
   const q={
    select(fields){calls.push({kind:'select',table,fields});return q;},
    eq(field,val){filters.push([field,val]);return q;},
    async limit(n){
     calls.push({kind:'limit',table,filters:filters.map(([key])=>key),n});
     if(throwSdk)throw Error('Backend body contains hidden token: NEVER LOG');
     if(table==='families')return {data:familyVisible?[{id:FAMILY}]:[]};
     if(table==='family_app_access')return {data:grant?[{app_code:'xb'},{app_code:'xb'}]:[]};
     if(table==='xb_children'){
      return {data:rows.filter(row=>filters.every(([k,v])=>row[k]===v)).slice(0,n)};
     }
     throw Error('UNEXPECTED_TABLE');
    },
    insert:nope,update:nope,upsert:nope,delete:nope
   };
   return q;
  },
  rpc:nope
 };
 return {app:{auth:{getSession:async()=>({data:{session:session?{user:{id:'fake'}}:null}})},rdb:()=>db},calls};
}
test('member can read only active business children; smoke and retired rows never escape',async()=>{
 const {app,calls}=mock();
 const x=reader.create(app,guard);
 const r=await x.listActiveChildren({familyId:FAMILY});
 assert.equal(r.totalVisible,4);
 assert.equal(r.suppressedCount,2);
 assert.deepEqual(r.activeChildren.map(y=>y.displayName),['正式宝宝','第二个正式宝宝']);
 assert.ok(!JSON.stringify(r).includes('虚拟测试宝宝'));
 assert.ok(!JSON.stringify(r).includes(id(2)));
 const childQuery=calls.find(c=>c.kind==='select'&&c.table==='xb_children');
 assert.match(childQuery.fields,/legacy_slot/);
 assert.match(childQuery.fields,/deleted_at/);
 assert.equal(calls.filter(c=>c.kind==='from').length,3);
 assert.equal(Object.isFrozen(r.activeChildren),true);
});
test('migration target is explicit active primary only, never auto-imports history',async()=>{
 const r=await reader.create(mock().app,guard).inspectLegacyTarget({familyId:FAMILY});
 assert.equal(r.childId,id(1));
 assert.equal(r.readyForMigration,false);
 await assert.rejects(
  ()=>reader.create(mock({rows:[smoke,ordinary]}).app,guard).inspectLegacyTarget({familyId:FAMILY}),
  /legacy_primary_unavailable/);
 await assert.rejects(
  ()=>reader.create(mock({rows:[{...primary,deleted_at:'2026-11-11T02:00:00Z'}]}).app,guard)
   .inspectLegacyTarget({familyId:FAMILY}),
  /legacy_primary_unavailable/);
});
test('missing server child classification fields aborts instead of displaying unknown row',async()=>{
 const broken={...primary};
 delete broken.legacy_slot;
 await assert.rejects(
  ()=>reader.create(mock({rows:[broken]}).app,guard).listActiveChildren({familyId:FAMILY}),
  /unclassified_child_rows/);
});
test('no session or no xb grant cannot be mistaken for empty nursery',async()=>{
 for(const cfg of [{session:false},{grant:false},{familyVisible:false}]){
  const {app}=mock(cfg);
  await assert.rejects(
   ()=>reader.create(app,guard).listActiveChildren({familyId:FAMILY}),
   /login_required|app_access_denied|family_access_denied/);
 }
});
test('duplicate IDs and oversized data fail closed',async()=>{
 const app=mock({rows:[primary,primary]}).app;
 await assert.rejects(
  ()=>reader.create(app,guard).listActiveChildren({familyId:FAMILY}),
  /invalid_child_rows/);
 const big=Array.from({length:101},(_,i)=>({...primary,id:id(i+200),legacy_slot:null}));
 await assert.rejects(
  ()=>reader.create(mock({rows:big}).app,guard).listActiveChildren({familyId:FAMILY}),
  /child_limit_exceeded/);
});
test('SDK failures are sanitized and never include raw exception messages',async()=>{
 const {app}=mock({throwSdk:true});
 await assert.rejects(
  ()=>reader.create(app,guard).listActiveChildren({familyId:FAMILY}),
  e=>e.message==='child_reader:cloudbase_query_failed');
});
test('invalid IDs and incompatible dependencies are rejected before requests',async()=>{
 const {app,calls}=mock();
 await assert.rejects(
  ()=>reader.create(app,guard).listActiveChildren({familyId:'bad-id'}),
  /invalid_family_id/);
 assert.equal(calls.length,0);
 assert.throws(()=>reader.create({},guard),/dependencies_required/);
});
test('cloud-child reader contains no direct writes, RPCs, storage or OTP interactions',()=>{
 assert.doesNotMatch(code,/\.rpc\s*\(|\.(?:insert|update|delete|upsert)\s*\(/);
 assert.doesNotMatch(code,/\b(?:localStorage|indexedDB|sessionStorage|fetch|WebSocket|signInWithOtp)\s*(?:\(|\.|\[)/);
 assert.match(code,/readyForMigration:false/);
 assert.match(code,/id,family_id,display_name,legacy_slot,deleted_at,revision/);
});
