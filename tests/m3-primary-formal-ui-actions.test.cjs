const test=require('node:test'),assert=require('node:assert/strict');
const Bridge=require('../sync/primary-formal-ui-actions.js');
const SIZES=['NB','S','M','L','XL','XXL'];
function fixture({build=false,approved=false,selected=true,stockChanges={},
  fresh=true}={}){
 const log=[],notifications=[];let handler;
 const primary={read:async()=>{log.push(['read']);return fresh?{
  status:'PRIMARY_CLOUD_READ_VERIFIED',
  inventory:{NB:0,S:140,M:0,L:0,XL:0,XXL:0},
  revisions:{NB:1,S:2,M:1,L:1,XL:1,XXL:1}
 }:{status:'PRIMARY_READ_UNVERIFIED'}}};
 const commands={submit:async(action,value,flags)=>{
  log.push([action,value,flags]);return {status:'PRIMARY_OPERATION_DURABLY_QUEUED'};
 }};
 const doc={
  addEventListener(type,fn,capture){
   assert.equal(type,'click');assert.equal(capture,true);handler=fn;
  },
  removeEventListener(){handler=null;},
  getElementById(id){
   const size=id.slice(4);if(!SIZES.includes(size))return null;
   return {value:String(Object.hasOwn(stockChanges,size)?stockChanges[size]:
    (size==='S'?140:0))};
  }
 };
 const ui=Bridge.create({commands,primary,
  readPurchase:()=>({size:'S',brand:'好奇',series:'小森林',pieces:60,price:100.5}),
  readQuote:()=>({size:'S',brand:'好奇',series:'小森林',pieces:5,price:7.5}),
  readTransaction:id=>id==='cloud'?{id,operationId:'04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2',
   origin:'cloud_post_migration',size:'S',reversed:false}:
   {id,origin:'legacy_migration',size:'S'},
  notify:x=>notifications.push(x.status),
  formalModeSelected:()=>selected,buildAllowsWrites:build,
  operatorApproved:()=>approved});
 const binding=ui.attach(doc);
 async function click(id,dataset={}){
  let cancelled=false;
  const el={id,dataset,closest:()=>el};
  handler?.({target:el,preventDefault(){cancelled=true},
   stopImmediatePropagation(){cancelled=true}});
  await new Promise(resolve=>setImmediate(resolve));
  return cancelled;
 }
 return {click,log,notifications,binding,doc};
}
test('no formal selection allows original editor handlers to keep working in non-formal mode',async()=>{
 const f=fixture({selected:false});
 assert.equal(await f.click('buyNow'),false);
 assert.equal(f.log.length,0);
 f.binding.detach();
});
test('default formal mode intercepts buy/use/stock/reverse without any cloud or local write',async()=>{
 const f=fixture({selected:true});
 for(const [id,attrs] of [['buyNow',{}],['',{action:'consume',size:'S',count:'1'}],
  ['saveStocks',{}]]){const props=attrs||{};
  await f.click(id,props);}
 assert.equal(f.log.length,0);
 assert.ok(f.notifications.every(x=>x==='FORMAL_CLOUD_WRITES_NOT_AUTHORIZED'));
 f.binding.detach();
});
test('authorized formal buy and consume route into existing primary command adapter',async()=>{
 const f=fixture({build:true,approved:true});
 assert.equal(await f.click('buyNow'),true);
 assert.equal(await f.click('',{action:'consume',size:'S',count:'3'}),true);
 assert.equal(f.log[0][0],'purchase');
 assert.equal(f.log[0][1].pieces,60);
 assert.equal(f.log[1][0],'consume');
 assert.equal(f.log[1][1].count,3);
});
test('one changed stocktake size maps to CAS; multiple sizes fail before any partial queue',async()=>{
 const f=fixture({build:true,approved:true,stockChanges:{S:135}});
 await f.click('saveStocks');
 assert.equal(f.log[0][0],'read');
 assert.equal(f.log[1][0],'stocktake');
 assert.deepEqual(f.log[1][1],{size:'S',count:135});
 const g=fixture({build:true,approved:true,stockChanges:{S:135,M:20}});
 await g.click('saveStocks');
 assert.deepEqual(g.log.map(x=>x[0]),['read']);
 assert.deepEqual(g.notifications,['MULTI_SIZE_STOCKTAKE_BATCH_REQUIRED']);
});
test('legacy purchase deletion is blocked; only new cloud transaction ID can produce reverse event',async()=>{
 const f=fixture({build:true,approved:true});
 await f.click('',{action:'deletetx',id:'legacy'});
 assert.equal(f.log.length,0);
 assert.equal(f.notifications.at(-1),'IMMUTABLE_LEGACY_HISTORY_NOT_REVERSIBLE');
 await f.click('',{action:'deletetx',id:'cloud'});
 assert.equal(f.log.length,1);
 assert.equal(f.log[0][0],'reverse');
 assert.equal(f.log[0][1].reversesOperationId,
  '04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2');
});
test('settings, candidate prices and growth actions fail closed until server CAS write contracts',async()=>{
 const f=fixture({build:true,approved:true});
 for(const id of ['saveQuote','saveWeight','saveProfile','savePlans','saveReference','clearQuotes'])
  assert.equal(await f.click(id),true);
 assert.equal(f.log.length,0);
 assert.ok(f.notifications.every(x=>x==='FORMAL_DOCUMENT_WRITE_CONTRACT_NOT_READY'));
});
test('quote purchase uses verified in-memory selected quote, never legacy localStorage',async()=>{
 const f=fixture({build:true,approved:true});
 await f.click('',{action:'buyquote',id:'quote'});
 assert.equal(f.log[0][0],'purchase');
 assert.equal(f.log[0][1].price,7.5);
});
