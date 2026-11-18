const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Model=require('../sync/primary-cloud-read-model.js');
const Access=require('../sync/cloudbase-access-preflight.js');
const Child=require('../sync/cloudbase-child-reader.js');
const Guard=require('../sync/child-scope-guard.js');
const Inventory=require('../sync/cloudbase-inventory-client.js');
const Legacy=require('../sync/cloudbase-legacy-history-reader.js');

const A='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const B='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a6';
const CHILD_A='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const CHILD_B='59918bcb-a7bc-4b2b-a9eb-f160475fd340';
const SHA1='a'.repeat(64),SHA2='b'.repeat(64);
const SIZES=['NB','S','M','L','XL','XXL'];
function fixture(n=121){
 const state={family:A,child:CHILD_A,actor:'dad',source:SHA1,
  allow:true,receipt:true,sourceQuery:true,stock:60,revision:1,
  purchases:1,uses:1,abortAt:0,brokenPage:false};
 let calls=[];
 const trace=(type,name)=>calls.push({type,name});
 const history=Array.from({length:n},(_,i)=>({
  kind:'transaction',id:'legacy-'+String(i+1),
  ordinal:i+1,payload:{id:'legacy-'+String(i+1),type:'buy',
   size:'S',pieces:1,price:1}
 }));
 const app={
  auth:{async getSession(){
   trace('session','auth.getSession');
   return {data:{session:{user:{id:state.actor}},user:{id:state.actor}}};
  }},
  rdb(){return{
   from(table){
    const filters=[];
    const q={
     select(){return q},
     eq(k,v){filters.push([k,v]);return q},
     limit(n){return Promise.resolve(rows(n))},
     then(done,fail){return Promise.resolve(rows(null)).then(done,fail)}
    };
    const matching=(k,v)=>filters.some(([key,value])=>key===k&&value===v);
    function rows(){
     trace('select',table);
     const family=matching('family_id',state.family);
     const child=matching('child_id',state.child);
     if(table==='families')
      return {data:matching('id',state.family)?[{id:state.family}]:[]};
     if(table==='family_members')
      return {data:family&&matching('user_uid',state.actor)
       ?[{family_id:state.family,user_uid:state.actor,member_role:'owner'}]:[]};
     if(table==='family_app_access')
      return {data:state.allow&&family&&matching('app_code','xb')
       ?[{family_id:state.family,user_uid:state.actor,app_code:'xb'}]:[]};
     if(table==='xb_children')
      return {data:family&&matching('legacy_slot','primary')
       ?[{id:state.child,family_id:state.family,
         display_name:'正式宝宝',legacy_slot:'primary',deleted_at:null,revision:0}]:[]};
     if(table==='xb_legacy_settings')
      return {data:state.sourceQuery&&family&&child
       ?[{family_id:state.family,child_id:state.child,source_sha256:state.source}]:[]};
     if(table==='xb_baby_profiles')
      return {data:family&&child?[{family_id:state.family,child_id:state.child,
       profile_data:{babyProfile:{name:'宝宝'},legacySourceSha256:state.source,
        birthDate:'',dueDate:'2027-01-08'}}]:[]};
     if(table==='xb_transactions')
      return {data:Array.from({length:state.purchases},(_,i)=>({
       operation_id:'11111111-1111-4111-8111-'+String(i+1).padStart(12,'0'),
       brand:'合成',series:'系列',size:'S',pieces:2,total_fen:200,
       purchase_date:'2026-11-10',reversed_by_operation_id:null,
       created_by:state.actor
      }))};
     if(table==='xb_inventory_operations')
      return {data:matching('kind','use')?Array.from({length:state.uses},(_,i)=>({
       operation_id:'22222222-2222-4222-8222-'+String(i+1).padStart(12,'0'),
       kind:'use',size:'S',delta:-1,occurred_at:'2026-11-12T08:00:00.000Z',
       actor_uid:state.actor,reverses_operation_id:null
      })):[]};
     throw Error('unexpected SELECT '+table);
    }
    return q;
   },
   async rpc(name,p){
    trace('rpc',name);
    if(name==='xb_read_legacy_settings_draft'){
     if(!state.receipt)return {error:{code:'42501'}};
     return {data:{complete:true,revision:0,can_edit:false,can_upload:false,
      settings:{target:{S:100},daily:{S:4},referenceOverrides:{}}}};
    }
    if(name==='xb_read_legacy_history_page_draft'){
     const pageNo=1+p.p_offset/p.p_limit;
     if(state.abortAt===pageNo)return {error:{code:'DATABASE_NETWORK_ERROR'}};
     const current=history.slice(p.p_offset,p.p_offset+p.p_limit);
     if(state.brokenPage&&pageNo===2)current.pop();
     return {data:{complete:true,record_kind:p.p_record_kind,
      offset:p.p_offset,limit:p.p_limit,total:history.length,
      has_more:p.p_offset+current.length<history.length,
      rows:current,can_edit:false,can_upload:false}};
    }
    if(name==='xb_read_inventory_reconciliation')return {data:{
     complete:true,family_id:state.family,child_id:state.child,
     actor_uid:state.actor,checked_operation_ids:p.p_operation_ids,
     seen_operation_ids:[],rows:SIZES.map(size=>({size,
      quantity:size==='S'?state.stock:0,
      revision:size==='S'?state.revision:0}))
    }};
    throw Error('unexpected RPC '+name);
   }
  }}
 };
 const read=(cache,customApp=app)=>Model.create({
  app:customApp,childReader:Child,scopeGuard:Guard,
  accessPreflight:Access,inventoryClient:Inventory,
  legacyHistoryReader:Legacy,historyCache:cache
 }).read({familyId:state.family,actorUid:state.actor});
 const count=(kind)=>calls.filter(x=>x.type==='rpc'&&x.name===kind).length;
 const rpcPages=()=>count('xb_read_legacy_history_page_draft');
 const countCalls=()=>({sessions:calls.filter(x=>x.type==='session').length,
  sourceSelect:calls.filter(x=>x.name==='xb_legacy_settings').length,
  profileSelect:calls.filter(x=>x.name==='xb_baby_profiles').length,
  historyPages:rpcPages(),inventorySnapshots:count('xb_read_inventory_reconciliation'),
  legacySettings:count('xb_read_legacy_settings_draft'),
  purchaseSelect:calls.filter(x=>x.name==='xb_transactions').length,
  usesSelect:calls.filter(x=>x.name==='xb_inventory_operations').length
 });
 return {state,app,read,history,clear:()=>{calls=[]},countCalls,
  cache:()=>Model.createHistoryCache()};
}
test('R-01B 121 immutable rows: 3 history RPCs then 0 on new read model; live reads stay fresh',async()=>{
 const f=fixture(121),cache=f.cache();
 const first=await f.read(cache);
 assert.equal(first.status,'PRIMARY_READ_ONLY_READY');
 assert.equal(first.legacyHistory.rows.length,121);
 assert.deepEqual(f.countCalls(),{sessions:1,sourceSelect:1,profileSelect:1,
  historyPages:3,inventorySnapshots:2,legacySettings:1,purchaseSelect:1,usesSelect:2});
 f.clear();
 f.state.stock=77;f.state.revision=4;f.state.purchases=2;f.state.uses=3;
 const second=await f.read(cache); // factory creates a new read model every call
 assert.equal(second.status,'PRIMARY_READ_ONLY_READY');
 assert.deepEqual(second.legacyHistory,first.legacyHistory);
 assert.equal(second.inventory.S,77);
 assert.equal(second.revisions.S,4);
 assert.equal(second.livePurchases.length,2);
 assert.equal(second.liveUses.length,3);
 assert.deepEqual(f.countCalls(),{sessions:1,sourceSelect:1,profileSelect:1,
  historyPages:0,inventorySnapshots:2,legacySettings:1,purchaseSelect:1,usesSelect:2});
 // A user of an old returned view cannot mutate the cache payload.
 first.legacyHistory.rows[0].payload.pieces=999;
 f.clear();const third=await f.read(cache);
 assert.equal(third.legacyHistory.rows[0].payload.pieces,1);
 assert.equal(f.countCalls().historyPages,0);
});
test('R-01B 50 rows need 1 first history RPC and 0 on subsequent verified refresh',async()=>{
 const f=fixture(50),cache=f.cache();
 assert.equal((await f.read(cache)).legacyHistory.total,50);
 assert.equal(f.countCalls().historyPages,1);
 f.clear();
 assert.equal((await f.read(cache)).legacyHistory.total,50);
 assert.equal(f.countCalls().historyPages,0);
});
test('R-01B verified source change and changed primary child each force full history download',async()=>{
 const f=fixture(121),cache=f.cache();
 await f.read(cache);f.clear();
 f.state.source=SHA2;
 assert.equal((await f.read(cache)).status,'PRIMARY_READ_ONLY_READY');
 assert.equal(f.countCalls().historyPages,3);
 f.clear();
 assert.equal((await f.read(cache)).status,'PRIMARY_READ_ONLY_READY');
 assert.equal(f.countCalls().historyPages,0);
 f.state.child=CHILD_B;f.clear();
 assert.equal((await f.read(cache)).childId,CHILD_B);
 assert.equal(f.countCalls().historyPages,3);
});
test('R-01B account or family change cannot reuse old history',async()=>{
 const f=fixture(121),cache=f.cache();
 await f.read(cache);
 f.state.actor='mom';f.clear();
 assert.equal((await f.read(cache)).actorUid,'mom');
 assert.equal(f.countCalls().historyPages,3);
 f.state.family=B;f.clear();
 assert.equal((await f.read(cache)).familyId,B);
 assert.equal(f.countCalls().historyPages,3);
 f.state.allow=false;f.clear();
 await assert.rejects(()=>f.read(cache),/access_preflight:xb_grant_unverified/);
 assert.equal(f.countCalls().historyPages,0);
});
test('R-01B logout and SDK instance switch never preserve a verified cache',async()=>{
 const f=fixture(121),cache=f.cache();
 await f.read(cache);f.clear();
 cache.invalidate(); // same controller clearing scope on sign-out or new OTP
 assert.equal((await f.read(cache)).status,'PRIMARY_READ_ONLY_READY');
 assert.equal(f.countCalls().historyPages,3);
 f.clear();
 // New CloudBase SDK app object, despite the same displayed account and family.
 const secondApp={...f.app};
 assert.equal((await f.read(cache,secondApp)).status,'PRIMARY_READ_ONLY_READY');
 assert.equal(f.countCalls().historyPages,3);
});
test('R-01B revoked migration receipt cannot succeed from existing cache',async()=>{
 const f=fixture(121),cache=f.cache();
 await f.read(cache);f.state.receipt=false;f.clear();
 const result=await f.read(cache);
 assert.equal(result.status,'MIGRATION_READ_NOT_READY');
 assert.equal(result.noDataImported,true);
 assert.equal(f.countCalls().historyPages,0);
 assert.equal(f.countCalls().inventorySnapshots,0);
});
test('R-01B incomplete page or failed 2nd history RPC never builds a partial cache',async()=>{
 for(const failure of ['offline','short-page']){
  const f=fixture(121),cache=f.cache();
  if(failure==='offline')f.state.abortAt=2;
  else f.state.brokenPage=true;
  assert.equal((await f.read(cache)).status,'MIGRATION_READ_NOT_READY',failure);
  assert.equal(f.countCalls().historyPages,2);
  f.clear();f.state.abortAt=0;f.state.brokenPage=false;
  const view=await f.read(cache);
  assert.equal(view.status,'PRIMARY_READ_ONLY_READY');
  assert.equal(view.legacyHistory.total,121);
  assert.equal(f.countCalls().historyPages,3,failure);
 }
});
test('R-01B absent verified source keeps conservative full download, not a false cache hit',async()=>{
 const f=fixture(121),cache=f.cache();
 f.state.sourceQuery=false;
 assert.equal((await f.read(cache)).status,'PRIMARY_READ_ONLY_READY');
 f.clear();
 assert.equal((await f.read(cache)).status,'PRIMARY_READ_ONLY_READY');
 assert.equal(f.countCalls().historyPages,3);
});
test('R-01B browser embedded module and controller keep cache in-memory only',()=>{
 const mod=fs.readFileSync(path.join(__dirname,
  '../sync/primary-cloud-read-model.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal/index.html'),'utf8');
 const controller=fs.readFileSync(path.join(__dirname,
  '../preview/v1.2.0/formal-controller.js'),'utf8');
 assert.ok(html.includes(mod.trim()));
 assert.match(controller,/historyCache:root\.XBPrimaryCloudReadModel\.createHistoryCache\(\)/);
 assert.match(controller,/historyCache\?\.invalidate\?\.\(\)/);
 assert.match(controller,/readModelFactory\(ctx\.app,historyCache\)/);
 assert.doesNotMatch(mod,/\blocalStorage\b|\bindexedDB\b|sessionStorage/);
});
