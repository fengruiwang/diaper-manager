const test=require('node:test');
const assert=require('node:assert/strict');
const {validBody}=require('../sync/maternal-health-client.js');
const {history,valuesForDisplay,updateDocument,deleteDocument}
 =require('../preview/v1.3.0/maternal-constipation.js');

const draft={
 id:'synthetic-bowel',kind:'constipation',entryVersion:1,date:'2026-11-22',
 didDefecate:true,defecationCount:3,stoolType:4,difficulty:'mild',bloating:'none',
 abdominalPain:false,waterIntakeRange:'1500_1999',note:'合成记录',details:[]
};
const validate=item=>validBody({schemaVersion:1,items:[item]});

test('v1 accepts optional Bristol, 1–7 types, count 3+, and a valid no-bowel day',()=>{
 for(const stoolType of [null,1,2,3,4,5,6,7])assert.equal(validate({...draft,stoolType}),true);
 assert.equal(validate({...draft,didDefecate:false,defecationCount:0,stoolType:null,
  waterIntakeRange:null,note:''}),true);
});
test('v1 rejects inconsistent counts and invalid dates, booleans, enums and value types',()=>{
 for(const malformed of [
  {date:'2026-02-30'},{didDefecate:'true'},{defecationCount:0},{defecationCount:4},
  {defecationCount:'2'},{stoolType:8},{stoolType:undefined},{stoolType:'4'},
  {didDefecate:false,defecationCount:0},{difficulty:'unknown'},{bloating:''},
  {abdominalPain:0},{waterIntakeRange:'0_999'},{note:null},{details:null}
 ])assert.equal(validate({...draft,...malformed}),false,JSON.stringify(malformed));
});
test('legacy records read with unknown values and can be edited without losing extensions',()=>{
 const legacy={id:'legacy',kind:'constipation',date:'2026-11-20',future:{status:'legacy'},
  details:[{id:'previous-extension'}]};
 assert.equal(validate(legacy),true);
 assert.ok(valuesForDisplay(legacy).every(([,value])=>value==='未记录'));
 const body={schemaVersion:1,items:[legacy]};
 const saved=updateDocument(body,{...draft,id:legacy.id,date:legacy.date},{editing:true});
 assert.equal(validBody(saved),true);
 assert.equal(saved.items[0].id,legacy.id);
 assert.deepEqual(saved.items[0].future,legacy.future);
 assert.deepEqual(saved.items[0].details,legacy.details);
 assert.deepEqual(body.items,[legacy]);
});
test('only the selected item is editable or deletable, with no new duplicate dates',()=>{
 const weight={id:'weight',kind:'weight',date:draft.date,weightKg:50};
 const legacy={id:'legacy',kind:'constipation',date:draft.date};
 const older={id:'older',kind:'constipation',date:'2026-11-20'};
 const body={schemaVersion:1,maternalProfile:{prePregnancyWeightKg:48},metadata:{tag:'keep'},
  items:[older,legacy,weight,draft]};
 assert.deepEqual(history(body).map(item=>item.id),[legacy.id,draft.id,older.id]);
 assert.equal(updateDocument(body,{...draft,id:'duplicate'}),null);
 assert.equal(updateDocument(body,{...draft,id:older.id},{editing:true}),null);
 assert.equal(updateDocument(body,{...draft,id:'missing'},{editing:true}),null);
 assert.equal(updateDocument(body,{...draft,id:weight.id},{editing:true}),null);
 const edited=updateDocument(body,{...draft,note:'仅修改指定记录'},{editing:true});
 assert.deepEqual(edited.items.slice(0,3),body.items.slice(0,3));
 assert.deepEqual(deleteDocument(edited,draft.id),{...body,items:[older,legacy,weight]});
 assert.equal(deleteDocument(body,weight.id),null);
 assert.equal(deleteDocument(body,'missing'),null);
 assert.equal(body.items.length,4);
});
