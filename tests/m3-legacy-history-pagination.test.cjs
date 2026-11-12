const test=require('node:test');
const assert=require('node:assert/strict');
const History=require('../sync/cloudbase-legacy-history-reader.js');
const FAMILY='29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5', CHILD='59918bcb-a7bc-4b2b-a9eb-f160475fd339';
const allRows=[
 ...Array.from({length:61},(_,i)=>({kind:'quote',id:'quote-'+(i+1),ordinal:i+1,
  payload:{id:'quote-'+(i+1),size:'S',brand:'合成',series:'样品',price:1}})),
 ...Array.from({length:52},(_,i)=>({kind:'transaction',id:'tx-'+(i+1),ordinal:i+1,
  payload:{id:'tx-'+(i+1),type:'buy',size:'S',pieces:5,price:8}})),
 ...Array.from({length:8},(_,i)=>({kind:'weight',id:'weight-'+(i+1),ordinal:i+1,
  payload:{id:'weight-'+(i+1),date:'2026-11-10',weight:4.2}}))
];
function fixture(rows=allRows,{tamper,reportedTotal}={}){
 const calls=[];
 const db={rpc:async(name,args)=>{
  if(name!=='xb_read_legacy_history_page_draft')throw Error('other RPC not used');
  calls.push(args.p_offset);
  const scoped=args.p_record_kind==='all'?rows:rows.filter(r=>r.kind===args.p_record_kind);
  const total=reportedTotal?reportedTotal(args.p_offset):scoped.length;
  let page=scoped.slice(args.p_offset,args.p_offset+args.p_limit);
  if(tamper)page=tamper(args.p_offset,page);
  return {data:{complete:true,can_edit:false,can_upload:false,record_kind:args.p_record_kind,
   offset:args.p_offset,limit:args.p_limit,total,has_more:args.p_offset+page.length<total,
   rows:page}};
 }};
 const app={auth:{getSession:async()=>({data:{session:{user:{id:'dad'}},user:{id:'dad'}}})},rdb:()=>db};
 return {reader:History.create(app),calls};
}
test('M3 aggregates 121 rows across three CloudBase pages, preserves category, ordinal and ID',async()=>{
 const x=fixture();
 const result=await x.reader.readAll({familyId:FAMILY,childId:CHILD,limit:50});
 assert.equal(result.complete,true);
 assert.equal(result.total,121);
 assert.equal(result.rows.length,121);
 assert.deepEqual(x.calls,[0,50,100]);
 assert.equal(result.rows[0].id,'quote-1');
 assert.equal(result.rows[60].id,'quote-61');
 assert.equal(result.rows[61].id,'tx-1');
 assert.equal(result.rows.at(-1).id,'weight-8');
 assert.equal(result.hasMore,false);
});
test('no history is a valid complete zero-row result; one page is not invented',async()=>{
 const x=fixture([]);
 const result=await x.reader.readAll({familyId:FAMILY,childId:CHILD});
 assert.equal(result.total,0);assert.deepEqual(result.rows,[]);assert.deepEqual(x.calls,[0]);
});
test('global ordinal gap spanning page boundary is rejected',async()=>{
 const changed=allRows.map(r=>({...r}));
 changed[50].ordinal=52;
 await assert.rejects(()=>fixture(changed).reader.readAll({familyId:FAMILY,childId:CHILD}),
  /legacy_history_reader:history_global_order_or_ordinal_gap/);
});
test('same ID reported twice across separate page boundaries is rejected',async()=>{
 const changed=allRows.map(r=>({...r}));
 changed[50].id='quote-50';changed[50].payload={...changed[50].payload,id:'quote-50'};
 await assert.rejects(()=>fixture(changed).reader.readAll({familyId:FAMILY,childId:CHILD}),
  /legacy_history_reader:duplicate_history_across_pages/);
});
test('total changes after first page are rejected without showing partial history',async()=>{
 const x=fixture(allRows,{reportedTotal:o=>o===0?121:122});
 await assert.rejects(()=>x.reader.readAll({familyId:FAMILY,childId:CHILD}),
  /legacy_history_reader:history_total_changed_between_pages/);
});
test('SQL offset ceiling refuses totals requiring more than 10,050 records',async()=>{
 const x=fixture(allRows,{reportedTotal:()=>10051});
 await assert.rejects(()=>x.reader.readAll({familyId:FAMILY,childId:CHILD}),
  /legacy_history_reader:full_history_exceeds_server_offset_limit/);
});
test('page server rejection fails closed; no fallback to cached/demo history',async()=>{
 const x=fixture(allRows,{tamper:(offset,rows)=>offset===50?[]:rows});
 await assert.rejects(()=>x.reader.readAll({familyId:FAMILY,childId:CHILD}),
  /legacy_history_reader:history_page_incomplete/);
});
