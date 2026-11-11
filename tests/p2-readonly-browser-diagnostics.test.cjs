const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const helper=require('../cloudbase/smoke/p2-readonly-diag.js');
const page=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/p2-readonly-test.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../cloudbase/smoke/p2-readonly-diag.js'),'utf8');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5'; // synthetic only
const fakeSession={user:{id:'fake-user-only'}};
function makeApp({session=null,rpcMode='reject',leakFamily=false,unclassified=false,readDeniedTable=null}={}){
 const calls=[];
 const guard=()=>{throw Error('DIRECT_WRITE_FORBIDDEN')};
 const app={
  auth:{
   getSession:async()=>({data:{session},error:null}),
   signOut:guard
  },
  rdb:()=>({
   from(table){
    calls.push(['from',table]);
    const filters=[];
    const query={
     select(columns){calls.push(['select',table,columns]);return query;},
     eq(key,val){calls.push(['eq',table,key]);filters.push([key,val]);return query;},
     limit:async()=>{
      calls.push(['limit',table]);
      if(!session){
       return {data:leakFamily&&table==='families'?[{id:FAMILY}]:[]};
      }
      if(table===readDeniedTable)return {error:{code:'DATABASE_42501',message:'permission_denied'}};
      if(table==='families')return {data:[{id:FAMILY}]};
      if(table==='family_members')return {data:[{member_role:'owner'},{member_role:'member'}]};
      if(table==='family_app_access')return {data:[{app_code:'xb'},{app_code:'xb'}]};
      return {data:[]};
     },
     insert:guard,update:guard,delete:guard,upsert:guard
    };
    return query;
   },
   async rpc(name,args){
    calls.push(['rpc',name]);
    assert.equal(name,'xb_read_inventory_reconciliation','write RPC must not be called');
    assert.deepEqual(args.p_operation_ids,[]);
    if(rpcMode==='accepted')return {data:{complete:true}};
    if(unclassified)return {error:{code:'NETWORK_ERROR',message:'Unreachable'}};
    if(!session)return {error:{code:'DATABASE_42501',message:'authentication_required'}};
    if(args.p_family_id===FAMILY)
     return {error:{code:'DATABASE_42501',message:'child_unavailable'}};
    return {error:{code:'DATABASE_42501',message:'permission_denied'}};
   }
  })
 };
 return {app,calls};
}
test('anonymous P2-3A probes only read tables and a read RPC, no data leaks',async()=>{
 const {app,calls}=makeApp();
 const r=await helper.create(app).runAnonymous();
 assert.equal(r.status,'PASS');
 assert.equal(r.steps.length,7);
 assert.equal(r.steps.find(x=>x.name==='anonymous_reconciliation_rpc').status,'PASS');
 assert.equal(calls.filter(x=>x[0]==='rpc').length,1);
 assert.ok(calls.some(x=>x[0]==='from'&&x[1]==='xb_inventory_operations'));
 assert.ok(!JSON.stringify(r).includes(FAMILY));
});
test('anonymous check blocks when any session exists instead of signing out',async()=>{
 const {app,calls}=makeApp({session:fakeSession});
 const r=await helper.create(app).runAnonymous();
 assert.equal(r.status,'BLOCKED');
 assert.equal(calls.length,0);
});
test('authenticated check scopes to one family and refuses other family and unknown child',async()=>{
 const {app,calls}=makeApp({session:fakeSession});
 const r=await helper.create(app).runAuthenticated();
 assert.equal(r.status,'PASS');
 assert.equal(r.steps.length,10);
 assert.equal(r.steps.find(x=>x.name==='member_family').status,'PASS');
 assert.equal(r.steps.find(x=>x.name==='nonexistent_child_rejected').status,'PASS');
 assert.equal(r.steps.find(x=>x.name==='other_family_rejected').status,'PASS');
 assert.equal(calls.filter(x=>x[0]==='rpc').length,2);
 assert.ok(!JSON.stringify(r).includes(FAMILY));
 assert.ok(!JSON.stringify(r).includes('fake-user-only'));
});
test('authenticated check blocks without valid session',async()=>{
 const {app,calls}=makeApp();
 const r=await helper.create(app).runAuthenticated();
 assert.equal(r.status,'BLOCKED');
 assert.equal(calls.length,0);
});
test('unexpected successful RPC is FAIL and unclassified transport error is INCONCLUSIVE',async()=>{
 const accepted=await helper.create(makeApp({session:fakeSession,rpcMode:'accepted'}).app).runAuthenticated();
 assert.equal(accepted.status,'FAIL');
 assert.equal(accepted.steps.find(x=>x.name==='other_family_rejected').status,'FAIL');
 const network=await helper.create(makeApp({session:fakeSession,unclassified:true}).app).runAuthenticated();
 assert.equal(network.status,'INCONCLUSIVE');
});
test('member table permission error is inconclusive, not a false PASS',async()=>{
 const {app}=makeApp({session:fakeSession,readDeniedTable:'xb_inventory'});
 const result=await helper.create(app).runAuthenticated();
 assert.equal(result.status,'INCONCLUSIVE');
 assert.equal(result.steps.find(x=>x.name==='authenticated_xb_inventory').status,'INCONCLUSIVE');
});
test('anonymous leaked family row triggers FAIL',async()=>{
 const leaked=await helper.create(makeApp({leakFamily:true}).app).runAnonymous();
 assert.equal(leaked.status,'FAIL');
 assert.equal(leaked.steps.find(x=>x.name==='anonymous_families').status,'FAIL');
});
test('P2-3A page is isolated, explicit-click only, does not expose credentials or auto-run writes',()=>{
 assert.match(page,/<script src="\.\/p2-readonly-diag\.js"><\/script>/);
 assert.match(page,/shouldCreateUser:false/);
 assert.match(page,/accessKey,timeout:15000/);
 assert.match(page,/publishable'\)\.value=''/);
 assert.match(page,/otp'\)\.value=''/);
 assert.doesNotMatch(page,/\blocalStorage\b\s*(?:\[|\.setItem)/);
 assert.doesNotMatch(page,/\.signOut\s*\(/);
 assert.doesNotMatch(page,/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/);
 assert.doesNotMatch(page,/\.applyOperation\s*\(|\.flush\s*\(/);
 assert.doesNotMatch(page,/\.rpc\(\s*['"]xb_apply_inventory_operation/);
 assert.doesNotMatch(script,/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/);
 assert.doesNotMatch(script,/\.rpc\(\s*['"]xb_apply_inventory_operation/);
 assert.match(script,/db\.rpc\('xb_read_inventory_reconciliation'/);
 assert.doesNotMatch(script,/\b(?:console\.log|console\.error|innerHTML)\b/);
 assert.doesNotMatch(page,/\b(?:console\.log|console\.error|innerHTML)\b/);
});
