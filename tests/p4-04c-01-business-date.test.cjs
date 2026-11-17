const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const date=require('../sync/primary-business-date.js');
const Commands=require('../sync/primary-business-commands.js');
const UI=require('../sync/primary-ui-projection.js');
const UUID='04e4577d-8a3d-4dd1-a7d3-71f6f8eb07f2';
const samples=[
 ['2026-11-16T16:30:00.000Z','2026-11-17','Beijing 00:30'],
 ['2026-11-16T23:59:00.000Z','2026-11-17','Beijing 07:59'],
 ['2026-11-17T00:00:00.000Z','2026-11-17','Beijing 08:00'],
 ['2026-11-17T04:15:00.000Z','2026-11-17','Beijing noon'],
 ['2026-11-16T15:59:00.000Z','2026-11-16','Beijing previous day'],
 ['2026-01-31T16:30:00.000Z','2026-02-01','month rollover'],
 ['2026-12-31T16:30:00.000Z','2027-01-01','year rollover']
];
function fixture(time){
 const queued=[];let ids=0;
 const primary={cloudWritesEnabled:true,
  selectedScope:()=>({familyId:'29b28c1b-9acb-4dad-a1d2-b63b9c69e3a5',
   childId:'59918bcb-a7bc-4b2b-a9eb-f160475fd339',actorUid:'dad'}),
  read:async()=>({status:'PRIMARY_CLOUD_READ_VERIFIED',
   inventory:{NB:10,S:140,M:0,L:0,XL:0,XXL:0},
   revisions:{NB:1,S:2,M:1,L:1,XL:1,XXL:1}}),
  queue:async op=>{queued.push(op);return {status:'PRIMARY_OPERATION_DURABLY_QUEUED'};}
 };
 return {cmd:Commands.create({primary,uuid:()=>{ids++;return UUID;},clock:()=>time}),
  queued,get ids(){return ids}};
}
test('P4-04C-01 UTC slicing reproduced as previous day; CST midnight and month/year boundaries pass',()=>{
 assert.equal('2026-11-16T16:30:00.000Z'.slice(0,10),'2026-11-16');
 assert.equal('2026-11-16T23:59:00.000Z'.slice(0,10),'2026-11-16');
 for(const [utc,day,label] of samples)assert.equal(date.fromTimestamp(utc),day,label);
 assert.equal(date.fromTimestamp('2026-11-17T00:30:00+08:00'),'2026-11-17');
 assert.throws(()=>date.fromTimestamp('invalid'),/invalid_timestamp/);
});
test('P4-04C-01 host TZ independence on identical UTC instant',()=>{
 const filename=path.resolve(__dirname,'../sync/primary-business-date.js');
 const expression='process.stdout.write(require('+JSON.stringify(filename)+').fromTimestamp('+
  JSON.stringify('2026-11-16T16:30:00.000Z')+'))';
 for(const zone of ['UTC','Asia/Shanghai','America/Los_Angeles','Pacific/Auckland']){
  const p=spawnSync(process.execPath,['-e',expression],{encoding:'utf8',env:{...process.env,TZ:zone}});
  assert.equal(p.status,0,zone+': '+p.stderr);
  assert.equal(p.stdout,'2026-11-17',zone);
 }
});
test('P4-04C-01 purchase date CST with unchanged UTC timestamp, UUID, amount and money',async()=>{
 for(const [utc,day,label] of samples){
  const f=fixture(utc);
  const result=await f.cmd.submit('purchase',{
   size:'S',brand:'好奇',series:'小森林',pieces:60,price:129.95
  },{operatorApproved:true});
  assert.equal(result.status,'PRIMARY_OPERATION_DURABLY_QUEUED',label);
  assert.equal(result.operationId,UUID,label);
  assert.equal(f.ids,1,label);
  assert.equal(f.queued.length,1,label);
  const op=f.queued[0];
  assert.equal(op.id,UUID);
  assert.equal(op.type,'inventory.delta');
  assert.equal(op.expectedRevision,null);
  assert.equal(op.payload.kind,'buy');
  assert.equal(op.payload.amount,60);
  assert.equal(op.payload.purchase.totalFen,12995);
  assert.equal(op.payload.purchase.purchaseDate,day,label);
  assert.equal(op.payload.occurredAt,utc,label);
  assert.equal(op.createdAt,utc,label);
  assert.equal(new Date(op.createdAt).toISOString(),utc);
 }
});
test('P4-04C-01 consumption projects matching CST date, legacy dates and baby dates unchanged',async()=>{
 const defaults={inventory:{},transactions:[],quotes:[],weightRecords:[],babyProfile:{},
  dueDate:'',birthDate:'',target:{},daily:{},referenceOverrides:{},currentSize:'NB'};
 for(const [utc,day,label] of samples){
  const f=fixture(utc);
  await f.cmd.submit('consume',{size:'S',count:2},{operatorApproved:true});
  assert.equal(f.queued[0].payload.occurredAt,utc,label);
  assert.equal(f.queued[0].createdAt,utc,label);
  assert.equal(f.queued[0].id,UUID);
  const demo=UI.demo(),original=JSON.stringify(demo);
  const result=UI.project({...demo,
   livePurchases:[{...demo.livePurchases[0],purchaseDate:day}],
   liveUses:[{operationId:'use-test',size:'S',pieces:2,occurredAt:utc}]
  },defaults);
  assert.equal(result.state.transactions.find(x=>x.id==='cloud:use-test').date,day,label);
  assert.equal(result.state.transactions.find(x=>x.id==='cloud:mock-post-migration-1').date,day,label);
  assert.equal(result.state.transactions.find(x=>x.id==='mock-old-buy').date,'2026-10-06');
  assert.equal(result.state.transactions.find(x=>x.id==='mock-old-use').date,'2026-10-09');
  assert.equal(result.state.birthDate,demo.profileData.birthDate);
  assert.equal(result.state.dueDate,demo.profileData.dueDate);
  assert.equal(JSON.stringify(demo),original);
 }
});
test('P4-04C-01 existing queued UUID and legacy payload are untouched by creation of new operation',async()=>{
 const previous={id:UUID,createdAt:'2026-11-16T16:30:00.000Z',
  payload:{occurredAt:'2026-11-16T16:30:00.000Z',purchase:{purchaseDate:'2026-11-16'}}};
 const bytes=JSON.stringify(previous);
 const f=fixture('2026-11-16T16:30:00.000Z');
 await f.cmd.submit('purchase',{
  size:'S',brand:'好奇',series:'小森林',pieces:10,price:20
 },{operatorApproved:true});
 assert.equal(JSON.stringify(previous),bytes);
 assert.equal(f.ids,1);
 assert.equal(f.queued[0].payload.purchase.purchaseDate,'2026-11-17');
});
