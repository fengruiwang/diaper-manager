/* M3: project verified PRIMARY cloud data into the existing five-page
 * V1.1.2 read-only view. Never updates a datastore or replays history.
 * Demo data are explicitly synthetic and are never sent to CloudBase.
 */
(function(root){
 'use strict';
 const SIZES=['NB','S','M','L','XL','XXL'];
 const clone=x=>JSON.parse(JSON.stringify(x));
 function fail(code){throw Error('primary_ui:'+code);}
 function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
 function project(view,defaults){
  if(!object(view)||!object(defaults)
    ||!['PRIMARY_READ_ONLY_READY','SYNTHETIC_PRIMARY_DEMO'].includes(view.status)
    ||view.canWrite!==false||!object(view.inventory)||!object(view.revisions)
    ||!object(view.settings)||!object(view.profileData)
    ||!object(view.profileData.babyProfile)
    ||!object(view.legacyHistory)||!Array.isArray(view.legacyHistory.rows)
    ||!Array.isArray(view.livePurchases))
   fail('unverified_read_model');
  if(view.legacyHistory.hasMore===true
    ||view.legacyHistory.rows.length!==view.legacyHistory.total)
   fail('incomplete_history_page');
  if(!SIZES.every(size=>Number.isSafeInteger(view.inventory[size])
     &&view.inventory[size]>=0
     &&Number.isSafeInteger(view.revisions[size])
     &&view.revisions[size]>=0))
   fail('invalid_stock');
  const state=clone(defaults),data=view.settings,profile=view.profileData;
  // The settings table intentionally excludes profile, original inventory and
  // record arrays: they must be sourced from dedicated verified tables.
  const allowed=['currentSize','sizeMode','autoSize','goalPrice','plannedBudget',
   'target','daily','preset','replenishPolicy','referenceOverrides'];
  for(const key of allowed){
   if(Object.prototype.hasOwnProperty.call(data,key))state[key]=clone(data[key]);
  }
  state.inventory=clone(view.inventory);
  state.dueDate=profile.dueDate;
  state.birthDate=profile.birthDate;
  state.babyWeight=profile.babyWeight;
  state.babyProfile=clone(profile.babyProfile);
  state.transactions=[];state.quotes=[];state.weightRecords=[];
  const seen=new Set();
  for(const row of view.legacyHistory.rows){
   if(!row||!['transaction','quote','weight'].includes(row.kind)
     ||!object(row.payload)||typeof row.payload.id!=='string'
     ||row.id!==row.payload.id)fail('invalid_history_row');
   const key=row.kind+':'+row.id;
   if(seen.has(key))fail('duplicate_history');
   seen.add(key);
   if(row.kind==='transaction')state.transactions.push({
    ...clone(row.payload),origin:'legacy_migration'});
   else if(row.kind==='quote')state.quotes.push(clone(row.payload));
   else state.weightRecords.push(clone(row.payload));
  }
  for(const row of view.livePurchases){
   if(!row||typeof row.operationId!=='string'||!row.operationId
     ||!SIZES.includes(row.size)||!Number.isSafeInteger(row.pieces)
     ||row.pieces<1||!Number.isSafeInteger(row.totalFen)
     ||row.totalFen<1||row.reversed===true)
    fail('invalid_post_migration_purchase');
   const id='cloud:'+row.operationId;
   if(seen.has('transaction:'+id))fail('duplicate_history');
   seen.add('transaction:'+id);
   state.transactions.push({
    id,type:'buy',date:row.purchaseDate,brand:row.brand,
    series:row.series,size:row.size,pieces:row.pieces,
    price:row.totalFen/100,operationId:row.operationId,
    reversed:row.reversed===true,origin:'cloud_post_migration'
   });
  }
  return Object.freeze({
   status:view.status,source:view.source||'unverified',canWrite:false,
   familyId:view.status==='PRIMARY_READ_ONLY_READY'?view.familyId:null,
   childId:view.status==='PRIMARY_READ_ONLY_READY'?view.childId:null,
   actorUid:view.status==='PRIMARY_READ_ONLY_READY'?view.actorUid:null,
   state:Object.freeze(state),revisions:Object.freeze(clone(view.revisions)),
   historyCount:state.transactions.length,
   quoteCount:state.quotes.length,weightCount:state.weightRecords.length,
   // This is a critical distinction: migrated purchases are display-only,
   // and state.inventory already contains the CURRENT authoritative stock.
   historicPurchasesAddedToStock:false,
   synthetic:view.status==='SYNTHETIC_PRIMARY_DEMO'
  });
 }
 function demo(){
  const rows=[
   {kind:'transaction',id:'mock-old-buy',payload:{
    id:'mock-old-buy',type:'buy',date:'2026-10-06',brand:'好奇',
    series:'小森林',size:'S',pieces:100,price:100}},
   {kind:'transaction',id:'mock-old-use',payload:{
    id:'mock-old-use',type:'use',date:'2026-10-09',size:'S',
    pieces:20,price:0}},
   {kind:'quote',id:'mock-quote-1',payload:{
    id:'mock-quote-1',date:'2026-10-05',brand:'好奇',series:'小森林',
    size:'S',per:50,packs:2,pieces:100,price:130,unit:1.3}},
   {kind:'weight',id:'mock-weight-1',payload:{
    id:'mock-weight-1',date:'2026-10-03',time:'09:20',weight:3.35,note:'模拟测量'}},
   {kind:'weight',id:'mock-weight-2',payload:{
    id:'mock-weight-2',date:'2026-11-01',time:'09:20',weight:4.25,note:'模拟测量'}}
  ];
  const inventory={NB:20,S:230,M:0,L:0,XL:0,XXL:0};
  const revisions={NB:1,S:2,M:1,L:1,XL:1,XXL:1};
  return Object.freeze({
   status:'SYNTHETIC_PRIMARY_DEMO',source:'synthetic-fixture',
   canWrite:false,inventory,revisions,
   settings:{currentSize:'S',sizeMode:'manual',autoSize:'S',goalPrice:1.5,
    plannedBudget:350,target:{NB:50,S:300,M:0,L:0,XL:0,XXL:0},
    daily:{NB:10,S:9,M:7,L:6,XL:5,XXL:5},preset:'balanced',
    replenishPolicy:{mode:'days',days:7},
    referenceOverrides:{'好奇|小森林|S':1.123}},
   profileData:{babyProfile:{name:'演示宝宝',sex:'女',birthTime:'10:00:00',
    birthWeight:3.2,birthLength:50},dueDate:'2026-10-01',
    birthDate:'2026-10-01',babyWeight:''},
   legacyHistory:{rows,total:rows.length,hasMore:false,complete:true},
   livePurchases:[{operationId:'mock-post-migration-1',size:'S',
    pieces:30,totalFen:4200,brand:'好奇',series:'小森林',
    purchaseDate:'2026-11-02',reversed:false}]
  });
 }
 const api=Object.freeze({project,demo});
 if(root)root.XBPrimaryUIProjection=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:null);
