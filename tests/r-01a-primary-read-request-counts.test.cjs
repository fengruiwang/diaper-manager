const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Model=require('../sync/primary-cloud-read-model.js');
const Access=require('../sync/cloudbase-access-preflight.js');
const Child=require('../sync/cloudbase-child-reader.js');
const ChildGuard=require('../sync/child-scope-guard.js');
const Inventory=require('../sync/cloudbase-inventory-client.js');
const Legacy=require('../sync/cloudbase-legacy-history-reader.js');

const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const BABY_A='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const BABY_B='59918bcb-a7bc-4b2b-a9eb-f160475fd340';
const SIZES=['NB','S','M','L','XL','XXL'];
const actorA='synthetic-a',actorB='synthetic-b';
function sdkFixture(){
 const events=[];
 let actor=actorA,primary=BABY_A,allowed=true,stockS=60;
 const track=(type,name)=>events.push([type,name]);
 const auth={async getSession(){
  track('session','auth.getSession');
  return {data:{user:{id:actor},session:{user:{id:actor}}}};
 }};
 const db={
  from(table){
   const filters=[];
   const q={
    select(){return q;},
    eq(name,value){filters.push([name,value]);return q;},
    limit(n){return Promise.resolve(execute(n));},
    then(resolve,reject){return Promise.resolve(execute(null)).then(resolve,reject);}
   };
   function match(key,value){return filters.some(([k,v])=>k===key&&v===value);}
   function execute(limit){
    track('select',table);
    if(table==='families')
     return {data:match('id',FAMILY)?[{id:FAMILY}]:[]};
    if(table==='family_members')
     return {data:match('family_id',FAMILY)&&match('user_uid',actor)
      ?[{family_id:FAMILY,user_uid:actor,member_role:'owner'}]:[]};
    if(table==='family_app_access')
     return {data:allowed&&match('family_id',FAMILY)
      &&match('app_code','xb')
      &&(!filters.some(([key])=>key==='user_uid')||match('user_uid',actor))
      ?[{family_id:FAMILY,user_uid:actor,app_code:'xb'}]:[]};
    if(table==='xb_children')
     return {data:match('family_id',FAMILY)&&match('legacy_slot','primary')
      ?[{id:primary,family_id:FAMILY,display_name:'正式宝宝',
         legacy_slot:'primary',deleted_at:null,revision:1}]:[]};
    if(table==='xb_baby_profiles')
     return {data:match('family_id',FAMILY)&&match('child_id',primary)
      ?[{family_id:FAMILY,child_id:primary,profile_data:{
        babyProfile:{name:'合成宝宝'},birthDate:'',dueDate:'2027-01-08'
       }}]:[]};
    if(table==='xb_transactions'||table==='xb_inventory_operations')
     return {data:[]};
    throw Error('unexpected table: '+table);
   }
   return q;
  },
  async rpc(name,args){
   track('rpc',name);
   if(name==='xb_read_inventory_reconciliation')
    return {data:{
     complete:true,family_id:args.p_family_id,child_id:args.p_child_id,
     actor_uid:actor,checked_operation_ids:args.p_operation_ids,
     seen_operation_ids:[],
     rows:SIZES.map(size=>({size,quantity:size==='S'?stockS:0,revision:size==='S'?1:0}))
    }};
   if(name==='xb_read_legacy_settings_draft')
    return {data:{complete:true,can_edit:false,can_upload:false,revision:1,
     settings:{target:{NB:100},daily:{NB:5},referenceOverrides:{}}}};
   if(name==='xb_read_legacy_history_page_draft')
    return {data:{complete:true,can_edit:false,can_upload:false,
     record_kind:args.p_record_kind,offset:args.p_offset,limit:args.p_limit,
     total:0,has_more:false,rows:[]}};
   throw Error('unexpected RPC '+name);
  }
 };
 const app={auth,rdb:()=>db};
 const totals=()=>({
  sessions:events.filter(x=>x[0]==='session').length,
  select:events.filter(x=>x[0]==='select').length,
  rpc:events.filter(x=>x[0]==='rpc').length,
  byTable:Object.fromEntries([...new Set(events.filter(x=>x[0]==='select').map(x=>x[1]))]
   .map(table=>[table,events.filter(x=>x[0]==='select'&&x[1]===table).length]))
 });
 return {app,events,totals,clear:()=>events.splice(0),
  setActor:value=>actor=value,setChild:value=>primary=value,
  setAllowed:value=>allowed=value,setStock:value=>stockS=value};
}
// A literal replay of the original unscoped adapter calls: verify family,
// re-check in child reader, then separately probe SDK session for each read
// method. This baseline counts actual mocked RDB SELECT, RPC and getSession
// executions, not number of JavaScript function definitions or calls.
function unscopedAdapters(){
 const strip=input=>{const {verifiedReadGrant,...plain}=input;return plain;};
 return {
  childReader:{create:(app,guard)=>{
   const child=Child.create(app,guard);
   return {inspectLegacyTarget:({familyId})=>child.inspectLegacyTarget({familyId})};
  }},
  inventoryClient:{create:app=>{
   const c=Inventory.create(app);
   return {
    readReconciliation:input=>c.readReconciliation(strip(input)),
    readPurchases:input=>c.readPurchases(strip(input)),
    readUses:input=>c.readUses(strip(input))
   };
  }},
  legacyHistoryReader:{create:app=>{
   const c=Legacy.create(app);
   return {
    readSettings:input=>c.readSettings(strip(input)),
    readAll:input=>c.readAll(strip(input))
   };
  }}
 };
}
function adapter(app,baseline=false){
 const old=baseline?unscopedAdapters():{};
 return Model.create({app,childReader:old.childReader||Child,
  scopeGuard:ChildGuard,accessPreflight:Access,
  inventoryClient:old.inventoryClient||Inventory,
  legacyHistoryReader:old.legacyHistoryReader||Legacy});
}
test('R-01A real SDK/RDB request counting: old unscoped complete read vs scoped complete read',async()=>{
 const old=sdkFixture();
 const first=await adapter(old.app,true).read({familyId:FAMILY,actorUid:actorA});
 assert.equal(first.status,'PRIMARY_READ_ONLY_READY');
 const before=old.totals();
 const now=sdkFixture();
 const second=await adapter(now.app).read({familyId:FAMILY,actorUid:actorA});
 assert.deepEqual(second,first,'business content, migrated history, stock and revisions unchanged');
 const after=now.totals();
 const category=stats=>({
  'auth.getSession':stats.sessions,
  families:stats.byTable.families||0,
  family_members:stats.byTable.family_members||0,
  family_app_access:stats.byTable.family_app_access||0,
  xb_children:stats.byTable.xb_children||0,
  'other SELECT':stats.select-(stats.byTable.families||0)
   -(stats.byTable.family_members||0)-(stats.byTable.family_app_access||0)
   -(stats.byTable.xb_children||0),
  'business RPC':stats.rpc,
  total:stats.sessions+stats.select+stats.rpc
 });
 assert.deepEqual(category(before),{
  'auth.getSession':8,families:2,family_members:1,
  family_app_access:2,xb_children:1,'other SELECT':4,'business RPC':4,total:22
 });
 assert.deepEqual(category(after),{
  'auth.getSession':1,families:1,family_members:1,
  family_app_access:1,xb_children:1,'other SELECT':4,'business RPC':4,total:13
 });
 // Both inventory reconciliation reads remain; neither historical RPC is removed.
 assert.deepEqual(now.events.filter(x=>x[0]==='rpc').map(x=>x[1]).sort(),
  ['xb_read_inventory_reconciliation','xb_read_inventory_reconciliation',
   'xb_read_legacy_history_page_draft','xb_read_legacy_settings_draft'].sort());
 assert.equal(now.events.some(x=>x.includes('xb_apply_inventory_operation')),false);
});
test('R-01A every new full read verifies a fresh session, member and XB grant; no caching',async()=>{
 const f=sdkFixture(),reader=adapter(f.app);
 assert.equal((await reader.read({familyId:FAMILY,actorUid:actorA})).status,'PRIMARY_READ_ONLY_READY');
 assert.equal((await reader.read({familyId:FAMILY,actorUid:actorA})).status,'PRIMARY_READ_ONLY_READY');
 assert.equal(f.totals().sessions,2);
 assert.equal(f.totals().byTable.family_members,2);
 f.setAllowed(false);f.clear();
 await assert.rejects(()=>reader.read({familyId:FAMILY,actorUid:actorA}),
  /access_preflight:xb_grant_unverified/);
 assert.deepEqual(f.totals(),{sessions:1,select:3,rpc:0,
  byTable:{families:1,family_members:1,family_app_access:1}});
});
test('R-01A switching actor and primary baby never borrows previous verified scope',async()=>{
 const f=sdkFixture(),reader=adapter(f.app);
 const a=await reader.read({familyId:FAMILY,actorUid:actorA});
 assert.equal(a.childId,BABY_A);
 f.setActor(actorB);f.clear();
 await assert.rejects(()=>reader.read({familyId:FAMILY,actorUid:actorA}),
  /access_preflight:actor_session_mismatch/);
 assert.equal(f.totals().select,0);
 const b=await reader.read({familyId:FAMILY,actorUid:actorB});
 assert.equal(b.actorUid,actorB);
 assert.equal(b.childId,BABY_A);
 f.setChild(BABY_B);f.clear();
 const second=await reader.read({familyId:FAMILY,actorUid:actorB});
 assert.equal(second.childId,BABY_B);
 assert.equal(f.totals().byTable.xb_children,1);
 assert.equal(f.totals().sessions,1);
 await assert.rejects(()=>reader.read({
  familyId:'11111111-1111-4111-8111-111111111111',actorUid:actorB
 }),/access_preflight:family_not_visible/);
});
test('R-01A fake, copied, cross-app, cross-child and expired proofs cannot skip authorization',async()=>{
 const f=sdkFixture(),preflight=Access.create(f.app);
 const plain=await preflight.verifyAccess({familyId:FAMILY,actorUid:actorA});
 assert.equal(Access.verifiedReadGrant(plain,{app:f.app,familyId:FAMILY}),false,
  'ordinary verifyAccess never grants a bypass token');
 let expired;
 const stock=Inventory.create(f.app),legacy=Legacy.create(f.app);
 await preflight.withVerifiedReadAccess({familyId:FAMILY,actorUid:actorA},async grant=>{
  expired=grant;
  const raw={...grant},child=Child.create(f.app,ChildGuard);
  f.clear();
  for(const bad of [raw,{},Object.freeze({member:true,appCode:'xb'})])
   await assert.rejects(()=>child.inspectLegacyTarget({
    familyId:FAMILY,verifiedReadGrant:bad
   }),/child_reader:verified_read_grant_required/);
  assert.equal(f.totals().select,0);
  assert.equal(Access.verifiedReadGrant(grant,{app:{...f.app},familyId:FAMILY}),false);
  const target=await child.inspectLegacyTarget({familyId:FAMILY,verifiedReadGrant:grant});
  assert.equal(target.childId,BABY_A);
  Access.bindVerifiedReadChild(grant,{
   app:f.app,familyId:FAMILY,actorUid:actorA,childId:BABY_A
  });
  await assert.rejects(()=>stock.readInventory({
   familyId:FAMILY,childId:BABY_B,verifiedReadGrant:grant
  }),/inventory_client:verified_read_grant_required/);
  await assert.rejects(()=>legacy.readSettings({
   familyId:FAMILY,childId:BABY_B,verifiedReadGrant:grant
  }),/legacy_history_reader:verified_read_grant_required/);
 });
 assert.equal(Access.verifiedReadGrant(expired,{app:f.app,familyId:FAMILY}),false);
 await assert.rejects(()=>stock.readInventory({
  familyId:FAMILY,childId:BABY_A,verifiedReadGrant:expired
 }),/inventory_client:verified_read_grant_required/);
 await assert.rejects(()=>preflight.withVerifiedReadAccess(
  {familyId:FAMILY,actorUid:actorA},async grant=>{
   expired=grant;throw Error('synthetic mid-read failure');
  }),/synthetic mid-read failure/);
 assert.equal(Access.verifiedReadGrant(expired,{app:f.app,familyId:FAMILY}),false);
 // Without a grant, standalone read adapters continue to call real SDK auth.
 f.clear();await stock.readInventory({familyId:FAMILY,childId:BABY_A});
 assert.equal(f.totals().sessions,1);
});
test('R-01A inline browser modules track the updated source, preserving the five-document client',()=>{
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 for(const file of ['cloudbase-access-preflight.js','cloudbase-child-reader.js',
   'cloudbase-inventory-client.js','cloudbase-legacy-history-reader.js',
   'primary-cloud-read-model.js']){
  const source=fs.readFileSync(path.join(__dirname,'../sync/'+file),'utf8').trim();
  assert.ok(html.includes(source),'formal HTML must load current '+file);
 }
 const scopeSource=fs.readFileSync(path.join(__dirname,
  '../sync/primary-documents-client.js'),'utf8');
 assert.match(scopeSource,/acceptVerifiedPrimary/);
 assert.match(scopeSource,/reuseReadScope/);
 assert.match(scopeSource,/Promise\.all\(KINDS\.map/);
});
