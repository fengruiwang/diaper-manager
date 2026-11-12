const test=require('node:test'),assert=require('node:assert/strict');
const Reader=require('../sync/legacy-migration-readback.js');
const F='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5';
const C='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
function fixture({tableError=false,truncate=false,loggedIn=true}={}){
 const calls=[];
 const app={auth:{getSession:async()=>({data:{session:loggedIn?{user:{id:'dad'}}:null}})},
  rdb:()=>({from:table=>{
   calls.push(['table',table]);
   return {select:fields=>({
    eq(key,value){calls.push([key,value]);return this;},
    async limit(max){calls.push(['limit',max]);
     if(tableError)return{error:{code:'SIMULATED'}};
     const data=table==='xb_weight_records'?[{family_id:F,child_id:C,
      legacy_record_id:'w1',measured_on:'2026-11-01',measured_at:'10:00:00',
      weight_kg:'3.250',note:'合成',deleted_at:null}]:[{
      family_id:F,child_id:C,size:'S',kind:'migration_baseline',delta:null
     }];
     return {data:truncate?Array.from({length:max},()=>data[0]):data};
    }
   })};
  }})};
 return {reader:Reader.create(app),calls};
}
test('native M2 audit reads only family + primary scoped rows with RLS session',async()=>{
 const f=fixture();
 const op=await f.reader.readBaselineOperations({familyId:F,childId:C});
 const w=await f.reader.readNativeWeights({familyId:F,childId:C});
 assert.equal(op.length,1);assert.equal(w[0].legacy_record_id,'w1');
 assert.deepEqual(f.calls.filter(x=>x[0]==='limit'),[['limit',7],['limit',10001]]);
 assert.equal(f.calls.filter(x=>x[0]==='family_id').length,2);
 assert.equal(f.calls.filter(x=>x[0]==='child_id').length,2);
});
test('no session or RLS read failure cannot satisfy native full readback',async()=>{
 const auth=fixture({loggedIn:false});
 await assert.rejects(()=>auth.reader.readNativeWeights({familyId:F,childId:C}),
  /migration_readback:session_unavailable/);
 const fail=fixture({tableError:true});
 await assert.rejects(()=>fail.reader.readBaselineOperations({familyId:F,childId:C}),
  /migration_readback:native_read_incomplete_or_unverified/);
});
test('potential truncation at server page limit is an explicit hard stop',async()=>{
 const f=fixture({truncate:true});
 await assert.rejects(()=>f.reader.readBaselineOperations({familyId:F,childId:C}),
  /migration_readback:native_read_incomplete_or_unverified/);
});
test('invalid family or child UUID cannot be sent to SQL',async()=>{
 const f=fixture();
 await assert.rejects(()=>f.reader.readNativeWeights({familyId:F,childId:'smoke'}),
  /migration_readback:invalid_scope/);
 assert.equal(f.calls.length,0);
});
